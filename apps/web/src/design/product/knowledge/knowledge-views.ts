import {
  BookOpenText,
  Building2,
  ClipboardCheck,
  FlaskConical,
  History,
  Library,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/i18n/messages";

export type KnowledgeViewId =
  | "overview"
  | "business"
  | "sources"
  | "guidance"
  | "review"
  | "test"
  | "history";

export interface KnowledgeViewDefinition {
  id: KnowledgeViewId;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

export const knowledgeViews: KnowledgeViewDefinition[] = [
  { id: "overview", labelKey: "knowledge.page.tab.overview", icon: BookOpenText },
  { id: "business", labelKey: "knowledge.page.tab.business", icon: Building2 },
  { id: "sources", labelKey: "knowledge.page.tab.sources", icon: Library },
  { id: "guidance", labelKey: "knowledge.page.tab.guidance", icon: ShieldCheck },
  { id: "review", labelKey: "knowledge.page.tab.review", icon: ClipboardCheck },
  { id: "test", labelKey: "knowledge.page.tab.test", icon: FlaskConical },
  { id: "history", labelKey: "knowledge.page.tab.history", icon: History },
];

export function isKnowledgeView(value: string | null | undefined): value is KnowledgeViewId {
  return knowledgeViews.some((view) => view.id === value);
}
