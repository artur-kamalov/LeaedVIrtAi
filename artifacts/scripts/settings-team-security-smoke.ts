import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  type ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type MembershipRole, type Tenant, type User } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import { AuthService } from "../../apps/api/src/modules/auth/auth.service.js";
import type { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { EmailOtpChallengeService } from "../../apps/api/src/modules/auth/email-otp-challenge.service.js";
import {
  EmailOtpDeliveryService,
  type SmtpTransportFactory,
} from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";
import { hashPassword, verifyPassword } from "../../apps/api/src/modules/auth/passwords.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { SettingsController } from "../../apps/api/src/modules/settings/settings.controller.js";
import { SettingsService } from "../../apps/api/src/modules/settings/settings.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFor(tenant: Tenant, user: User, role: MembershipRole): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "credentials",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
    },
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      passwordChangeRequired: user.passwordChangeRequired,
    },
  };
}

function guardContext(
  methodName: keyof SettingsController,
  role: MembershipRole,
): ExecutionContext {
  const handler = SettingsController.prototype[methodName];
  assert(typeof handler === "function", `SettingsController.${String(methodName)} is missing.`);
  return {
    getHandler: () => handler,
    getClass: () => SettingsController,
    switchToHttp: () => ({ getRequest: () => ({ leadvirtContext: { role } }) }),
  } as unknown as ExecutionContext;
}

function assertControllerForbidden(
  guard: RolesGuard,
  methodName: keyof SettingsController,
  role: MembershipRole,
) {
  let error: unknown;
  try {
    guard.canActivate(guardContext(methodName, role));
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof ForbiddenException, `${role} reached ${String(methodName)}.`);
}

async function expectException<T extends Error>(
  operation: Promise<unknown>,
  expected: abstract new (...args: never[]) => T,
  message: string,
) {
  let error: unknown;
  try {
    await operation;
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof expected, message);
}

function tokenHash(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function resetTokenFromMessage(message: Record<string, unknown>) {
  const match = String(message.text ?? "").match(/reset-password\?token=([^\s]+)/);
  assert(match?.[1], "Password reset email did not contain a tokenized reset URL.");
  return decodeURIComponent(match[1]);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const previousCredentialsAuthEnabled = process.env.AUTH_CREDENTIALS_ENABLED;
  const resetEnvironmentKeys = [
    "NODE_ENV",
    "APP_URL",
    "NEXT_PUBLIC_APP_URL",
    "EMAIL_PROVIDER",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_NAME",
    "SMTP_FROM_EMAIL",
  ] as const;
  const previousResetEnvironment = new Map(
    resetEnvironmentKeys.map((key) => [key, process.env[key]] as const),
  );
  process.env.AUTH_CREDENTIALS_ENABLED = "true";
  const settings = new SettingsService(
    prisma as unknown as PrismaService,
    {} as AuthService,
    {} as BusinessProfileService,
  );
  const smtpMessages: Array<Record<string, unknown>> = [];
  let smtpShouldFail = false;
  let smtpDeliveryStarted: (() => void) | null = null;
  let smtpDeliveryBarrier: Promise<void> | null = null;
  let smtpMessageSequence = 0;
  const smtpFactory: SmtpTransportFactory = () => ({
    sendMail: async (message) => {
      smtpMessages.push(message as unknown as Record<string, unknown>);
      if (smtpShouldFail) throw new Error("Simulated SMTP failure with provider details.");
      smtpDeliveryStarted?.();
      if (smtpDeliveryBarrier) await smtpDeliveryBarrier;
      smtpMessageSequence += 1;
      return { messageId: `auth-security-smtp-${smtpMessageSequence}` };
    },
    close: () => undefined,
  });
  const emailDelivery = new EmailOtpDeliveryService(smtpFactory);
  const auth = new AuthService(
    prisma as unknown as PrismaService,
    {} as EmailOtpChallengeService,
    emailDelivery,
  );

  try {
    const guard = new RolesGuard(new Reflector());
    for (const methodName of [
      "inviteTeamMember",
      "updateTeamMember",
      "removeTeamMember",
    ] as const) {
      assertControllerForbidden(guard, methodName, "VIEWER");
      assertControllerForbidden(guard, methodName, "AGENT");
      assertControllerForbidden(guard, methodName, "MANAGER");
      assert(guard.canActivate(guardContext(methodName, "ADMIN")), `ADMIN cannot ${methodName}.`);
      assert(guard.canActivate(guardContext(methodName, "OWNER")), `OWNER cannot ${methodName}.`);
    }
    assert(
      !("resetTeamMemberPassword" in SettingsController.prototype) &&
        !("resetTeamMemberPassword" in SettingsService.prototype),
      "The administrator-generated password reset contract still exists.",
    );

    const workspace = await prisma.tenant.create({
      data: { name: "Team Security", slug: `team-security-${suffix}` },
    });
    const victimWorkspace = await prisma.tenant.create({
      data: { name: "Victim Workspace", slug: `victim-workspace-${suffix}` },
    });
    tenantIds.push(workspace.id, victimWorkspace.id);

    const victimPassword = "Victim-original-password-42";
    const victimPasswordHash = hashPassword(victimPassword);
    const [owner, admin, viewer, agent, victim] = await Promise.all([
      prisma.user.create({
        data: { email: `owner-${suffix}@example.test`, name: "Workspace Owner" },
      }),
      prisma.user.create({
        data: { email: `admin-${suffix}@example.test`, name: "Workspace Admin" },
      }),
      prisma.user.create({
        data: { email: `viewer-${suffix}@example.test`, name: "Workspace Viewer" },
      }),
      prisma.user.create({
        data: { email: `agent-${suffix}@example.test`, name: "Workspace Agent" },
      }),
      prisma.user.create({
        data: {
          email: `victim-${suffix}@example.test`,
          name: "Victim Original Profile",
          passwordHash: victimPasswordHash,
        },
      }),
    ]);
    userIds.push(owner.id, admin.id, viewer.id, agent.id, victim.id);

    const [ownerMembership, adminMembership, viewerMembership, agentMembership] =
      await prisma.$transaction([
        prisma.membership.create({
          data: { tenantId: workspace.id, userId: owner.id, role: "OWNER" },
        }),
        prisma.membership.create({
          data: { tenantId: workspace.id, userId: admin.id, role: "ADMIN" },
        }),
        prisma.membership.create({
          data: { tenantId: workspace.id, userId: viewer.id, role: "VIEWER" },
        }),
        prisma.membership.create({
          data: { tenantId: workspace.id, userId: agent.id, role: "AGENT" },
        }),
        prisma.membership.create({
          data: { tenantId: victimWorkspace.id, userId: victim.id, role: "OWNER" },
        }),
      ]);

    const forgedViewerContext = contextFor(workspace, viewer, "OWNER");
    await expectException(
      settings.updateTeamMember(forgedViewerContext, viewerMembership.id, { role: "OWNER" }),
      ForbiddenException,
      "A VIEWER escalated by supplying a stale OWNER context.",
    );
    await expectException(
      settings.inviteTeamMember(forgedViewerContext, {
        email: `viewer-invite-${suffix}@example.test`,
        role: "OWNER",
      }),
      ForbiddenException,
      "A VIEWER invited an owner.",
    );
    await expectException(
      settings.removeTeamMember(forgedViewerContext, agentMembership.id),
      ForbiddenException,
      "A VIEWER removed a team member.",
    );
    assert(
      (await prisma.auditLog.count({ where: { tenantId: workspace.id } })) === 0,
      "A rejected VIEWER mutation wrote an audit record.",
    );

    const adminContext = contextFor(workspace, admin, "ADMIN");
    const passwordlessEmail = `passwordless-${suffix}@yandex.ru`;
    const passwordlessMembership = await settings.inviteTeamMember(adminContext, {
      email: passwordlessEmail,
      name: "Passwordless Invitee",
      role: "AGENT",
    });
    const passwordlessUser = await prisma.user.findUniqueOrThrow({
      where: { email: passwordlessEmail },
    });
    userIds.push(passwordlessUser.id);
    await expectException(
      auth.signup({
        email: passwordlessEmail,
        password: "Attacker-password-42",
        companyName: `Takeover Workspace ${suffix}`,
        name: "Attacker Name",
      }),
      ConflictException,
      "Credentials signup claimed an invited passwordless account.",
    );
    const passwordlessUserAfter = await prisma.user.findUniqueOrThrow({
      where: { id: passwordlessUser.id },
    });
    assert(
      passwordlessUserAfter.name === passwordlessUser.name &&
        passwordlessUserAfter.passwordHash === null &&
        passwordlessUserAfter.deletedAt === null &&
        passwordlessUserAfter.updatedAt.getTime() === passwordlessUser.updatedAt.getTime(),
      "Rejected credentials signup changed the invited passwordless account.",
    );
    assert(
      (await prisma.membership.count({ where: { userId: passwordlessUser.id } })) === 1 &&
        (await prisma.membership.findUnique({ where: { id: passwordlessMembership.id } }))?.role ===
          "AGENT",
      "Rejected credentials signup changed the invited account membership.",
    );
    assert(
      (await prisma.authSession.count({ where: { userId: passwordlessUser.id } })) === 0 &&
        (await prisma.auditLog.count({
          where: { actorUserId: passwordlessUser.id, action: "auth.signup" },
        })) === 0 &&
        (await prisma.tenant.count({ where: { name: `Takeover Workspace ${suffix}` } })) === 0,
      "Rejected credentials signup left authentication or workspace side effects.",
    );

    await expectException(
      settings.inviteTeamMember(adminContext, { email: victim.email, role: "OWNER" }),
      ForbiddenException,
      "An ADMIN invited an OWNER.",
    );
    const invitedVictim = await settings.inviteTeamMember(adminContext, {
      email: victim.email,
      name: "Attacker Controlled Name",
      role: "AGENT",
    });
    const victimAfterInvite = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    assert(
      victimAfterInvite.name === "Victim Original Profile" &&
        victimAfterInvite.passwordHash === victimPasswordHash &&
        victimAfterInvite.updatedAt.getTime() === victim.updatedAt.getTime() &&
        verifyPassword(victimPassword, victimAfterInvite.passwordHash),
      "Inviting an existing global user changed its profile or password.",
    );
    await expectException(
      settings.inviteTeamMember(adminContext, { email: victim.email, role: "ADMIN" }),
      ConflictException,
      "A repeated invite changed an existing membership role.",
    );
    const victimMembership = await prisma.membership.findUniqueOrThrow({
      where: { id: invitedVictim.id },
    });
    assert(victimMembership.role === "AGENT", "A repeated invite changed the member role.");

    await expectException(
      settings.updateTeamMember(adminContext, victimMembership.id, { role: "OWNER" }),
      ForbiddenException,
      "An ADMIN granted OWNER.",
    );
    await expectException(
      settings.updateTeamMember(adminContext, ownerMembership.id, { role: "ADMIN" }),
      ForbiddenException,
      "An ADMIN changed an OWNER.",
    );
    await expectException(
      settings.removeTeamMember(adminContext, ownerMembership.id),
      ForbiddenException,
      "An ADMIN removed an OWNER.",
    );
    const updatedVictim = await settings.updateTeamMember(adminContext, victimMembership.id, {
      role: "MANAGER",
    });
    assert(updatedVictim.role === "MANAGER", "An ADMIN could not manage a non-owner.");
    await settings.removeTeamMember(adminContext, agentMembership.id);
    assert(
      !(await prisma.membership.findUnique({ where: { id: agentMembership.id } })),
      "An ADMIN removal did not commit.",
    );

    const ownerContext = contextFor(workspace, owner, "OWNER");
    const promoted = await settings.updateTeamMember(ownerContext, adminMembership.id, {
      role: "OWNER",
    });
    assert(promoted.role === "OWNER", "An OWNER could not grant OWNER.");

    const signupRaceEmail = `signup-race-${suffix}@yandex.ru`;
    const signupRacePasswords = ["Signup-race-alpha-42", "Signup-race-beta-42"];
    const signupRaceResults = await Promise.allSettled(
      signupRacePasswords.map((password, index) =>
        auth.signup({
          email: signupRaceEmail,
          password,
          companyName: `Signup Race ${suffix} ${index}`,
          name: `Signup Race ${index}`,
        }),
      ),
    );
    const signupRaceUser = await prisma.user.findUnique({ where: { email: signupRaceEmail } });
    assert(signupRaceUser, "Concurrent credentials signup did not create an account.");
    userIds.push(signupRaceUser.id);
    const signupRaceMemberships = await prisma.membership.findMany({
      where: { userId: signupRaceUser.id },
      select: { tenantId: true, role: true },
    });
    tenantIds.push(...signupRaceMemberships.map((membership) => membership.tenantId));
    assert(
      signupRaceResults.filter((result) => result.status === "fulfilled").length === 1 &&
        signupRaceResults.some(
          (result) => result.status === "rejected" && result.reason instanceof ConflictException,
        ),
      "Concurrent credentials signup did not produce one success and one conflict.",
    );
    assert(
      signupRacePasswords.filter((password) =>
        verifyPassword(password, signupRaceUser.passwordHash),
      ).length === 1,
      "Concurrent credentials signup did not preserve exactly one password.",
    );
    assert(
      signupRaceMemberships.length === 1 && signupRaceMemberships[0]?.role === "OWNER",
      "Concurrent credentials signup created an incorrect membership set.",
    );
    const signupRaceTenantId = signupRaceMemberships[0]?.tenantId;
    assert(signupRaceTenantId, "Concurrent credentials signup did not create a workspace.");
    assert(
      (await prisma.onboardingState.count({ where: { tenantId: signupRaceTenantId } })) === 1 &&
        (await prisma.authSession.count({ where: { userId: signupRaceUser.id } })) === 1 &&
        (await prisma.auditLog.count({
          where: {
            tenantId: signupRaceTenantId,
            actorUserId: signupRaceUser.id,
            action: "auth.signup",
          },
        })) === 1,
      "Concurrent credentials signup created duplicate or incomplete account state.",
    );

    const ownerRace = await prisma.tenant.create({
      data: { name: "Owner Race", slug: `owner-race-${suffix}` },
    });
    tenantIds.push(ownerRace.id);
    const [raceOwnerA, raceOwnerB] = await Promise.all([
      prisma.user.create({ data: { email: `race-a-${suffix}@example.test` } }),
      prisma.user.create({ data: { email: `race-b-${suffix}@example.test` } }),
    ]);
    userIds.push(raceOwnerA.id, raceOwnerB.id);
    const [raceMembershipA, raceMembershipB] = await prisma.$transaction([
      prisma.membership.create({
        data: { tenantId: ownerRace.id, userId: raceOwnerA.id, role: "OWNER" },
      }),
      prisma.membership.create({
        data: { tenantId: ownerRace.id, userId: raceOwnerB.id, role: "OWNER" },
      }),
    ]);
    const ownerRaceResults = await Promise.allSettled([
      settings.updateTeamMember(contextFor(ownerRace, raceOwnerA, "OWNER"), raceMembershipA.id, {
        role: "ADMIN",
      }),
      settings.updateTeamMember(contextFor(ownerRace, raceOwnerB, "OWNER"), raceMembershipB.id, {
        role: "ADMIN",
      }),
    ]);
    assert(
      ownerRaceResults.filter((result) => result.status === "fulfilled").length === 1 &&
        ownerRaceResults.some(
          (result) => result.status === "rejected" && result.reason instanceof BadRequestException,
        ),
      "Concurrent owner demotions did not allow exactly one safe change.",
    );
    assert(
      (await prisma.membership.count({ where: { tenantId: ownerRace.id, role: "OWNER" } })) === 1,
      "Concurrent owner demotions removed the final owner.",
    );

    const resetWorkspace = await prisma.tenant.create({
      data: { name: "Reset Race", slug: `reset-race-${suffix}` },
    });
    const resetUser = await prisma.user.create({
      data: {
        email: `reset-${suffix}@example.test`,
        name: "Reset User",
        passwordHash: hashPassword("Old-password-42"),
      },
    });
    tenantIds.push(resetWorkspace.id);
    userIds.push(resetUser.id);
    await prisma.membership.create({
      data: { tenantId: resetWorkspace.id, userId: resetUser.id, role: "OWNER" },
    });
    await prisma.authSession.create({
      data: {
        userId: resetUser.id,
        tenantId: resetWorkspace.id,
        tokenHash: tokenHash(`session-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://leadvirt.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://leadvirt.com";
    for (const unsupportedProvider of ["mock", "manual", "unsupported"]) {
      process.env.EMAIL_PROVIDER = unsupportedProvider;
      await expectException(
        auth.requestPasswordReset({ email: resetUser.email }),
        ServiceUnavailableException,
        `Production ${unsupportedProvider} reset delivery did not fail closed.`,
      );
    }
    assert(
      (await prisma.authPasswordResetToken.count({ where: { userId: resetUser.id } })) === 0,
      "An unsupported production reset provider created a token.",
    );

    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    process.env.SMTP_USER = "noreply@example.test";
    process.env.SMTP_FROM_NAME = "LeadVirt.ai";
    process.env.SMTP_FROM_EMAIL = "noreply@example.test";
    smtpShouldFail = false;
    smtpMessages.length = 0;

    delete process.env.SMTP_PASSWORD;
    await expectException(
      auth.requestPasswordReset({ email: resetUser.email }),
      ServiceUnavailableException,
      "Incomplete production SMTP reset delivery did not fail closed.",
    );
    assert(
      smtpMessages.length === 0 &&
        (await prisma.authPasswordResetToken.count({ where: { userId: resetUser.id } })) === 0,
      "Incomplete production SMTP configuration attempted delivery or created a token.",
    );
    process.env.SMTP_PASSWORD = "smtp-test-secret";

    for (const invalidAppUrl of [
      "http://leadvirt.com",
      "https://operator:secret@leadvirt.com",
      "https://leadvirt.com/reset",
      "https://leadvirt.com?source=invalid",
      "https://leadvirt.com#invalid",
      "https://wrong.example",
    ]) {
      process.env.APP_URL = invalidAppUrl;
      await expectException(
        auth.requestPasswordReset({ email: resetUser.email }),
        ServiceUnavailableException,
        `Unsafe production reset origin ${invalidAppUrl} was accepted.`,
      );
    }
    assert(
      smtpMessages.length === 0 &&
        (await prisma.authPasswordResetToken.count({ where: { userId: resetUser.id } })) === 0,
      "Unsafe production reset origins attempted delivery or created a token.",
    );
    process.env.APP_URL = "https://leadvirt.com";

    const originalConsoleLog = console.log;
    const productionResetLogs: string[] = [];
    console.log = (...values: unknown[]) => {
      productionResetLogs.push(values.map(String).join(" "));
    };
    let resetRequest: Awaited<ReturnType<AuthService["requestPasswordReset"]>>;
    try {
      resetRequest = await auth.requestPasswordReset(
        { email: resetUser.email },
        { ipAddress: "203.0.113.10", userAgent: "auth-security-smoke" },
      );
    } finally {
      console.log = originalConsoleLog;
    }

    assert(
      resetRequest.sent &&
        resetRequest.deliveryMode === "smtp" &&
        !("resetUrl" in resetRequest) &&
        !("expiresAt" in resetRequest),
      "Production password reset exposed token-bearing response fields.",
    );
    assert(
      productionResetLogs.every((entry) => !entry.includes("reset-password?token=")),
      "Production password reset logged its reset URL.",
    );
    assert(smtpMessages.length === 1, "Production password reset did not send exactly one email.");
    const resetMessage = smtpMessages[0]!;
    const initialResetToken = resetTokenFromMessage(resetMessage);
    assert(
      String(resetMessage.to) === resetUser.email &&
        String(resetMessage.html).includes("https://leadvirt.com/reset-password?token=") &&
        JSON.stringify(resetMessage.headers) ===
          JSON.stringify({ "X-LeadVirt-Purpose": "password_reset" }),
      "Production password reset sent an incorrect SMTP message.",
    );
    const deliveredResetToken = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(initialResetToken) },
    });
    assert(
      deliveredResetToken.userId === resetUser.id &&
        deliveredResetToken.deliveryMode === "smtp" &&
        deliveredResetToken.usedAt === null,
      "A delivered reset token was not activated correctly.",
    );

    smtpMessages.length = 0;
    let releaseSmtpDelivery!: () => void;
    let markSmtpDeliveryStarted!: () => void;
    const smtpStarted = new Promise<void>((resolve) => {
      markSmtpDeliveryStarted = resolve;
    });
    smtpDeliveryBarrier = new Promise<void>((resolve) => {
      releaseSmtpDelivery = resolve;
    });
    smtpDeliveryStarted = markSmtpDeliveryStarted;
    const inFlightResetRequest = auth.requestPasswordReset({ email: resetUser.email });
    await smtpStarted;
    assert(smtpMessages.length === 1, "The in-flight reset did not reach SMTP delivery.");
    const staleResetToken = resetTokenFromMessage(smtpMessages[0]!);
    const stagedResetRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(staleResetToken) },
    });
    assert(
      stagedResetRecord.usedAt !== null,
      "An in-flight reset token was usable before delivery.",
    );

    await auth.confirmPasswordReset({
      token: initialResetToken,
      newPassword: "Delivery-race-password-42",
    });
    releaseSmtpDelivery();
    const staleResetResponse = await inFlightResetRequest;
    smtpDeliveryBarrier = null;
    smtpDeliveryStarted = null;
    assert(
      staleResetResponse.sent &&
        staleResetResponse.deliveryMode === "smtp" &&
        !("resetUrl" in staleResetResponse),
      "A stale in-flight reset did not preserve the generic production response.",
    );
    const staleResetRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(staleResetToken) },
    });
    assert(staleResetRecord.usedAt !== null, "A reset activated after password reset completion.");
    await expectException(
      auth.confirmPasswordReset({
        token: staleResetToken,
        newPassword: "Stale-delivery-must-not-win-42",
      }),
      UnauthorizedException,
      "A reset delivered before credential revalidation was accepted.",
    );

    smtpMessages.length = 0;
    const concurrentResetRequests = await Promise.all([
      auth.requestPasswordReset({ email: resetUser.email }),
      auth.requestPasswordReset({ email: resetUser.email }),
    ]);
    assert(
      concurrentResetRequests.every(
        (request) => request.deliveryMode === "smtp" && !("resetUrl" in request),
      ) && smtpMessages.length === 2,
      "Concurrent production reset requests did not each deliver without exposing a URL.",
    );
    const concurrentResetTokens = smtpMessages.map(resetTokenFromMessage);
    const concurrentTokenHashes = concurrentResetTokens.map(tokenHash);
    const activeResetTokens = await prisma.authPasswordResetToken.findMany({
      where: {
        userId: resetUser.id,
        usedAt: null,
      },
      select: { tokenHash: true },
    });
    assert(
      activeResetTokens.length === 1 &&
        concurrentTokenHashes.includes(activeResetTokens[0]!.tokenHash),
      "Concurrent delivered resets left more than one active token.",
    );
    const resetToken = concurrentResetTokens.find(
      (candidate) => tokenHash(candidate) === activeResetTokens[0]!.tokenHash,
    );
    assert(resetToken, "The active concurrent reset token was not delivered by SMTP.");

    const candidatePasswords = ["Concurrent-password-alpha-42", "Concurrent-password-beta-42"];
    const resetResults = await Promise.allSettled(
      candidatePasswords.map((newPassword) =>
        auth.confirmPasswordReset({ token: resetToken, newPassword }),
      ),
    );
    const winner = resetResults.findIndex((result) => result.status === "fulfilled");
    assert(
      winner >= 0 &&
        resetResults.filter((result) => result.status === "fulfilled").length === 1 &&
        resetResults.some(
          (result) =>
            result.status === "rejected" && result.reason instanceof UnauthorizedException,
        ),
      "One reset token was accepted more or less than once.",
    );
    const resetUserAfter = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
    assert(
      verifyPassword(candidatePasswords[winner]!, resetUserAfter.passwordHash) &&
        !verifyPassword(candidatePasswords[1 - winner]!, resetUserAfter.passwordHash),
      "The losing concurrent reset changed the password.",
    );
    assert(
      (await prisma.authSession.count({
        where: { userId: resetUser.id, revokedAt: { not: null } },
      })) === 1,
      "The successful password reset did not revoke sessions.",
    );
    assert(
      (await prisma.auditLog.count({
        where: { tenantId: resetWorkspace.id, action: "auth.password_reset_completed" },
      })) === 2,
      "Concurrent password reset wrote an incorrect number of completion audits.",
    );
    assert(
      (await prisma.auditLog.count({
        where: { tenantId: resetWorkspace.id, action: "auth.password_reset_requested" },
      })) === 3,
      "Delivered password reset wrote an incorrect number of request audits.",
    );

    smtpMessages.length = 0;
    let releasePasswordChangeDelivery!: () => void;
    let markPasswordChangeDeliveryStarted!: () => void;
    const passwordChangeDeliveryStarted = new Promise<void>((resolve) => {
      markPasswordChangeDeliveryStarted = resolve;
    });
    smtpDeliveryBarrier = new Promise<void>((resolve) => {
      releasePasswordChangeDelivery = resolve;
    });
    smtpDeliveryStarted = markPasswordChangeDeliveryStarted;
    const resetDuringPasswordChange = auth.requestPasswordReset({ email: resetUser.email });
    await passwordChangeDeliveryStarted;
    assert(smtpMessages.length === 1, "The password-change reset did not reach SMTP delivery.");
    const passwordChangeStaleToken = resetTokenFromMessage(smtpMessages[0]!);
    await auth.changePassword(contextFor(resetWorkspace, resetUser, "OWNER"), {
      currentPassword: candidatePasswords[winner]!,
      newPassword: "Authenticated-change-password-42",
    });
    releasePasswordChangeDelivery();
    const passwordChangeStaleResponse = await resetDuringPasswordChange;
    smtpDeliveryBarrier = null;
    smtpDeliveryStarted = null;
    assert(
      passwordChangeStaleResponse.sent &&
        passwordChangeStaleResponse.deliveryMode === "smtp" &&
        !("resetUrl" in passwordChangeStaleResponse),
      "A reset superseded by authenticated password change lost the generic response.",
    );
    const passwordChangeStaleRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(passwordChangeStaleToken) },
    });
    assert(
      passwordChangeStaleRecord.usedAt !== null,
      "A reset activated after authenticated password change completion.",
    );
    await expectException(
      auth.confirmPasswordReset({
        token: passwordChangeStaleToken,
        newPassword: "Stale-authenticated-change-must-not-win-42",
      }),
      UnauthorizedException,
      "A reset delivered before authenticated password-change revalidation was accepted.",
    );

    smtpMessages.length = 0;
    const auditFailurePrisma = new Proxy(prisma, {
      get(target, property) {
        if (property === "auditLog") {
          return new Proxy(target.auditLog, {
            get(delegate, delegateProperty) {
              if (delegateProperty === "create") {
                return async () => {
                  throw new Error("Simulated audit storage failure with database details.");
                };
              }
              const value = Reflect.get(delegate, delegateProperty, delegate);
              return typeof value === "function" ? value.bind(delegate) : value;
            },
          });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const auditFailureAuth = new AuthService(
      auditFailurePrisma as unknown as PrismaService,
      {} as EmailOtpChallengeService,
      emailDelivery,
    );
    const originalConsoleError = console.error;
    const auditFailureLogs: string[] = [];
    console.error = (...values: unknown[]) => {
      auditFailureLogs.push(values.map(String).join(" "));
    };
    let auditFailureResponse: Awaited<ReturnType<AuthService["requestPasswordReset"]>>;
    try {
      auditFailureResponse = await auditFailureAuth.requestPasswordReset({
        email: resetUser.email,
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert(
      auditFailureResponse.sent &&
        auditFailureResponse.deliveryMode === "smtp" &&
        !("resetUrl" in auditFailureResponse) &&
        smtpMessages.length === 1,
      "An audit outage changed the accepted reset delivery response.",
    );
    const auditFailureToken = resetTokenFromMessage(smtpMessages[0]!);
    const auditFailureRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(auditFailureToken) },
    });
    assert(
      auditFailureRecord.usedAt === null,
      "Audit failure invalidated a delivered reset token.",
    );
    assert(
      auditFailureLogs.length === 1 &&
        auditFailureLogs.every(
          (entry) =>
            !entry.includes("reset-password?token=") &&
            !entry.includes("Simulated audit storage failure with database details."),
        ),
      "Reset audit failure logging exposed the reset URL or database details.",
    );

    smtpShouldFail = true;
    smtpMessages.length = 0;
    const failedDeliveryLogs: string[] = [];
    console.error = (...values: unknown[]) => {
      failedDeliveryLogs.push(values.map(String).join(" "));
    };
    let failedResetResponse: Awaited<ReturnType<AuthService["requestPasswordReset"]>>;
    try {
      failedResetResponse = await auth.requestPasswordReset({ email: resetUser.email });
    } finally {
      console.error = originalConsoleError;
    }
    const unknownResetResponse = await auth.requestPasswordReset({
      email: `missing-reset-${suffix}@example.com`,
    });
    assert(
      JSON.stringify(failedResetResponse) === JSON.stringify(unknownResetResponse) &&
        !("resetUrl" in failedResetResponse),
      "Provider failure and an unknown account produced distinguishable response bodies.",
    );
    assert(smtpMessages.length === 1, "The failing SMTP reset did not attempt delivery once.");
    assert(
      failedDeliveryLogs.every(
        (entry) =>
          !entry.includes("reset-password?token=") &&
          !entry.includes("Simulated SMTP failure with provider details."),
      ),
      "Failed reset delivery logged a reset URL or provider details.",
    );
    const failedResetToken = resetTokenFromMessage(smtpMessages[0]!);
    const failedResetRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(failedResetToken) },
    });
    assert(failedResetRecord.usedAt !== null, "A failed SMTP delivery left a usable reset token.");
    await expectException(
      auth.confirmPasswordReset({
        token: failedResetToken,
        newPassword: "Failed-delivery-must-not-win-42",
      }),
      UnauthorizedException,
      "A reset token from failed delivery was accepted.",
    );
    assert(
      (await prisma.auditLog.count({
        where: { tenantId: resetWorkspace.id, action: "auth.password_reset_requested" },
      })) === 3,
      "Failed password reset delivery wrote a successful request audit.",
    );

    process.env.NODE_ENV = "development";
    process.env.EMAIL_PROVIDER = "mock";
    const mockResetLogs: string[] = [];
    console.log = (...values: unknown[]) => {
      mockResetLogs.push(values.map(String).join(" "));
    };
    let mockReset: Awaited<ReturnType<AuthService["requestPasswordReset"]>>;
    try {
      mockReset = await auth.requestPasswordReset({ email: resetUser.email });
    } finally {
      console.log = originalConsoleLog;
    }
    assert(
      "resetUrl" in mockReset &&
        typeof mockReset.resetUrl === "string" &&
        "expiresAt" in mockReset &&
        mockReset.deliveryMode === "mock",
      "Development mock reset URL behavior was not preserved.",
    );
    assert(
      mockResetLogs.some((entry) => entry.includes(mockReset.resetUrl)),
      "Development mock reset delivery did not log its QA URL.",
    );
    const mockResetToken = new URL(mockReset.resetUrl).searchParams.get("token");
    assert(mockResetToken, "Development mock reset URL did not contain a token.");
    const mockResetRecord = await prisma.authPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(mockResetToken) },
    });
    assert(mockResetRecord.usedAt === null, "Development mock reset token was not activated.");

    console.log(
      JSON.stringify({
        ok: true,
        viewerEscalationBlocked: true,
        crossTenantAccountPreserved: true,
        passwordlessSignupTakeoverBlocked: true,
        concurrentSignupSerialized: true,
        ownerBoundaryEnforced: true,
        finalOwnerPreserved: true,
        resetDeliveryFailClosed: true,
        failedResetTokenInvalidated: true,
        failedResetResponseGeneric: true,
        productionResetUrlHidden: true,
        developmentMockResetPreserved: true,
        concurrentResetActivationSerialized: true,
        inFlightResetActivationBlocked: true,
        inFlightResetAfterPasswordChangeBlocked: true,
        auditFailureDoesNotInvalidateDeliveredReset: true,
        resetTokenSingleUse: true,
      }),
    );
  } finally {
    if (tenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (previousCredentialsAuthEnabled === undefined) {
      delete process.env.AUTH_CREDENTIALS_ENABLED;
    } else {
      process.env.AUTH_CREDENTIALS_ENABLED = previousCredentialsAuthEnabled;
    }
    for (const [key, value] of previousResetEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
