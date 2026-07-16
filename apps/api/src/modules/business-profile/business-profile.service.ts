import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type OnboardingState as DbOnboardingState,
  type Tenant as DbTenant,
} from "@leadvirt/db";
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
import type { BusinessProfilePatchRequestDto } from "./dto/business-profile.dto.js";

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_INDEX = new Map(DAY_ORDER.map((day, index) => [day, index]));
type HeaderValue = string | string[] | undefined;

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

@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
  ) {}

  async get(context: RequestContext): Promise<BusinessProfileView> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: context.tenantId, deletedAt: null },
      include: { onboardingState: true },
    });
    if (!tenant) throw new NotFoundException("Workspace was not found.");
    return this.view(tenant.onboardingState, tenant);
  }

  async getSettingsAccount(context: RequestContext): Promise<SettingsAccount> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: context.tenantId, deletedAt: null },
      include: { onboardingState: true },
    });
    if (!tenant) throw new NotFoundException("Workspace was not found.");
    return this.settingsAccount(tenant, tenant.onboardingState, context);
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
    let dispatch: BusinessProfileDispatch = { eventId: null, reconciliationEventIds: [] };

    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "PATCH:/business-profile",
        key: idempotencyKey,
        request: { body: dto, ifMatch },
      },
      async (tx) => {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
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

  async updateOnboardingInTransaction(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    input: { currentStep?: string; data?: object },
    ifMatch?: HeaderValue,
  ) {
    await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
    const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
    const current = await this.ensureState(tx, context.tenantId);
    const previousData = record(current.data);
    const inputData = record(input.data);
    const mergedData = this.mergeOnboardingData(previousData, inputData);
    const requestedProfileFields = this.onboardingProfileFields(inputData);
    if (requestedProfileFields.length === 0) {
      const scenarioChanged = own(inputData, "scenario");
      const nextData = scenarioChanged
        ? this.materializeProfile(mergedData, this.profile(mergedData, tenant))
        : mergedData;
      if (scenarioChanged) this.assertProfileSize(this.profile(nextData, tenant));
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
      if (overlapsProfile) await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
      const tenant = await this.loadTenantForUpdate(tx, context.tenantId);
      const current = await this.ensureState(tx, context.tenantId);
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
      return this.settingsAccount(updatedTenant, updatedState, context);
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
  ): SettingsAccount {
    const profile = settingsProfile(tenant.settings);
    const canonical = this.profile(record(state?.data), tenant);
    const version = state?.businessProfileVersion ?? 1;
    return {
      tenant: {
        id: tenant.id,
        name: canonical.name,
        slug: tenant.slug,
        status: tenant.status,
        businessType: canonical.businessType || null,
        timezone: canonical.timezone,
      },
      owner: context.user,
      businessName: canonical.name,
      timezone: canonical.timezone,
      logoDataUrl: optionalText(profile.logoDataUrl) ?? null,
      description: canonical.description || null,
      phone: optionalText(profile.phone) ?? null,
      website: optionalText(profile.website) ?? null,
      businessProfileVersion: version,
      businessProfileEtag: this.profileEtag(tenant.id, version),
      businessProfileUpdatedAt: (state?.businessProfileUpdatedAt ?? tenant.updatedAt).toISOString(),
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
