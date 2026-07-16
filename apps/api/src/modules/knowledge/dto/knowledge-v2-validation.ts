import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import {
  isKnowledgeV2ScopeOpaqueId,
  isKnowledgeV2ScopeSegment,
  KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
  KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
  KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH,
} from "@leadvirt/knowledge";

const CHANNEL_TYPES = new Set([
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "WEBHOOK",
  "PHONE",
  "DEMO",
]);
const AUDIENCES = new Set(["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"]);
const CONDITION_FIELDS = new Set([
  "INTENT",
  "CHANNEL",
  "LOCALE",
  "LOCATION",
  "BUSINESS_HOURS",
  "CUSTOMER_AUTHORIZATION",
  "LEAD_STAGE",
  "TOOL_RESULT",
]);
const CONDITION_OPERATORS = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "EXISTS",
  "GREATER_THAN",
  "LESS_THAN",
]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

interface JsonLimits {
  maxArrayItems: number;
  maxDepth: number;
  maxKeys: number;
  maxKeyLength: number;
  maxNodes: number;
  maxStringLength: number;
  maxBytes: number;
}

const FACT_JSON_LIMITS: JsonLimits = {
  maxArrayItems: 100,
  maxDepth: 8,
  maxKeys: 100,
  maxKeyLength: 128,
  maxNodes: 512,
  maxStringLength: 4_000,
  maxBytes: 32_768,
};

const CONDITION_VALUE_LIMITS: JsonLimits = {
  maxArrayItems: 25,
  maxDepth: 3,
  maxKeys: 25,
  maxKeyLength: 64,
  maxNodes: 64,
  maxStringLength: 512,
  maxBytes: 4_096,
};

const SCOPE_JSON_LIMITS: JsonLimits = {
  maxArrayItems: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
  maxDepth: 2,
  maxKeys: 7,
  maxKeyLength: 16,
  maxNodes: 256,
  maxStringLength: KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
  maxBytes: 32_768,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key) && !UNSAFE_KEYS.has(key));
}

function isBoundedJson(value: unknown, limits: JsonLimits): boolean {
  const visited = new WeakSet<object>();
  let nodeCount = 0;

  const visit = (candidate: unknown, depth: number): boolean => {
    nodeCount += 1;
    if (nodeCount > limits.maxNodes || depth > limits.maxDepth) {
      return false;
    }

    if (candidate === null || typeof candidate === "boolean") {
      return true;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate);
    }
    if (typeof candidate === "string") {
      return candidate.length <= limits.maxStringLength;
    }
    if (typeof candidate !== "object") {
      return false;
    }
    if (visited.has(candidate)) {
      return false;
    }
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      return (
        candidate.length <= limits.maxArrayItems &&
        candidate.every((item) => visit(item, depth + 1))
      );
    }
    if (!isPlainRecord(candidate)) {
      return false;
    }

    const entries = Object.entries(candidate);
    return (
      entries.length <= limits.maxKeys &&
      entries.every(
        ([key, item]) =>
          key.length > 0 &&
          key.length <= limits.maxKeyLength &&
          !UNSAFE_KEYS.has(key) &&
          visit(item, depth + 1),
      )
    );
  };

  if (!visit(value, 0)) {
    return false;
  }

  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && new TextEncoder().encode(encoded).byteLength <= limits.maxBytes;
  } catch {
    return false;
  }
}

function hasUniqueValues(values: readonly string[], normalize: (value: string) => string): boolean {
  return new Set(values.map(normalize)).size === values.length;
}

function isBoundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
  validate: (item: string) => boolean = () => true,
  normalize: (item: string) => string = (item) => item,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item): item is string =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= maxItemLength &&
        item === item.trim() &&
        validate(item),
    ) &&
    hasUniqueValues(value, normalize)
  );
}

export function isKnowledgeV2Locale(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 35 ||
    value !== value.trim() ||
    value.includes("_")
  ) {
    return false;
  }

  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export function isKnowledgeV2TimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    value !== value.trim()
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isKnowledgeV2Timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 35 &&
    ISO_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isKnowledgeV2Scope(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    "brandIds",
    "locationIds",
    "channelTypes",
    "assistantIds",
    "audiences",
    "segments",
    "locales",
  ]);
  if (!hasOnlyKeys(value, allowedKeys)) {
    return false;
  }

  const checks: boolean[] = [];
  if (value.brandIds !== undefined) {
    checks.push(
      isBoundedStringArray(
        value.brandIds,
        KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
        KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
        isKnowledgeV2ScopeOpaqueId,
      ),
    );
  }
  if (value.locationIds !== undefined) {
    checks.push(
      isBoundedStringArray(
        value.locationIds,
        KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
        KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
        isKnowledgeV2ScopeOpaqueId,
      ),
    );
  }
  if (value.channelTypes !== undefined) {
    checks.push(
      isBoundedStringArray(value.channelTypes, CHANNEL_TYPES.size, 16, (item) =>
        CHANNEL_TYPES.has(item),
      ),
    );
  }
  if (value.assistantIds !== undefined) {
    checks.push(
      isBoundedStringArray(
        value.assistantIds,
        KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
        KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
        isKnowledgeV2ScopeOpaqueId,
      ),
    );
  }
  if (value.audiences !== undefined) {
    checks.push(
      isBoundedStringArray(value.audiences, AUDIENCES.size, 32, (item) => AUDIENCES.has(item)),
    );
  }
  if (value.segments !== undefined) {
    checks.push(
      isBoundedStringArray(
        value.segments,
        KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
        KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH,
        isKnowledgeV2ScopeSegment,
      ),
    );
  }
  if (value.locales !== undefined) {
    checks.push(
      isBoundedStringArray(
        value.locales,
        20,
        35,
        isKnowledgeV2Locale,
        (item) => Intl.getCanonicalLocales(item)[0]?.toLowerCase() ?? item.toLowerCase(),
      ),
    );
  }

  return checks.every(Boolean) && isBoundedJson(value, SCOPE_JSON_LIMITS);
}

interface ConditionState {
  nodes: number;
  visited: WeakSet<object>;
}

function isGuidanceConditionNode(value: unknown, depth: number, state: ConditionState): boolean {
  if (!isPlainRecord(value) || depth > 6 || state.nodes >= 64 || state.visited.has(value)) {
    return false;
  }
  state.nodes += 1;
  state.visited.add(value);

  if (value.kind === "ALL" || value.kind === "ANY") {
    if (!hasOnlyKeys(value, new Set(["kind", "conditions"]))) {
      return false;
    }
    return (
      Array.isArray(value.conditions) &&
      value.conditions.length >= (value.kind === "ALL" ? 0 : 1) &&
      value.conditions.length <= 10 &&
      value.conditions.every((condition) => isGuidanceConditionNode(condition, depth + 1, state))
    );
  }

  if (value.kind === "NOT") {
    return (
      hasOnlyKeys(value, new Set(["kind", "condition"])) &&
      isGuidanceConditionNode(value.condition, depth + 1, state)
    );
  }

  if (value.kind !== "PREDICATE") {
    return false;
  }
  if (!hasOnlyKeys(value, new Set(["kind", "field", "operator", "value"]))) {
    return false;
  }
  if (
    typeof value.field !== "string" ||
    !CONDITION_FIELDS.has(value.field) ||
    typeof value.operator !== "string" ||
    !CONDITION_OPERATORS.has(value.operator)
  ) {
    return false;
  }

  const hasValue = Object.hasOwn(value, "value");
  if (value.operator === "EXISTS") {
    return !hasValue;
  }
  if (!hasValue || !isBoundedJson(value.value, CONDITION_VALUE_LIMITS)) {
    return false;
  }
  if (value.operator === "IN" || value.operator === "NOT_IN") {
    if (!Array.isArray(value.value) || value.value.length < 1 || value.value.length > 25) {
      return false;
    }
    return (
      value.value.every(
        (item) => item === null || ["string", "number", "boolean"].includes(typeof item),
      ) && new Set(value.value.map((item) => JSON.stringify(item))).size === value.value.length
    );
  }
  if (value.operator === "CONTAINS") {
    return typeof value.value === "string" && value.value.length > 0 && value.value.length <= 512;
  }
  if (value.operator === "GREATER_THAN" || value.operator === "LESS_THAN") {
    return typeof value.value === "number" && Number.isFinite(value.value);
  }

  return true;
}

export function isKnowledgeV2GuidanceCondition(value: unknown): boolean {
  return isGuidanceConditionNode(value, 0, { nodes: 0, visited: new WeakSet<object>() });
}

export function isKnowledgeV2PublicationSchedule(value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, new Set(["timeZone", "daysOfWeek", "hour", "minute"]))
  ) {
    return false;
  }

  return (
    isKnowledgeV2TimeZone(value.timeZone) &&
    Array.isArray(value.daysOfWeek) &&
    value.daysOfWeek.length >= 1 &&
    value.daysOfWeek.length <= 7 &&
    value.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(value.daysOfWeek).size === value.daysOfWeek.length &&
    Number.isInteger(value.hour) &&
    typeof value.hour === "number" &&
    value.hour >= 0 &&
    value.hour <= 23 &&
    Number.isInteger(value.minute) &&
    typeof value.minute === "number" &&
    value.minute >= 0 &&
    value.minute <= 59
  );
}

function createValidator(
  name: string,
  validate: (value: unknown, arguments_: ValidationArguments) => boolean,
  validationOptions?: ValidationOptions,
  constraints: unknown[] = [],
): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name,
      target: target.constructor,
      propertyName: String(propertyName),
      constraints,
      ...(validationOptions === undefined ? {} : { options: validationOptions }),
      validator: { validate },
    });
  };
}

export function IsKnowledgeV2Locale(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2Locale",
    (value) => isKnowledgeV2Locale(value),
    validationOptions,
  );
}

export function IsKnowledgeV2LocaleList(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2LocaleList",
    (value) =>
      isBoundedStringArray(
        value,
        20,
        35,
        isKnowledgeV2Locale,
        (item) => Intl.getCanonicalLocales(item)[0]?.toLowerCase() ?? item.toLowerCase(),
      ) && value.length >= 1,
    validationOptions,
  );
}

export function IncludesKnowledgeV2Locale(
  localeProperty: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return createValidator(
    "includesKnowledgeV2Locale",
    (value, arguments_) => {
      if (!Array.isArray(value)) {
        return false;
      }
      const input = arguments_.object as Record<string, unknown>;
      const locale = input[localeProperty];
      if (locale === undefined || locale === null) {
        return true;
      }
      if (!isKnowledgeV2Locale(locale)) {
        return false;
      }
      const canonicalLocale = Intl.getCanonicalLocales(locale)[0];
      return value.some(
        (candidate: unknown) =>
          isKnowledgeV2Locale(candidate) &&
          Intl.getCanonicalLocales(candidate)[0] === canonicalLocale,
      );
    },
    validationOptions,
    [localeProperty],
  );
}

export function IsKnowledgeV2TimeZone(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2TimeZone",
    (value) => isKnowledgeV2TimeZone(value),
    validationOptions,
  );
}

export function IsKnowledgeV2Timestamp(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2Timestamp",
    (value) => isKnowledgeV2Timestamp(value),
    validationOptions,
  );
}

export function IsKnowledgeV2JsonValue(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2JsonValue",
    (value) => isBoundedJson(value, FACT_JSON_LIMITS),
    validationOptions,
  );
}

export function IsKnowledgeV2Scope(validationOptions?: ValidationOptions): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2Scope",
    (value) => isKnowledgeV2Scope(value),
    validationOptions,
  );
}

export function IsKnowledgeV2GuidanceCondition(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2GuidanceCondition",
    (value) => isKnowledgeV2GuidanceCondition(value),
    validationOptions,
  );
}

export function IsKnowledgeV2PublicationSchedule(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return createValidator(
    "isKnowledgeV2PublicationSchedule",
    (value) => isKnowledgeV2PublicationSchedule(value),
    validationOptions,
  );
}

export function IsAfterKnowledgeV2Date(
  startProperty: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return createValidator(
    "isAfterKnowledgeV2Date",
    (value, arguments_) => {
      if (value === undefined || value === null) {
        return true;
      }
      const input = arguments_.object as Record<string, unknown>;
      const start = input[startProperty];
      if (start === undefined || start === null) {
        return true;
      }
      return (
        isKnowledgeV2Timestamp(start) &&
        isKnowledgeV2Timestamp(value) &&
        Date.parse(value) > Date.parse(start)
      );
    },
    validationOptions,
    [startProperty],
  );
}
