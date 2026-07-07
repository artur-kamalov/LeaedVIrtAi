import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextFor(tenant: { id: string; name: string; slug: string; status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED"; businessType: string | null; timezone: string }, userId: string): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `umnico-settings-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "Umnico Settings Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  let userId: string | null = null;
  const service = new IntegrationsService(
    prisma as unknown as PrismaService,
    {} as TelegramService,
    {} as WebhookService
  );

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Umnico Settings Smoke",
        slug: `umnico-settings-smoke-${suffix}`,
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: `umnico-settings-${suffix}@leadvirt.ai`,
        name: "Umnico Settings Smoke"
      }
    });
    userId = user.id;

    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" }
    });

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Umnico Instagram",
        publicKey: `lvwh_umnico_settings_${suffix.replace(/-/g, "_")}`,
        settings: {
          webhook: {
            publicKey: `lvwh_umnico_settings_${suffix.replace(/-/g, "_")}`,
            secret: "smoke-secret",
            autoReply: true
          }
        }
      }
    });

    await prisma.integrationAccount.create({
      data: {
        tenantId: tenant.id,
        provider: "WEBHOOK_API",
        name: "Webhook/API",
        category: "Developers",
        status: "CONNECTED",
        settings: {}
      }
    });

    const updated = await service.updateSettings(contextFor(tenant, user.id), "WEBHOOK_API", {
      settings: {
        displayName: "Umnico Instagram",
        apiToken: "umnico-secret-token",
        endpointUrl: "https://api.umnico.com/v1.3",
        syncMode: "two-way",
        syncEnabled: true
      }
    });

    assert(isRecord(updated.settings), "Integration settings are not an object.");
    assert(updated.settings.apiToken === undefined, "Integration settings leaked apiToken.");
    assert(updated.settings.apiTokenStatus === "configured", "Integration settings did not report configured token.");
    assert(updated.settings.provider === "umnico", "Integration settings did not report Umnico provider.");

    const storedChannel = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    assert(isRecord(storedChannel.settings), "Channel settings are not an object.");
    const webhook = isRecord(storedChannel.settings.webhook) ? storedChannel.settings.webhook : {};
    const umnico = isRecord(webhook.umnico) ? webhook.umnico : {};
    assert(webhook.provider === "umnico", "Channel webhook provider was not set to Umnico.");
    assert(umnico.apiToken === "umnico-secret-token", "Channel Umnico token was not stored.");
    assert(umnico.apiBase === "https://api.umnico.com/v1.3", "Channel Umnico apiBase mismatch.");

    console.log(JSON.stringify({ ok: true, tenantId: tenant.id }));
  } finally {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
