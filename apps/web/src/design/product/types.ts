import type { ChannelId, StageId, Temp } from "./shared";
import type { MessageStatus } from "@leadvirt/types";

export interface Lead {
  id: string;
  conversationId?: string;
  apiLeadId?: string;
  name: string;
  channel: ChannelId;
  stage: StageId;
  temp: Temp;
  source: string;
  value: number;
  currency: string;
  manager: string;
  service: string;
  lastMessage: string;
  time: string;
  unread: number;
  ai: boolean;
}

export interface ChatMessage {
  id: string;
  from: "client" | "ai" | "manager";
  text: string;
  time: string;
  status?: MessageStatus;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  filename?: string | null;
  mimeType?: string | null;
  url: string;
  sizeBytes?: number | null;
}
