import { PrismaClient } from "@prisma/client";
export * from "./tenant-transaction.js";

const globalForPrisma = globalThis as unknown as {
  leadvirtPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.leadvirtPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.leadvirtPrisma = prisma;
}

export * from "@prisma/client";
