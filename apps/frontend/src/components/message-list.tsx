import type { ScheduledMessage } from "@ims/shared";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/queries";

type Status = ScheduledMessage["status"];

const statusStyles: Record<Status, string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  ACCEPTED: "bg-sky-100 text-sky-700",
  SENT: "bg-indigo-100 text-indigo-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
  RECEIVED: "bg-emerald-600 text-white",
  FAILED: "bg-red-100 text-red-700",
};

const when = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge className={cn("border-transparent", statusStyles[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}

export function MessageList() {
  const { data, isPending, isError } = useMessages();

  if (isPending) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading messages…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-sm">
        <AlertCircle className="size-5" />
        We couldn't load your messages just now. Retrying…
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-sm">
        <Inbox className="size-6" />
        No messages scheduled yet.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {data.map((message) => (
        <li key={message.id} className="flex items-start justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="font-medium">{message.recipient}</p>
            <p className="text-muted-foreground truncate text-sm">{message.body}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {when.format(new Date(message.scheduledAt))}
              {message.attempts > 1 ? ` · attempt ${message.attempts}` : ""}
            </p>
          </div>
          <StatusBadge status={message.status} />
        </li>
      ))}
    </ul>
  );
}