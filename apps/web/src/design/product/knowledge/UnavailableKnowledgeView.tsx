"use client";

import { LockKeyhole } from "lucide-react";
import { EmptyState } from "../ui";

export function UnavailableKnowledgeView({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/30" data-testid="knowledge-unavailable-view">
      <EmptyState icon={LockKeyhole} title={title} description={description} className="min-h-[360px]" />
    </div>
  );
}
