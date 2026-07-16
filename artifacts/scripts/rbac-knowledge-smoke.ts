import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@leadvirt/db";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeController } from "../../apps/api/src/modules/knowledge/knowledge.controller.js";
import { OnboardingController } from "../../apps/api/src/modules/onboarding/onboarding.controller.js";
import { SettingsController } from "../../apps/api/src/modules/settings/settings.controller.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requestContext(role: MembershipRole): RequestContext {
  return {
    tenantId: "tenant_rbac_smoke",
    userId: "user_rbac_smoke",
    role,
    authMode: "credentials",
    tenant: {
      id: "tenant_rbac_smoke",
      name: "RBAC Smoke",
      slug: "rbac-smoke",
      status: "TRIALING",
      businessType: null,
      timezone: "UTC",
    },
    user: {
      id: "user_rbac_smoke",
      email: "rbac-smoke@leadvirt.ai",
      phone: null,
      name: "RBAC Smoke",
      avatarUrl: null,
      passwordChangeRequired: false,
    },
  };
}

function executionContext(
  handler: Function,
  role: MembershipRole,
  controller: Function = KnowledgeController,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ leadvirtContext: requestContext(role) }),
    }),
  } as unknown as ExecutionContext;
}

function controllerCanActivate(
  guard: RolesGuard,
  controller: { prototype: Record<string, unknown> },
  methodName: string,
  role: MembershipRole,
) {
  const handler = controller.prototype[methodName];
  assert(typeof handler === "function", `Missing controller method ${methodName}.`);
  return guard.canActivate(executionContext(handler, role, controller as unknown as Function));
}

function assertControllerForbidden(
  guard: RolesGuard,
  controller: { prototype: Record<string, unknown> },
  methodName: string,
  role: MembershipRole,
) {
  let forbidden = false;
  try {
    controllerCanActivate(guard, controller, methodName, role);
  } catch (error) {
    forbidden = error instanceof ForbiddenException;
  }
  assert(forbidden, `Expected ${role} to be forbidden for ${methodName}.`);
}

function canActivate(
  guard: RolesGuard,
  methodName: keyof KnowledgeController,
  role: MembershipRole,
) {
  const handler = KnowledgeController.prototype[methodName];
  assert(typeof handler === "function", `Missing controller method ${String(methodName)}.`);
  return guard.canActivate(executionContext(handler, role));
}

function assertForbidden(
  guard: RolesGuard,
  methodName: keyof KnowledgeController,
  role: MembershipRole,
) {
  let forbidden = false;
  try {
    canActivate(guard, methodName, role);
  } catch (error) {
    forbidden = error instanceof ForbiddenException;
  }
  assert(forbidden, `Expected ${role} to be forbidden for ${String(methodName)}.`);
}

const guard = new RolesGuard(new Reflector());
assert(
  canActivate(guard, "list", "VIEWER") === true,
  "Expected VIEWER to read via list.",
);

for (const role of ["OWNER", "ADMIN", "MANAGER", "AGENT"] as MembershipRole[]) {
  assert(
    canActivate(guard, "search", role) === true,
    `Expected ${role} to run knowledge diagnostics.`,
  );
}
assertForbidden(guard, "search", "VIEWER");

for (const methodName of ["create", "reindex", "update", "archive"] as Array<
  keyof KnowledgeController
>) {
  assert(
    canActivate(guard, methodName, "MANAGER") === true,
    `Expected MANAGER to write via ${String(methodName)}.`,
  );
  assertForbidden(guard, methodName, "VIEWER");
  assertForbidden(guard, methodName, "AGENT");
}

for (const [controller, methodName] of [
  [OnboardingController, "update"],
  [OnboardingController, "completeStep"],
  [SettingsController, "updateAccount"],
] as const) {
  assert(
    controllerCanActivate(guard, controller, methodName, "MANAGER") === true,
    `Expected MANAGER to write via ${methodName}.`,
  );
  assertControllerForbidden(guard, controller, methodName, "VIEWER");
  assertControllerForbidden(guard, controller, methodName, "AGENT");
}

assert(
  controllerCanActivate(guard, OnboardingController, "state", "VIEWER") === true,
  "Expected VIEWER to read onboarding state.",
);
assert(
  controllerCanActivate(guard, SettingsController, "account", "VIEWER") === true,
  "Expected VIEWER to read account settings.",
);

console.log(JSON.stringify({ ok: true }));
