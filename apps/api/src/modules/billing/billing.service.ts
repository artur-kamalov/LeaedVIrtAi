import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  BillingInvoice,
  BillingPlanSelection,
  BillingPaymentMethod,
  BillingPaymentMethodUpdateRequest,
  PricingPlan,
  PricingPlanCode,
  Subscription,
  UsageSummary
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { EmailOtpDeliveryService } from "../auth/email-otp-delivery.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { billingPlanByCode, billingPlanCatalog, isPricingPlanCode } from "./billing-plan-catalog.js";
import type { ChangeSubscriptionPlanDto } from "./dto/change-subscription-plan.dto.js";

type BillingPlanRecord = {
  code: string;
  name: string;
  priceMonthlyRub: number | null;
  aiConversations: number | null;
  channelsLimit: number | null;
  usersLimit: number | null;
  scenariosLimit: number | null;
  features: unknown;
};

type SubscriptionRecord = {
  id: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  plan: BillingPlanRecord;
};

const legacyPlanTranslations: Record<string, string> = {
  "small businesses and testing one AI scenario": "малый бизнес и тест одного AI-сценария",
  "main recommended plan": "основной рекомендуемый план",
  "active sales teams and multiple directions": "активные отделы продаж и несколько направлений",
  "chains, clinics, e-commerce companies, holdings": "сети, клиники, e-commerce и холдинги",
  "500 AI conversations": "500 AI-диалогов",
  "2,500 AI conversations": "2 500 AI-диалогов",
  "10,000 AI conversations": "10 000 AI-диалогов",
  "2 channels": "2 канала",
  "5 channels": "5 каналов",
  "10 channels": "10 каналов",
  "3 users": "3 пользователя",
  "10 users": "10 пользователей",
  "25 users": "25 пользователей",
  "3 scenarios": "3 сценария",
  "15 scenarios": "15 сценариев",
  "50 scenarios": "50 сценариев",
  "custom limits": "Индивидуальные лимиты",
  "custom integrations": "Кастомные интеграции",
  "personal implementation manager": "Персональный менеджер внедрения"
};

function localizeLegacyPlanText(value: string) {
  return legacyPlanTranslations[value] ?? value;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOtpDeliveryService) private readonly emailDelivery: EmailOtpDeliveryService,
  ) {}

  plans(): PricingPlan[] {
    return billingPlanCatalog();
  }

  async paymentMethod(context: RequestContext): Promise<BillingPaymentMethod> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId },
      select: { updatedAt: true },
      orderBy: { createdAt: "desc" }
    });
    return {
      mode: "manual_invoice",
      label: "Безналичный расчёт по счёту",
      description: "Счёт выставляется вручную менеджером LeadVirt.ai. Карта в продукте не хранится.",
      status: "configured",
      updatedAt: subscription?.updatedAt.toISOString() ?? null,
      nextActionLabel: "Запросить изменение"
    };
  }

  async requestPaymentMethodChange(context: RequestContext): Promise<BillingPaymentMethodUpdateRequest> {
    const requestedAt = new Date().toISOString();
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "billing.payment_method_change_requested",
        entityType: "tenant",
        entityId: context.tenantId,
        payload: {
          mode: "manual_invoice",
          requestedAt
        }
      }
    });
    return {
      requested: true,
      requestedAt,
      mode: "manual_invoice"
    };
  }

  invoices(): BillingInvoice[] {
    // Subscription periods are not evidence that an invoice was issued or paid.
    return [];
  }

  async currentSubscription(context: RequestContext): Promise<Subscription | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    });
    if (!subscription) {
      return null;
    }
    return this.mapSubscription(subscription);
  }

  async planSelection(context: RequestContext): Promise<BillingPlanSelection | null> {
    const selection = await this.prisma.auditLog.findFirst({
      where: { tenantId: context.tenantId, action: "billing.plan_selection_requested" },
      orderBy: { createdAt: "desc" },
    });
    if (!selection || !isPricingPlanCode(selection.entityId)) return null;

    const activated = await this.prisma.subscription.findFirst({
      where: {
        tenantId: context.tenantId,
        status: { in: ["ACTIVE", "TRIALING"] },
        plan: { code: selection.entityId },
        updatedAt: { gte: selection.createdAt },
      },
      select: { id: true },
    });
    if (activated) return null;

    return this.mapPlanSelection(selection.id, selection.entityId, selection.createdAt);
  }

  async selectPlan(context: RequestContext, dto: ChangeSubscriptionPlanDto): Promise<BillingPlanSelection> {
    const current = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId, status: { in: ["ACTIVE", "TRIALING"] } },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
    if (current?.plan.code === dto.planCode) {
      throw new ConflictException("This plan is already active.");
    }

    const selectedAt = new Date();
    const plan = billingPlanByCode(dto.planCode);
    const billingRequestEmail = process.env.BILLING_REQUEST_EMAIL?.trim();
    const requestLines = [
      "A workspace requested manual plan activation.",
      `Workspace: ${context.tenant.name} (${context.tenant.slug})`,
      `Tenant ID: ${context.tenantId}`,
      `Actor user ID: ${context.userId}`,
    ];
    if (context.user.name?.trim()) requestLines.push(`Requester: ${context.user.name.trim()}`);
    if (context.user.email?.trim()) requestLines.push(`Requester email: ${context.user.email.trim()}`);
    if (context.user.phone?.trim()) requestLines.push(`Requester phone: ${context.user.phone.trim()}`);
    requestLines.push(
      `Requested plan: ${plan.name} (${plan.code})`,
      `Current plan: ${current?.plan.code ?? "none"}`,
      `Requested at: ${selectedAt.toISOString()}`,
    );
    const delivery = await this.emailDelivery.sendOperationalEmail({
      ...(billingRequestEmail ? { email: billingRequestEmail } : {}),
      subject: `LeadVirt.ai plan request: ${plan.name}`,
      text: requestLines.join("\n"),
      referenceKey: `billing-plan:${context.tenantId}:${dto.planCode}:${selectedAt.toISOString()}`,
      purpose: "billing_plan_selection",
    });
    const selection = await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "billing.plan_selection_requested",
        entityType: "billing_plan",
        entityId: dto.planCode,
        payload: {
          activePlanCode: current?.plan.code ?? null,
          selectedPlanCode: dto.planCode,
          checkoutAvailable: false,
          billingMode: "manual_invoice",
          operatorDeliveryMessageId: delivery.providerMessageId,
          selectedAt: selectedAt.toISOString(),
        },
        createdAt: selectedAt,
      },
    });

    return this.mapPlanSelection(selection.id, dto.planCode, selection.createdAt);
  }

  async changePlan(context: RequestContext, dto: ChangeSubscriptionPlanDto): Promise<BillingPlanSelection> {
    return this.selectPlan(context, dto);
  }

  async cancelSubscription(context: RequestContext): Promise<Subscription> {
    const current = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    });
    if (!current) {
      throw new NotFoundException("Активная подписка не найдена.");
    }

    const canceledAt = new Date().toISOString();
    const subscription = await this.prisma.subscription.update({
      where: { id: current.id },
      data: {
        status: "CANCELED",
        metadata: {
          ...jsonRecord(current.metadata),
          billingMode: "manual",
          canceledAt
        }
      },
      include: { plan: true }
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "billing.subscription_canceled",
        entityType: "subscription",
        entityId: subscription.id,
        payload: {
          planCode: current.plan.code,
          billingMode: "manual",
          canceledAt
        }
      }
    });

    return this.mapSubscription(subscription);
  }

  async usage(context: RequestContext): Promise<UsageSummary> {
    const [usage, subscription, channels, users, scenarios] = await Promise.all([
      this.prisma.usageCounter.findFirst({
        where: { tenantId: context.tenantId },
        orderBy: { periodEnd: "desc" }
      }),
      this.currentSubscription(context),
      this.prisma.channel.count({ where: { tenantId: context.tenantId, deletedAt: null } }),
      this.prisma.membership.count({ where: { tenantId: context.tenantId } }),
      this.prisma.workflow.count({ where: { tenantId: context.tenantId, deletedAt: null } })
    ]);
    return {
      aiConversations: usage?.aiConversations ?? 0,
      aiConversationsLimit: subscription?.plan.aiConversations ?? null,
      messagesSent: usage?.messagesSent ?? 0,
      messagesReceived: usage?.messagesReceived ?? 0,
      leadsCreated: usage?.leadsCreated ?? 0,
      bookingsCreated: usage?.bookingsCreated ?? 0,
      ordersCreated: usage?.ordersCreated ?? 0,
      crmSyncs: usage?.crmSyncs ?? 0,
      workflowRuns: usage?.workflowRuns ?? 0,
      channels,
      channelsLimit: subscription?.plan.channelsLimit ?? null,
      users,
      usersLimit: subscription?.plan.usersLimit ?? null,
      scenarios,
      scenariosLimit: subscription?.plan.scenariosLimit ?? null
    };
  }

  private mapPlan(plan: BillingPlanRecord): PricingPlan {
    const features = jsonRecord(plan.features);
    const featureList = Array.isArray(features.features)
      ? features.features.filter((item): item is string => typeof item === "string").map(localizeLegacyPlanText)
      : [];
    const pricingPlan = {
      code: plan.code as PricingPlanCode,
      name: plan.name,
      priceMonthlyRub: plan.priceMonthlyRub,
      aiConversations: plan.aiConversations,
      channelsLimit: plan.channelsLimit,
      usersLimit: plan.usersLimit,
      scenariosLimit: plan.scenariosLimit,
      popular: features.popular === true,
      features: featureList
    };
    return typeof features.bestFor === "string" ? { ...pricingPlan, bestFor: localizeLegacyPlanText(features.bestFor) } : pricingPlan;
  }

  private mapSubscription(subscription: SubscriptionRecord): Subscription {
    return {
      id: subscription.id,
      status: subscription.status,
      periodStart: subscription.periodStart.toISOString(),
      periodEnd: subscription.periodEnd.toISOString(),
      plan: this.mapPlan(subscription.plan)
    };
  }

  private mapPlanSelection(reference: string, code: PricingPlanCode, selectedAt: Date): BillingPlanSelection {
    return {
      reference,
      plan: billingPlanByCode(code),
      selectedAt: selectedAt.toISOString(),
      status: "CONTACT_REQUIRED",
      checkout: {
        available: false,
        mode: "manual_invoice",
      },
    };
  }
}
