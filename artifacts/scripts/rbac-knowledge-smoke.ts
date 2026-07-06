import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@leadvirt/db";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeController } from "../../apps/api/src/modules/knowledge/knowledge.controller.js";

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
      timezone: "UTC"
    },
    user: {
      id: "user_rbac_smoke",
      email: "rbac-smoke@leadvirt.ai",
      phone: null,
      name: "RBAC Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

function executionContext(handler: Function, role: MembershipRole): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => KnowledgeController,
    switchToHttp: () => ({
      getRequest: () => ({ leadvirtContext: requestContext(role) })
    })
  } as unknown as ExecutionContext;
}

function canActivate(guard: RolesGuard, methodName: keyof KnowledgeController, role: MembershipRole) {
  const handler = KnowledgeController.prototype[methodName];
  assert(typeof handler === "function", `Missing controller method ${String(methodName)}.`);
  return guard.canActivate(executionContext(handler, role));
}

function assertForbidden(guard: RolesGuard, methodName: keyof KnowledgeController, role: MembershipRole) {
  let forbidden = false;
  try {
    canActivate(guard, methodName, role);
  } catch (error) {
    forbidden = error instanceof ForbiddenException;
  }
  assert(forbidden, `Expected ${role} to be forbidden for ${String(methodName)}.`);
}

const guard = new RolesGuard(new Reflector());
for (const methodName of ["list", "search"] as Array<keyof KnowledgeController>) {
  assert(canActivate(guard, methodName, "VIEWER") === true, `Expected VIEWER to read via ${String(methodName)}.`);
}

for (const methodName of ["create", "reindex", "update", "archive"] as Array<keyof KnowledgeController>) {
  assert(canActivate(guard, methodName, "MANAGER") === true, `Expected MANAGER to write via ${String(methodName)}.`);
  assertForbidden(guard, methodName, "VIEWER");
  assertForbidden(guard, methodName, "AGENT");
}

console.log(JSON.stringify({ ok: true }));
