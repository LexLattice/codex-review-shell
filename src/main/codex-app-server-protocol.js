"use strict";

const SUPPORTED_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
];

const AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS = [
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
];

module.exports = {
  SUPPORTED_SERVER_REQUEST_METHODS,
  AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS,
};
