import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { canonicalKnowledgeV2Hash } from "../knowledge/knowledge-v2-http.js";
import { businessInformationEtag } from "./business-import-http.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class BusinessInformationStateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(context: RequestContext) {
    return this.prisma.$transaction((tx) => this.ensureInTransaction(tx, context));
  }

  async ensureInTransaction(tx: Prisma.TransactionClient, context: RequestContext) {
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(
        ${`business-information-state:${context.tenantId}`},
        0
      ))) AS business_information_state_lock
    `);
    const tenant = await tx.tenant.findFirst({
      where: { id: context.tenantId, deletedAt: null },
      include: { onboardingState: true },
    });
    if (!tenant) throw new Error("BUSINESS_INFORMATION_TENANT_NOT_FOUND");
    const existing = await tx.businessInformationState.findUnique({
      where: { tenantId: context.tenantId },
    });
    if (existing && existing.revision > 0) return existing;
    const canonicalHash = canonicalKnowledgeV2Hash({
      schema: "business-information-legacy-baseline-v1",
      tenant: {
        name: tenant.name,
        businessType: tenant.businessType,
        timezone: tenant.timezone,
        settingsProfile: record(record(tenant.settings).profile),
      },
      onboardingProfileVersion: tenant.onboardingState?.businessProfileVersion ?? 1,
      onboardingData: record(tenant.onboardingState?.data),
    });
    if (!existing) {
      return tx.businessInformationState.create({
        data: {
          tenantId: context.tenantId,
          revision: 0,
          canonicalHash,
          etag: 1,
          updatedByUserId: context.userId,
        },
      });
    }
    if (existing.canonicalHash === canonicalHash) return existing;
    return tx.businessInformationState.update({
      where: { tenantId: context.tenantId },
      data: {
        canonicalHash,
        etag: { increment: 1 },
        updatedByUserId: context.userId,
      },
    });
  }

  etag(state: { tenantId: string; etag: number }) {
    return businessInformationEtag(state.tenantId, state.etag);
  }
}
