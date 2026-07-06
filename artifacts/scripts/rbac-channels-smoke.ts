import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@leadvirt/db";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { ChannelsController } from "../../apps/api/src/modules/channels/channels.controller.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requestContext(role: MembershipRole): RequestContext {
  return {
    tenantId: "tenant_channel_rbac_smoke",
    userId: "user_channel_rbac_smoke",
    role,
    authMode: "credentials",
    tenant: {
      id: "tenant_channel_rbac_smoke",
      name: "Channel RBAC Smoke",
      slug: "channel-rbac-smoke",
      status: "TRIALING",
      businessType: null,
      timezone: "UTC"
    },
    user: {
      id: "user_channel_rbac_smoke",
      email: "channel-rbac-smoke@leadvirt.ai",
      phone: null,
      name: "Channel RBAC Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

function executionContext(handler: Function, role: MembershipRole): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ChannelsController,
    switchToHttp: () => ({
      getRequest: () => ({ leadvirtContext: requestContext(role) })
    })
  } as unknown as ExecutionContext;
}

function canActivate(guard: RolesGuard, methodName: keyof ChannelsController, role: MembershipRole) {
  const handler = ChannelsController.prototype[methodName];
  assert(typeof handler === "function", `Missing controller method ${String(methodName)}.`);
  return guard.canActivate(executionContext(handler, role));
}

function assertForbidden(guard: RolesGuard, methodName: keyof ChannelsController, role: MembershipRole) {
  let forbidden = false;
  try {
    canActivate(guard, methodName, role);
  } catch (error) {
    forbidden = error instanceof ForbiddenException;
  }
  assert(forbidden, `Expected ${role} to be forbidden for ${String(methodName)}.`);
}

const guard = new RolesGuard(new Reflector());
assert(canActivate(guard, "list", "VIEWER") === true, "Expected VIEWER to list channels.");

for (const methodName of ["create", "update"] as Array<keyof ChannelsController>) {
  assert(canActivate(guard, methodName, "MANAGER") === true, `Expected MANAGER to write via ${String(methodName)}.`);
  assertForbidden(guard, methodName, "VIEWER");
  assertForbidden(guard, methodName, "AGENT");
}

console.log(JSON.stringify({ ok: true }));
