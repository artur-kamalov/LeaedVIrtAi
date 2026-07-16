import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { AiProvider } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { decryptIntegrationCredentials } from "@leadvirt/integrations";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

loadEnvFile();
process.env.API_URL = "https://leadvirt.test";
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = "telegram-lifecycle-security-smoke";

const firstToken = "910000001:AA-lifecycle-first";
const secondToken = "910000002:AA-lifecycle-second";
const sharedToken = "910000003:AA-lifecycle-shared";

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function botId(token: string) {
  return Number(token.split(":", 1)[0]);
}

function botUsername(token: string) {
  if (token === firstToken) return "lifecycle_first_bot";
  if (token === secondToken) return "lifecycle_second_bot";
  return "lifecycle_shared_bot";
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const created: Array<{ tenantId: string; userId: string }> = [];
  const calls: Array<{ method: string; token: string }> = [];
  const remote = new Map<
    string,
    { url: string; secret: string; allowedUpdates: string[]; pendingUpdates: number }
  >();
  let getMeGate: { token: string; entered: () => void; release: Promise<void> } | null = null;
  let deleteGate: { token: string; entered: () => void; release: Promise<void> } | null = null;

  const stateFor = (token: string) => {
    const existing = remote.get(token);
    if (existing) return existing;
    const state = { url: "", secret: "", allowedUpdates: [] as string[], pendingUpdates: 0 };
    remote.set(token, state);
    return state;
  };

  const botApi = {
    getMe: async (token: string) => {
      calls.push({ method: "getMe", token });
      if (getMeGate?.token === token) {
        const gate = getMeGate;
        getMeGate = null;
        gate.entered();
        await gate.release;
      }
      return {
        id: botId(token),
        is_bot: true,
        first_name: "Lifecycle",
        username: botUsername(token),
      };
    },
    setWebhook: async (input: {
      botToken: string;
      url: string;
      secretToken: string;
      allowedUpdates: string[];
    }) => {
      calls.push({ method: "setWebhook", token: input.botToken });
      remote.set(input.botToken, {
        url: input.url,
        secret: input.secretToken,
        allowedUpdates: [...input.allowedUpdates],
        pendingUpdates: 0,
      });
      return true;
    },
    getWebhookInfo: async (token: string) => {
      calls.push({ method: "getWebhookInfo", token });
      const state = stateFor(token);
      return {
        url: state.url,
        pending_update_count: state.pendingUpdates,
        allowed_updates: [...state.allowedUpdates],
      };
    },
    deleteWebhook: async (token: string) => {
      calls.push({ method: "deleteWebhook", token });
      if (deleteGate?.token === token) {
        const gate = deleteGate;
        deleteGate = null;
        gate.entered();
        await gate.release;
      }
      const state = stateFor(token);
      state.url = "";
      state.secret = "";
      state.allowedUpdates = [];
      return true;
    },
  } as TelegramBotApiService;

  const channels = new ChannelsService(
    prisma as unknown as PrismaService,
    {} as KnowledgeV2PublicationService,
  );
  const integrations = new IntegrationsService(
    prisma as unknown as PrismaService,
    channels,
    botApi,
    {} as TelegramService,
    {} as WebhookService,
  );

  const createWorkspace = async (label: string) => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Telegram lifecycle ${label}`,
        slug: `telegram-lifecycle-${label}-${suffix}`,
        timezone: "UTC",
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `telegram-lifecycle-${label}-${suffix}@leadvirt.ai`,
        name: `Lifecycle ${label}`,
      },
    });
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    created.push({ tenantId: tenant.id, userId: user.id });
    return {
      tenant,
      context: {
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER",
        authMode: "credentials",
        tenant,
        user: {
          id: user.id,
          email: user.email,
          phone: null,
          name: user.name,
          avatarUrl: null,
          passwordChangeRequired: false,
        },
      } satisfies RequestContext,
    };
  };

  try {
    const workspace = await createWorkspace("same-workspace");
    const managerContext = { ...workspace.context, role: "MANAGER" } satisfies RequestContext;
    let managerCreateError: unknown;
    try {
      await channels.create(managerContext, {
        type: "WEBHOOK",
        settings: {
          webhook: {
            outbound: {
              targetUrl: "https://hooks.example.com/leadvirt",
              auth: { headerName: "authorization", secret: "manager-must-not-store" },
            },
          },
        },
      });
    } catch (error) {
      managerCreateError = error;
    }
    assert(
      managerCreateError instanceof ForbiddenException &&
        (await prisma.channel.count({
          where: { tenantId: workspace.tenant.id, type: "WEBHOOK", deletedAt: null },
        })) === 0,
      "Manager created a write-only outbound webhook credential through the channel endpoint.",
    );
    const webhook = await channels.create(workspace.context, {
      type: "WEBHOOK",
      settings: {
        webhook: {
          outbound: {
            targetUrl: "https://hooks.example.com/leadvirt",
            auth: { headerName: "authorization", secret: "owner-webhook-secret" },
          },
        },
      },
    });
    let managerUpdateError: unknown;
    try {
      await channels.update(managerContext, webhook.id, {
        settings: { webhook: { outbound: null } },
      });
    } catch (error) {
      managerUpdateError = error;
    }
    const storedWebhook = await prisma.channel.findUniqueOrThrow({ where: { id: webhook.id } });
    assert(
      managerUpdateError instanceof ForbiddenException &&
        JSON.stringify(storedWebhook.settings).includes("https://hooks.example.com/leadvirt") &&
        !JSON.stringify(storedWebhook.settings).includes("owner-webhook-secret") &&
        Boolean(storedWebhook.encryptedCredentials),
      "Manager changed outbound webhook authority or the write-only credential was not protected.",
    );
    let genericTelegramCreateError: unknown;
    try {
      await channels.create(workspace.context, { type: "TELEGRAM" });
    } catch (error) {
      genericTelegramCreateError = error;
    }
    assert(
      genericTelegramCreateError instanceof BadRequestException &&
        (await prisma.channel.count({
          where: { tenantId: workspace.tenant.id, type: "TELEGRAM", deletedAt: null },
        })) === 0,
      "Generic channel creation bypassed the managed Telegram webhook lifecycle.",
    );

    const firstEntered = deferred();
    const releaseFirst = deferred();
    getMeGate = { token: firstToken, entered: firstEntered.resolve, release: releaseFirst.promise };
    const firstConnect = integrations.connect(workspace.context, "TELEGRAM", {
      botToken: firstToken,
    });
    await firstEntered.promise;
    const secondGetMeBefore = calls.filter(
      (call) => call.method === "getMe" && call.token === secondToken,
    ).length;
    const secondConnect = integrations.connect(workspace.context, "TELEGRAM", {
      botToken: secondToken,
    });
    await pause(75);
    assert(
      calls.filter((call) => call.method === "getMe" && call.token === secondToken).length ===
        secondGetMeBefore,
      "A different bot escaped the same-workspace lifecycle lock.",
    );
    releaseFirst.resolve();
    const connected = await Promise.allSettled([firstConnect, secondConnect]);
    assert(
      connected.every((result) => result.status === "fulfilled"),
      "Serialized same-workspace bot replacements did not complete.",
    );
    const activeChannel = await prisma.channel.findFirstOrThrow({
      where: { tenantId: workspace.tenant.id, type: "TELEGRAM", deletedAt: null },
    });
    assert(
      activeChannel.status === "ACTIVE" &&
        activeChannel.externalId === String(botId(secondToken)) &&
        decryptIntegrationCredentials(activeChannel.encryptedCredentials!).botToken === secondToken,
      "Same-workspace replacements left an ambiguous active bot.",
    );
    assert(
      stateFor(firstToken).url === "" && stateFor(secondToken).url.length > 0,
      "Same-workspace replacement did not retire the previous remote webhook.",
    );
    let localDisableError: unknown;
    try {
      await channels.update(workspace.context, activeChannel.id, { status: "DISABLED" });
    } catch (error) {
      localDisableError = error;
    }
    const channelAfterLocalDisable = await prisma.channel.findUniqueOrThrow({
      where: { id: activeChannel.id },
    });
    assert(
      localDisableError instanceof BadRequestException &&
        channelAfterLocalDisable.status === "ACTIVE" &&
        stateFor(secondToken).url.length > 0,
      "Generic channel status bypassed Telegram remote webhook cleanup.",
    );

    const disconnectEntered = deferred();
    const releaseDisconnect = deferred();
    deleteGate = {
      token: secondToken,
      entered: disconnectEntered.resolve,
      release: releaseDisconnect.promise,
    };
    const disconnect = integrations.disconnect(workspace.context, "TELEGRAM");
    await disconnectEntered.promise;
    const remoteCallsAtDelete = calls.length;
    const test = integrations.testConnection(workspace.context, "TELEGRAM");
    await pause(75);
    assert(
      calls.length === remoteCallsAtDelete,
      "Telegram test raced remote calls against an in-progress disconnect.",
    );
    releaseDisconnect.resolve();
    const [disconnected, checked] = await Promise.all([disconnect, test]);
    assert(
      disconnected.status === "DISCONNECTED" && !checked.ok,
      "A queued Telegram test revived a completed disconnect.",
    );
    assert(
      calls.slice(remoteCallsAtDelete).every((call) => call.method === "getWebhookInfo"),
      "A post-disconnect test touched the remote bot lifecycle.",
    );
    const disconnectedChannel = await prisma.channel.findUniqueOrThrow({
      where: { id: activeChannel.id },
    });
    assert(
      disconnectedChannel.status === "DISABLED" && stateFor(secondToken).url === "",
      "Disconnect/test serialization did not preserve disabled state.",
    );

    const [workspaceA, workspaceB] = await Promise.all([
      createWorkspace("shared-a"),
      createWorkspace("shared-b"),
    ]);
    const sharedSetWebhookBefore = calls.filter(
      (call) => call.method === "setWebhook" && call.token === sharedToken,
    ).length;
    const sharedResults = await Promise.allSettled([
      integrations.connect(workspaceA.context, "TELEGRAM", { botToken: sharedToken }),
      integrations.connect(workspaceB.context, "TELEGRAM", { botToken: sharedToken }),
    ]);
    const winnerIndexes = sharedResults
      .map((result, index) => ({ result, index }))
      .filter((entry) => entry.result.status === "fulfilled")
      .map((entry) => entry.index);
    assert(winnerIndexes.length === 1, "Two workspaces claimed the same Telegram bot.");
    assert(
      calls.filter((call) => call.method === "setWebhook" && call.token === sharedToken).length ===
        sharedSetWebhookBefore + 1,
      "The losing workspace replaced the winning Telegram webhook.",
    );
    assert(
      (await prisma.channel.count({
        where: {
          type: "TELEGRAM",
          externalId: String(botId(sharedToken)),
          status: "ACTIVE",
          deletedAt: null,
        },
      })) === 1,
      "Shared-bot ownership is ambiguous after the connection race.",
    );
    const winner = winnerIndexes[0] === 0 ? workspaceA : workspaceB;
    await integrations.disconnect(winner.context, "TELEGRAM");

    console.log(`Telegram lifecycle security smoke: ${checks}/${checks} checks passed`);
  } finally {
    for (const entry of created.reverse()) {
      await prisma.tenant.delete({ where: { id: entry.tenantId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: entry.userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

void main();
