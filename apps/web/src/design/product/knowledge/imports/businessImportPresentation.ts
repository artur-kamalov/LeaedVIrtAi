import type { BusinessImportState } from "@leadvirt/types";
import type { TranslationKey } from "@/i18n/messages";

export const businessImportStateKeys: Record<BusinessImportState, TranslationKey> = {
  CREATED: "businessImport.state.created",
  UPLOADING: "businessImport.state.uploading",
  UPLOADED: "businessImport.state.uploaded",
  SCANNING: "businessImport.state.scanning",
  PARSING: "businessImport.state.parsing",
  MAPPING_REQUIRED: "businessImport.state.mappingRequired",
  EXTRACTING: "businessImport.state.extracting",
  READY_FOR_REVIEW: "businessImport.state.readyForReview",
  AWAITING_APPROVAL: "businessImport.state.awaitingApproval",
  APPLYING: "businessImport.state.applying",
  PROJECTING: "businessImport.state.projecting",
  PROJECTION_DELAYED: "businessImport.state.projectionDelayed",
  PARTIALLY_APPLIED: "businessImport.state.partiallyApplied",
  APPLIED: "businessImport.state.applied",
  CLOSED_WITH_REMAINDER: "businessImport.state.closedWithRemainder",
  FAILED_RETRYABLE: "businessImport.state.failedRetryable",
  FAILED: "businessImport.state.failed",
  REJECTED: "businessImport.state.rejected",
  CANCELLED: "businessImport.state.cancelled",
  EXPIRED: "businessImport.state.expired",
};

export function businessImportStateTone(state: BusinessImportState) {
  if (state === "APPLIED") return "success" as const;
  if (["FAILED_RETRYABLE", "FAILED", "REJECTED", "EXPIRED"].includes(state)) {
    return "error" as const;
  }
  if (
    ["AWAITING_APPROVAL", "PROJECTION_DELAYED", "PARTIALLY_APPLIED", "MAPPING_REQUIRED"].includes(
      state,
    )
  ) {
    return "warning" as const;
  }
  return "info" as const;
}
