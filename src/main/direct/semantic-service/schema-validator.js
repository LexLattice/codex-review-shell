"use strict";

const {
  canonicalJson,
  deepFreeze,
  isCanonicalId,
  isDigest,
  isImmutableSelector,
  isMutableSelector,
  isPlainObject,
} = require("./canonical");
const { getContractSchema } = require("./contract-schemas");

const ERROR_CODES = Object.freeze({
  UNKNOWN_SCHEMA: "DSS_SCHEMA_UNKNOWN",
  INVALID: "DSS_SCHEMA_INVALID",
  TYPE: "DSS_SCHEMA_TYPE",
  REQUIRED: "DSS_SCHEMA_REQUIRED",
  UNKNOWN_FIELD: "DSS_SCHEMA_UNKNOWN_FIELD",
  ENUM: "DSS_SCHEMA_ENUM",
  CONST: "DSS_SCHEMA_CONST",
  PATTERN: "DSS_SCHEMA_PATTERN",
  FORMAT: "DSS_SCHEMA_FORMAT",
  DIGEST: "DSS_SCHEMA_DIGEST",
  ID: "DSS_SCHEMA_ID",
  MUTABLE_SELECTOR: "DSS_SCHEMA_MUTABLE_SELECTOR",
  MIN_ITEMS: "DSS_SCHEMA_MIN_ITEMS",
  MAX_ITEMS: "DSS_SCHEMA_MAX_ITEMS",
  DUPLICATE_SET_ENTRY: "DSS_SCHEMA_DUPLICATE_SET_ENTRY",
  NONCANONICAL_SET: "DSS_SCHEMA_NONCANONICAL_SET",
  MINIMUM: "DSS_SCHEMA_NUMERIC_MINIMUM",
  MAXIMUM: "DSS_SCHEMA_NUMERIC_MAXIMUM",
  INTEGER: "DSS_SCHEMA_INTEGER",
  STRING_BOUNDS: "DSS_SCHEMA_STRING_BOUNDS",
  ANY_OF: "DSS_SCHEMA_ANY_OF",
  ONE_OF: "DSS_SCHEMA_ONE_OF",
  NOT: "DSS_SCHEMA_NOT",
  CANONICAL: "DSS_SCHEMA_CANONICAL",
});

class ContractValidationError extends TypeError {
  constructor(schemaName, errors) {
    const first = errors[0] || { code: ERROR_CODES.INVALID, path: "$", message: "contract is invalid" };
    super(`${first.code} at ${first.path}: ${first.message}`);
    this.name = "ContractValidationError";
    this.code = first.code;
    this.path = first.path;
    this.schemaName = schemaName;
    this.errors = errors;
  }
}

function pathFor(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function addError(errors, code, path, message, keyword, params = undefined) {
  const error = { code, path, message };
  if (keyword) error.keyword = keyword;
  if (params !== undefined) error.params = params;
  errors.push(error);
}

function typeMatches(value, expected) {
  switch (expected) {
    case "null": return value === null;
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "integer": return Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    default: return false;
  }
}

function isSafeToken(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 256
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~\-]{0,255}$/.test(value)
    && !isMutableSelector(value);
}

function isTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) && date.toISOString() === milliseconds;
}

function isBoundedText(value, schema) {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= (schema.minLength === undefined ? 1 : schema.minLength)
    && value.length <= (schema.maxLength === undefined ? 4096 : schema.maxLength);
}

function formatValid(value, format, schema) {
  switch (format) {
    case "id": return isCanonicalId(value) && !isMutableSelector(value);
    case "immutable-ref": return isImmutableSelector(value);
    case "digest": return isDigest(value);
    case "timestamp": return isTimestamp(value);
    case "safe-token": return isSafeToken(value);
    case "bounded-text": return isBoundedText(value, schema);
    case "nonempty": return typeof value === "string" && value.length > 0 && value === value.trim();
    default: return true;
  }
}

function canonicalEqual(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch (error) {
    return false;
  }
}

function validateNode(schema, value, path, errors, context) {
  if (!schema || typeof schema !== "object") {
    addError(errors, ERROR_CODES.INVALID, path, "schema declaration is invalid");
    return;
  }

  if (schema.$ref) {
    const target = context.resolve(schema.$ref);
    if (!target) {
      addError(errors, ERROR_CODES.INVALID, path, `unresolved schema reference ${schema.$ref}`);
    } else {
      validateNode(target, value, path, errors, context);
    }
    return;
  }

  if (schema.anyOf) {
    const branchErrors = [];
    let valid = false;
    for (const branch of schema.anyOf) {
      const candidateErrors = [];
      validateNode(branch, value, path, candidateErrors, context);
      if (candidateErrors.length === 0) {
        valid = true;
        break;
      }
      branchErrors.push(candidateErrors);
    }
    if (!valid) addError(errors, ERROR_CODES.ANY_OF, path, "value does not match any allowed schema", "anyOf", { branches: branchErrors.length });
    return;
  }

  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      const candidateErrors = [];
      validateNode(branch, value, path, candidateErrors, context);
      if (candidateErrors.length === 0) matches += 1;
    }
    if (matches !== 1) addError(errors, ERROR_CODES.ONE_OF, path, "value must match exactly one schema", "oneOf", { matches });
    return;
  }

  if (schema.not) {
    const candidateErrors = [];
    validateNode(schema.not, value, path, candidateErrors, context);
    if (candidateErrors.length === 0) addError(errors, ERROR_CODES.NOT, path, "value matches a forbidden schema", "not");
  }

  if (schema.const !== undefined && !canonicalEqual(value, schema.const)) {
    addError(errors, ERROR_CODES.CONST, path, `value must equal ${JSON.stringify(schema.const)}`, "const", { expected: schema.const });
    return;
  }

  if (schema.enum && !schema.enum.some((candidate) => canonicalEqual(value, candidate))) {
    addError(errors, ERROR_CODES.ENUM, path, "value is outside the closed enum", "enum", { allowed: schema.enum });
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      addError(errors, ERROR_CODES.TYPE, path, `expected ${types.join(" or ")}`, "type", { expected: types });
      return;
    }
    if (types.includes("object") && !isPlainObject(value)) {
      addError(errors, ERROR_CODES.CANONICAL, path, "contract objects must be plain JSON objects", "canonical");
      return;
    }
  }

  if (schema.type === "object" || (schema.properties && value && typeof value === "object" && !Array.isArray(value))) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          addError(errors, ERROR_CODES.REQUIRED, pathFor(path, key), "required field is missing", "required", { key });
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) addError(errors, ERROR_CODES.UNKNOWN_FIELD, pathFor(path, key), "unknown field is forbidden", "additionalProperties", { key });
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateNode(childSchema, value[key], pathFor(path, key), errors, context);
      }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      addError(errors, ERROR_CODES.MIN_ITEMS, path, "object has too few properties", "minProperties");
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
      addError(errors, ERROR_CODES.MAX_ITEMS, path, "object has too many properties", "maxProperties");
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) addError(errors, ERROR_CODES.MIN_ITEMS, path, "array has too few items", "minItems", { minimum: schema.minItems });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) addError(errors, ERROR_CODES.MAX_ITEMS, path, "array has too many items", "maxItems", { maximum: schema.maxItems });
    if (schema.uniqueItems || schema["x-set"] || schema["x-canonical-set"]) {
      const seen = new Map();
      for (let index = 0; index < value.length; index += 1) {
        let identity;
        try {
          identity = canonicalJson(value[index]);
        } catch (error) {
          addError(errors, ERROR_CODES.CANONICAL, pathFor(path, index), "set entry is not canonical JSON", "uniqueItems");
          continue;
        }
        if (seen.has(identity)) {
          addError(errors, ERROR_CODES.DUPLICATE_SET_ENTRY, pathFor(path, index), "duplicate set entry", "uniqueItems", { firstIndex: seen.get(identity) });
        } else {
          seen.set(identity, index);
        }
        if (schema["x-canonical-set"] && index > 0) {
          const previous = canonicalJson(value[index - 1]);
          if (identity < previous) addError(errors, ERROR_CODES.NONCANONICAL_SET, path, "set entries must be sorted canonically", "x-canonical-set");
        }
      }
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) validateNode(schema.items, value[index], pathFor(path, index), errors, context);
    }
  }

  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) addError(errors, ERROR_CODES.STRING_BOUNDS, path, "string is shorter than the contract minimum", "minLength", { minimum: schema.minLength });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) addError(errors, ERROR_CODES.STRING_BOUNDS, path, "string is longer than the contract maximum", "maxLength", { maximum: schema.maxLength });
    if (schema.pattern) {
      const pattern = new RegExp(schema.pattern);
      if (!pattern.test(value)) addError(errors, ERROR_CODES.PATTERN, path, "string does not match the closed pattern", "pattern");
    }
    if (schema.format && !formatValid(value, schema.format, schema)) {
      const code = schema.format === "digest" ? ERROR_CODES.DIGEST
        : schema.format === "id" ? ERROR_CODES.ID
          : schema.format === "immutable-ref" ? ERROR_CODES.MUTABLE_SELECTOR
            : ERROR_CODES.FORMAT;
      addError(errors, code, path, `invalid ${schema.format} value`, "format", { format: schema.format });
    }
    if (schema["x-no-mutable-selector"] && isMutableSelector(value)) addError(errors, ERROR_CODES.MUTABLE_SELECTOR, path, "mutable/latest-style selector is forbidden", "x-no-mutable-selector");
  }

  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (!Number.isFinite(value)) addError(errors, ERROR_CODES.TYPE, path, "number must be finite", "type");
    if (schema.type === "integer" && !Number.isSafeInteger(value)) addError(errors, ERROR_CODES.INTEGER, path, "number must be a safe integer", "type");
    if (schema.minimum !== undefined && value < schema.minimum) addError(errors, ERROR_CODES.MINIMUM, path, "number is below the contract minimum", "minimum", { minimum: schema.minimum });
    if (schema.maximum !== undefined && value > schema.maximum) addError(errors, ERROR_CODES.MAXIMUM, path, "number is above the contract maximum", "maximum", { maximum: schema.maximum });
  }
}

function resolveSchemaArgument(schemaOrName, value) {
  if (typeof schemaOrName === "string") return { schema: getContractSchema(schemaOrName), schemaName: schemaOrName, value };
  if (schemaOrName && typeof schemaOrName === "object" && (schemaOrName.$id || schemaOrName.type || schemaOrName.properties)) {
    return { schema: schemaOrName, schemaName: schemaOrName.$id || "inline", value };
  }
  // Be permissive about the common validate(value, schemaName) order.
  if (typeof value === "string") return { schema: getContractSchema(value), schemaName: value, value: schemaOrName };
  return { schema: null, schemaName: "unknown", value };
}

function validationResult(schemaOrName, value) {
  const resolved = resolveSchemaArgument(schemaOrName, value);
  if (!resolved.schema) {
    return {
      valid: false,
      schemaName: resolved.schemaName,
      errors: [{ code: ERROR_CODES.UNKNOWN_SCHEMA, path: "$", message: "unknown contract schema" }],
    };
  }
  const errors = [];
  let canonicalBoundaryValid = true;
  try {
    // Validate the closed JSON boundary once before walking the contract. The
    // structural walk below still reports field-level diagnostics (including
    // unknown fields), while this catches accessors, cycles, sparse arrays,
    // undefined, and non-JSON host objects.
    canonicalJson(value);
  } catch (error) {
    canonicalBoundaryValid = false;
    addError(errors, error?.code || ERROR_CODES.CANONICAL, error?.path || "$", error?.message || "value is not canonical JSON", "canonical");
  }
  const context = { resolve: getContractSchema };
  if (canonicalBoundaryValid) validateNode(resolved.schema, resolved.value, "$", errors, context);
  return { valid: errors.length === 0, schemaName: resolved.schemaName, errors };
}

/**
 * Return a structured result.  This is the non-throwing API for admission
 * preflight and diagnostics.
 */
function checkContract(schemaOrName, value) {
  return validationResult(schemaOrName, value);
}

/**
 * Throwing admission validator. A successful call returns the deeply frozen
 * input so registry/auth callers can safely retain the admitted value. Use
 * isValidContract or checkContract when a boolean/non-throwing result is
 * required.
 */
function validateContract(schemaOrName, value) {
  return assertValidContract(schemaOrName, value);
}

function assertValidContract(schemaOrName, value) {
  const result = validationResult(schemaOrName, value);
  if (!result.valid) throw new ContractValidationError(result.schemaName, result.errors);
  return deepFreeze(value);
}

function validateSchema(schemaOrName, value) {
  return isValidContract(schemaOrName, value);
}

function isValidContract(schemaOrName, value) {
  return validationResult(schemaOrName, value).valid;
}

module.exports = {
  ContractValidationError,
  ERROR_CODES,
  assertValidContract,
  checkContract,
  isValidContract,
  validate: validateContract,
  validateContract,
  validateSchema,
};
