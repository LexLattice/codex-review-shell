#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectHeadlessBridgeDaemon, buildHeadlessBridgeDaemonFromConfig } = require("../src/main/direct/headless/bridge-daemon.js");

const FIXTURE_TOKEN = "fixture-token";

function fixtureConfig(rootDir) {
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [
      {
        clientId: "fixture_cli",
        displayLabel: "Fixture CLI",
        clientKind: "fixture",
        status: "active",
        authMode: "capability_token",
        capabilityToken: FIXTURE_TOKEN,
        allowedIngressContracts: ["diagnostic_event@1"],
        allowedRoutes: [
          "route_diag",
          "route_disabled",
          "route_missing",
          "route_ambiguous",
          "route_unknown",
        ],
      },
    ],
    workThreads: [
      {
        workThreadId: "wt_diag",
        status: "active",
        projectId: "project_fixture",
        workspaceIdentity: "workspace_fixture",
        branchIdentity: "branch_fixture",
      },
      {
        workThreadId: "wt_a",
        status: "active",
        projectId: "project_fixture",
      },
      {
        workThreadId: "wt_b",
        status: "active",
        projectId: "project_fixture",
      },
    ],
    routes: [
      {
        routeId: "route_diag",
        routeVersion: "route_v1",
        status: "active",
        ingressContractRef: "diagnostic_event@1",
        workThreadId: "wt_diag",
        targetKind: "codex_direct_thread",
        targetThreadRef: {
          runtimePath: "direct-text",
          thread_id: "direct_session_diag",
        },
        contextPolicyRef: "context_policy_fixture",
        modelPolicyRef: "model_policy_fixture",
        outputReducerRef: "output_reducer_fixture",
        egress_policy_refs: ["egress_none_fixture"],
        interruptionPolicyRef: "interrupt_none_fixture",
        authorityBoundaryRef: "authority_fixture",
        toolAuthorityMode: "disabled",
      },
      {
        routeId: "route_disabled",
        routeVersion: "route_v1",
        status: "disabled",
        ingressContractRef: "diagnostic_event@1",
        workThreadId: "wt_diag",
        targetThreadRef: {
          threadId: "direct_session_disabled",
        },
      },
      {
        routeId: "route_missing",
        routeVersion: "route_v1",
        status: "active",
        ingressContractRef: "diagnostic_event@1",
        workThreadId: "wt_missing",
        targetThreadRef: {
          threadId: "direct_session_missing",
        },
      },
      {
        routeId: "route_ambiguous",
        routeVersion: "route_v1",
        status: "active",
        ingressContractRef: "diagnostic_event@1",
        candidate_work_thread_ids: ["wt_a", "wt_b"],
        targetThreadRef: {
          threadId: "direct_session_ambiguous",
        },
      },
    ],
  };
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

async function postEvent(baseUrl, body, options = {}) {
  return requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${FIXTURE_TOKEN}`,
      ...(options.headers || {}),
    },
  });
}

function event(overrides = {}) {
  return {
    clientId: "fixture_cli",
    idempotencyKey: "idem-1",
    eventSchema: "diagnostic_event@1",
    eventClass: "diagnostic",
    eventKind: "ping",
    sourceSystem: "fixture",
    requestedRouteId: "route_diag",
    facts: {
      hello: "world",
    },
    ...overrides,
  };
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-bridge-"));
const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const statusBefore = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(statusBefore.response.status, 200);
  assert.equal(statusBefore.body.schema, "bridge_daemon_status_projection@1");
  assert.equal(statusBefore.body.daemonState, "ready");
  assert.equal(statusBefore.body.providerRequestsStarted, 0);
  assert.equal(statusBefore.body.rawPayloadsExposed, false);

  const unauthorized = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event({ idempotencyKey: "idem-auth-fail" })),
    headers: {
      authorization: "Bearer wrong-token",
    },
  });
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.body.status, "blocked_ingress");
  assert.equal(unauthorized.body.error, "client_auth_failed");

  const accepted = await postEvent(baseUrl, event());
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.ok, true);
  assert.equal(accepted.body.status, "route_resolved");
  assert.equal(accepted.body.providerRequestStarted, undefined);
  assert.equal(accepted.body.event.rawPayloadIncluded, false);
  assert.equal(accepted.body.routeDecision.status, "resolved");
  assert.equal(accepted.body.routeDecision.targetThreadId, "direct_session_diag");

  const duplicate = await postEvent(baseUrl, event());
  assert.equal(duplicate.response.status, 202);
  assert.equal(duplicate.body.ok, true);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.event.envelopeId, accepted.body.event.envelopeId);

  const callerEvidence = {
    kind: "operator_note",
    id: "note-1",
    digest: `sha256:${"a".repeat(64)}`,
    rendererSafeLabel: "Operator note",
  };
  const evidenceAccepted = await postEvent(baseUrl, event({
    idempotencyKey: "idem-valid-evidence",
    evidenceRefs: [callerEvidence],
  }));
  assert.equal(evidenceAccepted.response.status, 202);
  assert.deepEqual(evidenceAccepted.body.event.evidenceRefs, [callerEvidence]);
  assert.deepEqual(evidenceAccepted.body.routeDecision.evidenceRefs, [callerEvidence]);
  const evidenceCountBeforeMixed = daemon.store.count("direct_bridge_inbox_events");
  const mixedEvidence = await postEvent(baseUrl, event({
    idempotencyKey: "idem-mixed-invalid-evidence",
    evidenceRefs: [callerEvidence, {
      kind: "malicious",
      id: "bad-1",
      nested: { rawPayload: "must be rejected" },
    }],
  }));
  assert.equal(mixedEvidence.response.status, 400);
  assert.equal(mixedEvidence.body.error, "invalid_evidence_refs");
  assert.equal(daemon.store.count("direct_bridge_inbox_events"), evidenceCountBeforeMixed);

  for (const [suffix, unsafeRef] of [
    ["uri", { kind: "operator_note", id: "unsafe-uri", source: "file:///etc/passwd" }],
    ["path", { kind: "operator_note", id: "unsafe-path", rendererSafeLabel: "../private/notes.txt" }],
    ["secret", { kind: "operator_note", id: "unsafe-secret", rendererSafeLabel: "api_key=sk-proj-secret" }],
  ]) {
    const beforeUnsafe = daemon.store.count("direct_bridge_inbox_events");
    const unsafe = await postEvent(baseUrl, event({
      idempotencyKey: `idem-unsafe-evidence-${suffix}`,
      evidenceRefs: [callerEvidence, unsafeRef],
    }));
    assert.equal(unsafe.response.status, 400);
    assert.equal(unsafe.body.error, "invalid_evidence_refs");
    assert.equal(daemon.store.count("direct_bridge_inbox_events"), beforeUnsafe);
  }

  const stored = await requestJson(baseUrl, `/v1/bridge/events/${encodeURIComponent(accepted.body.event.envelopeId)}`);
  assert.equal(stored.response.status, 200);
  assert.equal(stored.body.ok, true);
  assert.deepEqual(stored.body.lifecycle.map((item) => item.phase), [
    "received",
    "accepted_inbox",
    "route_resolved",
  ]);
  assert.equal(stored.body.routeDecision.providerRequestStarted, false);

  const blockedRawPayload = await postEvent(baseUrl, event({
    idempotencyKey: "idem-raw-payload",
    raw_payload: "forbidden",
  }));
  assert.equal(blockedRawPayload.response.status, 400);
  assert.equal(blockedRawPayload.body.ok, false);
  assert.equal(blockedRawPayload.body.status, "blocked_ingress");
  assert.equal(blockedRawPayload.body.error, "raw_payload_included");

  const blockedSchema = await postEvent(baseUrl, event({
    idempotencyKey: "idem-schema",
    eventSchema: "unknown_event@1",
  }));
  assert.equal(blockedSchema.response.status, 400);
  assert.equal(blockedSchema.body.error, "event_schema_not_allowed");

  const unknownRoute = await postEvent(baseUrl, event({
    idempotencyKey: "idem-unknown-route",
    requestedRouteId: "route_unknown",
  }));
  assert.equal(unknownRoute.response.status, 400);
  assert.equal(unknownRoute.body.status, "route_blocked");
  assert.equal(unknownRoute.body.error, "unknown_route");

  const disabledRoute = await postEvent(baseUrl, event({
    idempotencyKey: "idem-disabled-route",
    requestedRouteId: "route_disabled",
  }));
  assert.equal(disabledRoute.response.status, 400);
  assert.equal(disabledRoute.body.status, "route_blocked");
  assert.equal(disabledRoute.body.error, "route_disabled");

  const missingWorkThread = await postEvent(baseUrl, event({
    idempotencyKey: "idem-missing-workthread",
    requestedRouteId: "route_missing",
  }));
  assert.equal(missingWorkThread.response.status, 400);
  assert.equal(missingWorkThread.body.status, "route_blocked");
  assert.equal(missingWorkThread.body.error, "work_thread_missing");

  const ambiguousRoute = await postEvent(baseUrl, event({
    idempotencyKey: "idem-ambiguous-route",
    requestedRouteId: "route_ambiguous",
  }));
  assert.equal(ambiguousRoute.response.status, 400);
  assert.equal(ambiguousRoute.body.status, "route_blocked");
  assert.equal(ambiguousRoute.body.error, "route_ambiguity");

  const statusAfter = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(statusAfter.body.providerRequestsStarted, 0);
  assert.equal(statusAfter.body.rawSecretsExposed, false);
  assert.equal(statusAfter.body.rawPayloadsExposed, false);
  assert.equal(statusAfter.body.rawProviderFramesExposed, false);
  assert.equal(statusAfter.body.rawPathsExposed, false);
  assert.equal(statusAfter.body.inboxEvents, 8);
  assert.equal(statusAfter.body.lifecycle.route_resolved, 2);
  assert.equal(statusAfter.body.lifecycle.blocked_ingress, 2);
  assert.equal(statusAfter.body.lifecycle.route_blocked, 4);

  const configuredRoot = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-bridge-config-"));
  const configuredDaemon = buildHeadlessBridgeDaemonFromConfig({
    config: {
      ...fixtureConfig(configuredRoot),
      port: 0,
    },
  });
  const configuredAddress = await configuredDaemon.listen();
  assert.equal(configuredAddress.address || configuredAddress.host, "127.0.0.1");
  assert.ok(Number(configuredAddress.port) > 0);
  await configuredDaemon.close();
  await fs.rm(configuredRoot, { recursive: true, force: true });
} finally {
  await daemon.close();
  await daemon.close();
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log("direct-headless-bridge-substrate regression passed");
