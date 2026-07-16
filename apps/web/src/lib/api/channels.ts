import type {
  Channel,
  ChannelAutomaticReplyReadiness,
  ChannelProvisioningResult,
  ChannelStatus,
  ChannelType,
  ChannelWebhookSecretRotation,
  IntegrationSampleDeliveryResult,
} from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function listChannels() {
  return apiData<Channel[]>("/channels");
}

export function createChannel(body: {
  type: Extract<ChannelType, "WEBSITE" | "WEBHOOK">;
  name?: string;
  status?: Extract<ChannelStatus, "ACTIVE" | "DISABLED" | "PENDING">;
  publicKey?: string;
  settings?: Record<string, unknown>;
}) {
  return apiData<ChannelProvisioningResult>("/channels", {
    method: "POST",
    ...jsonBody(body),
  });
}

export function rotateChannelWebhookSecret(id: string) {
  return apiData<ChannelWebhookSecretRotation>(`/channels/${id}/webhook-secret/rotate`, {
    method: "POST",
  });
}

export function updateChannel(
  id: string,
  body: {
    status?: ChannelStatus;
    name?: string;
    settings?: Record<string, unknown>;
  },
) {
  return apiData<Channel>(`/channels/${id}`, { method: "PATCH", ...jsonBody(body) });
}

export type WebhookOutboundSettingsPatch = {
  targetUrl?: string | null;
  auth?: {
    headerName: string;
    secret: string;
    scheme?: "Bearer";
  } | null;
};

export function updateChannelWebhookOutbound(id: string, outbound: WebhookOutboundSettingsPatch) {
  return updateChannel(id, {
    settings: {
      webhook: {
        outbound,
      },
    },
  });
}

export function sendWebhookChannelSampleInbound() {
  return apiData<IntegrationSampleDeliveryResult>("/integrations/WEBHOOK_API/sample-inbound", {
    method: "POST",
  });
}

export function getChannelAutomaticReplyReadiness(id: string) {
  return apiData<ChannelAutomaticReplyReadiness>(`/channels/${id}/automatic-replies/readiness`);
}

export function activateChannelAutomaticReplies(id: string) {
  return apiData<ChannelAutomaticReplyReadiness>(`/channels/${id}/automatic-replies/activate`, {
    method: "POST",
  });
}

export function deactivateChannelAutomaticReplies(id: string) {
  return apiData<ChannelAutomaticReplyReadiness>(`/channels/${id}/automatic-replies/deactivate`, {
    method: "POST",
  });
}
