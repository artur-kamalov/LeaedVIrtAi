import type { AiAuditResponse } from "@leadvirt/types";
import { apiData, withQuery } from "./client";

export function getAiAudit(limit = 50) {
  return apiData<AiAuditResponse>(withQuery("/ai-audit", { limit }));
}
