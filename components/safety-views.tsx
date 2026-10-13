/**
 * POLARIS safety modules — convoy command, hazard-aware route review,
 * incident log, and the emergency command center.
 */
import { useState } from "react";
import { CheckCircle2, LocateFixed, Radar, Siren, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CONVOYS, EXPOSURE_TONE, INCIDENTS_SEED, convoyStatusLine, assessRouteExposure, responseResourcesNear, type Convoy } from "@/lib/safety";
import { HAZARDS, ROUTES, stationById } from "@/lib/polar-data";
import { useOps } from "@/lib/ops-store";

const card = "rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-md";

export function ConvoyModule() {
  const { goto, ackSos, assignSosResponse, sos } = useOps();
  const [openId, setOpenId] = useState<string | null>("cv-05");

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">Convoy & Field Movement</h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">Personnel · vehicles · route · comms · check-ins — missed check-ins alert the control room automatically · SIMULATED</p>
      </header>

      <div className="space-y-1.5">
        {CONVOYS.map((c) => (
          <ConvoyCard key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} onLocate={() => c.lastKnown && goto("home", { lat: c.lastKnown.lat, lon: c.lastKnown.lon, label: c.name })} />
        ))}
      </div>

      {sos.active && (
        <div className={cn(card, "flex flex-wrap items-center gap-3 border-red-400/40 p-3")}>
          <Siren className="h-5 w-5 text-red-400" />
          <p className="text-[12px] font-extrabold text-white">INC-2609-04 active — response: {sos.stage >= 3 ? "S-04 + med team RESPONDING" : "not yet assigned"}</p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-[10.5px] font-bold" onClick={ackSos}>Acknowledge</Button>
            <Button size="sm" className="h-7 bg-red-500 text-[10.5px] font-bold hover:bg-red-600" onClick={assignSosResponse}>Assign response</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function ConvoyCard({ c, open, onToggle, onLocate }: { c: Convoy; open: boolean; onToggle: () => void; onLocate: () => void }) {
  const exposure = c.routeId ? assessRouteExposure(c.routeId) : null;
  const nearHazards = HAZARDS.filter((h) => {
    if (!c.lastKnown) return false;
    const dx = (h.lon - c.lastKnown.lon) * 55;
    const dy = (h.lat - c.lastKnown.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy) < h.radiusKm * 1.8;
  });

  return (
    <div className={cn(card, "px-3 py-2.5", c.comms === "MISSED CHECK-IN" && "ring-1 ring-red-400/50")}>
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-extrabold text-white">{c.name}</p>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-wide",
            c.comms === "CONNECTED" ? "bg-emerald-500/15 text-emerald-300" : c.comms === "LOW CONNECTIVITY" ? "bg-amber-500/15 text-amber-300" : "animate-pulse bg-red-500/25 text-red-300",
          )}>
            {c.comms === "MISSED CHECK-IN" ? "MISSED CHECK-IN" : c.comms}
          </span>
          <span className="ml-auto text-[10px] font-bold text-sky-200/60">{convoyStatusLine(c).split("· ").slice(-1)}</span>
        </div>
        <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
          {c.personnel} personnel · {c.vehicles.length} vehicles ({c.vehicles.join(", ")}) · {c.from} → {c.to} · dep {c.departure} · ETA {c.expectedArrival} · last sync {c.lastSyncMinAgo} min ago
        </p>
      </button>

      {open && (
        <div className="mt-2.5 space-y-2 rounded-lg bg-black/20 p-2.5 text-[11px]">
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <p><span className="font-bold text-sky-200/50 uppercase">Cargo: </span><span className="font-semibold text-white">{c.cargoSummary}</span></p>
            <p><span className="font-bold text-sky-200/50 uppercase">Check-in: </span><span className="font-semibold text-white">{c.checkInDue}</span></p>
            <p><span className="font-bold text-sky-200/50 uppercase">Comms: </span><span className="font-semibold text-white">{c.emergencyContact}</span></p>
            <p><span className="font-bold text-sky-200/50 uppercase">Last known: </span><span className="font-semibold text-white">{c.lastKnown ? `${c.lastKnown.lat.toFixed(2)}°S ${c.lastKnown.lon.toFixed(2)}°E` : "—"}</span></p>
          </div>

          {exposure && exposure.exposure !== "LOW" && (
            <div className={cn("rounded-lg p-2.5", EXPOSURE_TONE[exposure.exposure].replace("text-", "text-").split(" ")[0])}>
              <p className="flex items-center gap-1.5 text-[11px] font-extrabold">
                <TriangleAlert className="h-3.5 w-3.5" /> ROUTE EXPOSURE DETECTED — {exposure.exposure} ({c.routeId})
              </p>
              <p className="mt-1 text-[10.5px] text-sky-100/85">Convoy {c.name} is on this route. {exposure.why[0]}</p>
            </div>
          )}

          {c.comms === "MISSED CHECK-IN" && (
            <div className="rounded-lg bg-red-500/10 p-2.5 ring-1 ring-red-400/40">
              <p className="text-[11px] font-extrabold text-red-300">MISSED CHECK-IN — control room notified</p>
              <ul className="mt-1 space-y-0.5 text-[10.5px] text-sky-100/85">
                <li>• Last known position {c.lastKnown ? `${c.lastKnown.lat.toFixed(2)}°S ${c.lastKnown.lon.toFixed(2)}°E` : "—"} (showing on map)</li>
                <li>• Route {c.from} → {c.to} · {nearHazards.length} nearby hazard zone(s): {nearHazards.map((h) => h.label).join(", ") || "none"}</li>
                <li>• Available response: {responseResourcesNear(c.lastKnown?.lat ?? -70, c.lastKnown?.lon ?? 12).map((r) => r.name).join(" · ")}</li>
              </ul>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" className="h-7 bg-red-500 text-[10.5px] font-bold hover:bg-red-600" onClick={onLocate}>Show last known position</Button>
                <Button size="sm" variant="outline" className="h-7 text-[10.5px] font-bold">Attempt VHF contact</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onLocate} className="flex h-6 w-6 items-center justify-center rounded-full text-sky-300 hover:bg-sky-500/10" title="Locate on map">
          <LocateFixed className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hazard-aware route review (AI recommends, human approves)           */
/* ------------------------------------------------------------------ */

export function RouteReviewModule() {
  const { approveIntel, goto, queue } = useOps();
  const [openId, setOpenId] = useState<string | null>("r-suhrid");
  const exposureIds = ["r-suhrid", "r-priya", "r-larsemann"];

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">Hazard-Aware Routing</h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">PERSON / VEHICLE → PLANNED ROUTE → HAZARD ZONE → WEATHER → ROUTE RISK — AI recommends; humans decide</p>
      </header>

      <div className="space-y-1.5">
        {exposureIds.map((rid) => {
          const e = assessRouteExposure(rid);
          if (!e) return null;
          const route = ROUTES.find((r) => r.id === rid)!;
          const open = openId === rid;
          return (
            <div key={rid} className={cn(card, "px-3 py-2.5", (e.exposure === "HIGH" || e.exposure === "CRITICAL") && "ring-1 ring-amber-400/40")}>
              <button type="button" onClick={() => setOpenId(open ? null : rid)} className="w-full text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12.5px] font-extrabold text-white">{route.label}</p>
                  <span className={cn("rounded px-2 py-0.5 text-[9px] font-extrabold", EXPOSURE_TONE[e.exposure])}>ROUTE EXPOSURE: {e.exposure}</span>
                  {e.affectedConvoys.map((cn_) => (
                    <span key={cn_} className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-200/80">{cn_}</span>
                  ))}
                </div>
                <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">{e.from} → {e.to} · {e.kind} route · risk score {e.score}/100</p>
              </button>

              {open && (
                <div className="mt-2.5 space-y-2 rounded-lg bg-black/20 p-2.5 text-[11px]">
                  <div>
                    <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Why?</p>
                    <ul className="mt-1 space-y-0.5">
                      {e.why.map((w) => (
                        <li key={w} className="flex gap-1.5 text-[10.5px] text-sky-100/85"><span className="text-sky-400">•</span><span>{w}</span></li>
                      ))}
                    </ul>
                  </div>
                  {e.alternative && (
                    <div className="rounded-lg bg-emerald-500/10 p-2.5 ring-1 ring-emerald-400/30">
                      <p className="text-[10.5px] font-extrabold text-emerald-300">ALTERNATIVE ROUTE AVAILABLE</p>
                      <p className="mt-0.5 text-[10.5px] text-sky-100/85">{e.alternative}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[10.5px] font-bold" onClick={() => goto("home")}>Review Route</Button>
                    <Button
                      size="sm"
                      className="h-7 bg-sky-500 text-[10.5px] font-bold hover:bg-sky-600"
                      onClick={() => approveIntel(`rec-route-${rid}`, "APPROVED")}
                    >
                      Approve
                    </Button>
                    <span className="text-[9.5px] font-semibold text-sky-200/50">Approval is audit-logged — AI never auto-executes route changes</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-sky-200/50">{queue.filter((q) => q.kind === "GPS EVENT" || q.kind === "TASK STATUS").length} live P2 movement/hazard events in the sync queue.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Emergency command center                                            */
/* ------------------------------------------------------------------ */

const SOS_STAGES = ["TRIGGERED", "ACKNOWLEDGED", "RESPONSE ASSIGNED", "RESPONDING", "RESOLVED"] as const;

export function EmergencyCommandModule() {
  const { sos, ackSos, assignSosResponse, resolveSos, goto, goto: _g } = useOps();
  void _g;
  const stageIdx = sos.stage === 4 ? 4 : sos.stage === 3 ? 3 : sos.stage === 2 ? 2 : sos.stage === 1 ? 1 : 0;
  const station = stationById("camp-suhrid");

  return (
    <section className="space-y-3">
      <header>
        <h2 className="flex items-center gap-2 text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">
          <Radar className="h-4 w-4 text-red-400" /> Emergency Command Center
        </h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">Incident INC-2609-04 · received via offline SOS packet (P1 transmission)</p>
      </header>

      <div className={cn(card, "border-red-400/40 p-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500 text-white shadow-md"><Siren className="h-6 w-6" /></span>
          <div>
            <p className="text-[14px] font-extrabold tracking-widest text-red-300">SOS-204 · INC-2609-04</p>
            <p className="text-[12.5px] font-bold text-white">PERSON: Tenzing Bhutia — Field Researcher</p>
          </div>
          <span className={cn("ml-auto rounded-full px-3 py-1 text-[10px] font-extrabold tracking-wide", sos.active ? "animate-pulse bg-red-500/20 text-red-300" : "bg-emerald-500/15 text-emerald-300")}>
            {sos.active ? SOS_STAGES[stageIdx] : "RESOLVED"}
          </span>
        </div>

        <div className="mt-3 grid gap-x-6 gap-y-1.5 text-[11.5px] sm:grid-cols-2">
          <Fact k="LOCATION" v="−71.02, 13.90 (GPS, device-captured offline)" />
          <Fact k="LAST SYNC" v="14:39 · 4 min before trigger" />
          <Fact k="BATTERY" v="34%" />
          <Fact k="DEVICE" v="Field tablet FT-07 · GPS fix valid" />
          <Fact k="EMERGENCY CATEGORY" v="Medical / immobilization" />
          <Fact k="LAST KNOWN ROUTE" v="Maitri → Camp Suhrid (over-ice, guided)" />
          <Fact k="NEARBY HAZARD" v="Crevasse Field — Sector C (9 km radius)" />
          <Fact k="NEAREST STATION" v={station ? `${station.name} — 41 km` : "Maitri — 41 km"} />
          <Fact k="AVAILABLE RESPONSE" v="S-04 (ready) · H-01 (weather hold) · Maitri med team" />
          <Fact k="COMMS CHANNEL" v="Satellite unavailable → stored locally → P1 queued" />
        </div>

        {/* status pipeline */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {SOS_STAGES.map((s, i) => (
            <span key={s} className={cn("rounded-full px-2.5 py-1 text-[9.5px] font-extrabold tracking-wide", i < stageIdx ? "bg-emerald-500/15 text-emerald-300" : i === stageIdx ? "bg-sky-500/25 text-sky-200" : "bg-white/5 text-sky-200/40")}>
              {s}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={sos.stage >= 2 ? "outline" : "default"} className="h-8 text-[11px] font-bold" onClick={ackSos} disabled={sos.stage >= 2 || !sos.active}>
            {sos.stage >= 2 ? <><CheckCircle2 className="mr-1 h-3 w-3" /> Acknowledged</> : "ACKNOWLEDGE"}
          </Button>
          <Button size="sm" className="h-8 bg-red-500 text-[11px] font-bold hover:bg-red-600" onClick={assignSosResponse} disabled={sos.stage >= 3 || !sos.active}>
            ASSIGN RESPONSE (S-04 + MED TEAM)
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold" onClick={() => goto("home", { lat: -71.02, lon: 13.9, label: "INC-2609-04" })} disabled={!sos.active}>
            SHOW ON MAP
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold" onClick={resolveSos} disabled={!sos.active}>
            RESOLVE INCIDENT
          </Button>
        </div>
        <p className="mt-2 text-[9.5px] font-semibold text-sky-200/50">Live location is shown only to authorized command roles — field positions are never exposed broadly.</p>
      </div>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <p>
      <span className="font-bold tracking-wide text-sky-200/50">{k}: </span>
      <span className="font-semibold text-white">{v}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Incident / safety history                                           */
/* ------------------------------------------------------------------ */

export function IncidentLogModule() {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">Incident & Safety History</h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">
          Operational lesson, not sensational record: field incidents happen during movement, in hazardous terrain, when comms & response logistics matter most.
        </p>
      </header>

      <div className={cn(card, "flex flex-wrap items-center gap-2 p-3 text-[10px] font-bold text-sky-200/80")}>
        <span>ONE OPERATIONAL CHAIN:</span>
        {["Movement", "Route", "Hazard", "Weather", "Connectivity", "Check-in", "SOS", "Response"].map((x, i, arr) => (
          <span key={x} className="flex items-center gap-2">
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[9.5px] font-extrabold text-sky-200">{x}</span>
            {i < arr.length - 1 && <span className="text-sky-400/60">→</span>}
          </span>
        ))}
      </div>

      <div className="space-y-1.5">
        {INCIDENTS_SEED.map((i) => (
          <div key={i.id} className={cn(card, "p-3", i.open && "ring-1 ring-red-400/40")}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] font-extrabold text-white">{i.id}</p>
              <span className={cn("rounded px-2 py-0.5 text-[9px] font-extrabold", i.open ? "bg-red-500/20 text-red-300" : "bg-emerald-500/15 text-emerald-300")}>{i.open ? "OPEN" : "RESOLVED"}</span>
              <span className="ml-auto text-[10px] font-bold text-sky-200/60">{i.date} · {i.time}</span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-sky-100/85">{i.location} · {i.people}</p>
            <div className="mt-1.5 grid gap-x-4 gap-y-1 text-[10.5px] sm:grid-cols-2">
              <Fact k="Mission / convoy" v={i.mission} />
              <Fact k="Hazard" v={i.hazard} />
              <Fact k="Weather" v={i.weather} />
              <Fact k="Communication" v={i.comms} />
              <Fact k="Response time" v={i.responseTime} />
              <Fact k="Resolution" v={i.resolution} />
            </div>
            <div className="mt-1.5">
              <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Actions taken</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {i.actions.map((a) => (
                  <li key={a} className="rounded-full bg-white/10 px-2 py-0.5 text-[9.5px] font-bold text-sky-100/80">{a}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
