"use strict";

const fs = require("node:fs");
const { dss02Fail, digestBytes, randomRef } = require("./dss02-common");

function readProtectedCredentialFd(fd, { maximumBytes = 64 * 1024 } = {}) {
  if (!Number.isSafeInteger(fd) || fd < 0) dss02Fail("DSS02_CREDENTIAL_DESCRIPTOR_INVALID");
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.mode & 0o077) dss02Fail("DSS02_CREDENTIAL_DESCRIPTOR_UNPROTECTED");
  if (stat.size > maximumBytes) dss02Fail("DSS02_CREDENTIAL_TOO_LARGE");
  const bytes = fs.readFileSync(fd);
  return Object.freeze({ credentialRef: randomRef("credential"), credentialDigest: digestBytes("DirectSemanticService.ProtectedCredential.v1", bytes), bytes });
}

function credentialDescriptorProvenance(fd, policy = { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }) {
  if (!Number.isSafeInteger(fd) || fd < 0) dss02Fail("DSS02_CREDENTIAL_DESCRIPTOR_INVALID");
  return Object.freeze({ descriptorPolicy: policy, descriptorNumber: fd, descriptorStat: fs.fstatSync(fd) });
}

module.exports = { readProtectedCredentialFd, credentialDescriptorProvenance };
