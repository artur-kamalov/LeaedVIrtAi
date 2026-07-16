import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./modules/database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { LeadsModule } from "./modules/leads/leads.module.js";
import { ConversationsModule } from "./modules/conversations/conversations.module.js";
import { MessagesModule } from "./modules/messages/messages.module.js";
import { ChannelsModule } from "./modules/channels/channels.module.js";
import { WorkflowsModule } from "./modules/workflows/workflows.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { AiAuditModule } from "./modules/ai-audit/ai-audit.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { OnboardingModule } from "./modules/onboarding/onboarding.module.js";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module.js";
import { WidgetModule } from "./modules/widget/widget.module.js";
import { TelegramModule } from "./modules/telegram/telegram.module.js";
import { WebhookModule } from "./modules/webhook/webhook.module.js";
import { OperatorOperationsModule } from "./modules/operator-operations/operator-operations.module.js";
import { BusinessProfileModule } from "./modules/business-profile/business-profile.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    MetricsModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    LeadsModule,
    ConversationsModule,
    MessagesModule,
    ChannelsModule,
    WorkflowsModule,
    IntegrationsModule,
    AiModule,
    AiAuditModule,
    BillingModule,
    AnalyticsModule,
    DashboardModule,
    BusinessProfileModule,
    SettingsModule,
    KnowledgeModule,
    OnboardingModule,
    WidgetModule,
    TelegramModule,
    WebhookModule,
    OperatorOperationsModule,
  ],
})
export class AppModule {}
