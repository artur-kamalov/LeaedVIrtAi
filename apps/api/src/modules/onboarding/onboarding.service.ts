import { Inject, Injectable } from "@nestjs/common";
import type { OnboardingState } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { BusinessProfileService } from "../business-profile/business-profile.service.js";
import { lockKnowledgeV2CorpusTransition } from "../knowledge/knowledge-v2-transition-lock.js";
import type {
  CompleteOnboardingStepDto,
  UpdateOnboardingDto,
} from "./dto/update-onboarding.dto.js";

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessProfileService) private readonly businessProfile: BusinessProfileService,
  ) {}

  async state(context: RequestContext): Promise<OnboardingState> {
    const state = await this.ensureState(context);
    return this.mapState(state);
  }

  async update(
    context: RequestContext,
    dto: UpdateOnboardingDto,
    ifMatch?: string | string[],
  ): Promise<OnboardingState> {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await this.businessProfile.updateOnboardingInTransaction(
        tx,
        context,
        dto,
        ifMatch,
      );
      await this.log(tx, context, "onboarding.updated", {
        currentStep: updated.state.currentStep,
      });
      return updated;
    });
    await this.businessProfile.dispatch(result, context.tenantId);
    return this.mapState(result.state);
  }

  async completeStep(
    context: RequestContext,
    dto: CompleteOnboardingStepDto,
  ): Promise<OnboardingState> {
    const state = await this.prisma.$transaction(async (tx) => {
      await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
      const current = await this.ensureState(context, tx);
      const completedSteps = this.completedSteps(current.completedSteps);
      if (!completedSteps.includes(dto.step)) completedSteps.push(dto.step);
      const updated = await tx.onboardingState.update({
        where: { tenantId: context.tenantId },
        data: {
          completedSteps,
          currentStep: dto.step,
          completedAt: dto.step === "launch" ? new Date() : current.completedAt,
        },
      });
      await this.log(tx, context, "onboarding.step_completed", { step: dto.step });
      return updated;
    });
    return this.mapState(state);
  }

  private async ensureState(context: RequestContext, tx: Prisma.TransactionClient = this.prisma) {
    return tx.onboardingState.upsert({
      where: { tenantId: context.tenantId },
      update: {},
      create: {
        tenantId: context.tenantId,
        currentStep: "business",
        completedSteps: [],
        data: {},
      },
    });
  }

  private mapState(state: Awaited<ReturnType<typeof this.ensureState>>): OnboardingState {
    return {
      businessProfileVersion: state.businessProfileVersion,
      businessProfileEtag: this.businessProfile.profileEtag(
        state.tenantId,
        state.businessProfileVersion,
      ),
      businessProfileUpdatedAt: state.businessProfileUpdatedAt.toISOString(),
      currentStep: state.currentStep,
      completedSteps: this.completedSteps(state.completedSteps),
      data:
        typeof state.data === "object" && state.data !== null && !Array.isArray(state.data)
          ? state.data
          : {},
      completedAt: state.completedAt?.toISOString() ?? null,
    };
  }

  private completedSteps(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private async log(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    payload: Prisma.JsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "onboarding",
        entityId: context.tenantId,
        payload,
      },
    });
  }
}
