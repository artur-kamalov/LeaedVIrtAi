import type { WidgetConfig, WidgetMessageRequest, WidgetMessageResponse } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function getWidgetConfig(publicKey: string) {
  return apiData<WidgetConfig>(`/public/widget/${encodeURIComponent(publicKey)}/config`);
}

export function sendWidgetMessage(publicKey: string, body: WidgetMessageRequest) {
  return apiData<WidgetMessageResponse>(`/public/widget/${encodeURIComponent(publicKey)}/messages`, {
    method: "POST",
    ...jsonBody(body)
  });
}
