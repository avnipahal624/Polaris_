import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConnState = "CONNECTED" | "OFFLINE" | "SYNCING" | "SYNCED";

export interface QueuedChange {
  id: string;
  ts: string;
  kind: "INVENTORY UPDATE" | "CARGO SCAN" | "TASK STATUS" | "GPS EVENT" | "SOS" | "FIELD NOTE";
  summary: string;
}

export interface ConflictRecord {
  id: string;
  station: string;
  resource: string;
  central: string;
  local: string;
  localTs: string;
  author: string;
}

export const SEED_QUEUE: QueuedChange[] = [
  { id: "q-1", ts: "14:37", kind: "INVENTORY UPDATE", summary: "Suhrid diesel — 2,050 L recount (field dip)" },
  { id: "q-2", ts: "14:39", kind: "CARGO SCAN", summary: "Container 6200412604 scanned at Bharati yard" },
  { id: "q-3", ts: "14:41", kind: "GPS EVENT", summary: "Field Team 1 position — Sector C fringe" },
  { id: "q-4", ts: "14:42", kind: "TASK STATUS", summary: "Generator audit 60% complete" },
  { id: "q-5", ts: "14:44", kind: "FIELD NOTE", summary: "Ridge wind rising — photos attached" },
  { id: "q-6", ts: "14:45", kind: "INVENTORY UPDATE", summary: "Priyadarshini rations −2 crates" },
  { id: "q-7", ts: "14:46", kind: "SOS", summary: "SOS packet queued — Field Team 1" },
];

export const SEED_CONFLICT: ConflictRecord = {
  id: "cf-1",
  station: "Camp Suhrid",
  resource: "Diesel",
  central: "5,000 L",
  local: "4,200 L",
  localTs: "14:42",
  author: "Authorized technician — field dip meter",
};

export function useConnectivity(initialQueue: QueuedChange[] = []) {
  const [conn, setConn] = useState<ConnState>("CONNECTED");
  const [lastSync, setLastSync] = useState("14:32");
  const [queue, setQueue] = useState<QueuedChange[]>(initialQueue);
  const [syncStage, setSyncStage] = useState(0);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Connectivity simulation: drop offline briefly, then reconnect and sync.
  useEffect(() => {
    const toOffline = setTimeout(() => setConn("OFFLINE"), 26000);
    const toSyncing = setTimeout(() => {
      if (queueRef.current.length > 0) setConn("SYNCING");
    }, 37000);
    return () => {
      clearTimeout(toOffline);
      clearTimeout(toSyncing);
    };
  }, []);

  // Sync flow when SYNCING.
  useEffect(() => {
    if (conn !== "SYNCING") return;
    setSyncStage(0);
    const t1 = setTimeout(() => setSyncStage(1), 700);
    const t2 = setTimeout(() => setSyncStage(2), 1500);
    const t3 = setTimeout(() => {
      setQueue([]);
      setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
      setConn("SYNCED");
    }, 2300);
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, [conn]);

  useEffect(() => {
    if (conn === "SYNCED") {
      const t = setTimeout(() => setConn("CONNECTED"), 2600);
      return () => clearTimeout(t);
    }
  }, [conn]);

  const goOnline = () => setConn("SYNCING");

  return { conn, lastSync, queue, syncStage, goOnline };
}

const CONN_STYLE: Record<ConnState, string> = {
  CONNECTED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  OFFLINE: "bg-amber-500/15 text-amber-800 border-amber-500/40",
  SYNCING: "bg-sky-500/15 text-sky-700 border-sky-500/40",
  SYNCED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
};

export function ConnectivityChip({ conn, lastSync, queued }: { conn: ConnState; lastSync: string; queued: number }) {
  const label =
    conn === "OFFLINE"
      ? `OFFLINE · LAST SYNC ${lastSync} · ${queued} QUEUED`
      : conn === "SYNCING"
        ? "SYNCING…"
        : conn === "SYNCED"
          ? `SYNC COMPLETE · ${lastSync}`
          : `ONLINE · SYNCED ${lastSync}`;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide", CONN_STYLE[conn])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", conn === "OFFLINE" ? "bg-amber-500" : conn === "SYNCING" ? "animate-pulse bg-sky-500" : "bg-emerald-500")} />
      {label}
    </span>
  );
}

const SYNC_STAGES = ["OFFLINE EVENTS", "LOCAL QUEUE", "SYNC ENGINE", "CENTRAL SYSTEM"];

export function OfflineBanner({ conn, lastSync, queued, onSyncNow }: { conn: ConnState; lastSync: string; queued: number; onSyncNow?: () => void }) {
  if (conn !== "OFFLINE" && conn !== "SYNCING") return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-2.5 backdrop-blur-md",
        conn === "OFFLINE" ? "border-amber-300/70 bg-amber-50/80" : "border-sky-300/70 bg-sky-50/80",
      )}
      role="status"
    >
      <div>
        <p className="text-[11px] font-extrabold tracking-widest uppercase">
          {conn === "OFFLINE" ? "OFFLINE MODE — read/write continues locally" : "SYNCING — pushing queued events"}
        </p>
        <p className="text-[11px] font-medium text-slate-600">
          Last synced {lastSync} · {queued} change{queued === 1 ? "" : "s"} queued · maps, hazards & tasks cached
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {SYNC_STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9.5px] font-bold tracking-wide",
              conn === "OFFLINE"
                ? i <= 1
                  ? "border-amber-400/60 bg-amber-100 text-amber-800"
                  : "border-slate-200 bg-white/60 text-slate-400"
                : i <= syncStageIdx(conn)
                  ? "border-sky-400/60 bg-sky-100 text-sky-800"
                  : "border-slate-200 bg-white/60 text-slate-400",
            )}
          >
            {s}
          </span>
        ))}
      </div>
      {conn === "OFFLINE" && onSyncNow && (
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onSyncNow}>
          Force sync
        </Button>
      )}
    </div>
  );
}

function syncStageIdx(conn: ConnState) {
  return conn === "SYNCING" ? 2 : 3;
}

export function SyncQueueDialog({
  open,
  onOpenChange,
  queue,
  conflict,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  queue: QueuedChange[];
  conflict: ConflictRecord | null;
  onResolve: (resolution: "KEEP LOCAL" | "KEEP CENTRAL" | "MERGE") => void;
}) {
  const [resolved, setResolved] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Offline sync & conflicts
            <Badge variant="outline" className="text-[10px]">
              {queue.length} queued
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Field events are queued locally and replayed to the central system in order. Conflicts are never auto-overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {queue.length === 0 && <p className="text-[12px] text-slate-500">Queue is empty — everything synced.</p>}
          {queue.map((q) => (
            <div key={q.id} className="glass-inset flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-slate-500">{q.ts}</span>
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-sky-700">{q.kind}</span>
              <span className="truncate text-[11.5px] text-slate-700">{q.summary}</span>
            </div>
          ))}
        </div>

        {conflict && !resolved && (
          <div className="rounded-xl border border-red-200 bg-red-50/70 p-3">
            <p className="text-[11px] font-extrabold tracking-widest text-red-700 uppercase">CONFLICT DETECTED</p>
            <p className="mt-1 text-[12px] font-bold text-slate-800">
              {conflict.station} — {conflict.resource}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-slate-200 bg-white/80 p-2">
                <p className="text-[9.5px] font-bold tracking-wide text-slate-400 uppercase">Central record</p>
                <p className="text-[13px] font-extrabold text-slate-800">{conflict.central}</p>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2">
                <p className="text-[9.5px] font-bold tracking-wide text-amber-700 uppercase">Local field update</p>
                <p className="text-[13px] font-extrabold text-slate-800">{conflict.local}</p>
              </div>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500">
              Field timestamp {conflict.localTs} · {conflict.author}
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" className="h-7 flex-1 text-[11px]" onClick={() => { onResolve("KEEP LOCAL"); setResolved(true); }}>
                Keep field value
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={() => { onResolve("KEEP CENTRAL"); setResolved(true); }}>
                Keep central value
              </Button>
              <Button size="sm" variant="ghost" className="h-7 flex-1 text-[11px]" onClick={() => { onResolve("MERGE"); setResolved(true); }}>
                Escalate
              </Button>
            </div>
          </div>
        )}

        {resolved && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11.5px] font-semibold text-emerald-700">
            Resolution recorded — audit trail entry created (actor: control room, this console).
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
