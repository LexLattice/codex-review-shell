"use strict";

const {
  openNativeChildProviderTurnCapture,
} = require("./native-child-capture");
const {
  assertSafeLiveActivityProjection,
} = require("./live-activity-projection");

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function captureEnvelope(writer, status = "capturing", receipt = null) {
  const turn = writer.turn();
  const capture = turn.capture || {};
  return {
    status,
    errorCode: "",
    receiptDigest: text(receipt?.captureDigest || capture.finalCaptureDigest),
    sessionId: writer.input.sessionId,
    turnId: writer.input.turnId,
  };
}

class DirectLiveTurnCaptureAdapter {
  constructor(options = {}) {
    this.writer = options.writer;
    this.epistemicService = options.epistemicService || null;
    this.projectId = text(options.projectId);
    this.onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    this.failure = null;
    this.finalized = false;
    this.receipt = null;
    if (!this.writer) {
      const error = new Error("Direct live turn capture requires an open writer.");
      error.code = "direct_live_turn_capture_writer_required";
      throw error;
    }
    this.emitProgress(this.writer.turn().capture?.complete === true ? "captured" : "capturing");
  }

  projection() {
    if (!this.epistemicService) return null;
    this.epistemicService.syncThread(this.writer.input.sessionId);
    return assertSafeLiveActivityProjection(this.epistemicService.liveActivityProjection({
      projectId: this.projectId,
      sessionId: this.writer.input.sessionId,
      turnId: this.writer.input.turnId,
    }));
  }

  emitProgress(status, receipt = null) {
    let projection = null;
    try {
      projection = this.projection();
    } catch {}
    if (!this.onProgress) return projection;
    const envelope = captureEnvelope(this.writer, status, receipt);
    const update = {
      status: envelope.status,
      receiptDigest: envelope.receiptDigest,
      sessionId: envelope.sessionId,
      turnId: envelope.turnId,
      liveActivityProjection: projection,
    };
    try {
      const returned = this.onProgress(update);
      if (returned && typeof returned.then === "function") Promise.resolve(returned).catch(() => {});
    } catch {}
    return projection;
  }

  assertWritable() {
    if (this.failure) throw this.failure;
    if (this.finalized) {
      const error = new Error("Direct live turn capture is already finalized.");
      error.code = "direct_live_turn_capture_already_finalized";
      throw error;
    }
  }

  strictCommitCallback(options = {}) {
    const globalOffset = Math.max(0, Number(options.globalOffset || 0));
    const renumberSequences = options.renumberSequences === true;
    return async (events, details = {}) => {
      this.assertWritable();
      const localOffset = Math.max(0, Number(details.normalizedOffset || 0));
      const sourceOffset = globalOffset + localOffset;
      const persisted = renumberSequences
        ? (Array.isArray(events) ? events : []).map((event, index) => ({
            ...event,
            sequence: sourceOffset + index,
          }))
        : events;
      try {
        this.writer.appendEventPrefix(persisted, { sourceOffset });
        this.emitProgress("capturing");
      } catch (error) {
        this.markFailed(error);
        throw error;
      }
    };
  }

  reconcileEventPrefix(events = [], options = {}) {
    this.assertWritable();
    try {
      this.writer.appendEventPrefix(events, {
        sourceOffset: Math.max(0, Number(options.sourceOffset || 0)),
      });
      this.emitProgress("capturing");
    } catch (error) {
      this.markFailed(error);
      throw error;
    }
  }

  appendToolResult(result = {}) {
    this.assertWritable();
    try {
      this.writer.appendToolResult(result);
      const turn = this.writer.turn();
      if (
        turn.requestShape?.workspaceWorkerContractId &&
        turn.requestShape.workspaceWorkerToolResultCount !== turn.toolResults.length
      ) {
        this.writer.sessionStore.updateTurnState(
          this.writer.input.sessionId,
          this.writer.input.turnId,
          turn.state,
          {
            requestShape: {
              ...turn.requestShape,
              workspaceWorkerToolResultCount: turn.toolResults.length,
            },
          },
        );
      }
      this.emitProgress("capturing");
    } catch (error) {
      this.markFailed(error);
      throw error;
    }
  }

  markFailed(error) {
    if (this.failure) return this.failure;
    const failure = error instanceof Error ? error : new Error("direct_live_turn_capture_failed");
    if (!failure.code) failure.code = "direct_live_turn_capture_failed";
    this.failure = failure;
    if (!this.finalized) {
      try {
        const turn = this.writer.turn();
        const preserveComplete = turn.capture?.complete === true;
        const recorded = (Array.isArray(turn.capture?.gapReceipts) ? turn.capture.gapReceipts : [])
          .some((receipt) => receipt?.code === failure.code);
        if (!recorded) this.writer.recordGap(failure.code, { preserveComplete });
        if (!preserveComplete) this.writer.refreshCapture({ status: "failed", complete: false });
      } catch {}
    }
    this.emitProgress("failed");
    return failure;
  }

  cancel() {
    if (this.receipt || this.finalized) return this.receipt;
    if (this.failure) return this.failure;
    const error = new Error("Direct live turn capture was cancelled by its owning lifecycle.");
    error.code = "direct_turn_capture_cancelled";
    return this.markFailed(error);
  }

  finalize(result = {}) {
    if (this.receipt) return this.receipt;
    this.assertWritable();
    try {
      this.receipt = this.writer.finalize(result, {
        duplicateConflictCode: "direct_epistemic_native_child_duplicate_conflict",
        prefixConflictCode: "direct_epistemic_native_child_partial_capture_conflict",
      });
      this.finalized = true;
      this.emitProgress("captured", this.receipt);
      return this.receipt;
    } catch (error) {
      this.markFailed(error);
      throw error;
    }
  }

  epistemicCapture() {
    if (this.receipt) return captureEnvelope(this.writer, "captured", this.receipt);
    return {
      ...captureEnvelope(this.writer, this.failure ? "failed" : "capturing"),
      errorCode: text(this.failure?.code),
    };
  }
}

function createNativeChildLiveTurnCapture(options = {}) {
  const writer = openNativeChildProviderTurnCapture(options.sessionStore, options.captureInput);
  return new DirectLiveTurnCaptureAdapter({
    writer,
    epistemicService: options.epistemicService,
    projectId: options.captureInput?.projectId,
    onProgress: options.onProgress,
  });
}

module.exports = {
  DirectLiveTurnCaptureAdapter,
  createNativeChildLiveTurnCapture,
};
