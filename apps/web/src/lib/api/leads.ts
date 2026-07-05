import type { Lead, LeadStatus, PaginatedEnvelope } from "@leadvirt/types";
import { apiData, apiRequest, jsonBody, withQuery } from "./client";

export interface LeadsQuery {
  status?: LeadStatus;
  channel?: string;
  search?: string;
  limit?: number;
  page?: number;
}

export interface PipelineSummary {
  stages: { status: LeadStatus; count: number; valueAmount: number; leads: Lead[] }[];
}

export function listLeads(query: LeadsQuery = {}) {
  return apiRequest<PaginatedEnvelope<Lead>>(withQuery("/leads", query));
}

export function getLead(id: string) {
  return apiData<Lead>(`/leads/${id}`);
}

export function updateLead(id: string, body: Partial<Pick<Lead, "name" | "phone" | "email" | "status" | "temperature" | "interest" | "summary">>) {
  return apiData<Lead>(`/leads/${id}`, {
    method: "PATCH",
    ...jsonBody(body)
  });
}

export function sendLeadToCrm(id: string) {
  return apiData<Lead>(`/leads/${id}/actions/send-to-crm`, { method: "POST" });
}

export function createLeadTask(id: string, title: string) {
  return apiData(`/leads/${id}/actions/create-task`, {
    method: "POST",
    ...jsonBody({ title })
  });
}

export function bookLeadAppointment(id: string, title: string, startsAt: string) {
  return apiData(`/leads/${id}/actions/book-appointment`, {
    method: "POST",
    ...jsonBody({ title, startsAt })
  });
}

export function getPipelineSummary() {
  return apiData<PipelineSummary>("/leads/pipeline/summary");
}
