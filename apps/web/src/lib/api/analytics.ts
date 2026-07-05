import type { AnalyticsOverview } from "@leadvirt/types";
import { apiData, withQuery } from "./client";

export type AnalyticsPeriod = "7d" | "30d" | "quarter";

export function getAnalyticsOverview(period: AnalyticsPeriod = "30d") {
  return apiData<AnalyticsOverview>(withQuery("/analytics/overview", { period }));
}
