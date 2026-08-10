"use strict";

const APP_EXPERIENCE_ENV_VAR = "CODEX_EXPERIENCE";

const APP_EXPERIENCES = Object.freeze({
  LEGACY_SHELL: "legacy-shell",
  DIRECT_WORKBENCH: "direct-workbench",
  WORLD_MANAGER_STUDIO: "world-manager-studio",
});

const EXPERIENCE_DEFINITIONS = Object.freeze({
  [APP_EXPERIENCES.LEGACY_SHELL]: Object.freeze({
    id: APP_EXPERIENCES.LEGACY_SHELL,
    label: "Codex Review Shell",
    controlPlane: "legacy-review-shell",
    interactionLaw: "multi-surface-review-shell",
    rendererDocument: "codex-surface.html",
    available: true,
  }),
  [APP_EXPERIENCES.DIRECT_WORKBENCH]: Object.freeze({
    id: APP_EXPERIENCES.DIRECT_WORKBENCH,
    label: "Direct Workbench",
    controlPlane: "direct-thread",
    interactionLaw: "direct-thread-conversation",
    rendererDocument: "t3-direct-surface.html",
    available: true,
  }),
  [APP_EXPERIENCES.WORLD_MANAGER_STUDIO]: Object.freeze({
    id: APP_EXPERIENCES.WORLD_MANAGER_STUDIO,
    label: "WorldManager Studio",
    controlPlane: "worldmanager-semantic",
    interactionLaw: "semantic-settlement-and-admission",
    rendererDocument: "world-manager-surface.html",
    available: false,
  }),
});

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function experienceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveAppExperience(env = process.env) {
  const explicit = cleanString(env[APP_EXPERIENCE_ENV_VAR]).toLowerCase();
  if (explicit && !EXPERIENCE_DEFINITIONS[explicit]) {
    throw experienceError(
      "app_experience_unknown",
      `${APP_EXPERIENCE_ENV_VAR} must be one of: ${Object.keys(EXPERIENCE_DEFINITIONS).join(", ")}.`,
    );
  }

  let id = explicit;
  let source = "explicit";
  if (!id) {
    if (env.CODEX_DIRECT_T3_GUI === "1") {
      id = APP_EXPERIENCES.DIRECT_WORKBENCH;
      source = "compatibility";
    } else {
      id = APP_EXPERIENCES.LEGACY_SHELL;
      source = "default";
    }
  }

  const definition = EXPERIENCE_DEFINITIONS[id];
  if (!definition.available) {
    throw experienceError(
      "app_experience_unavailable",
      `${definition.label} is reserved but not available in this mainline slice.`,
    );
  }

  return Object.freeze({
    ...definition,
    source,
  });
}

function publicAppExperience(experience) {
  const resolved = experience || resolveAppExperience();
  return {
    id: resolved.id,
    label: resolved.label,
    controlPlane: resolved.controlPlane,
    interactionLaw: resolved.interactionLaw,
    rendererDocument: resolved.rendererDocument,
  };
}

module.exports = {
  APP_EXPERIENCE_ENV_VAR,
  APP_EXPERIENCES,
  publicAppExperience,
  resolveAppExperience,
};
