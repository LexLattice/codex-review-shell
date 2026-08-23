(function runtimePreferenceWriteCoordinatorModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DirectRuntimePreferenceWriteCoordinator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function normalizeScope(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function errorMessage(error) {
    return String(error?.message || error || "Runtime preference update failed.");
  }

  function createRuntimePreferenceWriteCoordinator(options = {}) {
    if (typeof options.persist !== "function") {
      throw new TypeError("Runtime preference coordinator requires persist(scope, requested).");
    }
    const scopeStates = new Map();
    let queue = Promise.resolve(null);

    const scopeState = (scope) => {
      const key = normalizeScope(scope);
      if (!key) throw new TypeError("Runtime preference write scope is required.");
      if (!scopeStates.has(key)) {
        scopeStates.set(key, {
          generation: 0,
          status: "idle",
          error: "",
        });
      }
      return scopeStates.get(key);
    };

    const snapshot = () => {
      const scopes = {};
      for (const [scope, value] of scopeStates.entries()) {
        scopes[scope] = { ...value };
      }
      const values = Object.values(scopes);
      const failed = values.filter((value) => value.status === "failed");
      const status = values.some((value) => value.status === "saving")
        ? "saving"
        : failed.length
          ? "failed"
          : values.length
            ? "ready"
            : "idle";
      return {
        status,
        error: failed.map((value) => value.error).filter(Boolean).join(" · "),
        scopes,
      };
    };

    const publish = () => {
      const projection = snapshot();
      options.onStateChange?.(projection);
      return projection;
    };

    const enqueue = (scopeValue, requestedValue = {}) => {
      const scope = normalizeScope(scopeValue);
      const requested = { ...(requestedValue || {}) };
      const current = scopeState(scope);
      const generation = current.generation + 1;
      current.generation = generation;
      current.status = "saving";
      current.error = "";
      publish();

      queue = queue.then(async () => {
        try {
          const response = await options.persist(scope, requested);
          const canonical = typeof options.canonicalize === "function"
            ? options.canonicalize(scope, response, requested)
            : requested;
          const latest = scopeState(scope).generation === generation;
          const applicable = typeof options.isApplicable === "function"
            ? options.isApplicable(scope, requested, response) !== false
            : true;
          if (applicable) {
            options.applyConfirmed?.(scope, canonical, { generation, response });
          }
          if (latest) {
            const latestState = scopeState(scope);
            latestState.status = "ready";
            latestState.error = "";
            if (applicable) {
              options.applyOptimistic?.(scope, canonical, { generation, response });
            }
          }
          publish();
          if (latest && applicable && typeof options.onLatestSuccess === "function") {
            try {
              await options.onLatestSuccess(scope, response, canonical);
            } catch (error) {
              options.onError?.(error, {
                scope,
                generation,
                latest,
                phase: "post_success",
              });
            }
          }
          return { ok: true, scope, generation, latest, applicable, response, canonical };
        } catch (error) {
          const latest = scopeState(scope).generation === generation;
          const applicable = typeof options.isApplicable === "function"
            ? options.isApplicable(scope, requested, null) !== false
            : true;
          if (latest && applicable) {
            const failedState = scopeState(scope);
            failedState.status = "failed";
            failedState.error = errorMessage(error);
            const confirmed = typeof options.readConfirmed === "function"
              ? options.readConfirmed(scope)
              : {};
            options.applyOptimistic?.(scope, confirmed, {
              generation,
              error,
              rollback: true,
            });
          } else if (latest) {
            const staleState = scopeState(scope);
            staleState.status = "ready";
            staleState.error = "";
          }
          options.onError?.(error, {
            scope,
            generation,
            latest,
            phase: "persist",
          });
          publish();
          return { ok: false, scope, generation, latest, applicable, error };
        }
      });
      return queue;
    };

    const reconcile = (scopeValue) => {
      const scope = normalizeScope(scopeValue);
      const current = scopeState(scope);
      current.generation += 1;
      current.status = "ready";
      current.error = "";
      return publish();
    };

    const flush = async () => {
      await queue;
      const projection = snapshot();
      if (projection.status === "failed") {
        const error = new Error(
          projection.error || "The task runtime binding could not be saved.",
        );
        error.code = "runtime_preference_write_failed";
        error.projection = projection;
        throw error;
      }
      return projection;
    };

    return Object.freeze({
      enqueue,
      flush,
      reconcile,
      snapshot,
    });
  }

  return Object.freeze({ createRuntimePreferenceWriteCoordinator });
});
