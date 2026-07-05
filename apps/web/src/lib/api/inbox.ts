import type { ConversationDetail, ConversationStatus, PaginatedEnvelope } from "@leadvirt/types";
import { apiRequest, withQuery } from "./client";

export interface InboxQuery {
  status?: ConversationStatus;
  channel?: string;
  search?: string;
  limit?: number;
  page?: number;
}

export function listInboxConversations(query: InboxQuery = {}) {
  return apiRequest<PaginatedEnvelope<ConversationDetail>>(withQuery("/inbox/conversations", query));
}
