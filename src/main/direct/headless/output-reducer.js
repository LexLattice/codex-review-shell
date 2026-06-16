"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  digestFor,
  normalizeString,
  sha256,
  stableStringify,
} = require("./bridge-store");

const HEADLESS_OUTPUT_REDUCER_SCHEMA = "headless_output_reducer@1";
const REDUCER_MODES = new Set([
  "markdown_summary_only",
  "json_contract_required",
  "human_review_required",
  "artifact_only",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nowIso() {
  return new Date().toISOString();
}

function safeSlug(value = "", fallback = "artifact") {
  const text = normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || fallback;
}

function reducerConfig(route = {}) {
  const configured = isPlainObject(route.outputReducer)
    ? route.outputReducer
    : isPlainObject(route.output_reducer)
      ? route.output_reducer
      : {};
  const reducerRef = normalizeString(route.outputReducerRef || route.output_reducer_ref, "");
  const reducerMode = normalizeString(
    configured.reducerMode ||
      configured.reducer_mode ||
      (REDUCER_MODES.has(reducerRef) ? reducerRef : ""),
    "",
  );
  if (!reducerMode || reducerRef === "terminal-result-only" || reducerRef === "none") {
    return {
      enabled: false,
      reducerMode: "",
      reducerId: reducerRef || "none",
      reducerVersion: "v1",
    };
  }
  return {
    schema: HEADLESS_OUTPUT_REDUCER_SCHEMA,
    enabled: REDUCER_MODES.has(reducerMode),
    reducerId: normalizeString(configured.reducerId || configured.reducer_id || reducerRef, reducerMode),
    reducerVersion: normalizeString(configured.reducerVersion || configured.reducer_version, "v1"),
    reducerMode,
    artifactSubdir: safeSlug(configured.artifactSubdir || configured.artifact_subdir || reducerMode, reducerMode),
    promptSummary: normalizeString(configured.promptSummary || configured.prompt_summary, "Review headless result."),
    choices: Array.isArray(configured.choices) ? configured.choices : [],
  };
}

function assistantTextFromSessionTurn(session = {}, turnId = "") {
  const turn = (Array.isArray(session.messages) ? session.messages : []).find((message) => message.id === turnId);
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return items
    .filter((item) => item?.type === "agentMessage" || item?.role === "assistant")
    .map((item) => normalizeString(item.text, ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function jsonContractTextFromAssistant(assistantText = "") {
  let jsonText = normalizeString(assistantText, "");
  if (!jsonText.startsWith("```")) return jsonText;
  const fenced = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : jsonText;
}

function defaultHumanChoices() {
  return [
    {
      choiceId: "accept",
      label: "Accept",
      description: "Accept the reduced result as local context.",
      consequenceClass: "informational",
    },
    {
      choiceId: "revise",
      label: "Revise",
      description: "Request a later revision path; free text remains context only.",
      consequenceClass: "informational",
    },
    {
      choiceId: "reject",
      label: "Reject",
      description: "Reject the reduced result.",
      consequenceClass: "informational",
    },
  ];
}

function reducedBase({ packet = {}, route = {}, config = {}, assistantText = "" } = {}) {
  const outputDigest = assistantText ? sha256(assistantText) : "";
  return {
    packetId: normalizeString(packet.packetId, ""),
    sourceEnvelopeId: normalizeString(packet.envelopeId, ""),
    routeId: normalizeString(packet.routeId, ""),
    routeVersion: normalizeString(packet.routeVersion, ""),
    routeDigest: normalizeString(packet.routeDigest, ""),
    reducerId: config.reducerId,
    reducerVersion: config.reducerVersion,
    reducerMode: config.reducerMode,
    sourceOutputDigest: outputDigest,
    contextBuildId: normalizeString(packet.contextBuildId, ""),
    requestManifestId: normalizeString(packet.requestManifestId, ""),
    inferenceWitness: {
      providerProfileId: normalizeString(packet.providerProfileId, ""),
      model: normalizeString(packet.model || route.model || route.targetThreadRef?.model, ""),
      reasoningEffort: normalizeString(packet.reasoningEffort || route.reasoningEffort || route.targetThreadRef?.reasoningEffort, ""),
      serviceTier: normalizeString(packet.serviceTier || route.serviceTier || route.targetThreadRef?.serviceTier, ""),
      authorityBoundaryRef: normalizeString(route.authorityBoundaryRef || route.authority_boundary_ref, ""),
    },
    evidenceRefs: [{
      kind: "headless_output_reducer",
      rendererSafeLabel: "Headless output reducer",
      artifactDigest: digestFor("headless-output-reducer-input", {
        packetId: packet.packetId,
        routeDigest: packet.routeDigest,
        reducerId: config.reducerId,
        reducerVersion: config.reducerVersion,
        sourceOutputDigest: outputDigest,
      }),
    }],
    rawOutputIncluded: false,
    rawProviderPayloadIncluded: false,
    rawPathIncluded: false,
  };
}

function writeArtifact({ store, reducedResult, assistantText = "", artifactRoot = "" } = {}) {
  const root = normalizeString(artifactRoot, "");
  if (!root) return { action: null, receipt: null };
  const actionId = `headless_outbox_${sha256(`${reducedResult.resultId}:write_artifact`).slice(7, 31)}`;
  const fileName = `${safeSlug(reducedResult.reducerId)}-${safeSlug(reducedResult.resultId)}.md`;
  const relPath = path.join(safeSlug(reducedResult.reducerMode, "output"), fileName);
  const absolutePath = path.resolve(root, relPath);
  const rootResolved = path.resolve(root);
  if (!absolutePath.startsWith(`${rootResolved}${path.sep}`)) {
    const action = store.writeOutboxAction({
      actionId,
      sourceEnvelopeId: reducedResult.sourceEnvelopeId,
      routeId: reducedResult.routeId,
      actionKind: "write_artifact",
      status: "failed",
      reducedResultId: reducedResult.resultId,
      failureCode: "artifact_path_escape",
      rawPathIncluded: false,
    });
    return { action, receipt: null };
  }
  const action = store.writeOutboxAction({
    actionId,
    sourceEnvelopeId: reducedResult.sourceEnvelopeId,
    routeId: reducedResult.routeId,
    actionKind: "write_artifact",
    status: "queued",
    reducedResultId: reducedResult.resultId,
    artifactRelPath: relPath.split(path.sep).join("/"),
    artifactRootEvidenceKey: sha256(rootResolved),
    rawOutputIncluded: false,
    rawPathIncluded: false,
  });
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const content = [
    `# Headless Output Artifact`,
    "",
    `- reducer: ${reducedResult.reducerId}@${reducedResult.reducerVersion}`,
    `- route: ${reducedResult.routeId}@${reducedResult.routeVersion}`,
    `- packet: ${reducedResult.packetId}`,
    `- source output digest: ${reducedResult.sourceOutputDigest}`,
    "",
    assistantText,
    "",
  ].join("\n");
  fs.writeFileSync(absolutePath, content, "utf8");
  const delivered = store.writeOutboxAction({
    ...action,
    status: "delivered",
    deliveredAt: nowIso(),
  });
  const receipt = store.writeDeliveryReceipt({
    actionId: delivered.actionId,
    status: "delivered",
    artifactRelPath: action.artifactRelPath,
    artifactDigest: sha256(content),
    rawOutputIncluded: false,
    rawPathIncluded: false,
  });
  return { action: delivered, receipt };
}

function reduceHeadlessTurnOutput({
  store,
  controller,
  packet = {},
  route = {},
  artifactRoot = "",
} = {}) {
  if (!store || !controller?.sessionStore) return null;
  const config = reducerConfig(route);
  if (!config.enabled) return null;
  const session = controller.sessionStore.readSession?.(packet.targetThreadId);
  const assistantText = assistantTextFromSessionTurn(session || {}, packet.turnId);
  const base = reducedBase({ packet, route, config, assistantText });
  let resultPatch = {};
  let parsedJson = null;
  if (config.reducerMode === "json_contract_required") {
    try {
      parsedJson = JSON.parse(jsonContractTextFromAssistant(assistantText));
      resultPatch = {
        reductionStatus: "valid",
        jsonContractDigest: digestFor("json-contract", parsedJson),
        jsonContractPreview: stableStringify(parsedJson).slice(0, 2000),
      };
    } catch {
      resultPatch = {
        reductionStatus: "needs_human_review",
        failureCode: "json_contract_invalid",
      };
    }
  } else if (config.reducerMode === "human_review_required") {
    resultPatch = {
      reductionStatus: "needs_human_review",
    };
  } else {
    resultPatch = {
      reductionStatus: assistantText ? "valid" : "invalid",
      markdownSummaryPreview: assistantText.slice(0, 2000),
    };
  }
  const reducedResult = store.writeReducedResult({
    resultId: `headless_reduced_${sha256(`${packet.packetId}:${config.reducerId}:${config.reducerVersion}`).slice(7, 31)}`,
    ...base,
    ...resultPatch,
    outputPreview: assistantText.slice(0, 500),
  });
  const artifacts = {};
  if (["markdown_summary_only", "artifact_only"].includes(config.reducerMode) && reducedResult.reductionStatus === "valid") {
    artifacts.writeArtifact = writeArtifact({ store, reducedResult, assistantText, artifactRoot });
  }
  if (["human_review_required", "json_contract_required"].includes(config.reducerMode) && reducedResult.reductionStatus !== "valid") {
    artifacts.humanDecision = store.writeHumanDecisionPacket({
      sourceEnvelopeId: packet.envelopeId,
      workThreadId: packet.workThreadId,
      reducedResultId: reducedResult.resultId,
      promptSummary: config.promptSummary,
      choices: config.choices.length ? config.choices : defaultHumanChoices(),
      replyRouteId: normalizeString(route.replyRouteId || route.reply_route_id, route.routeId),
      rawOutputIncluded: false,
    });
  }
  return {
    schema: "headless_output_reduction_result@1",
    reducedResult,
    artifacts,
    rawOutputIncluded: false,
    rawProviderPayloadIncluded: false,
    rawPathIncluded: false,
  };
}

module.exports = {
  HEADLESS_OUTPUT_REDUCER_SCHEMA,
  REDUCER_MODES,
  assistantTextFromSessionTurn,
  jsonContractTextFromAssistant,
  reduceHeadlessTurnOutput,
  reducerConfig,
};
