import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  Flame,
  PackageSearch,
  Radar,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntelItem } from "@/lib/polar-intel";

interface Props {
  feed: IntelItem[];
  onApproveReject?: (id: string, outcome: "APPROVED" | "REJECTED") => void;
  onSimulate?: () => void;
  className?: string;
}

/** Curated priority order: the four insights that matter most right now. */
const PRIORITY_IDS = ["rec-hele-optim", "an-cargo-041", "pred-fuel-bharati", "risk-blizzard"];

const KIND_META: Record<
  IntelItem["kind"],
  { icon: typeof Flame; tint: string; ring: string; label: string }
> = {
  prediction: { icon: Flame, tint: "text-orange-600", ring: "bg-orange-500/10 ring-orange-400/30", label: "Prediction" },
  anomaly: { icon: PackageSearch, tint: "text-amber-600", ring: "bg-amber-500/10 ring-amber-400/30", label: "Anomaly" },
  risk: { icon: Wind, tint: "text-cyan-700", ring: "bg-cyan-500/10 ring-cyan-400/30", label: "Risk" },
  recommendation: {
    icon: BadgeCheck,
    tint: "text-sky-700",
    ring: "bg-sky-500/10 ring-sky-400/30",
    label: "Recommended action",
  },
};

export function IntelPanel({ feed, onApproveReject, onSimulate, className }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const items = PRIORITY_IDS.map((id) => feed.find((f) => f.id === id)).filter(
    (i): i is IntelItem => Boolean(i),
  );
  const extra = feed.filter((f) => !PRIORITY_IDS.includes(f.id));

  return (
    <div
      className={cn(
        "glass-strong flex max-h-full flex-col overflow-hidden rounded-2xl",
        "border-white/70 shadow-[0_18px_50px_-18px_rgba(10,35,70,0.45)]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/60 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-800 text-white shadow-sm">
          <Radar className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[11px] font-extrabold tracking-[0.14em] text-slate-800 uppercase">Polar Intelligence</p>
          <p className="text-[8.5px] font-bold tracking-wide text-slate-400 uppercase">
            Predict · Optimize · Detect · Assess
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8.5px] font-extrabold tracking-wide text-emerald-700 uppercase ring-1 ring-emerald-400/30">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>

      {/* Insights */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
        {items.map((item) => (
          <InsightCard
            key={item.id}
            item={item}
            expanded={!!expanded[item.id]}
            onToggle={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
            onOutcome={(o) => onApproveReject?.(item.id, o)}
          />
        ))}

        {/* Additional intel, compact one-liners */}
        {extra.length > 0 && (
          <div className="glass-inset rounded-xl px-3 py-2.5">
            <p className="text-[8.5px] font-extrabold tracking-widest text-slate-400 uppercase">Further signals</p>
            <ul className="mt-1.5 space-y-1">
              {extra.slice(0, 4).map((e) => (
                <li key={e.id} className="flex items-start gap-1.5 text-[10px] leading-snug font-semibold text-slate-600">
                  <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", e.severity === "critical" ? "bg-red-500" : e.severity === "warning" ? "bg-amber-500" : "bg-sky-400")} />
                  <span>
                    {e.title} — {e.headline}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      {onSimulate && (
        <button
          type="button"
          onClick={onSimulate}
          className="border-t border-white/60 px-4 py-2.5 text-left transition-colors hover:bg-white/40"
        >
          <p className="text-[10px] font-extrabold tracking-wide text-sky-800 uppercase">
            Run what-if simulation <span aria-hidden>→</span>
          </p>
          <p className="text-[9px] font-semibold text-slate-500">Model a ship delay and watch the impact propagate</p>
        </button>
      )}
    </div>
  );
}

function InsightCard({
  item,
  expanded,
  onToggle,
  onOutcome,
}: {
  item: IntelItem;
  expanded: boolean;
  onToggle: () => void;
  onOutcome: (o: "APPROVED" | "REJECTED") => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const criticalRing = item.severity === "critical" ? "border-red-300/60" : item.severity === "warning" ? "border-amber-300/50" : "border-sky-200/60";

  return (
    <div className={cn("glass-inset rounded-xl border p-3", criticalRing, item.state === "APPROVED" && "opacity-60")}>
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1", meta.ring, meta.tint)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11.5px] leading-tight font-extrabold text-slate-900">{item.title}</p>
            {item.severity === "critical" && (
              <span className="shrink-0 rounded bg-red-500/15 px-1 py-px text-[7.5px] font-extrabold tracking-wide text-red-600 uppercase">
                High
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] leading-snug font-semibold text-slate-500">{item.subject} · {meta.label}</p>
          <p className="mt-1 text-[10.5px] leading-snug font-semibold text-slate-700">{item.headline}</p>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg bg-white/60 px-2.5 py-2">
          <p className="flex items-center gap-1 text-[8.5px] font-extrabold tracking-widest text-slate-400 uppercase">
            <AlertTriangle className="h-2.5 w-2.5" /> Why?
          </p>
          <ul className="mt-1 space-y-0.5">
            {item.why.slice(0, 4).map((w, i) => (
              <li key={i} className="flex gap-1.5 text-[9.5px] leading-snug font-medium text-slate-600">
                <span className="text-sky-400">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-full bg-white/70 px-2.5 py-1 text-[9.5px] font-extrabold text-slate-600 ring-1 ring-slate-200/70 transition-colors hover:bg-white"
        >
          Why?
        </button>
        {item.kind === "recommendation" && item.state === "RECOMMENDATION" ? (
          <>
            <button
              type="button"
              onClick={() => onOutcome("REJECTED")}
              className="rounded-full bg-white/70 px-2.5 py-1 text-[9.5px] font-extrabold text-slate-600 ring-1 ring-slate-200/70 hover:bg-white"
            >
              Modify
            </button>
            <button
              type="button"
              onClick={() => onOutcome("APPROVED")}
              className="rounded-full bg-sky-600 px-3 py-1 text-[9.5px] font-extrabold text-white shadow-sm transition-colors hover:bg-sky-700"
            >
              Approve
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto rounded-full bg-sky-600 px-3 py-1 text-[9.5px] font-extrabold text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            Review
          </button>
        )}
      </div>
    </div>
  );
}

void ChevronDown;
