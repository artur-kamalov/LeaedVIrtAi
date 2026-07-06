import { Inject, Injectable } from "@nestjs/common";
import type { OnboardingState } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { CompleteOnboardingStepDto, UpdateOnboardingDto } from "./dto/update-onboarding.dto.js";

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService
  ) {}

  async state(context: RequestContext): Promise<OnboardingState> {
    const state = await this.ensureState(context);
    return this.mapState(state);
  }

  async update(context: RequestContext, dto: UpdateOnboardingDto): Promise<OnboardingState> {
    const current = await this.ensureState(context);
    const data = {
      ...(typeof current.data === "object" && current.data !== null && !Array.isArray(current.data) ? current.data : {}),
      ...(dto.data ?? {})
    };
    const state = await this.prisma.onboardingState.update({
      where: { tenantId: context.tenantId },
      data: {
        currentStep: dto.currentStep ?? current.currentStep,
        data: data as Prisma.InputJsonObject
      }
    });
    await this.syncTenantProfile(context, data);
    await this.knowledgeService.syncOnboardingSources(context, data);
    await this.log(context, "onboarding.updated", { currentStep: state.currentStep });
    return this.mapState(state);
  }

  async completeStep(context: RequestContext, dto: CompleteOnboardingStepDto): Promise<OnboardingState> {
    const current = await this.ensureState(context);
    const completedSteps = this.completedSteps(current.completedSteps);
    if (!completedSteps.includes(dto.step)) {
      completedSteps.push(dto.step);
    }
    const state = await this.prisma.onboardingState.update({
      where: { tenantId: context.tenantId },
      data: {
        completedSteps,
        currentStep: dto.step,
        completedAt: dto.step === "launch" ? new Date() : current.completedAt
      }
    });
    await this.log(context, "onboarding.step_completed", { step: dto.step });
    return this.mapState(state);
  }

  private async ensureState(context: RequestContext) {
    return this.prisma.onboardingState.upsert({
      where: { tenantId: context.tenantId },
      update: {},
      create: {
        tenantId: context.tenantId,
        currentStep: "business",
        completedSteps: [],
        data: {}
      }
    });
  }

  private mapState(state: Awaited<ReturnType<typeof this.ensureState>>): OnboardingState {
    return {
      currentStep: state.currentStep,
      completedSteps: this.completedSteps(state.completedSteps),
      data:
        typeof state.data === "object" && state.data !== null && !Array.isArray(state.data)
          ? state.data
          : {},
      completedAt: state.completedAt?.toISOString() ?? null
    };
  }

  private completedSteps(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async syncTenantProfile(context: RequestContext, data: Record<string, unknown>) {
    const companyInfo = this.record(data.companyInfo);
    const name = this.text(companyInfo.name);
    const businessType = this.text(data.businessType);
    if (!name && !businessType) return;

    await this.prisma.tenant.update({
      where: { id: context.tenantId },
      data: {
        ...(name ? { name } : {}),
        ...(businessType ? { businessType } : {})
      }
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }

  private async log(context: RequestContext, action: string, payload: Prisma.JsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "onboarding",
        entityId: context.tenantId,
        payload
      }
    });
  }
}
