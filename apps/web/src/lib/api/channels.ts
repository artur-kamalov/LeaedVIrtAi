import type { Channel, ChannelStatus, ChannelType } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function listChannels() {
  return apiData<Channel[]>("/channels");
}

export function createChannel(body: {
  type: Extract<ChannelType, "WEBSITE" | "TELEGRAM" | "WEBHOOK">;
  name?: string;
  status?: Extract<ChannelStatus, "ACTIVE" | "DISABLED" | "PENDING">;
  publicKey?: string;
  settings?: Record<string, unknown>;
}) {
  return apiData<Channel>("/channels", { method: "POST", ...jsonBody(body) });
}

export function updateChannel(
  id: string,
  body: {
    status?: ChannelStatus;
    name?: string;
    settings?: Record<string, unknown>;
  }
) {
  return apiData<Channel>(`/channels/${id}`, { method: "PATCH", ...jsonBody(body) });
}
