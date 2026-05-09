"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const RENDERER_TRANSCRIPT_PROJECTION_KIND = "renderer_transcript";
const COMPACT_TRANSCRIPT_PROJECTION_KIND = "compact_transcript";
const RENDERER_TRANSCRIPT_PROJECTION_VERSION = "renderer_transcript@1";
const COMPACT_TRANSCRIPT_PROJECTION_VERSION = "compact_transcript@1";
const RENDERER_TRANSCRIPT_BUILDER_VERSION = "direct_renderer_transcript_builder@1";
const COMPACT_TRANSCRIPT_BUILDER_VERSION = "direct_compact_transcript_builder@1";
const RENDERER_TRANSCRIPT_POLICY_ID = "direct_renderer_transcript_policy@1";
const COMPACT_TRANSCRIPT_POLICY_ID = "direct_compact_transcript_policy@1";
const MAX_RENDERER_PROJECTION_ITEMS = 2000;
const MAX_RENDERER_ITEM_TEXT_CHARS = 16_000;
const MAX_RENDERER_TOTAL_TEXT_CHARS = 1_000_000;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 4096;
const MAX_COMPACT_ITEM_TEXT_CHARS = 2_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeIdPart(value) {
  return String(value || "item").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "item";
}

function projectionItemId(projectionId, ordinal) {
  return `${projectionId}_item_${String(ordinal).padStart(4, "0")}`;
}

function canonicalSourceDigest(input) {
  return sha256(stableStringify({
    schema: "renderer_transcript_projection_source@1",
    threadId: input.threadId,
    projectionKind: input.projectionKind,
    projectionVersion: input.projectionVersion,
    builderVersion: input.builderVersion,
    policyId: input.policyId,
    policyVersion: input.policyId,
    sourceManifestDigests: input.sourceManifestDigests || [],
    sourceTurnDigests: input.sourceTurnDigests || [],
    normalizedEventRangeDigests: input.normalizedEventRangeDigests || [],
    operationLedgerHeadDigest: input.operationLedgerHeadDigest || "",
    schemaVersion: input.schemaVersion || "1",
    securityPolicyVersion: "renderer_raw_exposure_scan@1",
    caps: {
      maxItems: MAX_RENDERER_PROJECTION_ITEMS,
      maxTextCharsPerItem: MAX_RENDERER_ITEM_TEXT_CHARS,
      maxTotalTextChars: MAX_RENDERER_TOTAL_TEXT_CHARS,
      maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
    },
  }));
}

function readJsonLines(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizedEventFromLine(line) {
  if (isPlainObject(line?.event)) return line.event;
  return isPlainObject(line) ? line : {};
}

function truncateText(text, maxChars) {
  const value = optionalText(text);
  if (value.length <= maxChars) return { text: value, truncated: false, omittedChars: 0 };
  return {
    text: value.slice(0, maxChars),
    truncated: true,
    omittedChars: value.length - maxChars,
  };
}

function scanTextForRawExposure(text) {
  const value = optionalText(text);
  const findings = [];
  const blockPatterns = [
    { reason: "secret_pattern", pattern: /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]{8,}/i },
    { reason: "secret_pattern", pattern: /\bcookie\s*:\s*[^;\s=]+=[^\s;]{6,}/i },
    { reason: "secret_pattern", pattern: /\b(access_token|refresh_token|id_token|session_id|csrf)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/i },
    { reason: "raw_backend_frame", pattern: /\bresponse\.(output_item|function_call|created|completed)\b.*\{.*\}/i },
    { reason: "raw_path", pattern: /(^|\s)([A-Za-z]:\\|\\\\wsl\$\\|\/(?:home|mnt|Users|tmp)\/)[^\s]+/ },
  ];
  for (const { reason, pattern } of blockPatterns) {
    if (pattern.test(value)) findings.push({ severity: "block", reason });
  }
  if (/\b(authorization|cookie|access token|refresh token|bearer)\b/i.test(value) && !findings.length) {
    findings.push({ severity: "warn", reason: "sensitive_keyword_without_value" });
  }
  return findings;
}

function mergeOmittedCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (Number(target[key]) || 0) + (Number(value) || 0);
  }
  return target;
}

function sourceClassForSession(session = {}) {
  const sourceClass = normalizeString(session.sourceClass, "");
  if (sourceClass) return sourceClass;
  if (session.importedSessionReadOnly === true) return "imported-readonly";
  if (session.nativeDirectSession === true && session.parentImportLineage) return "import-checkpoint-continuation";
  if (session.nativeDirectSession === true) return "direct-native";
  return "direct-native";
}

function continuityStateForSourceClass(session = {}, sourceClass = sourceClassForSession(session)) {
  if (session.providerContinuityAvailable === true) return "provider_continuity_available";
  if (["imported-readonly", "derived-projection", "merged-projection"].includes(sourceClass)) return "non_runnable_projection";
  if (["direct-native", "import-checkpoint-continuation", "forked-direct-native"].includes(sourceClass)) return "fresh_session_only";
  return "unknown";
}

function composerHintForSourceClass(session = {}, sourceClass = sourceClassForSession(session)) {
  if (sourceClass === "imported-readonly") return "imported-readonly";
  if (["derived-projection", "merged-projection"].includes(sourceClass)) return "non-runnable-projection";
  if (sourceClass === "import-checkpoint-continuation") return "checkpoint-continuation";
  return "direct-native";
}

function enabledByProjectionForSourceClass(session = {}, sourceClass = sourceClassForSession(session)) {
  if (["imported-readonly", "derived-projection", "merged-projection"].includes(sourceClass)) return false;
  return session.nativeDirectSession === true;
}

function itemSourceDigest(sourceRef) {
  return sha256(stableStringify(sourceRef));
}

function buildStableSourceItemKey(sourceRef, itemKind, ordinalHint) {
  return sha256(stableStringify({
    sourceRef,
    itemKind,
    ordinalHint,
  })).slice(0, 32);
}

function createProjectionItem({
  projectionId,
  ordinal,
  threadId,
  turnId,
  itemKind,
  role = "harness",
  phase = "diagnostic",
  status = "complete",
  text = "",
  sourceRef,
  omittedCounts = {},
  maxChars = MAX_RENDERER_ITEM_TEXT_CHARS,
  extraPayload = {},
}) {
  const truncated = truncateText(text, maxChars);
  const sourceDigest = normalizeString(sourceRef?.sourceDigest, "") || itemSourceDigest(sourceRef);
  const stableSourceItemKey = buildStableSourceItemKey({ ...sourceRef, sourceDigest }, itemKind, ordinal);
  const payload = {
    itemId: projectionItemId(projectionId, ordinal),
    stableSourceItemKey,
    projectionId,
    ordinal,
    threadId,
    turnId: normalizeString(turnId, ""),
    itemKind,
    role,
    phase,
    status,
    text: truncated.text,
    textDigest: sha256(truncated.text),
    textTruncated: truncated.truncated,
    omittedCounts: {
      ...omittedCounts,
      ...(truncated.omittedChars ? { text_chars: truncated.omittedChars } : {}),
    },
    sourceRef: {
      ...sourceRef,
      sourceDigest,
    },
    flags: {
      rendererSafe: true,
      executable: false,
      approvalAvailable: false,
      composerEnabledByItem: false,
      rawPathExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
      ...extraPayload.flags,
    },
    ...extraPayload,
  };
  return payload;
}

function inputText(input) {
  if (typeof input === "string") return input;
  if (!isPlainObject(input)) return "";
  if (typeof input.text === "string") return input.text;
  if (typeof input.content === "string") return input.content;
  if (Array.isArray(input.content)) {
    return input.content.map((part) => optionalText(part?.text || part?.content)).join("");
  }
  return "";
}

function messageText(message) {
  if (typeof message === "string") return message;
  if (!isPlainObject(message)) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.items)) {
    return message.items
      .filter((item) => item?.type === "text" || item?.type === "output_text" || item?.type === "message")
      .map((item) => optionalText(item.text || item.contentItems || item.result))
      .join("");
  }
  return "";
}

function groupEventsByType(events) {
  const result = {
    messageText: "",
    reasoningSummaryText: "",
    reasoningUnsafeCount: 0,
    toolCalls: [],
    responseCompleted: false,
    responseFailed: false,
  };
  const toolCallsByKey = new Map();
  for (const event of events) {
    if (event.type === "message_delta") result.messageText += optionalText(event.text);
    else if (event.type === "reasoning_delta") {
      if (event.visibility === "summary" || event.rendererSafe === true) result.reasoningSummaryText += optionalText(event.text);
      else result.reasoningUnsafeCount += 1;
    } else if (event.type === "tool_call_started" || event.type === "tool_call_delta" || event.type === "tool_call_completed") {
      const key = normalizeString(event.callId || event.itemId || event.name, `tool_${toolCallsByKey.size + 1}`);
      const existing = toolCallsByKey.get(key) || {
        itemId: normalizeString(event.itemId, ""),
        callId: normalizeString(event.callId, ""),
        name: normalizeString(event.name, "tool_call"),
        namespace: normalizeString(event.namespace, ""),
        toolType: normalizeString(event.toolType, ""),
        argumentsText: "",
        status: "waiting",
      };
      if (event.type === "tool_call_delta") existing.argumentsText += optionalText(event.argumentsDelta);
      if (event.type === "tool_call_completed") {
        existing.status = "complete";
        existing.name = normalizeString(event.name, existing.name);
        existing.argumentsText = normalizeString(event.argumentsJson, existing.argumentsText);
      }
      toolCallsByKey.set(key, existing);
    } else if (event.type === "response_completed") result.responseCompleted = true;
    else if (event.type === "response_failed") result.responseFailed = true;
  }
  result.toolCalls = [...toolCallsByKey.values()];
  return result;
}

function buildTurnProjectionItems({ projectionId, session, turn, events, sourceRefs, startOrdinal, capsState }) {
  const items = [];
  let ordinal = startOrdinal;
  const turnId = normalizeString(turn.turnId, "");
  const threadId = normalizeString(session.sessionId, "");
  const baseRef = {
    rolloutId: normalizeString(sourceRefs.rolloutId, ""),
    sessionId: threadId,
    turnId,
    sourceArtifactKind: "direct-turn-json",
    sourceDigest: normalizeString(sourceRefs.turnDigests?.get(turnId), ""),
  };
  for (const input of Array.isArray(turn.input) ? turn.input : []) {
    if (normalizeString(input?.role, "user") !== "user") continue;
    const text = inputText(input);
    if (!text) continue;
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "user_message",
      role: "user",
      phase: "initial",
      text,
      sourceRef: { ...baseRef, sourceArtifactKind: "direct-turn-json" },
    }));
  }
  const grouped = groupEventsByType(events);
  if (grouped.reasoningSummaryText) {
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "thought_summary",
      role: "assistant",
      phase: "reasoning",
      text: grouped.reasoningSummaryText,
      sourceRef: {
        ...baseRef,
        sourceArtifactKind: "normalized-events-jsonl",
        sourceEventStartSeq: 1,
        sourceEventEndSeq: events.length,
        sourceDigest: normalizeString(sourceRefs.eventDigests?.get(turnId), ""),
      },
    }));
  }
  if (grouped.reasoningUnsafeCount) capsState.omittedCounts.reasoning_unsafe = (capsState.omittedCounts.reasoning_unsafe || 0) + grouped.reasoningUnsafeCount;
  for (const toolCall of grouped.toolCalls) {
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "tool_call",
      role: "harness",
      phase: "diagnostic",
      status: toolCall.status,
      text: `${toolCall.name}${toolCall.argumentsText ? ` ${toolCall.argumentsText}` : ""}`,
      sourceRef: {
        ...baseRef,
        sourceArtifactKind: "normalized-events-jsonl",
        sourceEventStartSeq: 1,
        sourceEventEndSeq: events.length,
        sourceDigest: normalizeString(sourceRefs.eventDigests?.get(turnId), ""),
      },
      extraPayload: {
        tool: {
          name: toolCall.name,
          namespace: toolCall.namespace,
          toolType: toolCall.toolType,
          callId: toolCall.callId,
          itemId: toolCall.itemId,
        },
      },
    }));
  }
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  const toolResults = Array.isArray(turn.toolResults) ? turn.toolResults : [];
  for (const result of toolResults) {
    const text = normalizeString(result.summary || result.textPreview || result.status, "tool result recorded");
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "tool_result",
      role: "tool",
      phase: "diagnostic",
      text,
      maxChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
      omittedCounts: result.truncated === true ? { tool_result_truncated: 1 } : {},
      sourceRef: { ...baseRef, sourceArtifactKind: "direct-turn-json" },
      extraPayload: {
        result: {
          resultClass: normalizeString(result.resultClass, ""),
          truncated: result.truncated === true,
          binary: result.binary === true,
        },
      },
    }));
  }
  for (const obligation of obligations) {
    if (toolResults.some((result) => result.obligationId === obligation.obligationId)) continue;
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "approval_decision",
      role: "harness",
      phase: "diagnostic",
      status: normalizeString(obligation.status, "waiting"),
      text: `${normalizeString(obligation.name, "tool_call")} ${normalizeString(obligation.status, "waiting")}`,
      sourceRef: { ...baseRef, sourceArtifactKind: "direct-turn-json" },
    }));
  }
  if (grouped.messageText) {
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "assistant_message",
      role: "assistant",
      phase: "final",
      text: grouped.messageText,
      sourceRef: {
        ...baseRef,
        sourceArtifactKind: "normalized-events-jsonl",
        sourceEventStartSeq: 1,
        sourceEventEndSeq: events.length,
        sourceDigest: normalizeString(sourceRefs.eventDigests?.get(turnId), ""),
      },
    }));
  } else {
    const assistantMessages = (Array.isArray(session.messages) ? session.messages : [])
      .filter((message) => message?.turnId === turnId && normalizeString(message.role, "") === "assistant")
      .map(messageText)
      .filter(Boolean);
    for (const text of assistantMessages) {
      items.push(createProjectionItem({
        projectionId,
        ordinal: ordinal++,
        threadId,
        turnId,
        itemKind: "assistant_message",
        role: "assistant",
        phase: "final",
        text,
        sourceRef: { ...baseRef, sourceArtifactKind: "direct-session-json", sourceDigest: normalizeString(sourceRefs.sessionDigest, "") },
      }));
    }
  }
  if (!grouped.messageText && !grouped.responseCompleted && normalizeString(turn.state, "") !== "completed") {
    const errorMessage = normalizeString(turn.error?.message, "");
    items.push(createProjectionItem({
      projectionId,
      ordinal: ordinal++,
      threadId,
      turnId,
      itemKind: "status",
      role: "harness",
      phase: "diagnostic",
      status: normalizeString(turn.state, "unknown"),
      text: errorMessage ? `Turn ${turn.state}: ${errorMessage}` : `Turn ${normalizeString(turn.state, "unknown")}`,
      sourceRef: { ...baseRef, sourceArtifactKind: "direct-turn-json" },
    }));
  }
  return { items, nextOrdinal: ordinal };
}

function applyProjectionCaps(items, capsState) {
  const capped = [];
  let totalChars = 0;
  for (const item of items) {
    if (capped.length >= MAX_RENDERER_PROJECTION_ITEMS) {
      capsState.truncated = true;
      capsState.omittedCounts.items = (capsState.omittedCounts.items || 0) + 1;
      continue;
    }
    const remaining = MAX_RENDERER_TOTAL_TEXT_CHARS - totalChars;
    if (remaining <= 0) {
      capsState.truncated = true;
      capsState.omittedCounts.total_text_chars = (capsState.omittedCounts.total_text_chars || 0) + item.text.length;
      continue;
    }
    if (item.text.length > remaining) {
      capped.push({
        ...item,
        text: item.text.slice(0, remaining),
        textDigest: sha256(item.text.slice(0, remaining)),
        textTruncated: true,
        omittedCounts: {
          ...item.omittedCounts,
          total_text_chars: (item.omittedCounts.total_text_chars || 0) + item.text.length - remaining,
        },
      });
      capsState.truncated = true;
      totalChars += remaining;
      continue;
    }
    totalChars += item.text.length;
    capped.push(item);
  }
  return capped;
}

function scanProjectionItems(items) {
  const warnings = [];
  const blockers = [];
  for (const item of items) {
    for (const finding of scanTextForRawExposure(item.text)) {
      const entry = { ...finding, itemId: item.itemId, itemKind: item.itemKind };
      if (finding.severity === "block") blockers.push(entry);
      else warnings.push(entry);
    }
  }
  return { warnings, blockers };
}

function projectionDigestFor(projection, items) {
  return sha256(stableStringify({
    projection: {
      projectId: projection.projectId,
      threadId: projection.threadId,
      projectionKind: projection.projectionKind,
      projectionVersion: projection.projectionVersion,
      builderVersion: projection.builderVersion,
      policyId: projection.policyId,
      source: projection.source,
      safety: projection.safety,
      caps: projection.caps,
      continuity: projection.continuity,
      lifecycle: projection.lifecycle,
    },
    items: items.map((item) => ({
      stableSourceItemKey: item.stableSourceItemKey,
      ordinal: item.ordinal,
      itemKind: item.itemKind,
      status: item.status,
      textDigest: item.textDigest,
      sourceRef: item.sourceRef,
    })),
  }));
}

function readTurnEvents(sessionStore, sessionId, turnId) {
  return readJsonLines(sessionStore.eventPath(sessionId, turnId)).map(normalizedEventFromLine);
}

function buildRendererTranscriptProjection(input = {}) {
  const { sessionStore, session, turns = [], rollout = {}, operationManifest = {}, nowMs } = input;
  if (!sessionStore) throw new Error("Renderer transcript projection requires a session store.");
  if (!isPlainObject(session)) throw new Error("Renderer transcript projection requires a session.");
  const threadId = normalizeString(session.sessionId, "");
  const projectId = normalizeString(session.projectId, "");
  const createdAt = nowIso(nowMs);
  const projectionId = normalizeString(input.projectionId, "") || `projection_renderer_${sha256(`${threadId}:${createdAt}:${Math.random()}`).slice(0, 18)}`;
  const sessionPath = sessionStore.sessionPath(session.sessionId);
  const sessionDigest = fileSha256(sessionPath);
  const turnDigests = new Map();
  const eventDigests = new Map();
  const normalizedEventRangeDigests = [];
  const sourceTurnDigests = [];
  const orderedTurns = [...turns].sort((a, b) => {
    const sessionOrder = new Map((Array.isArray(session.turns) ? session.turns : []).map((summary, index) => [summary.turnId, index]));
    return (sessionOrder.get(a.turnId) ?? 9999) - (sessionOrder.get(b.turnId) ?? 9999)
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  const eventsByTurn = new Map();
  for (const turn of orderedTurns) {
    const turnPath = sessionStore.turnPath(session.sessionId, turn.turnId);
    const turnDigest = fileSha256(turnPath);
    turnDigests.set(turn.turnId, turnDigest);
    sourceTurnDigests.push(turnDigest);
    const eventPath = sessionStore.eventPath(session.sessionId, turn.turnId);
    const events = readTurnEvents(sessionStore, session.sessionId, turn.turnId);
    eventsByTurn.set(turn.turnId, events);
    if (fs.existsSync(eventPath)) {
      const digest = fileSha256(eventPath);
      eventDigests.set(turn.turnId, digest);
      normalizedEventRangeDigests.push(digest);
    }
  }
  const sourceManifestDigests = [normalizeString(rollout.manifest_digest || rollout.manifestDigest, "") || sessionDigest].filter(Boolean);
  const operationLedgerHeadDigest = normalizeString(operationManifest.hashChainHead, "");
  const sourceDigest = canonicalSourceDigest({
    threadId,
    projectionKind: RENDERER_TRANSCRIPT_PROJECTION_KIND,
    projectionVersion: RENDERER_TRANSCRIPT_PROJECTION_VERSION,
    builderVersion: RENDERER_TRANSCRIPT_BUILDER_VERSION,
    policyId: RENDERER_TRANSCRIPT_POLICY_ID,
    sourceManifestDigests,
    sourceTurnDigests,
    normalizedEventRangeDigests,
    operationLedgerHeadDigest,
  });
  const sourceClass = sourceClassForSession(session);
  const capsState = {
    truncated: false,
    omittedCounts: {},
  };
  let items = [];
  let ordinal = 1;
  for (const turn of orderedTurns) {
    const built = buildTurnProjectionItems({
      projectionId,
      session,
      turn,
      events: eventsByTurn.get(turn.turnId) || [],
      sourceRefs: {
        rolloutId: normalizeString(rollout.rollout_id || rollout.rolloutId, ""),
        sessionDigest,
        turnDigests,
        eventDigests,
      },
      startOrdinal: ordinal,
      capsState,
    });
    items = items.concat(built.items);
    ordinal = built.nextOrdinal;
  }
  if (!items.length && Array.isArray(session.messages)) {
    for (const message of session.messages) {
      const text = messageText(message);
      if (!text) continue;
      items.push(createProjectionItem({
        projectionId,
        ordinal: ordinal++,
        threadId,
        turnId: normalizeString(message.turnId, ""),
        itemKind: normalizeString(message.role, "") === "user" ? "user_message" : "assistant_message",
        role: normalizeString(message.role, "assistant"),
        phase: normalizeString(message.role, "") === "user" ? "initial" : "final",
        text,
        sourceRef: {
          rolloutId: normalizeString(rollout.rollout_id || rollout.rolloutId, ""),
          sessionId: threadId,
          turnId: normalizeString(message.turnId, ""),
          sourceArtifactKind: "direct-session-json",
          sourceDigest: sessionDigest,
        },
      }));
    }
  }
  items = applyProjectionCaps(items, capsState);
  for (const item of items) mergeOmittedCounts(capsState.omittedCounts, item.omittedCounts);
  const scan = scanProjectionItems(items);
  const blocked = scan.blockers.length > 0;
  const projection = {
    projectionId,
    projectId,
    threadId,
    projectionKind: RENDERER_TRANSCRIPT_PROJECTION_KIND,
    projectionVersion: RENDERER_TRANSCRIPT_PROJECTION_VERSION,
    builderVersion: RENDERER_TRANSCRIPT_BUILDER_VERSION,
    policyId: RENDERER_TRANSCRIPT_POLICY_ID,
    status: blocked ? "blocked" : "valid",
    staleReason: "",
    securityReason: blocked ? scan.blockers[0].reason : "",
    unsafeForRenderer: blocked,
    unsafeForContextBuild: true,
    createdAt,
    source: {
      rolloutIds: [normalizeString(rollout.rollout_id || rollout.rolloutId, "")].filter(Boolean),
      sessionId: threadId,
      operationIds: [],
      eventRangeDigest: sha256(stableStringify(normalizedEventRangeDigests)),
      sourceProjectionIds: [],
      sourceManifestDigest: sourceManifestDigests[0] || "",
      sourceDigest,
      operationLedgerHeadDigest,
    },
    safety: {
      rendererSafe: !blocked,
      rawPathExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
      rawRequestBodyExposed: false,
      rawImportedJsonlExposed: false,
      unboundedToolResultExposed: false,
      warnings: scan.warnings,
      blockers: scan.blockers,
    },
    caps: {
      maxItems: MAX_RENDERER_PROJECTION_ITEMS,
      maxTextCharsPerItem: MAX_RENDERER_ITEM_TEXT_CHARS,
      maxTotalTextChars: MAX_RENDERER_TOTAL_TEXT_CHARS,
      maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
      truncated: capsState.truncated,
      omittedCounts: capsState.omittedCounts,
    },
    continuity: {
      sourceClass,
      nativeDirectSession: session.nativeDirectSession === true,
      providerContinuityAvailable: session.providerContinuityAvailable === true,
      composer: {
        projectionHint: composerHintForSourceClass(session, sourceClass),
        enabledByProjection: enabledByProjectionForSourceClass(session, sourceClass),
        authoritative: false,
        controlAuthority: "runtime-status",
      },
      continuityState: continuityStateForSourceClass(session, sourceClass),
    },
    lifecycle: {
      state: "active",
      operationIds: [],
      rendererListVisible: true,
    },
    integrity: {
      projectionDigest: "",
      algorithm: "sha256",
    },
  };
  projection.integrity.projectionDigest = projectionDigestFor(projection, items);
  return {
    projection,
    items,
    sourceDigest,
  };
}

function compactKindForItem(item) {
  if (item.itemKind === "user_message") return "turn_user_intent";
  if (item.itemKind === "assistant_message") return "turn_assistant_result";
  if (item.itemKind === "tool_call" || item.itemKind === "tool_result" || item.itemKind === "approval_decision") return "tool_evidence_summary";
  if (item.itemKind === "checkpoint_seed") return "import_evidence_summary";
  return "status_summary";
}

function buildCompactTranscriptProjection(input = {}) {
  const rendererProjection = input.rendererProjection;
  const rendererItems = Array.isArray(input.rendererItems) ? input.rendererItems : [];
  if (!isPlainObject(rendererProjection) || rendererProjection.status !== "valid" || rendererProjection.unsafeForRenderer === true) {
    throw new Error("Compact transcript projection requires a valid renderer transcript projection.");
  }
  const createdAt = nowIso(input.nowMs);
  const projectionId = normalizeString(input.projectionId, "") || `projection_compact_${sha256(`${rendererProjection.projectionId}:${createdAt}:${Math.random()}`).slice(0, 18)}`;
  const items = rendererItems.map((item, index) => {
    const truncated = truncateText(item.text, MAX_COMPACT_ITEM_TEXT_CHARS);
    return {
      itemId: projectionItemId(projectionId, index + 1),
      stableSourceItemKey: sha256(`${item.stableSourceItemKey}:compact`).slice(0, 32),
      projectionId,
      ordinal: index + 1,
      threadId: rendererProjection.threadId,
      turnId: normalizeString(item.turnId, ""),
      itemKind: "compact_summary",
      role: "harness",
      phase: "diagnostic",
      status: item.status || "complete",
      text: truncated.text,
      textDigest: sha256(truncated.text),
      textTruncated: truncated.truncated,
      omittedCounts: {
        ...(item.omittedCounts || {}),
        ...(truncated.omittedChars ? { compact_text_chars: truncated.omittedChars } : {}),
      },
      sourceRef: {
        rolloutId: normalizeString(item.sourceRef?.rolloutId, ""),
        sessionId: normalizeString(item.sourceRef?.sessionId, ""),
        turnId: normalizeString(item.sourceRef?.turnId, ""),
        sourceArtifactKind: "projection-item",
        sourceDigest: item.textDigest,
      },
      summaryKind: compactKindForItem(item),
      sourceRendererItemIds: [item.itemId],
      sourceStableItemKeys: [item.stableSourceItemKey],
      flags: {
        rendererSafe: true,
        usableForContextBuild: false,
        rawPathExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
        executable: false,
        approvalAvailable: false,
        composerEnabledByItem: false,
      },
    };
  });
  const sourceDigest = canonicalSourceDigest({
    threadId: rendererProjection.threadId,
    projectionKind: COMPACT_TRANSCRIPT_PROJECTION_KIND,
    projectionVersion: COMPACT_TRANSCRIPT_PROJECTION_VERSION,
    builderVersion: COMPACT_TRANSCRIPT_BUILDER_VERSION,
    policyId: COMPACT_TRANSCRIPT_POLICY_ID,
    sourceManifestDigests: [rendererProjection.integrity?.projectionDigest || rendererProjection.projectionDigest],
    sourceTurnDigests: rendererItems.map((item) => item.textDigest),
    normalizedEventRangeDigests: [],
    operationLedgerHeadDigest: rendererProjection.source?.operationLedgerHeadDigest,
  });
  const projection = {
    projectionId,
    projectId: rendererProjection.projectId,
    threadId: rendererProjection.threadId,
    projectionKind: COMPACT_TRANSCRIPT_PROJECTION_KIND,
    projectionVersion: COMPACT_TRANSCRIPT_PROJECTION_VERSION,
    builderVersion: COMPACT_TRANSCRIPT_BUILDER_VERSION,
    policyId: COMPACT_TRANSCRIPT_POLICY_ID,
    status: "valid",
    staleReason: "",
    securityReason: "",
    unsafeForRenderer: false,
    unsafeForContextBuild: true,
    createdAt,
    source: {
      rolloutIds: rendererProjection.source?.rolloutIds || [],
      sessionId: normalizeString(rendererProjection.source?.sessionId, ""),
      operationIds: rendererProjection.source?.operationIds || [],
      eventRangeDigest: rendererProjection.source?.eventRangeDigest || "",
      sourceProjectionIds: [rendererProjection.projectionId],
      sourceManifestDigest: rendererProjection.integrity?.projectionDigest || "",
      sourceDigest,
      operationLedgerHeadDigest: rendererProjection.source?.operationLedgerHeadDigest || "",
    },
    safety: {
      rendererSafe: true,
      rawPathExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
      rawRequestBodyExposed: false,
      rawImportedJsonlExposed: false,
      unboundedToolResultExposed: false,
      deterministicOnly: true,
      usableForContextBuild: false,
    },
    caps: {
      maxItems: MAX_RENDERER_PROJECTION_ITEMS,
      maxTextCharsPerItem: MAX_COMPACT_ITEM_TEXT_CHARS,
      maxTotalTextChars: MAX_RENDERER_TOTAL_TEXT_CHARS,
      maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
      truncated: items.some((item) => item.textTruncated),
      omittedCounts: items.reduce((counts, item) => mergeOmittedCounts(counts, item.omittedCounts), {}),
    },
    continuity: rendererProjection.continuity,
    lifecycle: rendererProjection.lifecycle,
    integrity: {
      projectionDigest: "",
      algorithm: "sha256",
    },
  };
  projection.integrity.projectionDigest = projectionDigestFor(projection, items);
  return {
    projection,
    items,
    sourceDigest,
  };
}

module.exports = {
  COMPACT_TRANSCRIPT_BUILDER_VERSION,
  COMPACT_TRANSCRIPT_POLICY_ID,
  COMPACT_TRANSCRIPT_PROJECTION_KIND,
  COMPACT_TRANSCRIPT_PROJECTION_VERSION,
  MAX_RENDERER_ITEM_TEXT_CHARS,
  MAX_RENDERER_PROJECTION_ITEMS,
  MAX_RENDERER_TOTAL_TEXT_CHARS,
  MAX_TOOL_RESULT_PREVIEW_CHARS,
  RENDERER_TRANSCRIPT_BUILDER_VERSION,
  RENDERER_TRANSCRIPT_POLICY_ID,
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  RENDERER_TRANSCRIPT_PROJECTION_VERSION,
  buildCompactTranscriptProjection,
  buildRendererTranscriptProjection,
  canonicalSourceDigest,
  scanTextForRawExposure,
  stableStringify,
};
