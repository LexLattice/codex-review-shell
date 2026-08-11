"use strict";

const {
  buildEpistemicRecord,
  digestFor,
  exactRef,
  text,
} = require("./kernel");

const LUNA_TRANSCRIPTION_MODEL = "gpt-5.6-luna";
const LUNA_TRANSCRIPTION_EFFORT = "low";
const LUNA_RESIDUE_LIMITS = Object.freeze({
  maxItems: 32,
  maxCharsPerItem: 12_000,
  maxTotalChars: 48_000,
});
const ATTRIBUTED_LINGUISTIC_TYPES = Object.freeze([
  "AgentClaim",
  "AgentInterpretation",
  "DeclaredBlocker",
  "DeclaredCompletion",
  "AgentActionDescription",
]);

const LUNA_TRANSCRIPTION_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["descriptions"],
  properties: {
    descriptions: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "statement", "evidence_refs"],
        properties: {
          kind: { type: "string", enum: [...ATTRIBUTED_LINGUISTIC_TYPES] },
          statement: { type: "string", minLength: 1, maxLength: 1200 },
          evidence_refs: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: { type: "string" },
          },
        },
      },
    },
  },
});

function sourceRefForEvent(sessionId, turnId, event) {
  const digest = text(event?.sourceEnvelopeDigest) || digestFor({ sessionId, turnId, event });
  const sequence = Number(event?.sequence ?? 0);
  const persistedIndex = Number(event?.persistedIndex ?? sequence);
  return {
    ...exactRef("direct_normalized_event", `${sessionId}:${turnId}:${persistedIndex}:${text(event?.type, "event")}`, digest),
    label: `${text(event?.type, "event")} #${persistedIndex}`,
  };
}

function toolResultSourceRef(sessionId, turnId, result, index) {
  const digest = digestFor({ sessionId, turnId, result });
  return {
    ...exactRef("direct_tool_result", `${sessionId}:${turnId}:${text(result?.obligationId, String(index))}`, digest),
    label: `tool result ${index + 1}`,
  };
}

function rawText(value) {
  return typeof value === "string" ? value : "";
}

function actorAttribution(session = {}, turn = {}) {
  const actorId = text(
    turn.agentId || turn.agentRunId || session.agentId || session.agentRunId,
    "unknown_actor",
  );
  const hasIdentityMetadata = Boolean(
    text(turn.agentId || turn.agentRunId || turn.agentThreadId) ||
    text(session.agentId || session.agentRunId || session.agentThreadId),
  );
  return {
    actorId,
    actorKind: text(turn.agentKind || session.agentKind, "unknown"),
    agentThreadId: text(turn.agentThreadId || session.agentThreadId),
    parentThreadId: text(turn.parentThreadId || session.parentThreadId),
    primaryThreadId: text(turn.primaryThreadId || session.primaryThreadId),
    role: text(turn.agentRole || session.agentRole),
    confidence: hasIdentityMetadata ? "session_turn_metadata" : "unknown",
  };
}

function occurrenceSourceForEvent(event = {}) {
  return {
    kind: "direct_normalized_event",
    producer: "direct_provider_transport",
    eventType: text(event?.type, "unknown_event"),
    sourceSequence: Number.isFinite(Number(event?.sequence)) ? Number(event.sequence) : null,
    persistedIndex: Number.isFinite(Number(event?.persistedIndex)) ? Number(event.persistedIndex) : null,
  };
}

function recordForEvent(input, event, recordInput) {
  const attribution = actorAttribution(input.session, input.turn);
  return buildEpistemicRecord({
    subject: input.subject,
    oRevision: input.oRevision,
    eRevision: input.eRevision,
    standing: "mechanically_observed",
    actor: attribution.actorId,
    attribution,
    occurrenceSource: occurrenceSourceForEvent(event),
    scope: {
      kind: "direct_turn",
      sessionId: text(input.session?.sessionId),
      turnId: text(input.turn?.turnId),
    },
    quantification: { kind: "observed_occurrence" },
    epistemicPromotion: false,
    ...recordInput,
  });
}

function deterministicThreadRecords(input = {}) {
  const sessionId = text(input.session?.sessionId);
  const turnId = text(input.turn?.turnId);
  const events = Array.isArray(input.events) ? input.events : [];
  const records = [];
  for (const event of events) {
    if (!event?.type) continue;
    const sourceRef = sourceRefForEvent(sessionId, turnId, event);
    const eventOrdinal = Number(event.persistedIndex ?? event.sequence ?? 0);
    const semanticBase = `thread:${sessionId}:turn:${turnId}:event:${eventOrdinal}:${event.type}`;
    if (event.type === "session_started") {
      records.push(recordForEvent(input, event, {
        recordType: "ProviderResponseStarted",
        semanticKey: semanticBase,
        facet: "execution",
        payload: {
          model: text(event.model, text(input.turn?.model, input.session?.model)),
          responseIdentityDigest: event.responseId ? digestFor(event.responseId) : "",
        },
        sourceRefs: [sourceRef],
      }));
      continue;
    }
    if (event.type === "message_delta" || event.type === "reasoning_delta") {
      const content = rawText(event.text);
      records.push(recordForEvent(input, event, {
        recordType: event.type === "message_delta" ? "AgentUtteranceFragment" : "AgentReasoningFragment",
        semanticKey: semanticBase,
        facet: "linguistic_residue",
        payload: {
          itemIdentity: text(event.itemId),
          textDigest: digestFor(content),
          characterCount: content.length,
          visibility: text(event.visibility, event.type === "message_delta" ? "assistant_output" : "opaque"),
          rawTextPersisted: false,
        },
        sourceRefs: [sourceRef],
      }));
      continue;
    }
    if (["tool_call_started", "tool_call_completed"].includes(event.type)) {
      records.push(recordForEvent(input, event, {
        recordType: "ToolInvocation",
        semanticKey: `thread:${sessionId}:turn:${turnId}:tool:${text(event.callId || event.itemId, String(eventOrdinal))}:${event.type}`,
        facet: "tool_activity",
        payload: {
          phase: event.type === "tool_call_started" ? "started" : "arguments_completed",
          name: text(event.name, "tool_call"),
          namespace: text(event.namespace),
          toolType: text(event.toolType, "unknown"),
          argumentsDigest: event.argumentsJson ? digestFor(event.argumentsJson) : "",
          rawArgumentsPersisted: false,
        },
        sourceRefs: [sourceRef],
      }));
      continue;
    }
    if (event.type === "usage_delta") {
      records.push(recordForEvent(input, event, {
        recordType: "UsageObservation",
        semanticKey: semanticBase,
        facet: "usage",
        payload: {
          inputTokens: Number(event.usage?.inputTokens || 0),
          cachedInputTokens: Number(event.usage?.cachedInputTokens || 0),
          outputTokens: Number(event.usage?.outputTokens || 0),
          reasoningTokens: Number(event.usage?.reasoningTokens || 0),
          totalTokens: Number(event.usage?.totalTokens || 0),
        },
        sourceRefs: [sourceRef],
      }));
      continue;
    }
    if (["response_completed", "response_incomplete", "response_failed", "transport_error", "auth_error", "quota_error", "aborted"].includes(event.type)) {
      records.push(recordForEvent(input, event, {
        recordType: "TurnOutcome",
        semanticKey: semanticBase,
        facet: "execution_outcome",
        payload: {
          outcome: event.type,
          stopReason: text(event.stopReason || event.reason),
          errorCode: text(event.code),
          retryable: event.retryable === true,
          responseIdentityDigest: event.responseId ? digestFor(event.responseId) : "",
        },
        sourceRefs: [sourceRef],
      }));
    }
  }

  for (const [index, result] of (Array.isArray(input.turn?.toolResults) ? input.turn.toolResults : []).entries()) {
    const sourceRef = toolResultSourceRef(sessionId, turnId, result, index);
    records.push(recordForEvent(input, null, {
      recordType: "ToolResult",
      semanticKey: `thread:${sessionId}:turn:${turnId}:tool-result:${text(result?.obligationId, String(index))}`,
      facet: "tool_activity",
      payload: {
        obligationIdentity: text(result?.obligationId),
        status: text(result?.status || result?.outcome, "recorded"),
        exitCode: Number.isFinite(Number(result?.exitCode)) ? Number(result.exitCode) : null,
        resultDigest: digestFor(result),
        rawOutputPersisted: false,
      },
      occurrenceSource: {
        kind: "direct_tool_result",
        producer: "direct_tool_runtime",
        obligationId: text(result?.obligationId),
        resultIndex: index,
      },
      sourceRefs: [sourceRef],
    }));
  }
  return records;
}

function omissionWitness(input = {}) {
  const witness = {
    code: text(input.code),
    evidenceRef: text(input.evidenceRef),
    fullTextDigest: text(input.fullTextDigest),
    includedCharacterCount: Number(input.includedCharacterCount || 0),
    omittedCharacterCount: Number(input.omittedCharacterCount || 0),
    omittedItemCount: Number(input.omittedItemCount || 0),
  };
  return {
    ...witness,
    witnessDigest: digestFor(witness),
  };
}

function groupedLinguisticResidue(input = {}) {
  const sessionId = text(input.session?.sessionId);
  const turnId = text(input.turn?.turnId);
  const groups = new Map();
  for (const event of Array.isArray(input.events) ? input.events : []) {
    const content = rawText(event?.text);
    if (event?.type !== "message_delta" || !content.length) continue;
    const key = text(event.itemId, "assistant_message");
    const group = groups.get(key) || { itemId: key, text: "", segments: [] };
    group.text += content;
    group.segments.push({
      text: content,
      sourceRef: sourceRefForEvent(sessionId, turnId, event),
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function sourceRefsForPrefix(segments = [], characterCount = 0) {
  let remaining = Math.max(0, Number(characterCount || 0));
  const refs = [];
  for (const segment of segments) {
    if (remaining <= 0) break;
    const content = rawText(segment?.text);
    if (!content.length) continue;
    refs.push(segment.sourceRef);
    remaining -= Math.min(remaining, content.length);
  }
  return refs;
}

function buildBoundedLinguisticResidue(input = {}) {
  const sessionId = text(input.session?.sessionId);
  const turnId = text(input.turn?.turnId);
  const attribution = actorAttribution(input.session, input.turn);
  const groups = groupedLinguisticResidue(input);
  const residue = [];
  const omissions = [];
  let remainingCharacters = LUNA_RESIDUE_LIMITS.maxTotalChars;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (residue.length >= LUNA_RESIDUE_LIMITS.maxItems || remainingCharacters <= 0) {
      const omittedGroups = groups.slice(index);
      omissions.push(omissionWitness({
        code: residue.length >= LUNA_RESIDUE_LIMITS.maxItems
          ? "residue_item_limit_reached"
          : "residue_total_character_limit_reached",
        fullTextDigest: digestFor(omittedGroups.map((entry) => ({
          itemId: entry.itemId,
          textDigest: digestFor(entry.text),
        }))),
        omittedCharacterCount: omittedGroups.reduce((sum, entry) => sum + entry.text.length, 0),
        omittedItemCount: omittedGroups.length,
      }));
      break;
    }

    const includedCharacterCount = Math.min(
      group.text.length,
      LUNA_RESIDUE_LIMITS.maxCharsPerItem,
      remainingCharacters,
    );
    const includedText = group.text.slice(0, includedCharacterCount);
    const fullTextDigest = digestFor(group.text);
    const sourceRefs = sourceRefsForPrefix(group.segments, includedCharacterCount);
    const evidenceDigest = digestFor({
      sessionId,
      turnId,
      itemId: group.itemId,
      text: includedText,
      fullTextDigest,
      includedCharacterCount,
      sourceRefs,
    });
    const evidenceRef = `direct_message_projection:${sessionId}:${turnId}:${group.itemId}:${evidenceDigest.slice(0, 16)}`;
    residue.push({
      evidence_ref: evidenceRef,
      evidence_digest: evidenceDigest,
      actor: attribution.actorId,
      attribution,
      text: includedText,
      full_text_digest: fullTextDigest,
      included_character_count: includedCharacterCount,
      source_refs: sourceRefs,
    });
    remainingCharacters -= includedCharacterCount;

    if (includedCharacterCount < group.text.length) {
      omissions.push(omissionWitness({
        code: includedCharacterCount === LUNA_RESIDUE_LIMITS.maxCharsPerItem
          ? "residue_item_character_limit_reached"
          : "residue_total_character_limit_reached",
        evidenceRef,
        fullTextDigest,
        includedCharacterCount,
        omittedCharacterCount: group.text.length - includedCharacterCount,
      }));
    }
  }

  return {
    residue,
    omissions,
    constraints: { ...LUNA_RESIDUE_LIMITS },
  };
}

function linguisticResidue(input = {}) {
  return buildBoundedLinguisticResidue(input).residue;
}

function buildLunaTranscriptionRequest(input = {}) {
  const bounded = buildBoundedLinguisticResidue(input);
  const residue = bounded.residue;
  const sourceDigest = digestFor(bounded);
  const providerResidue = residue.map((entry) => ({
    evidence_ref: entry.evidence_ref,
    actor: entry.actor,
    attribution: entry.attribution,
    text: entry.text,
  }));
  return {
    model: LUNA_TRANSCRIPTION_MODEL,
    reasoningEffort: LUNA_TRANSCRIPTION_EFFORT,
    outputSchema: LUNA_TRANSCRIPTION_OUTPUT_SCHEMA,
    textFormatName: "direct_epistemic_thread_transcription",
    sourceDigest,
    instructions: [
      "You are a source-faithful event transcriber, not an auditor or task reasoner.",
      "Convert only explicit actor statements into typed definite descriptions.",
      "Preserve attribution: an agent interpretation is not a fact about the world.",
      "Do not decide correctness, progress, readiness, strategy, blockers not explicitly declared, or hidden motives.",
      "Use only evidence_ref values present in the input. Omit anything that cannot be grounded exactly.",
    ].join(" "),
    prompt: JSON.stringify({
      contract: "typed_compression_without_epistemic_promotion",
      constraints: bounded.constraints,
      omissions: bounded.omissions,
      residue: providerResidue,
    }),
    residue,
    omissions: bounded.omissions,
    constraints: bounded.constraints,
  };
}

function recordsFromLunaOutput(input = {}, output = {}) {
  const allowed = new Map(
    linguisticResidue(input).map((entry) => [entry.evidence_ref, entry]),
  );
  const descriptions = Array.isArray(output?.descriptions) ? output.descriptions : [];
  const attribution = actorAttribution(input.session, input.turn);
  const actor = attribution.actorId;
  const records = [];
  for (const [index, description] of descriptions.entries()) {
    const kind = text(description?.kind);
    const statement = text(description?.statement);
    const evidenceIds = [...new Set((Array.isArray(description?.evidence_refs) ? description.evidence_refs : [])
      .map((value) => text(value))
      .filter((value) => allowed.has(value)))];
    if (!ATTRIBUTED_LINGUISTIC_TYPES.includes(kind) || !statement || !evidenceIds.length) continue;
    const evidenceRefs = evidenceIds.map((id) => {
      const evidence = allowed.get(id);
      return {
        ...exactRef("direct_message_projection", id, evidence.evidence_digest),
        label: "assistant message projection",
      };
    });
    const sourceRefs = evidenceIds.flatMap((id) => allowed.get(id).source_refs || []);
    records.push(buildEpistemicRecord({
      subject: input.subject,
      oRevision: input.oRevision,
      eRevision: input.eRevision,
      recordType: kind,
      semanticKey: `thread:${input.session.sessionId}:turn:${input.turn.turnId}:luna:${kind}:${index}:${digestFor({ statement, evidenceIds }).slice(0, 16)}`,
      facet: kind === "AgentInterpretation" ? "agent_interpretation" : "agent_statement",
      predicate: kind,
      scope: {
        kind: "direct_turn",
        sessionId: text(input.session?.sessionId),
        turnId: text(input.turn?.turnId),
      },
      quantification: { kind: "actor_attributed_statement" },
      actor,
      attribution,
      occurrenceSource: {
        kind: "model_transcription",
        producer: LUNA_TRANSCRIPTION_MODEL,
        evidenceProjectionRefs: evidenceIds,
      },
      standing: "attributed",
      payload: {
        statement,
        attributedTo: actor,
        transcriberModel: LUNA_TRANSCRIPTION_MODEL,
      },
      evidenceRefs,
      sourceRefs,
      epistemicPromotion: false,
    }));
  }
  return records;
}

module.exports = {
  ATTRIBUTED_LINGUISTIC_TYPES,
  LUNA_RESIDUE_LIMITS,
  LUNA_TRANSCRIPTION_EFFORT,
  LUNA_TRANSCRIPTION_MODEL,
  LUNA_TRANSCRIPTION_OUTPUT_SCHEMA,
  actorAttribution,
  buildBoundedLinguisticResidue,
  buildLunaTranscriptionRequest,
  deterministicThreadRecords,
  linguisticResidue,
  recordsFromLunaOutput,
  sourceRefForEvent,
};
