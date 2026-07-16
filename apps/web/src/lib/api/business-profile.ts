import type { BusinessProfileData, BusinessProfileView } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function getBusinessProfile() {
  return apiData<BusinessProfileView>("/business-profile");
}

export function updateBusinessProfile(
  profile: Partial<BusinessProfileData>,
  headers: { "Idempotency-Key": string; "If-Match": string },
) {
  return apiData<BusinessProfileView>("/business-profile", {
    method: "PATCH",
    headers,
    ...jsonBody({ profile }),
  });
}
