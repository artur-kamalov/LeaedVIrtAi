import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import { PrismaService } from "../database/prisma.service.js";
import { emailOtpLocales, type EmailOtpLocale, type RequestEmailOtpDto } from "./dto/request-email-otp.dto.js";
import type { VerifyEmailOtpDto } from "./dto/verify-email-otp.dto.js";
import { EmailOtpDeliveryService } from "./email-otp-delivery.service.js";

const ttlMs = 10 * 60 * 1000;
const resendMs = 60 * 1000;
const maxAttempts = 5;
const codeLength = 6;

export type VerifiedEmailOtpChallenge = {
  id: string;
  email: string;
  deliveryMode: string;
  locale: EmailOtpLocale;
  verifiedAt: Date;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeLocale(value: string | undefined): EmailOtpLocale {
  return emailOtpLocales.includes(value as EmailOtpLocale) ? (value as EmailOtpLocale) : "en";
}

function pepper() {
  const configured = process.env.AUTH_EMAIL_OTP_PEPPER?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new ServiceUnavailableException("Email sign-in is not configured.");
  }
  return "leadvirt-local-email-otp-pepper";
}

function pepperReady() {
  const configured = process.env.AUTH_EMAIL_OTP_PEPPER?.trim() ?? "";
  return process.env.NODE_ENV !== "production" || configured.length >= 32;
}

function codeHash(challengeId: string, email: string, code: string) {
  return createHmac("sha256", pepper()).update(`${challengeId}:${email}:${code}`).digest("hex");
}

function equalHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class EmailOtpChallengeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOtpDeliveryService) private readonly delivery: EmailOtpDeliveryService,
  ) {}

  config() {
    const delivery = this.delivery.config();
    return {
      enabled: delivery.enabled && pepperReady(),
      codeLength,
      resendAfterSeconds: resendMs / 1000,
    };
  }

  async request(dto: RequestEmailOtpDto) {
    const config = this.config();
    if (!config.enabled) {
      throw new ServiceUnavailableException("Email sign-in is not configured.");
    }

    const email = normalizeEmail(dto.email);
    const locale = normalizeLocale(dto.locale);
    const now = new Date();
    const challengeId = randomBytes(24).toString("hex");
    const code = randomInt(0, 10 ** codeLength).toString().padStart(codeLength, "0");
    const expiresAt = new Date(now.getTime() + ttlMs);
    const deliveryMode = this.delivery.deliveryMode();

    await this.prisma.authEmailOtpChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-otp:${email}`})::bigint)`;
      const latest = await tx.authEmailOtpChallenge.findFirst({
        where: {
          email,
          OR: [{ consumedAt: null }, { providerMessageId: { not: null } }],
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const retryAfterMs = latest ? resendMs - (now.getTime() - latest.createdAt.getTime()) : 0;
      if (retryAfterMs > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: "Please wait before requesting another code.",
            retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await tx.authEmailOtpChallenge.create({
        data: {
          id: challengeId,
          email,
          codeHash: codeHash(challengeId, email, code),
          deliveryMode,
          locale,
          expiresAt,
        },
      });
    });

    let providerMessageId: string;
    try {
      const result = await this.delivery.send({ challengeId, email, code, locale });
      providerMessageId = result.providerMessageId;
    } catch (error) {
      await this.prisma.authEmailOtpChallenge.updateMany({
        where: { id: challengeId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw error;
    }

    await this.prisma.$transaction([
      this.prisma.authEmailOtpChallenge.updateMany({
        where: { email, id: { not: challengeId }, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authEmailOtpChallenge.update({
        where: { id: challengeId },
        data: { providerMessageId },
      }),
    ]);

    return {
      sent: true,
      challengeId,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: config.resendAfterSeconds,
      ...(this.delivery.canExposeCode() ? { debugCode: code } : {}),
    };
  }

  async verify(dto: VerifyEmailOtpDto): Promise<VerifiedEmailOtpChallenge> {
    if (!this.config().enabled) {
      throw new ServiceUnavailableException("Email sign-in is not configured.");
    }

    const verifiedAt = new Date();
    const challenge = await this.prisma.authEmailOtpChallenge.findUnique({
      where: { id: dto.challengeId },
      select: {
        id: true,
        email: true,
        codeHash: true,
        deliveryMode: true,
        locale: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= verifiedAt || challenge.attempts >= maxAttempts) {
      throw new UnauthorizedException("Email code is invalid or expired.");
    }

    if (!equalHex(codeHash(challenge.id, challenge.email, dto.code), challenge.codeHash)) {
      const nextAttempts = challenge.attempts + 1;
      await this.prisma.authEmailOtpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: {
          attempts: { increment: 1 },
          ...(nextAttempts >= maxAttempts ? { consumedAt: verifiedAt } : {}),
        },
      });
      throw new UnauthorizedException("Email code is invalid or expired.");
    }

    return {
      id: challenge.id,
      email: challenge.email,
      deliveryMode: challenge.deliveryMode,
      locale: normalizeLocale(challenge.locale),
      verifiedAt,
    };
  }

  async consume(tx: Prisma.TransactionClient, challenge: VerifiedEmailOtpChallenge) {
    const consumed = await tx.authEmailOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: challenge.verifiedAt },
        attempts: { lt: maxAttempts },
      },
      data: { attempts: { increment: 1 }, consumedAt: challenge.verifiedAt },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException("Email code is invalid or expired.");
    }
  }
}
