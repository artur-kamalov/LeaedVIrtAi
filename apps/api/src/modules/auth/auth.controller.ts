import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { isIP } from "node:net";
import type { Request, Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { AuthService } from "./auth.service.js";
import { TelegramAuthDto } from "./dto/telegram-auth.dto.js";
import { TelegramOidcAuthDto } from "./dto/telegram-oidc-auth.dto.js";
import { WorkspaceAuthGuard } from "./workspace-auth.guard.js";
import { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RequestPasswordResetDto } from "./dto/request-password-reset.dto.js";
import { SignupDto } from "./dto/signup.dto.js";
import { RequestEmailOtpDto } from "./dto/request-email-otp.dto.js";
import { VerifyEmailOtpDto } from "./dto/verify-email-otp.dto.js";

function stringHeader(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function validIp(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && isIP(normalized) ? normalized : undefined;
}

function lastForwardedIp(value: string | undefined) {
  const addresses = value?.split(",") ?? [];
  for (let index = addresses.length - 1; index >= 0; index -= 1) {
    const address = validIp(addresses[index]);
    if (address) return address;
  }
  return undefined;
}

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuthRateLimitService) private readonly rateLimit: AuthRateLimitService
  ) {}

  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limit(request, "login", dto.email, 30, 10 * 60_000);
    const result = await this.authService.login(dto, this.metaFromRequest(request));
    this.authService.setSessionCookie(response, result.token);
    return { data: result.data };
  }

  @Post("auth/signup")
  @HttpCode(200)
  async signup(@Body() dto: SignupDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limit(request, "signup", dto.email, 12, 60 * 60_000);
    const result = await this.authService.signup(dto, this.metaFromRequest(request));
    this.authService.setSessionCookie(response, result.token);
    return { data: result.data };
  }

  @Post("auth/telegram")
  @HttpCode(200)
  async telegram(@Body() dto: TelegramAuthDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limit(request, "telegram", String(dto.id), 30, 10 * 60_000);
    const result = await this.authService.loginWithTelegram(dto, this.metaFromRequest(request));
    this.authService.setSessionCookie(response, result.token);
    return { data: result.data };
  }

  @Post("auth/telegram/oidc")
  @HttpCode(200)
  async telegramOidc(@Body() dto: TelegramOidcAuthDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limit(request, "telegram-oidc", dto.idToken.slice(0, 24), 30, 10 * 60_000);
    const result = await this.authService.loginWithTelegramOidc(dto, this.metaFromRequest(request));
    this.authService.setSessionCookie(response, result.token);
    return { data: result.data };
  }

  @Get("auth/telegram/config")
  telegramConfig() {
    return { data: this.authService.telegramLoginConfig() };
  }

  @Get("auth/email-otp/config")
  emailOtpConfig() {
    return { data: this.authService.emailOtpConfig() };
  }

  @Post("auth/email-otp/request")
  @HttpCode(200)
  async requestEmailOtp(@Body() dto: RequestEmailOtpDto, @Req() request: Request) {
    this.limit(request, "email-otp-request-ip", "all", 20, 10 * 60_000);
    this.limit(request, "email-otp-request-minute", dto.email, 1, 60_000);
    this.limit(request, "email-otp-request-hour", dto.email, 6, 60 * 60_000);
    return { data: await this.authService.requestEmailOtp(dto) };
  }

  @Post("auth/email-otp/verify")
  @HttpCode(200)
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limit(request, "email-otp-verify", dto.challengeId, 12, 10 * 60_000);
    const result = await this.authService.verifyEmailOtp(dto, this.metaFromRequest(request));
    this.authService.setSessionCookie(response, result.token);
    return { data: result.data };
  }

  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.logout(this.authService.readSessionToken(request));
    this.authService.clearSessionCookie(response);
    return { data: result };
  }

  @Post("auth/password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() request: Request) {
    this.limit(request, "password-reset-request", dto.email, 8, 60 * 60_000);
    return { data: await this.authService.requestPasswordReset(dto, this.metaFromRequest(request)) };
  }

  @Post("auth/password-reset/confirm")
  @HttpCode(200)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto, @Req() request: Request) {
    this.limit(request, "password-reset-confirm", dto.token.slice(0, 16), 20, 60 * 60_000);
    return { data: await this.authService.confirmPasswordReset(dto, this.metaFromRequest(request)) };
  }

  @Get("me")
  @UseGuards(WorkspaceAuthGuard)
  me(@CurrentContext() context: RequestContext) {
    return {
      data: {
        ...context.user,
        role: context.role,
        tenantId: context.tenantId,
        authMode: context.authMode
      }
    };
  }

  @Get("auth/me")
  @UseGuards(WorkspaceAuthGuard)
  authMe(@CurrentContext() context: RequestContext) {
    return this.me(context);
  }

  private metaFromRequest(request: Request) {
    const forwardedFor = stringHeader(request.headers["x-forwarded-for"]);
    const realIp = validIp(stringHeader(request.headers["x-real-ip"]));
    const ipAddress = realIp ?? lastForwardedIp(forwardedFor) ?? request.ip;
    const userAgent = stringHeader(request.headers["user-agent"]);
    return {
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {})
    };
  }

  private limit(request: Request, scope: string, subject: string, limit: number, windowMs: number) {
    if (process.env.NODE_ENV !== "production" && stringHeader(request.headers["x-leadvirt-qa"]) === "playwright") {
      return;
    }

    const meta = this.metaFromRequest(request);
    const ipAddress = meta.ipAddress ?? "unknown-ip";
    const normalizedSubject = subject.trim().toLowerCase();
    this.rateLimit.assert({
      key: `${scope}:${ipAddress}:${normalizedSubject}`,
      limit,
      windowMs,
      message: "Too many auth attempts. Please wait before trying again."
    });
  }
}

