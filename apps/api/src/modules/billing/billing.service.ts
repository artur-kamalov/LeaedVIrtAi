import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  BillingInvoice,
  BillingPaymentMethod,
  BillingPaymentMethodUpdateRequest,
  PricingPlan,
  PricingPlanCode,
  Subscription,
  UsageSummary
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function invoiceMonth(value: Date) {
  return value.toISOString().slice(0, 7);
}

@Injectable()
export class BillingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async plans(): Promise<PricingPlan[]> {
    const plans = await this.prisma.billingPlan.findMany({ orderBy: { priceMonthlyRub: "asc" } });
    return plans.map((plan) => this.mapPlan(plan));
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

  async invoices(context: RequestContext): Promise<BillingInvoice[]> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId },
      include: { plan: true },
      orderBy: { periodStart: "desc" }
    });
    if (!subscription) {
      return [];
    }

    const plan = this.mapPlan(subscription.plan);
    return [0, -1, -2].map((offset) => {
      const periodStart = addMonths(subscription.periodStart, offset);
      const periodEnd = addMonths(subscription.periodEnd, offset);
      const month = invoiceMonth(periodStart);
      return {
        id: `${subscription.id}-${month}`,
        issuedAt: periodStart.toISOString(),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        amountRub: subscription.plan.priceMonthlyRub,
        status: "PAID",
        plan,
        downloadName: `leadvirt-invoice-${month}.txt`
      };
    });
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

  async changePlan(context: RequestContext, dto: ChangeSubscriptionPlanDto): Promise<Subscription> {
    const plan = await this.prisma.billingPlan.findUnique({ where: { code: dto.planCode } });
    if (!plan) {
      throw new NotFoundException("Тариф не найден.");
    }

    const current = await this.prisma.subscription.findFirst({
      where: { tenantId: context.tenantId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    });

    if (current?.plan.code === dto.planCode) {
      return this.mapSubscription({ ...current, plan });
    }

    const changedAt = new Date().toISOString();
    const subscription = current
      ? await this.prisma.subscription.update({
          where: { id: current.id },
          data: {
            planId: plan.id,
            status: "ACTIVE",
            metadata: {
              ...jsonRecord(current.metadata),
              billingMode: "manual",
              changedAt,
              previousPlanCode: current.plan.code
            }
          },
          include: { plan: true }
        })
      : await this.prisma.subscription.create({
          data: {
            tenantId: context.tenantId,
            planId: plan.id,
            status: "ACTIVE",
            periodStart: new Date(),
            periodEnd: addDays(new Date(), 30),
            metadata: {
              billingMode: "manual",
              createdBy: "manual_plan_change",
              changedAt
            }
          },
          include: { plan: true }
        });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "billing.plan_changed",
        entityType: "subscription",
        entityId: subscription.id,
        payload: {
          fromPlanCode: current?.plan.code ?? null,
          toPlanCode: plan.code,
          billingMode: "manual"
        }
      }
    });

    return this.mapSubscription(subscription);
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
}
