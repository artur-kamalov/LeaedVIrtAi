import type { ReactNode } from "react";
import { Card } from "./card";
import { StatusBadge } from "./status-badge";

export function LeadCard({
  name,
  source,
  interest,
  value,
  status,
  actions
}: {
  name: string;
  source: string;
  interest: string;
  value?: string;
  status: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card hover className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-zinc-50">{name}</h3>
          <p className="mt-1 text-sm text-zinc-500">{interest}</p>
        </div>
        <StatusBadge tone="info">{status}</StatusBadge>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-zinc-500">{source}</span>
        {value ? <span className="font-semibold text-emerald-300">{value}</span> : null}
      </div>
      {actions ? <div className="mt-4">{actions}</div> : null}
    </Card>
  );
}
