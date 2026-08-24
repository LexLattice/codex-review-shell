"use strict";

/*
 * DSS-0.1 composition root.
 *
 * This factory is deliberately smaller than a service daemon. It joins the
 * frozen contracts, principal/capability custody, registry authority, and
 * authorization intersection without introducing scheduling, persistence, or
 * worker execution ahead of DSS-0.2.
 */

const { fail, deepFreeze, isPlainObject } = require("./canonical");
const { createPrincipalAuthority } = require("./principal-authority");
const { createCapabilityAuthority } = require("./capability-authority");
const { createRegistryAuthority } = require("./registry");
const { createAuthorizationAuthority } = require("./authorization");

function createDirectSemanticServiceFoundation(options = {}) {
  if (!isPlainObject(options)) fail("direct_semantic_foundation_options_invalid");
  const allowed = new Set([
    "now",
    "clock",
    "principalAuthorityId",
    "capabilityAuthorityId",
    "registryAuthorityRef",
    "registryAdmissionCapabilityRef",
    "authorizationAuthorityId",
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail("direct_semantic_foundation_options_invalid", key);
  }

  const clock = options.now ?? options.clock;
  const principalAuthority = createPrincipalAuthority({
    ...(options.principalAuthorityId === undefined ? {} : { authorityId: options.principalAuthorityId }),
    ...(clock === undefined ? {} : { now: clock }),
  });
  const capabilityAuthority = createCapabilityAuthority({
    principalAuthority,
    ...(options.capabilityAuthorityId === undefined ? {} : { authorityId: options.capabilityAuthorityId }),
    ...(clock === undefined ? {} : { now: clock }),
  });
  const registryAuthority = createRegistryAuthority({
    ...(options.registryAuthorityRef === undefined ? {} : { authorityRef: options.registryAuthorityRef }),
    ...(options.registryAdmissionCapabilityRef === undefined
      ? {}
      : { admissionCapabilityRef: options.registryAdmissionCapabilityRef }),
  });
  const authorizationAuthority = createAuthorizationAuthority({
    principalAuthority,
    capabilityAuthority,
    registry: registryAuthority,
    ...(options.authorizationAuthorityId === undefined ? {} : { authorityId: options.authorizationAuthorityId }),
    ...(clock === undefined ? {} : { now: clock }),
  });

  return deepFreeze({
    schema: "direct_semantic_service_foundation@1",
    maturity: "dss_0_1_contracts_and_registry",
    principalAuthority,
    capabilityAuthority,
    registryAuthority,
    authorizationAuthority,
  });
}

module.exports = {
  createDirectSemanticServiceFoundation,
  createDss01Foundation: createDirectSemanticServiceFoundation,
};
