import type { AiDraftReply, ConversationDetail, ConversationStatus } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function getConversation(id: string) {
  return apiData<ConversationDetail>(`/conversations/${id}`);
}

export function sendConversationMessage(id: string, text: string) {
  return apiData<ConversationDetail>(`/conversations/${id}/messages`, {
    method: "POST",
    ...jsonBody({ text })
  });
}

export function draftAiReply(id: string) {
  return apiData<AiDraftReply>(`/conversations/${id}/ai/reply`, { method: "POST" });
}

export function updateConversationStatus(id: string, status: ConversationStatus) {
  return apiData<ConversationDetail>(`/conversations/${id}/status`, {
    method: "PATCH",
    ...jsonBody({ status })
  });
}

export function assignConversation(id: string, userId?: string) {
  return apiData<ConversationDetail>(`/conversations/${id}/assign`, {
    method: "POST",
    ...jsonBody({ userId })
  });
}

export function handoffConversation(id: string) {
  return apiData<ConversationDetail>(`/conversations/${id}/handoff`, { method: "POST" });
}
