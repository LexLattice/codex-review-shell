"use strict";

const {
  buildERevision,
  buildORevision,
  buildSemanticPort,
  buildSubject,
  digestFor,
  text,
} = require("./kernel");
const { DirectEpistemicStore } = require("./store");
const {
  buildArcagi3RepositoryProjection,
  inspectArcagi3Repository,
  rendererSafeObservation,
  workspaceRoot,
} = require("./repository-runtime");
const {
  LUNA_TRANSCRIPTION_EFFORT,
  LUNA_TRANSCRIPTION_MODEL,
  buildLunaTranscriptionRequest,
  deterministicThreadRecords,
  linguisticResidue,
  recordsFromLunaOutput,
} = require("./thread-transcriber");

const DIRECT_EPISTEMIC_PROJECTION_SCHEMA = "direct_epistemic_projection@1";

function serviceError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeImportSummary(result) {
  if (!result) return null;
  const counts = {};
  for (const record of Array.isArray(result.records) ? result.records : []) {
    counts[record.recordType] = Number(counts[record.recordType] || 0) + 1;
  }
  return {
    importId: result.importId,
    subjectRef: result.subjectRef,
    purpose: result.purpose,
    purposeId: result.purposeId,
    requestIntent: result.requestIntent,
    facets: result.facets,
    portRef: result.portRef,
    oRevisionRef: result.oRevisionRef,
    eRevisionRef: result.eRevisionRef,
    recordCount: Array.isArray(result.records) ? result.records.length : 0,
    recordCounts: counts,
    omissions: result.omissions,
    omissionWitnesses: result.omissionWitnesses,
    freshness: result.freshness,
    detailDepth: result.detailDepth,
    sinceRevision: result.sinceRevision,
    rawEvidencePolicy: result.rawEvidencePolicy,
    tokenBudget: result.tokenBudget,
    requestConstraints: result.requestConstraints,
    createdAt: result.createdAt,
    importDigest: result.importDigest,
  };
}

function safeSubjectSummary(summary) {
  if (!summary) return null;
  return {
    subject: summary.subject,
    oRevision: summary.oRevision,
    eRevision: summary.eRevision,
    recordCount: summary.recordCount,
    recordCounts: summary.recordCounts,
    ports: summary.ports,
    latestImport: safeImportSummary(summary.latestImport),
    latestTranscription: summary.latestTranscription,
    updatedAt: summary.updatedAt,
  };
}

function threadPorts(subject) {
  return [
    buildSemanticPort({
      subject,
      name: "thread.tool_activity",
      label: "Tool activity",
      purpose: "Inspect which tools ran and what mechanically observable outcomes were recorded.",
      facets: ["tool_activity"],
      standings: ["mechanically_observed"],
      traversal: ["tool_activity"],
    }),
    buildSemanticPort({
      subject,
      name: "thread.agent_interpretations",
      label: "Agent interpretations",
      purpose: "Inspect what the agent explicitly interpreted without promoting those interpretations to facts.",
      facets: ["agent_interpretation", "agent_statement"],
      standings: ["attributed"],
      traversal: ["agent_interpretation", "agent_statement"],
    }),
    buildSemanticPort({
      subject,
      name: "thread.execution_outcomes",
      label: "Execution outcomes",
      purpose: "Inspect provider and turn outcomes without importing tool arguments or output bodies.",
      facets: ["execution", "execution_outcome", "usage"],
      standings: ["mechanically_observed"],
      traversal: ["execution", "execution_outcome", "usage"],
    }),
    buildSemanticPort({
      subject,
      name: "thread.full_typed_history",
      label: "Full typed history",
      purpose: "Inspect all prepared event descriptions while retaining standing and attribution distinctions.",
      facets: [
        "execution",
        "execution_outcome",
        "usage",
        "tool_activity",
        "linguistic_residue",
        "agent_interpretation",
        "agent_statement",
      ],
      standings: ["mechanically_observed", "attributed", "validated"],
      traversal: ["execution", "tool_activity", "execution_outcome", "agent_interpretation", "usage"],
    }),
  ];
}

class DirectEpistemicService {
  constructor(options = {}) {
    this.store = options.store || new DirectEpistemicStore({ rootDir: options.rootDir });
    this.ownsStore = !options.store;
    this.sessionStore = options.sessionStore || null;
    this.transcriber = typeof options.transcriber === "function" ? options.transcriber : null;
    this.transcriberStatus = typeof options.transcriberStatus === "function" ? options.transcriberStatus : null;
    this.repositoryInspector = options.repositoryInspector || inspectArcagi3Repository;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.repositoryObservations = new Map();
    this.pendingSessionSyncs = new Map();
    this.pendingTranscriptions = new Map();
    this.sessionSyncDirty = new Set();
    this.sessionSyncFailures = new Map();
    this.closed = false;
    this.generation = 1;
    this.unsubscribeSessionObserver = this.sessionStore?.subscribeEpistemicEvents?.((event) => {
      const sessionId = text(event?.sessionId);
      if (!sessionId) return;
      this.scheduleSessionSync(sessionId);
    }) || null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.unsubscribeSessionObserver?.();
    this.unsubscribeSessionObserver = null;
    for (const pending of this.pendingTranscriptions.values()) {
      try {
        this.store.putTranscriptionJob({
          ...pending.job,
          status: "failed",
          errorCode: "direct_epistemic_transcription_service_closed",
        });
      } catch {}
      pending.controller.abort(serviceError(
        "direct_epistemic_transcription_service_closed",
        "The Direct epistemic service closed during transcription.",
      ));
    }
    if (this.ownsStore) this.store.close();
  }

  scheduleSessionSync(sessionId) {
    if (this.closed) return Promise.resolve(null);
    if (this.pendingSessionSyncs.has(sessionId)) {
      this.sessionSyncDirty.add(sessionId);
      return this.pendingSessionSyncs.get(sessionId);
    }
    const pending = Promise.resolve()
      .then(async () => {
        do {
          this.sessionSyncDirty.delete(sessionId);
          try {
            this.syncThread(sessionId);
            this.sessionSyncFailures.delete(sessionId);
          } catch (error) {
            this.sessionSyncFailures.set(sessionId, {
              code: text(error?.code, "direct_epistemic_thread_sync_failed"),
              at: new Date(this.now()).toISOString(),
            });
          }
          await Promise.resolve();
        } while (!this.closed && this.sessionSyncDirty.has(sessionId));
      })
      .finally(() => this.pendingSessionSyncs.delete(sessionId));
    this.pendingSessionSyncs.set(sessionId, pending);
    return pending;
  }

  assertOpen() {
    if (!this.closed) return;
    const error = new Error("direct_epistemic_service_closed");
    error.code = "direct_epistemic_service_closed";
    throw error;
  }

  initializeRepository(project = {}, options = {}) {
    this.assertOpen();
    const rootDir = workspaceRoot(project);
    if (!rootDir) throw new Error("direct_epistemic_project_workspace_required");
    const observation = options.observation || this.repositoryInspector(rootDir);
    const projection = buildArcagi3RepositoryProjection({
      projectId: text(project.id, "arcagi3"),
      observation,
    });
    const priorHead = this.store.readHead(projection.subject.subjectId);
    this.store.admitProjection({
      ...projection,
      expectedHead: priorHead ? {
        oRevisionId: priorHead.oRevision.oRevisionId,
        eRevisionId: priorHead.eRevision.eRevisionId,
      } : null,
    });
    this.repositoryObservations.set(projection.subject.subjectId, {
      ...rendererSafeObservation(observation),
      oRevisionId: projection.oRevision.oRevisionId,
      eRevisionId: projection.eRevision.eRevisionId,
    });
    return this.repositoryProjection(project.id);
  }

  refreshRepository(project = {}, options = {}) {
    return this.initializeRepository(project, options);
  }

  repositoryProjection(projectId) {
    const subject = this.store.findSubject("repository", text(projectId));
    if (!subject) return null;
    const summary = safeSubjectSummary(this.store.subjectSummary(subject.subjectId));
    return {
      ...summary,
      observation: this.repositoryObservations.get(subject.subjectId) || {
        profileId: subject.profileId?.split("@")[0] || "",
        observationComplete: false,
        omissions: ["refresh_required_for_process_observation"],
        rawWorkspacePathIncluded: false,
      },
    };
  }

  threadTurnArtifacts(session) {
    const turns = [];
    const turnIds = [...new Set([
      ...(Array.isArray(session?.turns) ? session.turns.map((summary) => summary?.turnId) : []),
      ...(this.sessionStore?.listTurnIdsFromDisk?.(session.sessionId) || []),
    ].filter(Boolean))];
    for (const turnId of turnIds) {
      const turn = this.sessionStore?.readTurn(session.sessionId, turnId);
      if (!turn) continue;
      turns.push({
        turn,
        events: this.sessionStore.readNormalizedEvents(session.sessionId, turn.turnId),
      });
    }
    return turns;
  }

  syncThread(sessionId) {
    this.assertOpen();
    if (!this.sessionStore) throw new Error("direct_epistemic_session_store_unavailable");
    const session = this.sessionStore.readSession(text(sessionId));
    if (!session) throw new Error(`direct_epistemic_session_unknown:${text(sessionId)}`);
    const turnArtifacts = this.threadTurnArtifacts(session);
    const subject = buildSubject({
      kind: "thread",
      externalId: session.sessionId,
      projectId: text(session.projectId),
      label: text(session.title, "Direct thread"),
      profileId: "direct-normalized-events@1",
    });
    const turnIdentities = turnArtifacts.map(({ turn, events }) => ({
      turnId: turn.turnId,
      state: turn.state,
      eventDigest: digestFor(events),
      toolResultDigest: digestFor(Array.isArray(turn.toolResults) ? turn.toolResults : []),
      updatedAt: turn.updatedAt,
    }));
    const oRevision = buildORevision({
      subject,
      substrateKind: "direct_normalized_event_history",
      substrateIdentity: {
        sessionId: session.sessionId,
        turnCount: turnArtifacts.length,
        turnIdentities,
      },
      posture: "observed_append_only_history",
    });
    const eRevision = buildERevision({
      subject,
      oRevision,
      revisionClass: "deterministic_event_projection",
      basis: {
        transcriber: "deterministic@1",
        turnIdentities,
      },
      standing: "admitted",
      coverage: {
        posture: "structured_events_and_tool_results",
        turnCount: turnArtifacts.length,
        linguisticResidueSemanticallyTranscribed: false,
      },
    });
    const existingHead = this.store.readHead(subject.subjectId);
    const preserveDerivedHead = Boolean(
      existingHead?.oRevision?.oRevisionId === oRevision.oRevisionId &&
      existingHead?.eRevision?.eRevisionId &&
      this.store.revisionLineage(existingHead.eRevision.eRevisionId)
        .some((revision) => revision.eRevisionId === eRevision.eRevisionId),
    );
    const records = turnArtifacts.flatMap(({ turn, events }) => deterministicThreadRecords({
      subject,
      oRevision,
      eRevision,
      session,
      turn,
      events,
    }));
    this.store.admitProjection({
      subject,
      oRevision,
      eRevision,
      records,
      ports: threadPorts(subject),
      expectedHead: existingHead ? {
        oRevisionId: existingHead.oRevision.oRevisionId,
        eRevisionId: existingHead.eRevision.eRevisionId,
      } : null,
      setHead: !preserveDerivedHead,
    });
    return safeSubjectSummary(this.store.subjectSummary(subject.subjectId));
  }

  sessionsForProject(projectId) {
    if (!this.sessionStore) return [];
    const index = this.sessionStore.readIndex();
    return (Array.isArray(index?.sessions) ? index.sessions : [])
      .filter((session) => text(session?.projectId) === text(projectId))
      .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
  }

  latestThreadProjection(projectId, preferredSessionId = "") {
    const projections = this.threadProjectionsForProject(projectId);
    return projections.find((summary) => summary.subject?.externalId === preferredSessionId) || projections[0] || null;
  }

  threadProjectionsForProject(projectId, options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit || 12)));
    const projections = [];
    for (const session of this.sessionsForProject(projectId).slice(0, limit)) {
      try {
        const projection = this.syncThread(session.sessionId);
        projections.push({ ...projection, syncStatus: "current", syncFailure: null });
        this.sessionSyncFailures.delete(session.sessionId);
      } catch (error) {
        const failure = {
          code: text(error?.code, "direct_epistemic_thread_sync_failed"),
          at: new Date(this.now()).toISOString(),
        };
        this.sessionSyncFailures.set(session.sessionId, failure);
        const subject = this.store.findSubject("thread", session.sessionId);
        const summary = subject ? safeSubjectSummary(this.store.subjectSummary(subject.subjectId)) : null;
        if (summary) projections.push({ ...summary, syncStatus: "stale", syncFailure: failure });
      }
    }
    return projections;
  }

  async transcribeThread(input = {}) {
    this.assertOpen();
    if (!this.transcriber) throw new Error("direct_epistemic_luna_transcriber_unavailable");
    if (input.signal?.aborted) throw serviceError(
      "direct_epistemic_transcription_aborted",
      "The transcription request was already aborted.",
    );
    const sessionId = text(input.sessionId);
    const deterministic = this.syncThread(sessionId);
    const session = this.sessionStore.readSession(sessionId);
    const artifacts = this.threadTurnArtifacts(session);
    const selected = input.turnId
      ? artifacts.find(({ turn }) => turn.turnId === input.turnId)
      : artifacts[artifacts.length - 1];
    if (!selected) throw new Error("direct_epistemic_turn_unavailable");
    const head = this.store.readHead(deterministic.subject.subjectId);
    const request = buildLunaTranscriptionRequest({
      session,
      turn: selected.turn,
      events: selected.events,
      model: text(input.model, LUNA_TRANSCRIPTION_MODEL),
      reasoningEffort: text(input.reasoningEffort, LUNA_TRANSCRIPTION_EFFORT),
    });
    if (!request.residue.length) throw new Error("direct_epistemic_linguistic_residue_empty");
    const jobId = `ep_job_${digestFor({
      subjectId: deterministic.subject.subjectId,
      oRevisionId: head.oRevision.oRevisionId,
      sourceDigest: request.sourceDigest,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
    }).slice(0, 24)}`;
    const existingPending = this.pendingTranscriptions.get(jobId);
    if (existingPending) {
      const abortExisting = () => existingPending.controller.abort(serviceError(
        "direct_epistemic_transcription_aborted",
        "The transcription request was aborted.",
      ));
      input.signal?.addEventListener("abort", abortExisting, { once: true });
      try {
        return await existingPending.promise;
      } finally {
        input.signal?.removeEventListener("abort", abortExisting);
      }
    }
    const completed = this.store.readTranscriptionJob(jobId);
    if (completed?.status === "completed" && completed.resultERevisionId) {
      const currentHead = this.store.readHead(deterministic.subject.subjectId);
      const resultRevision = this.store.readERevision(completed.resultERevisionId);
      const remainsCurrent = Boolean(
        resultRevision &&
        currentHead?.oRevision?.oRevisionId === head.oRevision.oRevisionId &&
        this.store.revisionLineage(currentHead.eRevision.eRevisionId)
          .some((revision) => revision.eRevisionId === completed.resultERevisionId),
      );
      if (remainsCurrent) return safeSubjectSummary(this.store.subjectSummary(head.subject.subjectId));
    }
    const generation = this.generation;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(serviceError(
      "direct_epistemic_transcription_aborted",
      "The transcription request was aborted.",
    ));
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const job = {
      jobId,
      subjectId: deterministic.subject.subjectId,
      oRevisionId: head.oRevision.oRevisionId,
      sourceDigest: request.sourceDigest,
      model: request.model,
      effort: request.reasoningEffort,
      omissionCount: Array.isArray(request.omissions) ? request.omissions.length : 0,
      omissionDigest: digestFor(request.omissions || []),
      constraintDigest: digestFor(request.constraints || {}),
    };
    const promise = this.runTranscriptionJob({
      jobId,
      job,
      generation,
      deterministic,
      session,
      selected,
      selectedIsLatest: selected.turn.turnId === artifacts[artifacts.length - 1]?.turn?.turnId,
      head,
      request,
      signal: controller.signal,
    });
    const pending = { promise, controller, job };
    this.pendingTranscriptions.set(jobId, pending);
    try {
      return await promise;
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      if (this.pendingTranscriptions.get(jobId) === pending) this.pendingTranscriptions.delete(jobId);
    }
  }

  async runTranscriptionJob(context = {}) {
    const {
      job,
      generation,
      session,
      selected,
      selectedIsLatest,
      head,
      request,
      signal,
    } = context;
    this.store.putTranscriptionJob({
      ...job,
      status: "running",
    });
    try {
      if (signal?.aborted) throw serviceError(
        "direct_epistemic_transcription_aborted",
        "The transcription request was aborted before provider invocation.",
      );
      const output = await this.transcriber(request, { signal });
      if (this.closed || generation !== this.generation) {
        throw serviceError(
          "direct_epistemic_transcription_service_closed",
          "The Direct epistemic service closed before transcription admission.",
        );
      }
      if (signal?.aborted) throw serviceError(
        "direct_epistemic_transcription_aborted",
        "The transcription request was aborted before admission.",
      );
      const currentHead = this.store.readHead(head.subject.subjectId);
      if (
        currentHead?.oRevision?.oRevisionId !== head.oRevision.oRevisionId ||
        currentHead?.eRevision?.eRevisionId !== head.eRevision.eRevisionId
      ) {
        const error = new Error("The thread changed while Luna was transcribing; the stale result was not admitted.");
        error.code = "direct_epistemic_transcription_source_stale";
        throw error;
      }
      const eRevision = buildERevision({
        subject: head.subject,
        oRevision: head.oRevision,
        parentERevisionId: head.eRevision.eRevisionId,
        revisionClass: "luna_attributed_transcription",
        basis: {
          sourceDigest: request.sourceDigest,
          outputDigest: digestFor(output),
          model: request.model,
          effort: request.reasoningEffort,
        },
        standing: "attributed",
        coverage: {
          posture: "selected_turn_linguistic_residue",
          selectedTurnId: selected.turn.turnId,
          selectedTurnWasLatest: selectedIsLatest === true,
          selectedTurnSourceDigest: request.sourceDigest,
          sourceFragmentCount: request.residue.length,
          sourceOmissionCount: Array.isArray(request.omissions) ? request.omissions.length : 0,
          omissions: Array.isArray(request.omissions) ? request.omissions : [],
          constraints: request.constraints || {},
          epistemicPromotionAllowed: false,
        },
      });
      const records = recordsFromLunaOutput({
        subject: head.subject,
        oRevision: head.oRevision,
        eRevision,
        session,
        turn: selected.turn,
        events: selected.events,
        model: request.model,
      }, output);
      this.store.admitProjection({
        subject: head.subject,
        oRevision: head.oRevision,
        eRevision,
        records,
        ports: threadPorts(head.subject),
        expectedHead: {
          oRevisionId: head.oRevision.oRevisionId,
          eRevisionId: head.eRevision.eRevisionId,
        },
        transcriptionJob: {
          ...job,
          status: "completed",
          resultERevisionId: eRevision.eRevisionId,
        },
      });
      return safeSubjectSummary(this.store.subjectSummary(head.subject.subjectId));
    } catch (error) {
      const terminalError = signal?.aborted
        ? (this.closed || generation !== this.generation
            ? serviceError(
                "direct_epistemic_transcription_service_closed",
                "The Direct epistemic service closed during transcription.",
              )
            : serviceError(
                "direct_epistemic_transcription_aborted",
                "The transcription request was aborted.",
              ))
        : error;
      if (!this.closed && generation === this.generation) {
        this.store.putTranscriptionJob({
          ...job,
          status: "failed",
          errorCode: text(terminalError?.code, "transcription_failed"),
        });
      }
      throw terminalError;
    }
  }

  importContext(input = {}) {
    this.assertOpen();
    const projectId = text(input.projectId);
    let subject = null;
    if (input.subjectKind === "thread") {
      const sessionId = text(input.sessionId) || this.sessionsForProject(projectId)[0]?.sessionId || "";
      if (!sessionId) throw new Error("direct_epistemic_thread_subject_unavailable");
      this.syncThread(sessionId);
      subject = this.store.findSubject("thread", sessionId);
    } else {
      subject = this.store.findSubject("repository", projectId);
      const head = subject ? this.store.readHead(subject.subjectId) : null;
      const observation = subject ? this.repositoryObservations.get(subject.subjectId) : null;
      if (
        !head?.oRevision ||
        !observation?.observationComplete ||
        observation.oRevisionId !== head.oRevision.oRevisionId
      ) {
        const error = new Error("Refresh the repository observation before materializing an exact context preview.");
        error.code = "direct_epistemic_repository_refresh_required";
        throw error;
      }
    }
    if (!subject) throw new Error("direct_epistemic_subject_unavailable");
    return this.store.importContext({
      subjectId: subject.subjectId,
      portName: text(input.portName),
      purpose: text(input.purpose),
      facets: Array.isArray(input.facets) ? input.facets : [],
      oRevisionId: text(input.oRevisionId),
      eRevisionId: text(input.eRevisionId),
      freshness: "exact",
      detailDepth: text(input.detailDepth, "typed_records"),
      sinceRevision: text(input.sinceRevision),
      rawEvidencePolicy: "references_only",
      tokenBudget: Number.isFinite(Number(input.tokenBudget)) ? Math.max(0, Number(input.tokenBudget)) : 0,
    });
  }

  snapshot(project = {}, options = {}) {
    const projectId = text(project.id);
    const rootDir = workspaceRoot(project);
    const repository = this.repositoryProjection(projectId);
    const profileCandidate = repository?.subject?.profileId?.split("@")[0] ||
      (rootDir ? "resident_probe_required" : "unavailable");
    const threads = this.threadProjectionsForProject(projectId);
    const thread = threads.find((summary) => summary.subject?.externalId === text(options.sessionId)) || threads[0] || null;
    return {
      schema: DIRECT_EPISTEMIC_PROJECTION_SCHEMA,
      projectId,
      profileCandidate,
      repository,
      thread,
      threads: threads.map((summary) => ({
        subject: summary.subject,
        oRevision: summary.oRevision,
        eRevision: summary.eRevision,
        recordCount: summary.recordCount,
        recordCounts: summary.recordCounts,
        updatedAt: summary.updatedAt,
        syncStatus: text(summary.syncStatus, "current"),
        syncFailure: summary.syncFailure || null,
      })),
      transcriber: {
        ...(() => {
          let runtime = {};
          let statusChecked = !this.transcriberStatus;
          try {
            runtime = this.transcriberStatus?.() || {};
            statusChecked = true;
          } catch {}
          const authReady = this.transcriberStatus
            ? statusChecked && runtime.authReady === true
            : true;
          return {
            available: Boolean(this.transcriber) && authReady && !this.closed,
            readiness: text(runtime.readiness, authReady ? "invoke_to_verify_model" : "authentication_required"),
            blocker: text(runtime.blocker, authReady ? "" : "Direct authentication status is unavailable."),
          };
        })(),
        optIn: true,
        model: LUNA_TRANSCRIPTION_MODEL,
        reasoningEffort: LUNA_TRANSCRIPTION_EFFORT,
        semanticPromotionAllowed: false,
      },
      invariants: {
        activeControlDirection: "top_down_only",
        passiveEvidenceDirection: "append_only_to_ledger",
        higherOrderAuditContinuous: false,
        rawTranscriptIncluded: false,
        privateWorkspacePathIncluded: false,
        worldManagerCanonicalStanding: false,
      },
      updatedAt: new Date(this.now()).toISOString(),
    };
  }
}

module.exports = {
  DIRECT_EPISTEMIC_PROJECTION_SCHEMA,
  DirectEpistemicService,
  safeImportSummary,
  safeSubjectSummary,
  threadPorts,
};
