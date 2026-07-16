import type { Workflow, WorkflowTestResult } from "@leadvirt/types";
import { apiData, jsonBody, withQuery } from "./client";

export type WorkflowStepPayload = Omit<
  Pick<NonNullable<Workflow["steps"]>[number], "id" | "type" | "name" | "positionX" | "positionY" | "config">,
  "id"
> & {
  id?: string;
};

export type WorkflowUpsertPayload = Pick<Workflow, "name"> &
  Partial<Pick<Workflow, "description" | "status">> & {
    steps?: WorkflowStepPayload[];
  };

export function listWorkflows(options: { includeArchived?: boolean } = {}) {
  return apiData<Workflow[]>(withQuery("/workflows", options));
}

export function getWorkflow(id: string) {
  return apiData<Workflow>(`/workflows/${id}`);
}

export function createWorkflow(body: WorkflowUpsertPayload) {
  return apiData<Workflow>("/workflows", { method: "POST", ...jsonBody(body) });
}

export function updateWorkflow(id: string, body: WorkflowUpsertPayload) {
  return apiData<Workflow>(`/workflows/${id}`, { method: "PATCH", ...jsonBody(body) });
}

export function publishWorkflow(id: string) {
  return apiData<Workflow>(`/workflows/${id}/publish`, { method: "POST" });
}

export function testWorkflow(id: string) {
  return apiData<WorkflowTestResult>(`/workflows/${id}/test`, { method: "POST" });
}
