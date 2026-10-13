import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  INVENTORY,
  KPI_SEED,
  STATIONS,
  TRANSPORTS,
  hazardById,
  type Station,
  type TransportStatus,
} from "@/lib/polar-data";
import { assessStationRisk, computeDepletion } from "@/lib/polar-intel";

/* ---------------- Badges ---------------- */

const badgeCls = "rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide";

export const Badges = {
  StatusBadge: ({ status }: { status: "nominal" | "watch" | "critical" }) => {
    const map = {
      nominal: { cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", label: "NOMINAL" },
      watch: { cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", label: "WATCH" },
      critical: { cls: "bg-red-500/15 text-red-700 border-red-500/30", label: "CRITICAL" },
    };
    const it = map[status];
    return <span className={cn(badgeCls, it.cls)}>{it.label}</span>;
  },
  TransportBadge: ({ status }: { status: TransportStatus }) => {
    const map: Record<TransportStatus, string> = {
      "ON TIME": "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
      "IN TRANSIT": "bg-sky-500/15 text-sky-700 border-sky-500/30",
      DELAYED: "bg-amber-500/15 text-amber-700 border-amber-500/30",
      "WEATHER HOLD": "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
      COMPLETED: "bg-slate-500/10 text-slate-600 border-slate-400/30",
      CANCELLED: "bg-red-500/15 text-red-700 border-red-500/30",
    };
    return <span className={cn(badgeCls, map[status])}>{status}</span>;
  },
  SeverityBadge: ({ severity }: { severity: "critical" | "warning" | "info" }) => {
    const map = {
      critical: { cls: "bg-red-500/15 text-red-700 border-red-500/30", label: "CRITICAL" },
      warning: { cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", label: "WARNING" },
      info: { cls: "bg-sky-500/15 text-sky-700 border-sky-500/30", label: "INFO" },
    };
    const it = map[severity];
    return <span className={cn(badgeCls, it.cls)}>{it.label}</span>;
  },
};

/* ---------------- Inventory meter with operational math ---------------- */

export function ResourceMeter({ label, pct, sub, tone }: { label: string; pct: number; sub: string; tone?: "auto" | "neutral" }) {
  const barColor =
    tone === "neutral" ? "bg-sky-500" : pct < 25 ? "bg-red-500" : pct < 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600">{label}</span>
        <span className="text-[11px] font-bold text-slate-800">{pct}%</span>
      </div>
      <Progress value={pct} className="mt-1 h-1.5 bg-slate-200/70" />
      <p className="mt-1 text-[10.5px] font-medium text-slate-500">{sub}</p>
      <div className={cn("mt-1 h-0.5 w-8 rounded-full", barColor)} />
    </div>
  );
}

export function StationDetailBody({ s, onClose }: { s: Station; onClose: () => void }) {
  const depl = computeDepletion(s);
  const fuel = depl.find((d) => d.resource === "Fuel");
  const risk = assessStationRisk(s);
  const transport = TRANSPORTS.find((t) => t.id === s.nextTransportId);

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <Detail label="Personnel" value={`${s.personnel}/${s.capacity}`} />
        <Detail label="Fuel" value={`${s.fuelPct}% · ${s.fuelL.toLocaleString()} L`} />
        <Detail label="Fuel critical" value={fuel?.daysToCritical !== null && fuel !== undefined ? `${fuel.daysToCritical!.toFixed(1)} days` : "—"} />
        <Detail label="Food reserve" value={`${s.foodDaysRemaining} days`} />
        <Detail label="Medical" value={`${s.medicalPct}%`} />
        <Detail label="Next resupply" value={`${s.nextResupplyDays} days`} />
      </div>

      <div className="glass-inset mt-3 rounded-xl p-2.5">
        <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Current weather</p>
        <p className="mt-0.5 text-[11px] text-slate-700">
          {s.weather.tempC}°C · wind {s.weather.windKph} km/h · vis {s.weather.visibilityKm} km — {s.weather.condition}
        </p>
        {risk.level !== "NOMINAL" && (
          <p className="mt-1.5 text-[11px] font-bold text-red-600">
            {risk.level} — {risk.factors.length} factor{risk.factors.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {(s.hazardIds.length > 0 || transport) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {s.hazardIds.map((hid) => {
            const hz = hazardById(hid);
            return (
              <span key={hid} className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                ⚠ {hz?.label ?? hid}
              </span>
            );
          })}
          {transport && (
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              Next: {transport.name} · ETA {transport.eta}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
        >
          View tasks ({s.activeTasks})
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
        >
          Close
        </button>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="text-[11px] font-bold text-slate-800">{value}</p>
    </div>
  );
}

/* ---------------- KPI strip ---------------- */

function KpiTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "alert" }) {
  return (
    <div className={cn("glass-tile rounded-xl px-3 py-2.5", tone === "alert" && "border-red-300/70 bg-red-50/60")}>
      <p className="text-[9.5px] font-bold tracking-widest text-slate-500 uppercase">{label}</p>
      <p className="mt-0.5 text-xl leading-none font-extrabold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-[10px] font-medium text-slate-500">{hint}</p>}
    </div>
  );
}

export function KpiStrip({ queuedCount }: { queuedCount?: number }) {
  const totals = STATIONS.reduce(
    (acc, s) => {
      acc.personnel += s.personnel;
      acc.capacity += s.capacity;
      return acc;
    },
    { personnel: 0, capacity: 0 },
  );
  const criticalStock = INVENTORY.filter(
    (i) => i.consumptionPerDay > 0 && i.stock > 0 && i.criticalThreshold > 0 && i.stock < i.criticalThreshold * 3.4,
  ).length;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <KpiTile label="ACTIVE STATIONS" value={`${STATIONS.length}/12`} hint="2 under watch" />
      <KpiTile label="PERSONNEL" value={`${totals.personnel}`} hint={`of ${KPI_SEED.personnelAuthorized} authorized`} />
      <KpiTile label="CARGO DELIVERED" value={`${KPI_SEED.cargoDeliveredPct}%`} hint="1 consignment verifying" />
      <KpiTile label="CRITICAL STOCK LINES" value={`${criticalStock}`} hint="below comfort margin" />
      <KpiTile label="ACTIVE ALERTS" value={`${3 + STATIONS.filter((s) => s.status !== "nominal").length - 2}`} hint="risks + anomalies" tone="alert" />
      <KpiTile
        label={queuedCount ? "QUEUED CHANGES" : "MISSION READINESS"}
        value={queuedCount ? `${queuedCount}` : `${KPI_SEED.missionReadiness}%`}
        hint={queuedCount ? "awaiting sync" : "risk-weighted"}
        tone={queuedCount ? "alert" : undefined}
      />
    </div>
  );
}

/* ---------------- Transport chips ---------------- */

export function UpcomingTransportList() {
  const priority: Record<TransportStatus, number> = {
    "IN TRANSIT": 0,
    DELAYED: 1,
    "WEATHER HOLD": 2,
    "ON TIME": 3,
    COMPLETED: 4,
    CANCELLED: 5,
  };
  const list = [...TRANSPORTS].sort((a, b) => priority[a.status] - priority[b.status]);
  return (
    <div className="space-y-2">
      {list.map((t) => (
        <div key={t.id} className="glass-inset rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-slate-900">{t.name}</p>
            <Badges.TransportBadge status={t.status} />
          </div>
          <p className="mt-0.5 text-[10.5px] text-slate-500">
            {t.origin} → {t.destination}
          </p>
          <p className="mt-0.5 text-[10.5px] font-medium text-slate-600">
            {t.status === "COMPLETED" ? `Arrived ${t.eta}` : `ETA ${t.eta}`}
            {t.delayDays ? ` · +${t.delayDays} d` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------------- SOS circular press-and-hold (reference style) ---------------- */

export function SosCircle({ onActivated }: { onActivated?: () => void }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const [state, setState] = useState<"idle" | "holding" | "running">("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const doneRef = useRef(false);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const beginHold = () => {
    if (state !== "idle") return;
    setState("holding");
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / 2000);
      setProgress(p);
      if (p >= 1) {
        cancelAnimationFrame(rafRef.current);
        void runFlow();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (state === "holding") {
      cancelAnimationFrame(rafRef.current);
      setProgress(0);
      setState("idle");
    }
  };

  const runFlow = async () => {
    setState("running");
    setSteps(["GPS LOCATION CAPTURED"]);
    await wait(550);
    setSteps((s) => [...s, "CONNECTIVITY CHECK — OFFLINE"]);
    await wait(550);
    setSteps((s) => [...s, "SOS QUEUED — PACKET STORED"]);
    await wait(550);
    setSteps((s) => [...s, "HQ ALERT — RESPONSE ACTIVE"]);
    if (!doneRef.current) {
      doneRef.current = true;
      onActivated?.();
    }
  };

  if (state === "running") {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-2.5" role="alert">
        <p className="text-[9.5px] font-extrabold tracking-wide text-red-600 uppercase">SOS protocol running</p>
        <ol className="mt-1 space-y-0.5">
          {steps.map((s, i) => (
            <li key={i} className="text-[9.5px] font-semibold text-red-700">{i + 1}. {s}</li>
          ))}
        </ol>
      </div>
    );
  }

  const C = 2 * Math.PI * 30;
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onMouseDown={beginHold}
        onMouseUp={cancelHold}
        onMouseLeave={cancelHold}
        onTouchStart={beginHold}
        onTouchEnd={cancelHold}
        className="relative flex h-[74px] w-[74px] touch-none items-center justify-center rounded-full select-none"
        aria-label="Hold for 2 seconds to send SOS"
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 74 74">
          <circle cx="37" cy="37" r="34" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
          <circle
            cx="37"
            cy="37"
            r="34"
            fill="none"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            style={{ display: progress > 0 ? undefined : "none" }}
          />
        </svg>
        <span className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-gradient-to-b from-red-500 to-red-600 text-[15px] font-extrabold tracking-widest text-white shadow-lg transition-transform active:scale-95">
          SOS
        </span>
      </button>
      <p className="mt-1.5 text-[9.5px] font-bold tracking-wide text-white/90 drop-shadow">Press & Hold 2 Sec</p>
      <p className="text-[8.5px] font-semibold text-white/70 drop-shadow">Area Location (KY, KD)</p>
    </div>
  );
}

/* ---------------- SOS press-and-hold (bar variant) ---------------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SosButton({ size = "md", onActivated }: { size?: "md" | "lg"; onActivated?: () => void }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const [state, setState] = useState<"idle" | "holding" | "running">("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const doneRef = useRef(false);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const beginHold = () => {
    if (state !== "idle") return;
    setState("holding");
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / 2000);
      setProgress(p);
      if (p >= 1) {
        cancelAnimationFrame(rafRef.current);
        void runSosFlow();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (state === "holding") {
      cancelAnimationFrame(rafRef.current);
      setProgress(0);
      setState("idle");
    }
  };

  const runSosFlow = async () => {
    setState("running");
    setSteps(["GPS LOCATION CAPTURED — -71.02, 13.90"]);
    await wait(550);
    setSteps((s) => [...s, "CONNECTIVITY CHECK — offline route selected"]);
    await wait(550);
    setSteps((s) => [...s, "OFFLINE — SOS QUEUED IN LOCAL PACKET STORE"]);
    await wait(550);
    setSteps((s) => [...s, "HQ ALERT PACKET READY — MAITRI COMMAND"]);
    await wait(550);
    setSteps((s) => [...s, "RESPONSE ACTIVE — INCIDENT #INC-2609-04"]);
    if (!doneRef.current) {
      doneRef.current = true;
      onActivated?.();
    }
  };

  if (state === "running") {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-3" role="alert">
        <p className="text-[11px] font-extrabold tracking-wide text-red-600 uppercase">SOS protocol running</p>
        <ol className="mt-1.5 space-y-1">
          {steps.map((s, i) => (
            <li key={i} className="text-[11px] font-medium text-red-700">
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <button
      type="button"
      onMouseDown={beginHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={beginHold}
      onTouchEnd={cancelHold}
      className={cn(
        "relative w-full touch-none overflow-hidden rounded-2xl border border-red-400 bg-gradient-to-b from-red-500 to-red-600 text-white shadow-lg transition-transform select-none active:scale-[0.98]",
        size === "lg" ? "py-4 text-base" : "py-2.5 text-sm",
      )}
      aria-label="Hold for 2 seconds to send SOS"
    >
      <span
        className="absolute inset-y-0 left-0 z-0 bg-white/30"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative z-10 font-extrabold tracking-widest">SOS · HOLD 2 SEC</span>
    </button>
  );
}
