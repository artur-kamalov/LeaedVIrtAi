import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type IntegrationProvider } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cases: ReadonlyArray<{
  provider: IntegrationProvider;
  settings: Record<string, unknown>;
  expectedCredentials: Record<string, string>;
}> = [
  {
    provider: "WHATSAPP_BUSINESS",
    settings: {
      phoneNumberId: "whatsapp-phone-number-id",
      accessToken: "whatsapp-access-token",
      appSecret: "whatsapp-app-secret",
    },
    expectedCredentials: {
      accessToken: "whatsapp-access-token",
      appSecret: "whatsapp-app-secret",
    },
  },
  {
    provider: "SHOPIFY",
    settings: {
      storeUrl: "https://shop.example.com",
      apiToken: "shopify-api-token",
      appPassword: "shopify-app-password",
    },
    expectedCredentials: {
      apiToken: "shopify-api-token",
      appPassword: "shopify-app-password",
    },
  },
  {
    provider: "OTHER",
    settings: {
      endpointUrl: "https://api.example.com",
      apiToken: "generic-api-token",
      oauth: { accessToken: "nested-access-token", bearer_token: "nested-bearer-token" },
    },
    expectedCredentials: {
      apiToken: "generic-api-token",
      "oauth/accessToken": "nested-access-token",
      "oauth/bearer_token": "nested-bearer-token",
    },
  },
];

function contextFor(tenant: RequestContext["tenant"], userId: string): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `integration-credentials-${tenant.id}@leadvirt.test`,
      phone: null,
      name: "Integration Credential Smoke",
      avatarUrl: null,
      passwordChangeRequired: false,
    },
  };
}

function assertNoSecretMaterial(value: unknown, expectedCredentials: Record<string, string>) {
  const serialized = JSON.stringify(value);
  for (const [field, secret] of Object.entries(expectedCredentials)) {
    const leafField = field.split("/").at(-1);
    assert(!serialized.includes(secret), `Response leaked credential value for ${field}.`);
    assert(!leafField || !serialized.includes(`"${leafField}"`), `Response exposed ${field}.`);
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  let userId: string | null = null;
  const service = new IntegrationsService(
    prisma as unknown as PrismaService,
    {} as ChannelsService,
    {} as TelegramBotApiService,
    {} as TelegramService,
    {} as WebhookService,
  );

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Integration Credential Security Smoke",
        slug: `integration-credential-security-${suffix}`,
        timezone: "UTC",
      },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: `integration-credential-security-${suffix}@leadvirt.test`,
        name: "Integration Credential Smoke",
      },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });

    for (const testCase of cases) {
      await prisma.integrationAccount.create({
        data: {
          tenantId: tenant.id,
          provider: testCase.provider,
          name: testCase.provider,
          status: "DISCONNECTED",
          settings: {},
        },
      });

      const context = contextFor(tenant, user.id);
      let rejected = false;
      try {
        await service.updateSettings(context, testCase.provider, {
          settings: testCase.settings,
        });
      } catch (error) {
        rejected = error instanceof HttpException && error.getStatus() === 501;
      }
      assert(rejected, `${testCase.provider} accepted credentials without a live adapter.`);

      const stored = await prisma.integrationAccount.findUniqueOrThrow({
        where: { tenantId_provider: { tenantId: tenant.id, provider: testCase.provider } },
      });
      assert(
        stored.encryptedCredentials === null,
        `${testCase.provider} persisted rejected credentials.`,
      );
      assertNoSecretMaterial(stored.settings, testCase.expectedCredentials);
    }

    const legacySecret = "legacy-shop-script-token";
    await prisma.integrationAccount.create({
      data: {
        tenantId: tenant.id,
        provider: "SHOP_SCRIPT",
        name: "Shop-Script legacy",
        status: "DISCONNECTED",
        settings: { endpointUrl: "https://shop.example.com", apiToken: legacySecret },
      },
    });
    let legacyUpdateRejected = false;
    try {
      await service.updateSettings(contextFor(tenant, user.id), "SHOP_SCRIPT", {
        settings: { endpointUrl: "https://shop.example.com", apiToken: "" },
      });
    } catch (error) {
      legacyUpdateRejected = error instanceof HttpException && error.getStatus() === 501;
    }
    assert(legacyUpdateRejected, "Legacy unavailable credentials could still be mutated.");
    const legacyStorage = await prisma.integrationAccount.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "SHOP_SCRIPT" } },
    });
    assert(
      (legacyStorage.settings as { apiToken?: string }).apiToken === legacySecret,
      "Rejected legacy update changed stored recovery data.",
    );

    const listed = await service.list(contextFor(tenant, user.id));
    for (const testCase of cases) {
      const account = listed.find((item) => item.provider === testCase.provider);
      assert(account, `${testCase.provider} was missing from the integration list.`);
      assertNoSecretMaterial(account, testCase.expectedCredentials);
    }
    const legacyAccount = listed.find((item) => item.provider === "SHOP_SCRIPT");
    assert(legacyAccount, "Legacy Shop-Script account was missing from the integration list.");
    assertNoSecretMaterial(legacyAccount, { apiToken: legacySecret });

    console.log(
      JSON.stringify({
        ok: true,
        providers: cases.map((item) => item.provider),
        rejectedCredentialWrites: cases.length + 1,
        legacyCredentialsRedacted: true,
      }),
    );
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
