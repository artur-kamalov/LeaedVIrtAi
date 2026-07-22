import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  Prisma,
  type BusinessIdentity as DbBusinessIdentity,
  type BusinessInformationState as DbBusinessInformationState,
  type OnboardingState as DbOnboardingState,
  type Tenant as DbTenant,
} from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
} from "@leadvirt/knowledge";
import { createRuntimeQueueEvent } from "@leadvirt/runtime-queue";
import type {
  BusinessProfileData,
  BusinessProfilePatch,
  BusinessProfileScheduleDay,
  BusinessProfileServiceItem,
  BusinessProfileView,
  SettingsAccount,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeService } from "../knowledge/knowledge.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "../knowledge/knowledge-v2-http.js";
import { lockKnowledgeV2CorpusTransition } from "../knowledge/knowledge-v2-transition-lock.js";
import { isKnowledgeV2TimeZone } from "../knowledge/dto/knowledge-v2-validation.js";
import {
  BUSINESS_PROFILE_MAX_SERIALIZED_BYTES,
  businessProfileSerializedBytes,
} from "./business-profile-limits.js";
import { businessImportError } from "./business-import-http.js";
import {
  adoptPendingBusinessImportObject,
  cleanupPendingBusinessImportObject,
  putPendingBusinessImportObject,
  reservePendingBusinessImportObject,
  type PendingBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportQueueService } from "./business-import-queue.service.js";
import type { BusinessProfilePatchRequestDto } from "./dto/business-profile.dto.js";

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_INDEX = new Map(DAY_ORDER.map((day, index) => [day, index]));
type HeaderValue = string | string[] | undefined;

type CanonicalOfferingRow = Prisma.BusinessOfferingGetPayload<{
  include: { prices: true; duration: true };
}>;

interface CanonicalAggregateRows {
  identity: DbBusinessIdentity;
  offerings: CanonicalOfferingRow[];
}

interface CanonicalIdentitySnapshot {
  id: string;
  displayName: string;
  legalName: string | null;
  businessType: string | null;
  description: string | null;
  defaultLocale: string;
  timezone: string;
  defaultCurrency: string;
  rowVersion: number;
}

interface CanonicalPriceSnapshot {
  id: string;
  type: "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST";
  amount: string | null;
  amountFrom: string | null;
  amountTo: string | null;
  currency: string;
  unit: string | null;
  taxNote: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  rowVersion: number;
}

interface CanonicalDurationSnapshot {
  id: string;
  minimumMinutes: number;
  maximumMinutes: number | null;
  preparationMinutes: number | null;
  bufferMinutes: number | null;
  rowVersion: number;
}

interface CanonicalOfferingSnapshot {
  id: string;
  kind: "SERVICE" | "PRODUCT" | "MENU_ITEM";
  category: string | null;
  parentCategory: string | null;
  name: string;
  description: string | null;
  locale: string;
  bookingNotes: string | null;
  active: boolean;
  archivedAt: string | null;
  rowVersion: number;
  prices: CanonicalPriceSnapshot[];
  duration: CanonicalDurationSnapshot | null;
}

interface CanonicalSnapshot {
  schema: "leadvirt.business-information.v2";
  identity: CanonicalIdentitySnapshot;
  offerings: CanonicalOfferingSnapshot[];
}

type CanonicalFieldChange = {
  resourceType:
    | "BUSINESS_IDENTITY"
    | "OFFERING"
    | "OFFERING_PRICE"
    | "OFFERING_DURATION";
  resourceKey: string;
  fieldPath: string;
  value: unknown;
};

interface CanonicalMutationPlan {
  before: CanonicalSnapshot;
  after: CanonicalSnapshot;
  beforeRowsHash: string;
  canonicalHash: string;
  profile: BusinessProfileData;
  changedProfileFields: string[];
  fieldChanges: CanonicalFieldChange[];
}

interface PreparedCanonicalMutation {
  kind: "mutation";
  baseState: {
    revision: number;
    currentRevisionId: string;
    canonicalHash: string;
    etag: number;
  };
  beforeRowsHash: string;
  revisionId: string;
  objectLedgerId: string;
  objectKey: string;
  encryptionKeyRef: string;
  reservation: PendingBusinessImportObject;
  deltaHash: string;
  deltaBytes: Uint8Array;
  objectCreated: boolean;
  planHash: string;
}

interface PreparedCanonicalNoop {
  kind: "noop";
  baseState: {
    revision: number;
    currentRevisionId: string;
    canonicalHash: string;
    etag: number;
  };
  beforeRowsHash: string;
}

type PreparedCanonicalPatch = PreparedCanonicalMutation | PreparedCanonicalNoop;

export interface BusinessProfileDispatch {
  eventId: string | null;
  reconciliationEventIds: string[];
}

export interface BusinessProfileSettingsPatch {
  businessName?: string;
  timezone?: string;
  businessType?: string;
  logoDataUrl?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
}

interface TenantProfileExtras {
  logoDataUrl?: string | null;
  phone?: string | null;
  website?: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function own(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function nullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function settingsProfile(value: unknown) {
  return record(record(value).profile);
}

function normalizedIfMatch(value: HeaderValue) {
  return (Array.isArray(value) ? value : (value ?? "").split(","))
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .sort();
}

function isoDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function canonicalSnapshot(rows: CanonicalAggregateRows): CanonicalSnapshot {
  return {
    schema: "leadvirt.business-information.v2",
    identity: {
      id: rows.identity.id,
      displayName: rows.identity.displayName,
      legalName: rows.identity.legalName,
      businessType: rows.identity.businessType,
      description: rows.identity.description,
      defaultLocale: rows.identity.defaultLocale,
      timezone: rows.identity.timezone,
      defaultCurrency: rows.identity.defaultCurrency,
      rowVersion: rows.identity.rowVersion,
    },
    offerings: rows.offerings
      .map((offering) => ({
        id: offering.id,
        kind: offering.kind,
        category: offering.category,
        parentCategory: offering.parentCategory,
        name: offering.name,
        description: offering.description,
        locale: offering.locale,
        bookingNotes: offering.bookingNotes,
        active: offering.active,
        archivedAt: offering.archivedAt?.toISOString() ?? null,
        rowVersion: offering.rowVersion,
        prices: offering.prices
          .map((price) => ({
            id: price.id,
            type: price.type,
            amount: price.amount?.toString() ?? null,
            amountFrom: price.amountFrom?.toString() ?? null,
            amountTo: price.amountTo?.toString() ?? null,
            currency: price.currency,
            unit: price.unit,
            taxNote: price.taxNote,
            effectiveFrom: isoDate(price.effectiveFrom),
            effectiveUntil: isoDate(price.effectiveUntil),
            rowVersion: price.rowVersion,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        duration: offering.duration
          ? {
              id: offering.duration.id,
              minimumMinutes: offering.duration.minimumMinutes,
              maximumMinutes: offering.duration.maximumMinutes,
              preparationMinutes: offering.duration.preparationMinutes,
              bufferMinutes: offering.duration.bufferMinutes,
              rowVersion: offering.duration.rowVersion,
            }
          : null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function canonicalContent(snapshot: CanonicalSnapshot) {
  return {
    schema: snapshot.schema,
    identity: {
      id: snapshot.identity.id,
      displayName: snapshot.identity.displayName,
      legalName: snapshot.identity.legalName,
      businessType: snapshot.identity.businessType,
      description: snapshot.identity.description,
      defaultLocale: snapshot.identity.defaultLocale,
      timezone: snapshot.identity.timezone,
      defaultCurrency: snapshot.identity.defaultCurrency,
    },
    offerings: snapshot.offerings.map((offering) => ({
      id: offering.id,
      kind: offering.kind,
      category: offering.category,
      parentCategory: offering.parentCategory,
      name: offering.name,
      description: offering.description,
      locale: offering.locale,
      bookingNotes: offering.bookingNotes,
      active: offering.active,
      archivedAt: offering.archivedAt,
      prices: offering.prices.map((price) => ({
        id: price.id,
        type: price.type,
        amount: price.amount,
        amountFrom: price.amountFrom,
        amountTo: price.amountTo,
        currency: price.currency,
        unit: price.unit,
        taxNote: price.taxNote,
        effectiveFrom: price.effectiveFrom,
        effectiveUntil: price.effectiveUntil,
      })),
      duration: offering.duration
        ? {
            id: offering.duration.id,
            minimumMinutes: offering.duration.minimumMinutes,
            maximumMinutes: offering.duration.maximumMinutes,
            preparationMinutes: offering.duration.preparationMinutes,
            bufferMinutes: offering.duration.bufferMinutes,
          }
        : null,
    })),
  };
}

function cloneSnapshot(snapshot: CanonicalSnapshot): CanonicalSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CanonicalSnapshot;
}

function stableCanonicalId(prefix: string, tenantId: string, sourceId: string) {
  return `${prefix}_${createHash("sha256")
    .update(`${tenantId}\0${sourceId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function primaryPrice(prices: readonly CanonicalPriceSnapshot[]) {
  return [...prices].sort((left, right) => {
    const effective = (right.effectiveFrom ?? "").localeCompare(left.effectiveFrom ?? "");
    return effective || left.id.localeCompare(right.id);
  })[0];
}

function formatPrice(price: CanonicalPriceSnapshot | undefined) {
  if (!price) return "";
  const unit = price.unit ? ` / ${price.unit}` : "";
  if (price.type === "FREE") return "Free";
  if (price.type === "ON_REQUEST") return "On request";
  if (price.type === "FIXED" && price.amount !== null) {
    return `${price.currency} ${price.amount}${unit}`;
  }
  if (price.type === "FROM" && price.amountFrom !== null) {
    return `From ${price.currency} ${price.amountFrom}${unit}`;
  }
  if (price.type === "RANGE" && price.amountFrom !== null && price.amountTo !== null) {
    return `${price.currency} ${price.amountFrom}-${price.amountTo}${unit}`;
  }
  return "";
}

function formatDuration(duration: CanonicalDurationSnapshot | null) {
  if (!duration) return "";
  const maximum = duration.maximumMinutes;
  return maximum !== null && maximum !== duration.minimumMinutes
    ? `${duration.minimumMinutes}-${maximum} minutes`
    : `${duration.minimumMinutes} minutes`;
}

function canonicalProfile(legacy: BusinessProfileData, snapshot: CanonicalSnapshot) {
  const identity = snapshot.identity;
  return {
    ...legacy,
    businessType: identity.businessType ?? "",
    name: identity.displayName,
    description: identity.description ?? "",
    timezone: identity.timezone,
    services: snapshot.offerings
      .filter((offering) => offering.active && offering.archivedAt === null)
      .map((offering) => ({
        id: offering.id,
        name: offering.name,
        description: offering.description ?? "",
        price: formatPrice(primaryPrice(offering.prices)),
        duration: formatDuration(offering.duration),
      })),
  } satisfies BusinessProfileData;
}

interface ParsedPrice {
  type: CanonicalPriceSnapshot["type"];
  amount: string | null;
  amountFrom: string | null;
  amountTo: string | null;
  currency: string;
}

function normalizeDecimal(value: string) {
  const normalized = value.replace(/\s+/gu, "").replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u.test(normalized)) return null;
  const [integer = "0", fraction] = normalized.split(".");
  const cleanedFraction = fraction?.replace(/0+$/u, "");
  return cleanedFraction ? `${integer}.${cleanedFraction}` : integer;
}

function currencyCode(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const normalized = value.toUpperCase();
  return (
    {
      "€": "EUR",
      "$": "USD",
      "£": "GBP",
      "₽": "RUB",
    } as Record<string, string>
  )[normalized] ?? normalized;
}

function parsePrice(value: string, fallbackCurrency: string): ParsedPrice | null {
  const normalized = value.trim();
  if (/^(?:free|gratis|gratuit|gratuito|kostenlos|бесплатно)$/iu.test(normalized)) {
    return {
      type: "FREE",
      amount: null,
      amountFrom: null,
      amountTo: null,
      currency: fallbackCurrency,
    };
  }
  if (
    /^(?:on request|upon request|price on request|по запросу|sur demande|auf anfrage|a consultar)$/iu.test(
      normalized,
    )
  ) {
    return {
      type: "ON_REQUEST",
      amount: null,
      amountFrom: null,
      amountTo: null,
      currency: fallbackCurrency,
    };
  }
  const withoutFrom = normalized.replace(/^(?:from|от|desde|a partir de|ab)\s+/iu, "");
  const isFrom = withoutFrom !== normalized;
  const match = withoutFrom.match(
    /^(?:(?<prefix>[A-Za-z]{3}|[$€£₽])\s*)?(?<first>\d[\d ]*(?:[.,]\d{1,4})?)(?:\s*(?:-|–|—|to|до)\s*(?:(?<rangeCurrency>[A-Za-z]{3}|[$€£₽])\s*)?(?<second>\d[\d ]*(?:[.,]\d{1,4})?))?(?:\s*(?<suffix>[A-Za-z]{3}|[$€£₽]))?$/iu,
  );
  if (!match?.groups) return null;
  const first = normalizeDecimal(match.groups.first ?? "");
  const second = match.groups.second ? normalizeDecimal(match.groups.second) : null;
  if (!first || (match.groups.second && !second)) return null;
  const declaredCurrencies = [match.groups.prefix, match.groups.rangeCurrency, match.groups.suffix]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => currencyCode(candidate, fallbackCurrency));
  if (new Set(declaredCurrencies).size > 1) return null;
  const currency = declaredCurrencies[0] ?? fallbackCurrency;
  if (!/^[A-Z]{3}$/u.test(currency)) return null;
  if (second !== null) {
    if (isFrom || Number(first) > Number(second)) return null;
    return {
      type: "RANGE",
      amount: null,
      amountFrom: first,
      amountTo: second,
      currency,
    };
  }
  return {
    type: isFrom ? "FROM" : "FIXED",
    amount: isFrom ? null : first,
    amountFrom: isFrom ? first : null,
    amountTo: null,
    currency,
  };
}

function parseDuration(value: string) {
  const normalized = value.trim();
  const hours = normalized.match(
    /^(?<first>\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|ч|час|часа|часов)$/iu,
  );
  if (hours?.groups?.first) {
    const minutes = Number(hours.groups.first.replace(",", ".")) * 60;
    return Number.isInteger(minutes) && minutes >= 0 && minutes <= 525_600
      ? { minimumMinutes: minutes, maximumMinutes: null }
      : null;
  }
  const minutes = normalized.match(
    /^(?<first>\d+)(?:\s*(?:-|–|—|to|до)\s*(?<second>\d+))?\s*(?:m|min|mins|minute|minutes|мин|минута|минуты|минут)?$/iu,
  );
  if (!minutes?.groups?.first) return null;
  const minimumMinutes = Number(minutes.groups.first);
  const maximumMinutes = minutes.groups.second ? Number(minutes.groups.second) : null;
  if (
    !Number.isInteger(minimumMinutes) ||
    minimumMinutes < 0 ||
    minimumMinutes > 525_600 ||
    (maximumMinutes !== null &&
      (!Number.isInteger(maximumMinutes) ||
        maximumMinutes < minimumMinutes ||
        maximumMinutes > 525_600))
  ) return null;
  return { minimumMinutes, maximumMinutes };
}

function profileFieldError(field: string, message: string): never {
  throw businessImportError(
    HttpStatus.BAD_REQUEST,
    "BUSINESS_INFORMATION_COMPATIBILITY_VALUE_INVALID",
    message,
    { field },
  );
}

function sameParsedPrice(price: CanonicalPriceSnapshot, parsed: ParsedPrice) {
  return (
    price.type === parsed.type &&
    price.amount === parsed.amount &&
    price.amountFrom === parsed.amountFrom &&
    price.amountTo === parsed.amountTo &&
    price.currency === parsed.currency
  );
}

function planCanonicalMutation(
  tenantId: string,
  rows: CanonicalAggregateRows,
  legacyProfile: BusinessProfileData,
  patch: BusinessProfilePatch,
): CanonicalMutationPlan {
  const before = canonicalSnapshot(rows);
  const after = cloneSnapshot(before);
  const baseProfile = canonicalProfile(legacyProfile, before);
  const fieldChanges: CanonicalFieldChange[] = [];
  const identity = after.identity;
  let identityChanged = false;
  const setIdentity = (
    fieldPath: string,
    key: "displayName" | "businessType" | "description" | "timezone",
    value: string | null,
  ) => {
    if (identity[key] === value) return;
    identity[key] = value as never;
    identityChanged = true;
    fieldChanges.push({
      resourceType: "BUSINESS_IDENTITY",
      resourceKey: identity.id,
      fieldPath,
      value,
    });
  };
  if (patch.name !== undefined) setIdentity("/displayName", "displayName", patch.name);
  if (patch.businessType !== undefined) {
    setIdentity("/businessType", "businessType", patch.businessType || null);
  }
  if (patch.description !== undefined) {
    setIdentity("/description", "description", patch.description || null);
  }
  if (patch.timezone !== undefined) setIdentity("/timezone", "timezone", patch.timezone);
  if (identityChanged) identity.rowVersion += 1;

  if (patch.services !== undefined) {
    const normalizedIds = new Set<string>();
    for (const [index, service] of patch.services.entries()) {
      if (normalizedIds.has(service.id)) {
        profileFieldError(
          `profile.services.${index}.id`,
          "Service identifiers must be unique after whitespace normalization.",
        );
      }
      normalizedIds.add(service.id);
      let offering = after.offerings.find((candidate) => candidate.id === service.id);
      if (!offering) {
        const id = stableCanonicalId("bio", tenantId, service.id);
        if (after.offerings.some((candidate) => candidate.id === id)) {
          profileFieldError(
            `profile.services.${index}.id`,
            "This service identifier is already assigned to another canonical service.",
          );
        }
        offering = {
          id,
          kind: "SERVICE",
          category: null,
          parentCategory: null,
          name: service.name,
          description: service.description || null,
          locale: identity.defaultLocale,
          bookingNotes: null,
          active: true,
          archivedAt: null,
          rowVersion: 1,
          prices: [],
          duration: null,
        };
        after.offerings.push(offering);
        for (const [fieldPath, value] of [
          ["/kind", offering.kind],
          ["/name", offering.name],
          ["/description", offering.description],
          ["/locale", offering.locale],
          ["/active", offering.active],
        ] as const) {
          fieldChanges.push({
            resourceType: "OFFERING",
            resourceKey: offering.id,
            fieldPath,
            value,
          });
        }
      } else {
        let offeringChanged = false;
        if (offering.name !== service.name) {
          offering.name = service.name;
          offeringChanged = true;
          fieldChanges.push({
            resourceType: "OFFERING",
            resourceKey: offering.id,
            fieldPath: "/name",
            value: service.name,
          });
        }
        const description = service.description || null;
        if (offering.description !== description) {
          offering.description = description;
          offeringChanged = true;
          fieldChanges.push({
            resourceType: "OFFERING",
            resourceKey: offering.id,
            fieldPath: "/description",
            value: description,
          });
        }
        if (offeringChanged) offering.rowVersion += 1;
      }

      if (service.price) {
        const selected = primaryPrice(offering.prices);
        const parsed =
          selected && service.price.trim() === formatPrice(selected)
            ? {
                type: selected.type,
                amount: selected.amount,
                amountFrom: selected.amountFrom,
                amountTo: selected.amountTo,
                currency: selected.currency,
              }
            : parsePrice(service.price, identity.defaultCurrency);
        if (!parsed) {
          profileFieldError(
            `profile.services.${index}.price`,
            "Use a typed amount such as EUR 45, From EUR 45, EUR 45-60, Free, or On request.",
          );
        }
        const advancedPrice =
          offering.prices.length > 1 ||
          (selected !== undefined &&
            (selected.unit !== null ||
              selected.taxNote !== null ||
              selected.effectiveFrom !== null ||
              selected.effectiveUntil !== null));
        if (advancedPrice && selected && !sameParsedPrice(selected, parsed)) {
          profileFieldError(
            `profile.services.${index}.price`,
            "This service has structured price details that the compatibility editor cannot replace safely.",
          );
        }
        if (!advancedPrice && (!selected || !sameParsedPrice(selected, parsed))) {
          const price: CanonicalPriceSnapshot = selected ?? {
            id: stableCanonicalId("bip", tenantId, offering.id),
            type: parsed.type,
            amount: null,
            amountFrom: null,
            amountTo: null,
            currency: parsed.currency,
            unit: null,
            taxNote: null,
            effectiveFrom: null,
            effectiveUntil: null,
            rowVersion: 1,
          };
          const created = selected === undefined;
          const priceFields = [
            ["/type", parsed.type],
            ["/amount", parsed.amount],
            ["/amountFrom", parsed.amountFrom],
            ["/amountTo", parsed.amountTo],
            ["/currency", parsed.currency],
          ] as const;
          price.type = parsed.type;
          price.amount = parsed.amount;
          price.amountFrom = parsed.amountFrom;
          price.amountTo = parsed.amountTo;
          price.currency = parsed.currency;
          if (created) offering.prices.push(price);
          else price.rowVersion += 1;
          for (const [fieldPath, value] of priceFields) {
            fieldChanges.push({
              resourceType: "OFFERING_PRICE",
              resourceKey: price.id,
              fieldPath,
              value,
            });
          }
        }
      }

      if (service.duration) {
        const parsed = parseDuration(service.duration);
        if (!parsed) {
          profileFieldError(
            `profile.services.${index}.duration`,
            "Use a duration such as 45 minutes, 45-60 minutes, or 1 hour.",
          );
        }
        if (
          !offering.duration ||
          offering.duration.minimumMinutes !== parsed.minimumMinutes ||
          offering.duration.maximumMinutes !== parsed.maximumMinutes
        ) {
          const duration: CanonicalDurationSnapshot = offering.duration ?? {
            id: stableCanonicalId("bid", tenantId, offering.id),
            minimumMinutes: parsed.minimumMinutes,
            maximumMinutes: parsed.maximumMinutes,
            preparationMinutes: null,
            bufferMinutes: null,
            rowVersion: 1,
          };
          const created = offering.duration === null;
          duration.minimumMinutes = parsed.minimumMinutes;
          duration.maximumMinutes = parsed.maximumMinutes;
          if (created) offering.duration = duration;
          else duration.rowVersion += 1;
          fieldChanges.push(
            {
              resourceType: "OFFERING_DURATION",
              resourceKey: duration.id,
              fieldPath: "/minimumMinutes",
              value: duration.minimumMinutes,
            },
            {
              resourceType: "OFFERING_DURATION",
              resourceKey: duration.id,
              fieldPath: "/maximumMinutes",
              value: duration.maximumMinutes,
            },
          );
        }
      }

    }
  }
  after.offerings.sort((left, right) => left.id.localeCompare(right.id));
  for (const offering of after.offerings) {
    offering.prices.sort((left, right) => left.id.localeCompare(right.id));
  }

  const patchedLegacy = { ...baseProfile, ...patch };
  const profile = canonicalProfile(patchedLegacy, after);
  const changedProfileFields = (
    [
      "businessType",
      "name",
      "description",
      "avgCheck",
      "servicesCatalog",
      "services",
      "hours",
      "weeklySchedule",
      "availability",
      "faq",
      "policies",
      "escalationRules",
      "timezone",
    ] as const
  ).filter(
    (field) =>
      canonicalKnowledgeV2Hash(baseProfile[field]) !== canonicalKnowledgeV2Hash(profile[field]),
  );
  return {
    before,
    after,
    beforeRowsHash: canonicalKnowledgeV2Hash(before),
    canonicalHash: canonicalKnowledgeV2Hash(canonicalContent(after)),
    profile,
    changedProfileFields,
    fieldChanges,
  };
}

@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Optional()
    @Inject(BusinessImportRuntimeService)
    private readonly importRuntime?: BusinessImportRuntimeService,
    @Optional()
    @Inject(BusinessImportQueueService)
    private readonly importQueue?: BusinessImportQueueService,
  ) {}

  async get(context: RequestContext): Promise<BusinessProfileView> {
    return this.prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { id: context.tenantId, deletedAt: null },
          include: { onboardingState: true },
        });
        if (!tenant) throw new NotFoundException("Workspace was not found.");
        const informationState = await tx.businessInformationState.findUnique({
          where: { tenantId: context.tenantId },
        });
        if (!informationState || informationState.revision === 0) {
          return this.view(tenant.onboardingState, tenant);
        }
        const rows = await this.loadCanonicalRows(tx, context.tenantId);
        return this.canonicalView(tenant.onboardingState, tenant, informationState, rows);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getSettingsAccount(context: RequestContext): Promise<SettingsAccount> {
    return this.prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { id: context.tenantId, deletedAt: null },
          include: { onboardingState: true },
        });
        if (!tenant) throw new NotFoundException("Workspace was not found.");
        const informationState = await tx.businessInformationState.findUnique({
          where: { tenantId: context.tenantId },
        });
        const identity =
          informationState && informationState.revision > 0
            ? await this.loadCanonicalIdentity(tx, context.tenantId)
            : null;
        return this.settingsAccount(
          tenant,
          tenant.onboardingState,
          context,
          informationState,
          identity,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async patch(
    context: RequestContext,
    dto: BusinessProfilePatchRequestDto,
    idempotencyKey: string,
    ifMatch: HeaderValue,
  ): Promise<BusinessProfileView> {
    const requestedFields = Object.keys(dto.profile);
    if (requestedFields.length === 0) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_INPUT_INVALID",
        "At least one profile field is required.",
        {
          fieldErrors: [
            {
              field: "profile",
              code: "KNOWLEDGE_VALIDATION_IS_NOT_EMPTY_OBJECT",
              message: "profile must contain at least one field",
            },
          ],
        },
      );
    }
    this.assertSchedule(dto.profile.weeklySchedule);
    const profilePatch = this.normalizeProfilePatch(dto.profile);
    const informationState = await this.prisma.businessInformationState.findUnique({
      where: { tenantId: context.tenantId },
      select: { revision: true },
    });
    if (informationState && informationState.revision > 0) {
      return this.patchCanonical(
        context,
        profilePatch,
        requestedFields,
        idempotencyKey,
        ifMatch,
      );
    }
    let dispatch: BusinessProfileDispatch = { eventId: null, reconciliationEventIds: [] };

    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "PATCH:/business-profile",
        key: idempotencyKey,
        request: { body: dto, ifMatch: normalizedIfMatch(ifMatch) },
      },
      async (tx) => {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
        await this.lockCanonicalAggregate(tx, context.tenantId);
        await this.assertLegacyProfileWritable(tx, context.tenantId);
        const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
        const current = await this.ensureState(tx, context.tenantId);
        assertIfMatch(
          ifMatch,
          this.profileEtag(context.tenantId, current.businessProfileVersion),
          current.businessProfileVersion,
          requestedFields,
        );
        const currentView = this.view(current, tenant);
        const nextProfile = { ...currentView.profile, ...profilePatch };
        this.assertProfileSize(nextProfile);
        const previousData = record(current.data);
        const nextData = this.materializeProfile(previousData, nextProfile, requestedFields);
        const profileChanged = !this.sameProfile(currentView.profile, nextProfile);
        const materializationChanged =
          canonicalKnowledgeV2Hash(previousData) !== canonicalKnowledgeV2Hash(nextData);
        const tenantPatch = this.tenantSyncPatch(tenant, nextProfile);
        if (!profileChanged && !materializationChanged && Object.keys(tenantPatch).length === 0) {
          return {
            httpStatus: HttpStatus.OK,
            responseBody: currentView,
            responseRef: current.id,
          };
        }
        const result = await this.writeProfileDataInTransaction(
          tx,
          context,
          current,
          tenant,
          previousData,
          nextData,
          tenantPatch,
          profileChanged,
        );
        dispatch = result.dispatch;
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_profile.updated",
            entityType: "onboarding",
            entityId: current.id,
            payload: { profileFields: requestedFields.sort() },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.view(result.state, result.tenant),
          responseRef: current.id,
        };
      },
    );
    await this.dispatch(dispatch, context.tenantId);
    return result.responseBody;
  }

  private async patchCanonical(
    context: RequestContext,
    profilePatch: BusinessProfilePatch,
    requestedFields: string[],
    idempotencyKey: string,
    ifMatch: HeaderValue,
  ) {
    let projectionEventId: string | null = null;
    const cleanup: { preparedObject: PreparedCanonicalMutation | null } = {
      preparedObject: null,
    };
    try {
      const result = await this.idempotency.executePrepared<
        BusinessProfileView,
        PreparedCanonicalPatch
      >(
        {
          tenantId: context.tenantId,
          endpoint: "PATCH:/business-profile:v2",
          key: idempotencyKey,
          request: { body: { profile: profilePatch }, ifMatch: normalizedIfMatch(ifMatch) },
        },
        async () => {
          const prepared = await this.prepareCanonicalPatch(
            context,
            profilePatch,
            requestedFields,
            idempotencyKey,
            ifMatch,
          );
          if (prepared.kind === "mutation") cleanup.preparedObject = prepared;
          return prepared;
        },
        async (tx, prepared) => {
          const applied = await this.applyCanonicalPatch(
            tx,
            context,
            profilePatch,
            requestedFields,
            ifMatch,
            prepared,
          );
          projectionEventId = applied.projectionEventId;
          return {
            httpStatus: applied.httpStatus,
            responseBody: applied.responseBody,
            responseRef: applied.responseRef,
          };
        },
      );
      if (!projectionEventId && result.responseRef) {
        projectionEventId =
          (
            await this.prisma.runtimeOutbox.findFirst({
              where: {
                tenantId: context.tenantId,
                aggregateType: "BusinessInformationRevision",
                aggregateId: result.responseRef,
                eventType: "business.information.project.requested",
              },
              select: { id: true },
            })
          )?.id ?? null;
      }
      if (projectionEventId) this.importQueue?.dispatch(projectionEventId);
      return result.responseBody;
    } catch (error) {
      if (cleanup.preparedObject?.objectCreated && this.importRuntime) {
        try {
          const runtime = this.importRuntime.runtime();
          await cleanupPendingBusinessImportObject(
            this.prisma,
            runtime.store,
            cleanup.preparedObject.reservation,
          );
        } catch {
          // The global pending-object sweeper retries durable ledger cleanup.
        }
      }
      throw error;
    }
  }

  private async prepareCanonicalPatch(
    context: RequestContext,
    profilePatch: BusinessProfilePatch,
    requestedFields: string[],
    idempotencyKey: string,
    ifMatch: HeaderValue,
  ): Promise<PreparedCanonicalPatch> {
    const prepared = await this.prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { id: context.tenantId, deletedAt: null },
          include: { onboardingState: true },
        });
        if (!tenant) throw new NotFoundException("Workspace was not found.");
        const state = await this.requireCanonicalState(tx, context.tenantId);
        assertIfMatch(
          ifMatch,
          this.profileEtag(context.tenantId, state.etag),
          state.etag,
          requestedFields,
        );
        const rows = await this.loadCanonicalRows(tx, context.tenantId);
        const legacy = this.profile(record(tenant.onboardingState?.data), tenant);
        const plan = planCanonicalMutation(context.tenantId, rows, legacy, profilePatch);
        const baseState = {
          revision: state.revision,
          currentRevisionId: state.currentRevisionId,
          canonicalHash: state.canonicalHash,
          etag: state.etag,
        };
        if (plan.changedProfileFields.length === 0 && plan.fieldChanges.length === 0) {
          return {
            kind: "noop" as const,
            baseState,
            beforeRowsHash: plan.beforeRowsHash,
          };
        }
        return { tenant, state, plan, baseState };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (prepared.kind === "noop") return prepared;
    if (!this.importRuntime) {
      throw businessImportError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "BUSINESS_INFORMATION_REVISION_STORAGE_UNAVAILABLE",
        "Business information revision storage is not configured.",
        { retryable: true },
      );
    }
    const nextRevision = prepared.state.revision + 1;
    const revisionId = randomUUID();
    const beforeProfile = canonicalProfile(
      this.profile(record(prepared.tenant.onboardingState?.data), prepared.tenant),
      prepared.plan.before,
    );
    const delta = {
      schema: "leadvirt.business-information-revision-delta.v1",
      tenantId: context.tenantId,
      revision: nextRevision,
      parentRevisionId: prepared.state.currentRevisionId,
      parentRevision: prepared.state.revision,
      origin: "MANUAL",
      actorUserId: context.userId,
      idempotencyKeyHash: createHash("sha256").update(idempotencyKey, "utf8").digest("hex"),
      before: {
        canonical: prepared.plan.before,
        compatibilityProfile: this.compatibilityOnly(beforeProfile),
      },
      after: {
        canonical: prepared.plan.after,
        compatibilityProfile: this.compatibilityOnly(prepared.plan.profile),
      },
      changedProfileFields: prepared.plan.changedProfileFields,
      changedCanonicalFields: prepared.plan.fieldChanges.map(
        ({ resourceType, resourceKey, fieldPath }) => ({
          resourceType,
          resourceKey,
          fieldPath,
        }),
      ),
    };
    const deltaHash = canonicalKnowledgeV2Hash(delta);
    const deltaBytes = new TextEncoder().encode(JSON.stringify(delta));
    const objectKey = createDeterministicKnowledgeObjectKey({
      tenantId: context.tenantId,
      sourceId: "business-information-revisions",
      purpose: "extracted",
      identity: `${revisionId}:${deltaHash}`,
    });
    const runtime = this.importRuntime.runtime();
    const reservation = await reservePendingBusinessImportObject(this.prisma, {
      tenantId: context.tenantId,
      objectKind: "REVISION_DELTA",
      objectStorageKey: objectKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `MANUAL_REVISION_DELTA:${revisionId}`,
      retainUntil: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const write = await putPendingBusinessImportObject(
      this.prisma,
      runtime.store,
      reservation,
      deltaBytes,
    );
    return {
      kind: "mutation",
      baseState: prepared.baseState,
      beforeRowsHash: prepared.plan.beforeRowsHash,
      revisionId,
      objectLedgerId: reservation.ledgerId,
      objectKey,
      encryptionKeyRef: write.encryptionKeyRef,
      reservation,
      deltaHash,
      deltaBytes,
      objectCreated: true,
      planHash: this.canonicalPlanHash(prepared.plan),
    };
  }

  private async applyCanonicalPatch(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    profilePatch: BusinessProfilePatch,
    requestedFields: string[],
    ifMatch: HeaderValue,
    prepared: PreparedCanonicalPatch,
  ) {
    await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
    await this.lockCanonicalAggregate(tx, context.tenantId);
    const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
    const state = await this.requireCanonicalState(tx, context.tenantId);
    assertIfMatch(
      ifMatch,
      this.profileEtag(context.tenantId, state.etag),
      state.etag,
      requestedFields,
    );
    if (
      state.revision !== prepared.baseState.revision ||
      state.currentRevisionId !== prepared.baseState.currentRevisionId ||
      state.canonicalHash !== prepared.baseState.canonicalHash ||
      state.etag !== prepared.baseState.etag
    ) {
      throw businessImportError(
        HttpStatus.PRECONDITION_FAILED,
        "BUSINESS_INFORMATION_REVISION_CONFLICT",
        "Business information changed after it was loaded.",
        {
          details: { currentEtag: this.profileEtag(context.tenantId, state.etag) },
        },
      );
    }
    const rows = await this.loadCanonicalRows(tx, context.tenantId);
    const legacy = this.profile(record((await this.ensureState(tx, context.tenantId)).data), tenant);
    const plan = planCanonicalMutation(context.tenantId, rows, legacy, profilePatch);
    if (plan.beforeRowsHash !== prepared.beforeRowsHash) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_INFORMATION_INTEGRITY_CONFLICT",
        "Canonical business information changed without an aggregate revision.",
        { retryable: true },
      );
    }
    if (prepared.kind === "noop") {
      if (plan.changedProfileFields.length > 0 || plan.fieldChanges.length > 0) {
        throw businessImportError(
          HttpStatus.CONFLICT,
          "BUSINESS_INFORMATION_INTEGRITY_CONFLICT",
          "The prepared business information mutation is no longer a no-op.",
          { retryable: true },
        );
      }
      return {
        httpStatus: HttpStatus.OK,
        responseBody: this.canonicalView(
          await this.ensureState(tx, context.tenantId),
          tenant,
          state,
          rows,
        ),
        responseRef: state.currentRevisionId,
        projectionEventId: null,
      };
    }
    if (this.canonicalPlanHash(plan) !== prepared.planHash) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_INFORMATION_INTEGRITY_CONFLICT",
        "The prepared business information mutation no longer matches canonical state.",
        { retryable: true },
      );
    }
    await this.writeCanonicalRows(tx, context.tenantId, plan);
    const previousData = record((await this.ensureState(tx, context.tenantId)).data);
    const nextData = this.materializeProfile(previousData, plan.profile, requestedFields);
    const onboardingState = await tx.onboardingState.update({
      where: { tenantId: context.tenantId },
      data: {
        data: nextData as unknown as Prisma.InputJsonObject,
        businessProfileVersion: { increment: 1 },
        businessProfileUpdatedAt: new Date(),
      },
    });
    const updatedTenant = await this.updateTenantProfile(
      tx,
      tenant,
      this.tenantSyncPatch(tenant, plan.profile),
      {},
    );
    await adoptPendingBusinessImportObject(
      tx,
      prepared.reservation,
      "BUSINESS_INFORMATION_REVISION",
      null,
    );
    const nextRevision = state.revision + 1;
    const revision = await tx.businessInformationRevision.create({
      data: {
        id: prepared.revisionId,
        tenantId: context.tenantId,
        revision: nextRevision,
        parentRevisionId: state.currentRevisionId,
        parentRevision: state.revision,
        canonicalHash: plan.canonicalHash,
        origin: "MANUAL",
        deltaObjectKey: prepared.objectKey,
        deltaEncryptionKeyRef: prepared.encryptionKeyRef,
        deltaObjectLedgerId: prepared.objectLedgerId,
        deltaHash: prepared.deltaHash,
        affectedResources: this.affectedCanonicalResources(plan),
        createdByUserId: context.userId,
      },
    });
    const projectionData = {
      tenantId: context.tenantId,
      businessRevisionId: revision.id,
      businessRevision: revision.revision,
      generation: revision.revision,
      requestedByUserId: context.userId,
      requestedAt: revision.createdAt.toISOString(),
    };
    const projectionEvent = this.importQueue
      ? await this.importQueue.createRevisionProjectionEvent(
          tx,
          projectionData,
          context.sessionId,
        )
      : await createRuntimeQueueEvent(tx, {
          tenantId: context.tenantId,
          aggregateType: "BusinessInformationRevision",
          aggregateId: revision.id,
          aggregateVersion: revision.revision,
          generation: revision.revision,
          eventType: "business.information.project.requested",
          dedupeKey: `business-information-project:${revision.id}:${revision.revision}`,
          deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
          ...(context.sessionId !== undefined ? { traceId: context.sessionId } : {}),
          envelope: {
            queueName: "business.import",
            jobName: "project-revision",
            jobId: `business-information-project:${revision.id}:${revision.revision}`,
            data: projectionData,
            attempts: 10,
            backoffMs: 2_000,
          },
        });
    await this.writeManualAttributions(tx, context, revision, plan.fieldChanges);
    const updatedState = await tx.businessInformationState.update({
      where: { tenantId: context.tenantId },
      data: {
        revision: nextRevision,
        currentRevisionId: revision.id,
        canonicalHash: plan.canonicalHash,
        etag: { increment: 1 },
        updatedByUserId: context.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "business_information.manual_revision_created",
        entityType: "business_information_revision",
        entityId: revision.id,
        payload: {
          revision: nextRevision,
          profileFields: plan.changedProfileFields,
          canonicalFieldCount: plan.fieldChanges.length,
          publicationChanged: false,
        },
      },
    });
    return {
      httpStatus: HttpStatus.OK,
      responseBody: this.canonicalView(
        onboardingState,
        updatedTenant,
        updatedState,
        plan.after,
      ),
      responseRef: revision.id,
      projectionEventId: projectionEvent.id,
    };
  }

  async updateOnboardingInTransaction(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    input: { currentStep?: string; data?: object },
    ifMatch?: HeaderValue,
  ) {
    await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
    await this.lockCanonicalAggregate(tx, context.tenantId);
    const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
    const current = await this.ensureState(tx, context.tenantId);
    const informationState = await tx.businessInformationState.findUnique({
      where: { tenantId: context.tenantId },
    });
    const previousData = record(current.data);
    const inputData = record(input.data);
    const mergedData = this.mergeOnboardingData(previousData, inputData);
    const requestedProfileFields = this.onboardingProfileFields(inputData);
    if (informationState && informationState.revision > 0 && requestedProfileFields.length > 0) {
      this.legacyWriteBlocked();
    }
    if (requestedProfileFields.length === 0) {
      const scenarioChanged = own(inputData, "scenario");
      const nextData = scenarioChanged && (!informationState || informationState.revision === 0)
        ? this.materializeProfile(mergedData, this.profile(mergedData, tenant))
        : mergedData;
      if (scenarioChanged && (!informationState || informationState.revision === 0)) {
        this.assertProfileSize(this.profile(nextData, tenant));
      }
      const state = await tx.onboardingState.update({
        where: { id: current.id },
        data: {
          data: nextData as Prisma.InputJsonObject,
          ...(input.currentStep !== undefined ? { currentStep: input.currentStep } : {}),
        },
      });
      const sync = scenarioChanged
        ? await this.knowledge.syncOnboardingSourcesInTransaction(
            tx,
            context,
            previousData,
            nextData,
          )
        : { eventId: null, reconciliationEventIds: [] };
      return { state, eventId: sync.eventId, reconciliationEventIds: sync.reconciliationEventIds };
    }
    const currentProfile = this.profile(previousData, tenant);
    const nextProfile = this.profile(mergedData, tenant);
    this.assertProfileSize(nextProfile);
    const profileChanged = !this.sameProfile(currentProfile, nextProfile);
    this.assertSchedule(nextProfile.weeklySchedule);
    assertIfMatch(
      ifMatch,
      this.profileEtag(context.tenantId, current.businessProfileVersion),
      current.businessProfileVersion,
      this.changedProfileFields(currentProfile, nextProfile),
    );
    const nextData = this.materializeProfile(mergedData, nextProfile, requestedProfileFields);
    const profilePatch = this.tenantSyncPatch(tenant, nextProfile);
    const written = await this.writeProfileDataInTransaction(
      tx,
      context,
      current,
      tenant,
      previousData,
      nextData,
      profilePatch,
      profileChanged,
      input.currentStep,
    );
    return { state: written.state, ...written.dispatch };
  }

  async updateSettingsAccount(
    context: RequestContext,
    dto: BusinessProfileSettingsPatch,
    ifMatch?: HeaderValue,
  ): Promise<SettingsAccount> {
    if (dto.businessName !== undefined && !dto.businessName.trim()) {
      throw new BadRequestException("Business name is required.");
    }
    if (dto.businessType !== undefined && !dto.businessType.trim()) {
      throw new BadRequestException("Business type is required.");
    }
    if (dto.timezone !== undefined && !isKnowledgeV2TimeZone(dto.timezone.trim())) {
      throw new BadRequestException("Timezone is invalid.");
    }
    const profilePatch = this.profilePatchFromSettings(dto);
    const overlapsProfile = Object.keys(profilePatch).length > 0;
    let dispatch: BusinessProfileDispatch = { eventId: null, reconciliationEventIds: [] };

    const account = await this.prisma.$transaction(async (tx) => {
      if (overlapsProfile) {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
        await this.lockCanonicalAggregate(tx, context.tenantId);
      }
      const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
      const current = await this.ensureState(tx, context.tenantId);
      const informationState = await tx.businessInformationState.findUnique({
        where: { tenantId: context.tenantId },
      });
      if (overlapsProfile && informationState && informationState.revision > 0) {
        this.legacyWriteBlocked();
      }
      let updatedTenant: DbTenant;
      let updatedState = current;

      if (overlapsProfile) {
        const currentProfile = this.view(current, tenant).profile;
        assertIfMatch(
          ifMatch,
          this.profileEtag(context.tenantId, current.businessProfileVersion),
          current.businessProfileVersion,
          Object.keys(profilePatch),
        );
        const nextProfile = { ...currentProfile, ...profilePatch };
        this.assertProfileSize(nextProfile);
        const profileChanged = !this.sameProfile(currentProfile, nextProfile);
        const previousData = record(current.data);
        const nextData = this.materializeProfile(previousData, nextProfile);
        const materializationChanged =
          canonicalKnowledgeV2Hash(previousData) !== canonicalKnowledgeV2Hash(nextData);
        const tenantPatch = this.tenantSyncPatch(tenant, nextProfile);
        if (profileChanged || materializationChanged) {
          const written = await this.writeProfileDataInTransaction(
            tx,
            context,
            current,
            tenant,
            previousData,
            nextData,
            tenantPatch,
            profileChanged,
            undefined,
            this.settingsExtras(dto),
          );
          updatedTenant = written.tenant;
          updatedState = written.state;
          dispatch = written.dispatch;
        } else {
          updatedTenant = await this.updateTenantProfile(
            tx,
            tenant,
            tenantPatch,
            this.settingsExtras(dto),
          );
        }
      } else {
        updatedTenant = await this.updateTenantProfile(tx, tenant, {}, this.settingsExtras(dto));
      }

      const changedProfileFields = ["logoDataUrl", "description", "phone", "website"].filter(
        (field) => own(dto, field),
      );
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.account_updated",
          entityType: "tenant",
          entityId: context.tenantId,
          payload: {
            ...(dto.businessName !== undefined ? { businessName: dto.businessName } : {}),
            ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
            ...(dto.businessType !== undefined ? { businessType: dto.businessType } : {}),
            profileFields: changedProfileFields,
          },
        },
      });
      const identity =
        informationState && informationState.revision > 0
          ? await this.loadCanonicalIdentity(tx, context.tenantId)
          : null;
      return this.settingsAccount(
        updatedTenant,
        updatedState,
        context,
        informationState,
        identity,
      );
    });
    await this.dispatch(dispatch, context.tenantId);
    return account;
  }

  async dispatch(result: BusinessProfileDispatch, tenantId = "unknown") {
    try {
      await this.knowledge.dispatchOnboardingSync(result.eventId, result.reconciliationEventIds);
    } catch (error) {
      const eventCount = (result.eventId ? 1 : 0) + result.reconciliationEventIds.length;
      this.logger.warn(
        `Knowledge dispatch remains pending after a committed profile write tenant=${tenantId} events=${eventCount}: ${
          error instanceof Error ? error.message : "unknown dispatch error"
        }`,
      );
    }
  }

  private async lockCanonicalAggregate(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(
        ${`business-information-state:${tenantId}`},
        0
      ))) AS business_information_state_lock
    `);
  }

  private async assertLegacyProfileWritable(tx: Prisma.TransactionClient, tenantId: string) {
    const state = await tx.businessInformationState.findUnique({
      where: { tenantId },
      select: { revision: true },
    });
    if (state && state.revision > 0) this.legacyWriteBlocked();
  }

  private legacyWriteBlocked(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_INFORMATION_LEGACY_WRITE_BLOCKED",
      "Business Information v2 is the editable authority for this workspace.",
      { details: { editor: "/app/knowledge?view=business" } },
    );
  }

  private async requireCanonicalState(tx: Prisma.TransactionClient, tenantId: string) {
    const state = await tx.businessInformationState.findUnique({ where: { tenantId } });
    if (!state || state.revision < 1 || !state.currentRevisionId) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_INFORMATION_CUTOVER_REQUIRED",
        "Business Information v2 has not completed its cutover.",
      );
    }
    return state as DbBusinessInformationState & { currentRevisionId: string };
  }

  private async loadCanonicalIdentity(tx: Prisma.TransactionClient, tenantId: string) {
    const identity = await tx.businessIdentity.findUnique({ where: { tenantId } });
    if (!identity) {
      throw businessImportError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "BUSINESS_INFORMATION_IDENTITY_MISSING",
        "Canonical business identity is unavailable.",
        { retryable: true },
      );
    }
    return identity;
  }

  private async loadCanonicalRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<CanonicalAggregateRows> {
    const [identity, offerings] = await Promise.all([
      this.loadCanonicalIdentity(tx, tenantId),
      tx.businessOffering.findMany({
        where: { tenantId },
        include: { prices: true, duration: true },
      }),
    ]);
    return { identity, offerings };
  }

  private canonicalView(
    state: DbOnboardingState | null,
    tenant: DbTenant,
    informationState: DbBusinessInformationState,
    rows: CanonicalAggregateRows | CanonicalSnapshot,
  ): BusinessProfileView {
    const snapshot = "schema" in rows ? rows : canonicalSnapshot(rows);
    return {
      profile: canonicalProfile(this.profile(record(state?.data), tenant), snapshot),
      version: informationState.etag,
      etag: this.profileEtag(tenant.id, informationState.etag),
      updatedAt: informationState.updatedAt.toISOString(),
    };
  }

  private compatibilityOnly(profile: BusinessProfileData) {
    return {
      avgCheck: profile.avgCheck,
      servicesCatalog: profile.servicesCatalog,
      hours: profile.hours,
      weeklySchedule: profile.weeklySchedule,
      availability: profile.availability,
      faq: profile.faq,
      policies: profile.policies,
      escalationRules: profile.escalationRules,
    };
  }

  private canonicalPlanHash(plan: CanonicalMutationPlan) {
    return canonicalKnowledgeV2Hash({
      beforeRowsHash: plan.beforeRowsHash,
      canonicalHash: plan.canonicalHash,
      profile: plan.profile,
      fieldChanges: plan.fieldChanges,
    });
  }

  private affectedCanonicalResources(plan: CanonicalMutationPlan) {
    const resources = new Map<string, { resourceType: string; resourceKey: string }>();
    for (const change of plan.fieldChanges) {
      resources.set(`${change.resourceType}:${change.resourceKey}`, {
        resourceType: change.resourceType,
        resourceKey: change.resourceKey,
      });
    }
    return {
      schema: "leadvirt.business-information-affected-resources.v1",
      resources: [...resources.values()],
      profileFields: plan.changedProfileFields,
    };
  }

  private assertCanonicalRowWrite(
    write: { count: number },
    resourceType: string,
    resourceKey: string,
  ) {
    if (write.count === 1) return;
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_INFORMATION_ROW_VERSION_CONFLICT",
      "A canonical business information row changed concurrently.",
      { details: { resourceType, resourceKey } },
    );
  }

  private async writeCanonicalRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    plan: CanonicalMutationPlan,
  ) {
    if (plan.before.identity.rowVersion !== plan.after.identity.rowVersion) {
      const identity = plan.after.identity;
      this.assertCanonicalRowWrite(
        await tx.businessIdentity.updateMany({
          where: {
            tenantId,
            id: identity.id,
            rowVersion: plan.before.identity.rowVersion,
          },
          data: {
            displayName: identity.displayName,
            legalName: identity.legalName,
            businessType: identity.businessType,
            description: identity.description,
            defaultLocale: identity.defaultLocale,
            timezone: identity.timezone,
            defaultCurrency: identity.defaultCurrency,
            rowVersion: identity.rowVersion,
          },
        }),
        "BUSINESS_IDENTITY",
        identity.id,
      );
    }
    const beforeOfferings = new Map(plan.before.offerings.map((offering) => [offering.id, offering]));
    for (const offering of plan.after.offerings) {
      const before = beforeOfferings.get(offering.id);
      if (!before) {
        await tx.businessOffering.create({
          data: {
            id: offering.id,
            tenantId,
            kind: offering.kind,
            category: offering.category,
            parentCategory: offering.parentCategory,
            name: offering.name,
            description: offering.description,
            locale: offering.locale,
            bookingNotes: offering.bookingNotes,
            active: offering.active,
            rowVersion: offering.rowVersion,
            archivedAt: offering.archivedAt ? new Date(offering.archivedAt) : null,
          },
        });
      } else if (before.rowVersion !== offering.rowVersion) {
        this.assertCanonicalRowWrite(
          await tx.businessOffering.updateMany({
            where: { tenantId, id: offering.id, rowVersion: before.rowVersion },
            data: {
              kind: offering.kind,
              category: offering.category,
              parentCategory: offering.parentCategory,
              name: offering.name,
              description: offering.description,
              locale: offering.locale,
              bookingNotes: offering.bookingNotes,
              active: offering.active,
              rowVersion: offering.rowVersion,
              archivedAt: offering.archivedAt ? new Date(offering.archivedAt) : null,
            },
          }),
          "OFFERING",
          offering.id,
        );
      }
      const beforePrices = new Map((before?.prices ?? []).map((price) => [price.id, price]));
      for (const price of offering.prices) {
        const previousPrice = beforePrices.get(price.id);
        const data = {
          type: price.type,
          amount: price.amount,
          amountFrom: price.amountFrom,
          amountTo: price.amountTo,
          currency: price.currency,
          unit: price.unit,
          taxNote: price.taxNote,
          effectiveFrom: price.effectiveFrom ? new Date(`${price.effectiveFrom}T00:00:00.000Z`) : null,
          effectiveUntil: price.effectiveUntil
            ? new Date(`${price.effectiveUntil}T00:00:00.000Z`)
            : null,
          rowVersion: price.rowVersion,
        };
        if (!previousPrice) {
          await tx.businessOfferingPrice.create({
            data: { id: price.id, tenantId, offeringId: offering.id, ...data },
          });
        } else if (previousPrice.rowVersion !== price.rowVersion) {
          this.assertCanonicalRowWrite(
            await tx.businessOfferingPrice.updateMany({
              where: { tenantId, id: price.id, rowVersion: previousPrice.rowVersion },
              data,
            }),
            "OFFERING_PRICE",
            price.id,
          );
        }
      }
      const duration = offering.duration;
      const previousDuration = before?.duration ?? null;
      if (duration && !previousDuration) {
        await tx.businessOfferingDuration.create({
          data: {
            id: duration.id,
            tenantId,
            offeringId: offering.id,
            minimumMinutes: duration.minimumMinutes,
            maximumMinutes: duration.maximumMinutes,
            preparationMinutes: duration.preparationMinutes,
            bufferMinutes: duration.bufferMinutes,
            rowVersion: duration.rowVersion,
          },
        });
      } else if (
        duration &&
        previousDuration &&
        duration.rowVersion !== previousDuration.rowVersion
      ) {
        this.assertCanonicalRowWrite(
          await tx.businessOfferingDuration.updateMany({
            where: { tenantId, id: duration.id, rowVersion: previousDuration.rowVersion },
            data: {
              minimumMinutes: duration.minimumMinutes,
              maximumMinutes: duration.maximumMinutes,
              preparationMinutes: duration.preparationMinutes,
              bufferMinutes: duration.bufferMinutes,
              rowVersion: duration.rowVersion,
            },
          }),
          "OFFERING_DURATION",
          duration.id,
        );
      }
    }
  }

  private async writeManualAttributions(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    revision: { id: string; revision: number; canonicalHash: string },
    changes: CanonicalFieldChange[],
  ) {
    const supersededAt = new Date();
    for (const change of changes) {
      await tx.businessInformationAttribution.updateMany({
        where: {
          tenantId: context.tenantId,
          resourceType: change.resourceType,
          resourceKey: change.resourceKey,
          fieldPath: change.fieldPath,
          supersededAt: null,
        },
        data: { supersededAt },
      });
      const resourceReference =
        change.resourceType === "BUSINESS_IDENTITY"
          ? { identityId: change.resourceKey }
          : change.resourceType === "OFFERING"
            ? { offeringId: change.resourceKey }
            : change.resourceType === "OFFERING_PRICE"
              ? { offeringPriceId: change.resourceKey }
              : { offeringDurationId: change.resourceKey };
      await tx.businessInformationAttribution.create({
        data: {
          tenantId: context.tenantId,
          resourceType: change.resourceType,
          resourceKey: change.resourceKey,
          fieldPath: change.fieldPath,
          currentValueHash: canonicalKnowledgeV2Hash({ value: change.value }),
          authority: "MANUAL",
          businessRevisionId: revision.id,
          businessRevision: revision.revision,
          businessRevisionHash: revision.canonicalHash,
          ...resourceReference,
        },
      });
    }
  }

  private async writeProfileDataInTransaction(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    current: DbOnboardingState,
    tenant: DbTenant,
    previousData: Record<string, unknown>,
    nextData: Record<string, unknown>,
    profilePatch: BusinessProfilePatch,
    profileChanged: boolean,
    currentStep?: string,
    extras: TenantProfileExtras = {},
  ) {
    const state = await tx.onboardingState.update({
      where: { id: current.id },
      data: {
        data: nextData as Prisma.InputJsonObject,
        ...(profileChanged
          ? {
              businessProfileVersion: { increment: 1 },
              businessProfileUpdatedAt: new Date(),
            }
          : {}),
        ...(currentStep !== undefined ? { currentStep } : {}),
      },
    });
    const updatedTenant = await this.updateTenantProfile(tx, tenant, profilePatch, extras);
    const sync = await this.knowledge.syncOnboardingSourcesInTransaction(
      tx,
      context,
      previousData,
      nextData,
    );
    return {
      state,
      tenant: updatedTenant,
      dispatch: {
        eventId: sync.eventId,
        reconciliationEventIds: sync.reconciliationEventIds,
      },
    };
  }

  private async updateTenantProfile(
    tx: Prisma.TransactionClient,
    tenant: DbTenant,
    profilePatch: BusinessProfilePatch,
    extras: TenantProfileExtras,
  ) {
    const currentSettings = record(tenant.settings);
    const currentProfile = record(currentSettings.profile);
    const changesSettings =
      profilePatch.description !== undefined ||
      own(extras, "logoDataUrl") ||
      own(extras, "phone") ||
      own(extras, "website");
    const profile = {
      ...currentProfile,
      ...(profilePatch.description !== undefined
        ? { description: nullableText(profilePatch.description) }
        : {}),
      ...(own(extras, "logoDataUrl") ? { logoDataUrl: extras.logoDataUrl ?? null } : {}),
      ...(own(extras, "phone") ? { phone: nullableText(extras.phone) } : {}),
      ...(own(extras, "website") ? { website: nullableText(extras.website) } : {}),
    };
    const changesTenant =
      profilePatch.name !== undefined ||
      profilePatch.businessType !== undefined ||
      profilePatch.timezone !== undefined ||
      changesSettings;
    if (!changesTenant) return tenant;
    return tx.tenant.update({
      where: { id: tenant.id },
      data: {
        ...(profilePatch.name !== undefined ? { name: profilePatch.name } : {}),
        ...(profilePatch.businessType !== undefined
          ? { businessType: profilePatch.businessType }
          : {}),
        ...(profilePatch.timezone !== undefined ? { timezone: profilePatch.timezone } : {}),
        ...(changesSettings ? { settings: { ...currentSettings, profile } } : {}),
      },
    });
  }

  private async loadTenantForUpdate(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new NotFoundException("Workspace was not found.");
    return tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  private ensureState(tx: Prisma.TransactionClient, tenantId: string) {
    return tx.onboardingState.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId, currentStep: "business", completedSteps: [], data: {} },
    });
  }

  private view(state: DbOnboardingState | null, tenant: DbTenant): BusinessProfileView {
    const version = state?.businessProfileVersion ?? 1;
    return {
      profile: this.profile(record(state?.data), tenant),
      version,
      etag: this.profileEtag(tenant.id, version),
      updatedAt: (state?.businessProfileUpdatedAt ?? tenant.updatedAt).toISOString(),
    };
  }

  private profile(data: Record<string, unknown>, tenant: DbTenant): BusinessProfileData {
    const companyInfo = record(data.companyInfo);
    const profileSettings = settingsProfile(tenant.settings);
    return {
      businessType: text(data.businessType) || optionalText(tenant.businessType) || "",
      name: text(companyInfo.name) || tenant.name,
      description:
        optionalText(companyInfo.description) ?? optionalText(profileSettings.description) ?? "",
      avgCheck: text(companyInfo.avgCheck),
      servicesCatalog: text(companyInfo.servicesCatalog),
      services: this.services(companyInfo.services),
      hours: text(companyInfo.hours),
      weeklySchedule: this.schedule(companyInfo.weeklySchedule),
      availability: text(companyInfo.availability),
      faq: text(companyInfo.faq),
      policies: text(companyInfo.policies),
      escalationRules: text(companyInfo.escalationRules),
      timezone: text(data.timezone) || tenant.timezone,
    };
  }

  private services(value: unknown): BusinessProfileServiceItem[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const candidate = record(item);
      const id = optionalText(candidate.id);
      const name = optionalText(candidate.name);
      if (!id || !name) return [];
      return [
        {
          id,
          name,
          description: text(candidate.description),
          price: text(candidate.price),
          duration: text(candidate.duration),
        },
      ];
    });
  }

  private schedule(value: unknown): BusinessProfileScheduleDay[] {
    if (!Array.isArray(value)) return [];
    const entries = value.flatMap((item) => {
      const candidate = record(item);
      const day = optionalText(candidate.day);
      if (!day || !DAY_INDEX.has(day as (typeof DAY_ORDER)[number])) return [];
      if (typeof candidate.enabled !== "boolean") return [];
      return [
        {
          day: day as BusinessProfileScheduleDay["day"],
          enabled: candidate.enabled,
          opensAt: text(candidate.opensAt),
          closesAt: text(candidate.closesAt),
        },
      ];
    });
    return entries.sort(
      (left, right) => (DAY_INDEX.get(left.day) ?? 0) - (DAY_INDEX.get(right.day) ?? 0),
    );
  }

  private normalizeProfilePatch(patch: BusinessProfilePatch): BusinessProfilePatch {
    return {
      ...(patch.businessType !== undefined ? { businessType: patch.businessType.trim() } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.avgCheck !== undefined ? { avgCheck: patch.avgCheck.trim() } : {}),
      ...(patch.servicesCatalog !== undefined
        ? { servicesCatalog: patch.servicesCatalog.trim() }
        : {}),
      ...(patch.services !== undefined
        ? {
            services: patch.services.map((service) => ({
              id: service.id.trim(),
              name: service.name.trim(),
              description: service.description.trim(),
              price: service.price.trim(),
              duration: service.duration.trim(),
            })),
          }
        : {}),
      ...(patch.hours !== undefined ? { hours: patch.hours.trim() } : {}),
      ...(patch.weeklySchedule !== undefined
        ? {
            weeklySchedule: patch.weeklySchedule
              .map((entry) => ({
                day: entry.day,
                enabled: entry.enabled,
                opensAt: entry.opensAt.trim(),
                closesAt: entry.closesAt.trim(),
              }))
              .sort(
                (left, right) => (DAY_INDEX.get(left.day) ?? 0) - (DAY_INDEX.get(right.day) ?? 0),
              ),
          }
        : {}),
      ...(patch.availability !== undefined ? { availability: patch.availability.trim() } : {}),
      ...(patch.faq !== undefined ? { faq: patch.faq.trim() } : {}),
      ...(patch.policies !== undefined ? { policies: patch.policies.trim() } : {}),
      ...(patch.escalationRules !== undefined
        ? { escalationRules: patch.escalationRules.trim() }
        : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone.trim() } : {}),
    };
  }

  private materializeProfile(
    data: Record<string, unknown>,
    profile: BusinessProfileData,
    explicitFields: readonly string[] = [],
  ) {
    const companyInfo = record(data.companyInfo);
    const shouldStoreSchedule =
      own(companyInfo, "weeklySchedule") ||
      explicitFields.includes("weeklySchedule") ||
      profile.weeklySchedule.length > 0;
    return {
      ...data,
      businessType: profile.businessType,
      timezone: profile.timezone,
      companyInfo: {
        ...companyInfo,
        name: profile.name,
        description: profile.description,
        avgCheck: profile.avgCheck,
        servicesCatalog: profile.servicesCatalog,
        services: profile.services,
        hours: profile.hours,
        ...(shouldStoreSchedule ? { weeklySchedule: profile.weeklySchedule } : {}),
        availability: profile.availability,
        faq: profile.faq,
        policies: profile.policies,
        escalationRules: profile.escalationRules,
      },
    };
  }

  private mergeOnboardingData(
    previousData: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) {
    const next = { ...previousData, ...patch };
    if (own(patch, "companyInfo") && record(patch.companyInfo) === patch.companyInfo) {
      next.companyInfo = { ...record(previousData.companyInfo), ...record(patch.companyInfo) };
    }
    return next;
  }

  private sameProfile(left: BusinessProfileData, right: BusinessProfileData) {
    return canonicalKnowledgeV2Hash(left) === canonicalKnowledgeV2Hash(right);
  }

  private changedProfileFields(left: BusinessProfileData, right: BusinessProfileData) {
    return (
      [
        "businessType",
        "name",
        "description",
        "avgCheck",
        "servicesCatalog",
        "services",
        "hours",
        "weeklySchedule",
        "availability",
        "faq",
        "policies",
        "escalationRules",
        "timezone",
      ] as const
    ).filter(
      (field) => canonicalKnowledgeV2Hash(left[field]) !== canonicalKnowledgeV2Hash(right[field]),
    );
  }

  private onboardingProfileFields(data: Record<string, unknown>) {
    const fields: string[] = [];
    if (own(data, "businessType")) fields.push("businessType");
    if (own(data, "timezone")) fields.push("timezone");
    const companyInfo = record(data.companyInfo);
    for (const field of [
      "name",
      "description",
      "avgCheck",
      "servicesCatalog",
      "services",
      "hours",
      "weeklySchedule",
      "availability",
      "faq",
      "policies",
      "escalationRules",
    ]) {
      if (own(companyInfo, field)) fields.push(field);
    }
    return fields;
  }

  private tenantSyncPatch(tenant: DbTenant, profile: BusinessProfileData): BusinessProfilePatch {
    const storedProfile = settingsProfile(tenant.settings);
    return {
      ...(tenant.name !== profile.name ? { name: profile.name } : {}),
      ...(profile.businessType && tenant.businessType !== profile.businessType
        ? { businessType: profile.businessType }
        : {}),
      ...((optionalText(storedProfile.description) ?? "") !== profile.description
        ? { description: profile.description }
        : {}),
      ...(tenant.timezone !== profile.timezone ? { timezone: profile.timezone } : {}),
    };
  }

  private profilePatchFromSettings(dto: BusinessProfileSettingsPatch): BusinessProfilePatch {
    return {
      ...(dto.businessName !== undefined ? { name: dto.businessName.trim() } : {}),
      ...(dto.businessType !== undefined ? { businessType: dto.businessType.trim() } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
      ...(own(dto, "description") ? { description: dto.description?.trim() ?? "" } : {}),
    };
  }

  private settingsExtras(dto: BusinessProfileSettingsPatch): TenantProfileExtras {
    return {
      ...(own(dto, "logoDataUrl") ? { logoDataUrl: dto.logoDataUrl ?? null } : {}),
      ...(own(dto, "phone") ? { phone: dto.phone ?? null } : {}),
      ...(own(dto, "website") ? { website: dto.website ?? null } : {}),
    };
  }

  private settingsAccount(
    tenant: DbTenant,
    state: DbOnboardingState | null,
    context: RequestContext,
    informationState: DbBusinessInformationState | null = null,
    identity: DbBusinessIdentity | null = null,
  ): SettingsAccount {
    const profile = settingsProfile(tenant.settings);
    const canonical = this.profile(record(state?.data), tenant);
    const v2Enabled = Boolean(informationState && informationState.revision > 0 && identity);
    const businessName = v2Enabled ? identity!.displayName : canonical.name;
    const businessType = v2Enabled ? identity!.businessType : canonical.businessType || null;
    const timezone = v2Enabled ? identity!.timezone : canonical.timezone;
    const description = v2Enabled ? identity!.description : canonical.description || null;
    const version = v2Enabled ? informationState!.etag : (state?.businessProfileVersion ?? 1);
    return {
      tenant: {
        id: tenant.id,
        name: businessName,
        slug: tenant.slug,
        status: tenant.status,
        businessType,
        timezone,
      },
      owner: context.user,
      businessName,
      timezone,
      logoDataUrl: optionalText(profile.logoDataUrl) ?? null,
      description,
      phone: optionalText(profile.phone) ?? null,
      website: optionalText(profile.website) ?? null,
      businessProfileVersion: version,
      businessProfileEtag: this.profileEtag(tenant.id, version),
      businessProfileUpdatedAt: (
        v2Enabled ? informationState!.updatedAt : (state?.businessProfileUpdatedAt ?? tenant.updatedAt)
      ).toISOString(),
    };
  }

  private assertSchedule(schedule: BusinessProfileScheduleDay[] | undefined) {
    if (!schedule) return;
    for (const [index, entry] of schedule.entries()) {
      if (
        entry.enabled &&
        (!entry.opensAt || !entry.closesAt || entry.opensAt === entry.closesAt)
      ) {
        throw knowledgeV2Error(
          HttpStatus.BAD_REQUEST,
          "KNOWLEDGE_VALIDATION_INPUT_INVALID",
          "The request contains invalid fields.",
          {
            fieldErrors: [
              {
                field: `profile.weeklySchedule.${index}`,
                code: "KNOWLEDGE_VALIDATION_BUSINESS_HOURS_INVALID",
                message: "Enabled days require different opening and closing times.",
              },
            ],
          },
        );
      }
    }
  }

  private assertProfileSize(profile: BusinessProfileData) {
    if (businessProfileSerializedBytes(profile) <= BUSINESS_PROFILE_MAX_SERIALIZED_BYTES) return;
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_INPUT_INVALID",
      "The business profile is too large.",
      {
        fieldErrors: [
          {
            field: "profile",
            code: "KNOWLEDGE_VALIDATION_MAX_UTF8_BYTES",
            message: `profile must be at most ${BUSINESS_PROFILE_MAX_SERIALIZED_BYTES} UTF-8 bytes`,
          },
        ],
      },
    );
  }

  profileEtag(tenantId: string, version: number) {
    return strongKnowledgeV2Etag("business-profile", tenantId, version);
  }
}
