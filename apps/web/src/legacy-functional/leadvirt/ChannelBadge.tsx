import { channels, type ChannelId } from "@/features/mock/data";
import { cn } from "@/lib/cn";

export function ChannelBadge({ id, label = false }: { id: ChannelId; label?: boolean }) {
  const channel = channels[id];
  const Icon = channel.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1", channel.bg)}>
      <Icon className={cn("h-3.5 w-3.5", channel.color)} />
      {label ? <span className={cn("text-xs font-medium", channel.color)}>{channel.label}</span> : null}
    </span>
  );
}
