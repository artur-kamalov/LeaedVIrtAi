import { Prisma } from "@leadvirt/db";
import type { PrismaService } from "../modules/database/prisma.service.js";

export type TelegramBotLifecycleLock = (
  botIds: ReadonlyArray<string | number | null | undefined>,
) => Promise<void>;

function normalizeTelegramBotId(value: string | number | null | undefined) {
  const candidate = typeof value === "number" ? String(value) : value?.trim();
  if (!candidate || !/^[1-9]\d*$/u.test(candidate)) return null;
  return candidate;
}

async function lockTelegramLifecycleKey(tx: Prisma.TransactionClient, lockKey: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT TRUE AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
  `);
}

export function withTelegramLifecycleLock<T>(
  prisma: PrismaService,
  tenantId: string,
  operation: (lockBotIdentities: TelegramBotLifecycleLock) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await lockTelegramLifecycleKey(tx, `telegram-lifecycle:workspace:${tenantId}`);
      let botLocksAcquired = false;
      const lockBotIdentities: TelegramBotLifecycleLock = async (botIds) => {
        if (botLocksAcquired) {
          throw new Error("Telegram bot lifecycle locks were already acquired.");
        }
        botLocksAcquired = true;
        const lockKeys = [
          ...new Set(
            botIds
              .map(normalizeTelegramBotId)
              .filter((botId): botId is string => botId !== null)
              .map((botId) => `telegram-lifecycle:bot:${botId}`),
          ),
        ].sort();
        for (const lockKey of lockKeys) await lockTelegramLifecycleKey(tx, lockKey);
      };
      return operation(lockBotIdentities);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}
