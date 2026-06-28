import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MessageStatus } from "@ims/shared";
import { useStats } from "@/lib/queries";

const STATUS_ORDER: MessageStatus[] = [
  "QUEUED",
  "ACCEPTED",
  "SENT",
  "DELIVERED",
  "RECEIVED",
  "FAILED",
];

const statusDot: Record<MessageStatus, string> = {
  QUEUED: "bg-slate-400",
  ACCEPTED: "bg-sky-400",
  SENT: "bg-indigo-400",
  DELIVERED: "bg-violet-500",
  RECEIVED: "bg-emerald-500",
  FAILED: "bg-rose-500",
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;

  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);

  return `${m}m ${s}s`;
}

function formatHour(iso: string): string {
  const d = new Date(iso);

  return d.toLocaleTimeString(undefined, { hour: "2-digit" });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

export function Dashboard() {
  const { data, isPending, isError } = useStats();

  if (isError) {
    return (
      <p className="text-muted-foreground text-sm">
        We couldn't load the dashboard just now. Retrying…
      </p>
    );
  }
  
  if (isPending) {
    return <p className="text-muted-foreground text-sm">Loading metrics…</p>;
  }

  const deliverP50 = data.timing.sentToDelivered?.p50Seconds ?? null;
  const deliverP95 = data.timing.sentToDelivered?.p95Seconds ?? null;
  const hasThroughput = data.throughput.some((b) => b.sent > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total" value={String(data.total)} />
        <Tile label="Received" value={String(data.reached.RECEIVED)} hint="reached read" />
        <Tile
          label="Failure rate"
          value={`${(data.failureRate * 100).toFixed(0)}%`}
          hint={`avg ${data.avgAttempts} attempts`}
        />
        <Tile
          label="Median deliver"
          value={formatDuration(deliverP50)}
          hint={deliverP95 !== null ? `p95 ${formatDuration(deliverP95)}` : "sent → delivered"}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-center gap-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${statusDot[status]}`} />
            <span className="text-muted-foreground">{status.toLowerCase()}</span>
            <span className="font-medium tabular-nums text-slate-900">
              {data.statusCounts[status]}
            </span>
          </div>
        ))}
      </div>

      <div>
        <div className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          Sent · last 24h
        </div>
        {hasThroughput ? (
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.throughput} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="hour"
                  tickFormatter={formatHour}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  interval={3}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => formatHour(String(v))}
                  formatter={(value) => [String(value), "sent"]}
                />
                <Bar dataKey="sent" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No messages sent in the last 24 hours yet.</p>
        )}
      </div>
    </div>
  );
}