import { ForbiddenException, type ExecutionContext, type Type } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@leadvirt/db";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { BillingController } from "../../apps/api/src/modules/billing/billing.controller.js";
import { IntegrationsController } from "../../apps/api/src/modules/integrations/integrations.controller.js";
import { WorkflowsController } from "../../apps/api/src/modules/workflows/workflows.controller.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requestContext(role: MembershipRole): RequestContext {
  return {
    tenantId: "tenant_product_rbac_smoke",
    userId: "user_product_rbac_smoke",
    role,
    authMode: "credentials",
    tenant: {
      id: "tenant_product_rbac_smoke",
      name: "Product RBAC Smoke",
      slug: "product-rbac-smoke",
      status: "TRIALING",
      businessType: null,
      timezone: "UTC"
    },
    user: {
      id: "user_product_rbac_smoke",
      email: "product-rbac-smoke@leadvirt.ai",
      phone: null,
      name: "Product RBAC Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

function executionContext(controller: Type<unknown>, handler: Function, role: MembershipRole): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ leadvirtContext: requestContext(role) })
    })
  } as unknown as ExecutionContext;
}

function canActivate<T extends object>(guard: RolesGuard, controller: Type<T>, methodName: keyof T, role: MembershipRole) {
  const handler = controller.prototype[methodName];
  assert(typeof handler === "function", `Missing controller method ${String(methodName)}.`);
  return guard.canActivate(executionContext(controller, handler, role));
}

function assertAllowed<T extends object>(guard: RolesGuard, controller: Type<T>, methodName: keyof T, role: MembershipRole) {
  assert(canActivate(guard, controller, methodName, role) === true, `Expected ${role} to access ${controller.name}.${String(methodName)}.`);
}

function assertForbidden<T extends object>(guard: RolesGuard, controller: Type<T>, methodName: keyof T, role: MembershipRole) {
  let forbidden = false;
  try {
    canActivate(guard, controller, methodName, role);
  } catch (error) {
    forbidden = error instanceof ForbiddenException;
  }
  assert(forbidden, `Expected ${role} to be forbidden for ${controller.name}.${String(methodName)}.`);
}

const guard = new RolesGuard(new Reflector());

for (const methodName of ["plans", "paymentMethod", "invoices", "currentSubscription", "usage"] as Array<keyof BillingController>) {
  assertAllowed(guard, BillingController, methodName, "VIEWER");
}
for (const methodName of ["requestPaymentMethodChange", "changeSubscriptionPlan", "cancelSubscription"] as Array<keyof BillingController>) {
  assertAllowed(guard, BillingController, methodName, "ADMIN");
  assertForbidden(guard, BillingController, methodName, "MANAGER");
  assertForbidden(guard, BillingController, methodName, "VIEWER");
}

assertAllowed(guard, IntegrationsController, "list", "VIEWER");
for (const methodName of ["connect", "disconnect", "testConnection", "sendSampleInbound", "updateSettings"] as Array<keyof IntegrationsController>) {
  assertAllowed(guard, IntegrationsController, methodName, "MANAGER");
  assertForbidden(guard, IntegrationsController, methodName, "VIEWER");
  assertForbidden(guard, IntegrationsController, methodName, "AGENT");
}

for (const methodName of ["list", "get"] as Array<keyof WorkflowsController>) {
  assertAllowed(guard, WorkflowsController, methodName, "VIEWER");
}
for (const methodName of ["create", "update", "publish", "test"] as Array<keyof WorkflowsController>) {
  assertAllowed(guard, WorkflowsController, methodName, "MANAGER");
  assertForbidden(guard, WorkflowsController, methodName, "VIEWER");
  assertForbidden(guard, WorkflowsController, methodName, "AGENT");
}

console.log(JSON.stringify({ ok: true }));
