import type { DashboardSummary } from "@leadvirt/types";
import { apiData } from "./client";

export function getDashboardSummary() {
  return apiData<DashboardSummary>("/dashboard/summary");
}
