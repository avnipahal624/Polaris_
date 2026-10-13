import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { simulate, type SimResult } from "@/lib/polar-intel";
import type { SimScenario, SimScenarioId } from "@/lib/polar-data";
import { cn } from "@/lib/utils";
import { Radar, Siren, User } from "lucide-react";

/* ---------------- Emergency command view ---------------- */

export interface SosIncident {
  person: string;
  role: string;
  location: string;
  coords: string;
  time: string;
  lastMovement: string;
  nearestStation: string;
  nearestVehicle: string;
  weather: string;
  routeNote: string;
  battery: string;
  category: string;
  lastSync: string;
  stationId: string;
}

export const SEED_SOS: SosIncident = {
  person: "Tenzing Bhutia",
  role: "Field Researcher",
  location: "Camp B — Sector 4 approach",
  coords: "-71.02, 13.90",
  time: "14:43",
  lastMovement: "14:37",
  nearestStation: "Maitri — 41 km",
  nearestVehicle: "Snow Vehicle S-04",
  weather: "Blizzard approaching",
  routeNote: "Hazard exposure detected — Crevasse Field, Sector C",
  battery: "34%",
  category: "Medical / immobilization",
  lastSync: "14:39",
  stationId: "camp-suhrid",
};

export function EmergencyBanner({ sos, onOpenMap, onLog }: { sos: SosIncident; onOpenMap: () => void; onLog: () => void }) {
  const [acked, setAcked] = useState(false);
  return (
    <div className="polar-scan relative overflow-hidden rounded-2xl border border-red-400/80 bg-gradient-to-r from-red-50 via-white to-red-50 shadow-lg">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-red-300 bg-red-500 text-white shadow-md">
            <Siren className="h-6 w-6" />
          </span>
          <div>
            <p className="flex items-center gap-2 text-[12px] font-extrabold tracking-widest text-red-600 uppercase">
              🚨 ACTIVE SOS
              {!acked && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
            </p>
            <p className="text-sm font-bold text-slate-900">{sos.person} — {sos.role}</p>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
          <EmFact label="Location" value={sos.location} sub={sos.coords} />
          <EmFact label="Time / last move" value={sos.time} sub={`Last movement ${sos.lastMovement}`} />
          <EmFact label="Nearest station" value={sos.nearestStation} sub={`Vehicle: ${sos.nearestVehicle}`} />
          <EmFact label="Weather" value={sos.weather} sub={sos.routeNote} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={acked ? "outline" : "destructive"} className="h-8 text-[11px] font-bold" onClick={() => setAcked(true)}>
            {acked ? "Acknowledged ✓" : "ACKNOWLEDGE"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold" onClick={onOpenMap}>
            OPEN MAP
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold">
            VIEW PERSON
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold">
            ASSIGN RESPONSE
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold" onClick={onLog}>
            START INCIDENT LOG
          </Button>
        </div>
      </div>
      <div className="polar-scrim-soft flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[10.5px] font-semibold text-slate-700">
        <span>Satellite status: <b>OFFLINE — SOS QUEUED</b> (packet will route when link restores)</span>
        <span>Battery: <b>{sos.battery}</b></span>
        <span>Category: <b>{sos.category}</b></span>
        <span>Last successful sync: <b>{sos.lastSync}</b></span>
      </div>
    </div>
  );
}

function EmFact({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-bold tracking-widest text-slate-400 uppercase">{label}</p>
      <p className="text-[11.5px] font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500">{sub}</p>
    </div>
  );
}

/* ---------------- What-if simulator ---------------- */

export function SimulatorDialog({
  open,
  onOpenChange,
  scenarios,
  result,
  onRun,
  onApprove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scenarios: readonly SimScenario[];
  result: SimResult | null;
  onRun: (id: SimScenarioId, delayDays: number) => void;
  onApprove: () => void;
}) {
  const [selected, setSelected] = useState<SimScenarioId>("ship-delay");
  const [days, setDays] = useState(5);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = scenarios.find((s) => s.id === selected) ?? scenarios[0];
  const withDelay = active?.hasDelay === true;

  const run = () => {
    setBusy(true);
    setResultSafe(null);
    window.setTimeout(() => {
      onRun(selected, withDelay ? days : 5);
      setBusy(false);
    }, 700);
  };

  // Keep a local copy so the dialog can show the pre-approval projection and
  // the committed store result side by side.
  const [local, setLocal] = useState<SimResult | null>(null);
  const setResultSafe = setLocal;
  const shown = result ?? local;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4.5 w-4.5 text-sky-600" />
            WHAT-IF EXPEDITION SIMULATOR
          </DialogTitle>
          <DialogDescription>
            Runs the scenario against the shared operational picture: cargo → inventory → forecast → risk → transport →
            recommendation. Human approval is required before any mitigation is applied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition-colors",
                selected === s.id
                  ? "border-sky-400 bg-sky-50/90 ring-1 ring-sky-300"
                  : "border-slate-200 bg-white/60 hover:border-sky-300",
              )}
            >
              <p className="text-[12px] font-extrabold text-slate-800">{s.label}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{s.detail}</p>
            </button>
          ))}
        </div>

        <div className="glass-inset flex flex-wrap items-center gap-3 rounded-xl p-3">
          <span className="text-[12px] font-semibold text-slate-700">“What happens if {active?.label.toLowerCase()}</span>
          {withDelay && (
            <>
              <input
                type="number"
                min={1}
                max={14}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
                className="h-8 w-16 rounded-lg border border-sky-200 bg-white px-2 text-center text-[13px] font-bold text-slate-800 outline-none focus:border-sky-400"
              />
              <span className="text-[12px] font-semibold text-slate-700">days?”</span>
            </>
          )}
          {!withDelay && <span className="text-[12px] font-semibold text-slate-700">occurs?</span>}
          <Button size="sm" className="ml-auto h-8 bg-sky-600 text-[11px] font-bold hover:bg-sky-700" onClick={run}>
            SIMULATE
          </Button>
        </div>

        {busy && (
          <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="text-[11.5px] font-semibold text-sky-800">
              PREDICTION → ANOMALY DETECTION → RISK ENGINE → OPTIMIZATION → RECOMMENDATION…
            </p>
          </div>
        )}

        {shown && (
          <div className="space-y-3">
            <div
              className={cn(
                "rounded-xl border px-3 py-2",
                shown.riskLevel === "HIGH OPERATIONAL RISK"
                  ? "border-red-300 bg-red-50/80"
                  : shown.riskLevel === "ELEVATED RISK"
                    ? "border-amber-300 bg-amber-50/80"
                    : "border-emerald-300 bg-emerald-50/70",
              )}
            >
              <p className="text-[11px] font-extrabold tracking-widest uppercase">
                <span
                  className={
                    shown.riskLevel === "HIGH OPERATIONAL RISK"
                      ? "text-red-700"
                      : shown.riskLevel === "ELEVATED RISK"
                        ? "text-amber-700"
                        : "text-emerald-700"
                  }
                >
                  {shown.riskLevel}
                </span>
              </p>
              <p className="text-[11px] text-slate-600">{shown.query}</p>
            </div>

            <div>
              <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Predicted impact</p>
              <div className="mt-1.5 space-y-1.5">
                {shown.impacts.map((imp, i) => (
                  <div key={i} className="glass-inset flex flex-wrap items-baseline gap-x-3 rounded-lg px-3 py-2">
                    <span className="w-16 text-[10px] font-extrabold tracking-wide text-sky-800 uppercase">{imp.resource}</span>
                    <span className="text-[11px] font-bold text-slate-800">{imp.station}</span>
                    <span className={cn("text-[11.5px] font-bold", imp.impact === "Unaffected" ? "text-emerald-700" : "text-red-600")}>
                      {imp.impact}
                    </span>
                    <span className="w-full text-[10.5px] text-slate-500">{imp.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-extrabold tracking-widest text-emerald-700 uppercase">Recommended mitigation</p>
                <button
                  type="button"
                  onClick={() => setWhy((v) => !v)}
                  className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[9.5px] font-extrabold text-emerald-700 hover:bg-emerald-600/20"
                >
                  {why ? "HIDE WHY?" : "WHY?"}
                </button>
              </div>
              <ul className="mt-1.5 space-y-1">
                {shown.mitigation.map((m, i) => (
                  <li key={i} className="flex gap-1.5 text-[11.5px] text-slate-700">
                    <span className="font-bold text-emerald-600">{i + 1}.</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
              {why && (
                <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[10.5px] leading-snug text-slate-600">
                  <b>What happened:</b> {active?.label} {withDelay ? `(+${shown.delayDays} days)` : ""}.{" "}
                  <b>Data used:</b> station reserves, consumption rates, transport ETAs, cargo lifecycle state, weather and
                  hazard geometry. <b>Predicted impact:</b> the rows above, propagated through the inventory and fuel forecast
                  models. POLAR INTELLIGENCE recommends; it never executes.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          <p className="mr-auto flex items-center gap-1 text-[10px] font-semibold text-slate-400">
            <User className="h-3 w-3" /> Human approval required — approving writes the updated plan to the audit log.
          </p>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" className="h-8 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-700" onClick={onApprove}>
            APPROVE PLAN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
