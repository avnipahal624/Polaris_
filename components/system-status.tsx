/**
 * POLARIS data-source truth strip and system status.
 *
 * Every number in POLARIS carries a provenance. This component makes that
 * provenance visible instead of implied: a service with no credential is
 * shown as "NOT CONFIGURED", never substituted with plausible-looking data.
 */
import { useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleSlash, Database, Radio, RefreshCw, Server, Wifi, WifiOff } from "lucide-react";

import { usePolarisLive } from "@/lib/polaris-live";
import { BANDWIDTH_ALLOWLIST, BANDWIDTH_LABEL, PRIORITY_NAME, type ConnectivityMode } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";

const MODES: { id: ConnectivityMode; label: string }[] = [
  { id: "CONNECTED", label: "CONNECTED" },
  { id: "LOW_BANDWIDTH", label: "LOW" },
  { id: "VERY_LOW_BANDWIDTH", label: "VERY LOW" },
  { id: "OFFLINE", label: "OFFLINE" },
];

export function ConnectivityControl() {
  const live = usePolarisLive();
  const allow = BANDWIDTH_ALLOWLIST[live.connMode];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Connectivity band">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => void live.setConnMode(m.id)}
            aria-pressed={live.connMode === m.id}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors",
              live.connMode === m.id
                ? "border-sky-400 bg-sky-400/20 text-sky-900"
                : "border-white/60 bg-white/40 text-slate-600 hover:bg-white/60",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-4 text-slate-600">
        {BANDWIDTH_LABEL[live.connMode]}. Allowed priorities:{" "}
        {allow.length === 0 ? "none — everything is stored locally" : allow.map((p) => PRIORITY_NAME[p].split(" ")[0]).join(", ")}.
      </p>
    </div>
  );
}

export function DataSourceBadge({ kind }: { kind: "LIVE" | "SYNCED" | "LAST_KNOWN" | "SIMULATED" | "NOT_CONFIGURED" }) {
  const tone = {
    LIVE: "border-emerald-300 bg-emerald-50/80 text-emerald-800",
    SYNCED: "border-sky-300 bg-sky-50/80 text-sky-800",
    LAST_KNOWN: "border-amber-300 bg-amber-50/80 text-amber-800",
    SIMULATED: "border-indigo-300 bg-indigo-50/80 text-indigo-800",
    NOT_CONFIGURED: "border-slate-300 bg-slate-50/80 text-slate-600",
  }[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider", tone)}>
      {kind === "LIVE" ? <Radio className="h-2.5 w-2.5" /> : null}
      {kind === "LAST_KNOWN" ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
      {kind === "NOT_CONFIGURED" ? <CircleSlash className="h-2.5 w-2.5" /> : null}
      {kind}
    </span>
  );
}

/**
 * System status. Each row reports the state the backend actually observed —
 * the database row is proved by reading it, the weather and storage rows are
 * read from their environment configuration.
 */
export function SystemStatusPanel() {
  const live = usePolarisLive();
  const [open, setOpen] = useState(false);

  const connected = live.integrations.filter((i) => i.state === "CONNECTED").length;
  const notConfigured = live.integrations.filter((i) => i.state === "NOT_CONFIGURED");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-white/60 bg-white/50 px-2 py-1 text-[10px] font-medium text-slate-700 backdrop-blur hover:bg-white/70"
      >
        <Server className="h-3 w-3" />
        SYSTEM {connected}/{live.integrations.length}
        {notConfigured.length > 0 ? <span className="text-amber-700">· {notConfigured.length} unconfigured</span> : null}
      </button>
    );
  }

  return (
    <div className="w-[340px] rounded-xl border border-white/70 bg-white/85 p-3 shadow-lg backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">System status</p>
        <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-800">
          CLOSE
        </button>
      </div>
      <ul className="space-y-1.5">
        {live.integrations.map((i) => (
          <li key={i.id} className="rounded-md border border-slate-200/70 bg-white/70 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              {i.state === "CONNECTED" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              ) : i.state === "DEGRADED" ? (
                <AlertTriangle className="h-3 w-3 text-amber-600" />
              ) : (
                <CircleSlash className="h-3 w-3 text-slate-400" />
              )}
              <span className="text-[11px] font-medium text-slate-800">{i.label}</span>
              <span
                className={cn(
                  "ml-auto text-[9px] font-semibold tracking-wider",
                  i.state === "CONNECTED" ? "text-emerald-700" : i.state === "DEGRADED" ? "text-amber-700" : "text-slate-500",
                )}
              >
                {i.state.replace("_", " ")}
              </span>
            </div>
            <p className="mt-0.5 pl-4.5 text-[10px] leading-3.5 text-slate-600">{i.capability}</p>
            {i.requiresEnv && i.state !== "CONNECTED" ? (
              <p className="mt-0.5 pl-4.5 font-mono text-[9px] text-slate-500">requires {i.requiresEnv}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-slate-200 pt-1.5 text-[9px] text-slate-500">
        Environment: {live.environment}. Geography, station coordinates and the geospatial engine are real. Seeded operational values are
        labelled SIMULATED wherever they appear.
      </p>
    </div>
  );
}

/** Real sync counters: the queue on disk plus the server's own acknowledgement. */
export function SyncStatusStrip() {
  const live = usePolarisLive();
  const [busy, setBusy] = useState(false);
  const q = live.queueStats;

  const run = async () => {
    setBusy(true);
    await live.syncNow();
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-white/70 bg-white/70 p-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-1.5">
        {live.connMode === "OFFLINE" ? <WifiOff className="h-3.5 w-3.5 text-amber-600" /> : <Wifi className="h-3.5 w-3.5 text-emerald-600" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-700">Sync</span>
        <button
          type="button"
          onClick={run}
          disabled={busy || live.connMode === "OFFLINE"}
          className="ml-auto flex items-center gap-1 rounded border border-sky-300 bg-sky-50/80 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-2.5 w-2.5", busy && "animate-spin")} />
          SYNC NOW
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
        <Stat label="Queued" value={q?.queued ?? 0} tone="text-sky-700" />
        <Stat label="Syncing" value={q?.syncing ?? 0} tone="text-amber-700" />
        <Stat label="Conflicts" value={(q?.conflicts ?? 0) + (live.syncStatus?.openConflicts ?? 0)} tone="text-rose-700" />
        <Stat label="Applied" value={live.syncStatus?.applied ?? 0} tone="text-emerald-700" />
      </div>
      {q?.topPriority !== null && q?.topPriority !== undefined ? (
        <p className="mt-1.5 text-[9px] text-slate-600">Next up: {PRIORITY_NAME[q.topPriority]}</p>
      ) : null}
      <p className="mt-0.5 text-[9px] text-slate-500">
        {q?.lastResult ? `Last sync ${q.lastResult}` : "Not synchronised this session"}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded border border-slate-200/70 bg-white/70 py-1">
      <p className={cn("text-[15px] font-semibold leading-none", tone)}>{value}</p>
      <p className="mt-0.5 text-[8px] uppercase tracking-wider text-slate-500">{label}</p>
    </div>
  );
}

/** Renders a real error instead of silently showing an empty dashboard. */
export function BackendErrorBoundary({ children }: { children: ReactNode }) {
  const live = usePolarisLive();
  const anyError = Object.values(live.state).includes("error");
  if (!anyError) return <>{children}</>;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900">
      <p className="font-semibold">Unable to reach the POLARIS database.</p>
      <p className="mt-1 text-xs">
        Your session is valid but the backend did not answer. Nothing is being shown from a local cache, because a cached figure could be
        mistaken for a current one.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs font-medium"
      >
        Retry
      </button>
    </div>
  );
}

export function LiveIndicator() {
  const live = usePolarisLive();
  const t = live.controlRoom?.asOf;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-600">
      <Activity className="h-3 w-3 text-emerald-600" />
      {live.state.controlRoom === "ready" && t ? (
        <>
          database <Database className="h-2.5 w-2.5" /> {new Date(t).toISOString().slice(11, 19)} UTC
        </>
      ) : (
        "connecting…"
      )}
    </span>
  );
}
