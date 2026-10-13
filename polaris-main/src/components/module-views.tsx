/**
 * POLARIS operational modules.
 * Every module reads/writes the SAME central ops store — no isolated mock pages.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  LocateFixed,
  ScanLine,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePolarisLive } from "@/lib/polaris-live";
import type { ModuleId } from "@/lib/ops-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LIFECYCLE_STAGES,
  PERSONNEL_EXTRA,
  ROSTER,
  SHIPMENT_EXTRA,
  STATIONS,
  TRANSPORTS,
  stationById,
  type Shipment,
  type Station,
} from "@/lib/polar-data";
import {
  INVENTORY_FULL,
  EQUIPMENT,
  SAMPLES,
  useOps,
  type SearchHit,
} from "@/lib/ops-store";
import { assessStationRisk, computeDepletion } from "@/lib/polar-intel";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const chip = "rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-wide whitespace-nowrap";
const sev = {
  CRITICAL: "bg-red-500/15 text-red-300 ring-1 ring-red-400/40",
  HIGH: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40",
  MEDIUM: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/40",
  INFORMATION: "bg-slate-500/10 text-sky-200/70 ring-1 ring-white/20",
} as const;

export function Chip({ children, tone }: { children: React.ReactNode; tone?: keyof typeof sev }) {
  return <span className={cn(chip, tone ? sev[tone] : sev.INFORMATION)}>{children}</span>;
}

function LocateBtn({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const { goto } = useOps();
  return (
    <button
      type="button"
      title="Locate on map"
      onClick={() => goto("home", { lat, lon, label })}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sky-300 transition-colors hover:bg-sky-500/10"
    >
      <LocateFixed className="h-3.5 w-3.5" />
    </button>
  );
}

function ModuleShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">{title}</h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">{sub} · SIMULATED demo data on real geography</p>
      </header>
      {children}
    </section>
  );
}

const card = "rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-md";
const row = "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/10";

/* ------------------------------------------------------------------ */
/* CARGO & INVENTORY                                                   */
/* ------------------------------------------------------------------ */

function LifecycleBar({ status }: { status: Shipment["status"] }) {
  const idx = LIFECYCLE_STAGES.indexOf(status as (typeof LIFECYCLE_STAGES)[number]);
  return (
    <div className="flex items-center gap-0.5">
      {LIFECYCLE_STAGES.map((s, i) => (
        <span
          key={s}
          title={s}
          className={cn("h-1.5 flex-1 rounded-full", i <= idx ? (idx >= 8 ? "bg-emerald-400" : "bg-sky-400") : "bg-white/15")}
        />
      ))}
    </div>
  );
}

export function CargoModule() {
  const { ops, scanCargo, queue } = useOps();
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [scanResult, setScanResult] = useState<null | { kind: string; msg: string }>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");

  const shipments = ops.shipments;
  const filtered = shipments.filter((s) => {
    const ql = q.toLowerCase();
    const matchQ = !ql || `${s.id} ${s.category} ${s.barcode} ${s.rfid} ${s.currentLocation}`.toLowerCase().includes(ql);
    const matchF =
      filter === "ALL" ||
      (filter === "IN TRANSIT" && (s.status === "TRANSPORTED" || s.status === "LOADED")) ||
      (filter === "VERIFY" && s.containersUnverified > 0) ||
      (filter === "DELAYED" && s.currentLocation.includes("delay"));
    return matchQ && matchF;
  });

  const doScan = () => {
    if (!scan.trim()) return;
    const r = scanCargo(scan);
    setScanResult({
      kind: r,
      msg:
        r === "found"
          ? `${scan} verified against manifest — queued to central inventory.`
          : r === "unverified"
            ? `${scan} belongs to a consignment with unverified containers — discrepancy escalated.`
            : `${scan} NOT in manifest — missing-cargo detection raised.`,
    });
    setScan("");
  };

  const missing = shipments.filter((s) => s.containersReceived < s.containersExpected && s.status === "ARRIVED");

  const detail = shipments.find((s) => s.id === openId);
  const dExtra = detail ? SHIPMENT_EXTRA[detail.id] : undefined;
  const dTransport = detail ? TRANSPORTS.find((t) => t.id === detail.transportId) : undefined;

  return (
    <ModuleShell title="Cargo & Inventory" sub="Warehouse → Loaded → Dispatched → In Transit → Arrived → Unloaded → Received → Scanned → Stored → Consumed">
      <div className={cn(card, "p-3")}>
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-widest text-sky-200 uppercase">
          <ScanLine className="h-3.5 w-3.5" /> Barcode / RFID scan (works offline)
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            placeholder="Scan or type 6200412604 / RF-ANT-041-2606"
            className="h-8 border-white/20 bg-white/10 text-[12px] font-bold text-white placeholder:text-sky-200/40"
            onKeyDown={(e) => e.key === "Enter" && doScan()}
          />
          <Button size="sm" className="h-8 bg-sky-500 text-[11px] font-bold hover:bg-sky-600" onClick={doScan}>
            SCAN
          </Button>
        </div>
        {scanResult && (
          <p className={cn("mt-2 flex items-center gap-1.5 text-[11px] font-bold", scanResult.kind === "found" ? "text-emerald-300" : scanResult.kind === "unverified" ? "text-amber-300" : "text-red-300")}>
            {scanResult.kind === "found" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
            {scanResult.msg}
          </p>
        )}
        <p className="mt-1.5 text-[9.5px] font-semibold text-sky-200/50">{queue.filter((x) => x.kind === "CARGO SCAN").length} scan events in sync queue · reconciled with central system on sync</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="In transit / loaded" value={`${shipments.filter((s) => s.status === "TRANSPORTED" || s.status === "LOADED").length}`} />
        <SummaryTile label="Unverified containers" value={`${shipments.reduce((a, s) => a + s.containersUnverified, 0)}`} tone="warn" />
        <SummaryTile label="Missing (expected vs received)" value={`${missing.reduce((a, s) => a + (s.containersExpected - s.containersReceived), 0)}`} tone="bad" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {["ALL", "IN TRANSIT", "VERIFY", "DELAYED"].map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-full px-2.5 py-1 text-[10px] font-extrabold", filter === f ? "bg-sky-500 text-white" : "bg-white/10 text-sky-200/80 hover:bg-white/20")}>
            {f}
          </button>
        ))}
        <div className="relative ml-auto w-44">
          <Search className="absolute top-2 left-2 h-3.5 w-3.5 text-sky-200/50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cargo…" className="h-8 w-full rounded-lg border border-white/15 bg-white/10 pr-2 pl-7 text-[11px] font-semibold text-white placeholder:text-sky-200/40" />
        </div>
      </div>

      <div className="space-y-1.5">
        {filtered.map((s) => (
          <div key={s.id} className={cn(card, "px-3 py-2.5")}>
            <button type="button" onClick={() => setOpenId(s.id === openId ? null : s.id)} className="w-full text-left">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-extrabold text-white">{s.id}</p>
                <Chip>{s.category}</Chip>
                <Chip tone={s.priority === "CRITICAL" ? "CRITICAL" : s.priority === "HIGH" ? "HIGH" : "INFORMATION"}>{s.priority}</Chip>
                {s.containersUnverified > 0 && <Chip tone="HIGH">{s.containersUnverified} unverified</Chip>}
                {s.currentLocation.includes("delay") && <Chip tone="HIGH">delayed</Chip>}
                <span className="ml-auto text-[10px] font-bold text-sky-200/60">{s.containersReceived}/{s.containersExpected} received</span>
              </div>
              <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
                {s.origin} → {stationById(s.destinationId)?.short ?? s.destinationId} · {s.weightKg.toLocaleString()} kg · ETA {s.expectedArrival} · {s.currentLocation}
              </p>
              <div className="mt-1.5"><LifecycleBar status={s.status} /></div>
            </button>

            {openId === s.id && (
              <div className="mt-2.5 grid gap-2 rounded-lg bg-black/20 p-2.5 text-[11px] text-sky-100/90 sm:grid-cols-2">
                <Fact k="Barcode / RFID" v={`${s.barcode} · ${s.rfid}`} />
                <Fact k="Quantity" v={dExtra?.quantity ?? `${s.containersExpected} containers`} />
                <Fact k="Weight" v={`${s.weightKg.toLocaleString()} kg`} />
                <Fact k="Responsible" v={dExtra?.responsible ?? s.stationResponsible} />
                <Fact k="Dispatch" v={s.dispatchDate} />
                <Fact k="Expected arrival" v={s.expectedArrival} />
                <Fact k="Actual arrival" v={s.actualArrival ?? "—"} />
                <Fact k="Verification" v={s.containersUnverified > 0 ? `${s.containersUnverified} containers pending verification` : "Verified"} />
                <Fact k="Transport" v={dTransport ? `${dTransport.name} · ${dTransport.status}` : s.currentLocation} />
                <Fact k="Received note" v={dExtra?.receivedNote ?? "—"} />
                <div className="sm:col-span-2">
                  <p className="text-[9.5px] font-bold tracking-widest text-sky-200/50 uppercase">Shipment timeline</p>
                  <ol className="mt-1 space-y-0.5 text-[10.5px]">
                    {LIFECYCLE_STAGES.map((step, i) => {
                      const cur = LIFECYCLE_STAGES.indexOf(s.status as (typeof LIFECYCLE_STAGES)[number]);
                      return (
                        <li key={step} className={cn("flex items-center gap-1.5", i <= cur ? "text-white" : "text-sky-200/35")}>
                          <span className={cn("h-1 w-1 rounded-full", i <= cur ? "bg-sky-400" : "bg-white/20")} />
                          {step}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-[11px] text-sky-200/50">No consignments match.</p>}
      </div>

      <h3 className="pt-2 text-[11px] font-extrabold tracking-widest text-sky-200 uppercase">Inventory — stock, minimum reserve, consumption & expiry</h3>
      <div className={cn(card, "divide-y divide-white/10")}>
        {INVENTORY_FULL.map((i) => {
          const st = stationById(i.stationId);
          const daysLeft = i.consumptionPerDay > 0 && i.unit === "L" ? (i.stock / i.consumptionPerDay).toFixed(1) : null;
          const low = i.stock < i.minThreshold;
          return (
            <div key={i.id} className={row}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11.5px] font-extrabold text-white">{i.name}</p>
                  <Chip>{i.category}</Chip>
                  <Chip tone={low ? "CRITICAL" : "INFORMATION"}>{st?.short ?? i.stationId}</Chip>
                </div>
                <p className="mt-0.5 text-[10px] font-semibold text-sky-200/60">
                  Stock {i.stock.toLocaleString()} {i.unit} · min {i.minThreshold.toLocaleString()} · critical {i.criticalThreshold.toLocaleString()} · draw {i.consumptionPerDay} {i.unit}/d{daysLeft ? ` · depletes in ${daysLeft} d` : ""}
                  {i.expiryBatches ? ` · ${i.expiryBatches[0].count} containers expire in ${i.expiryBatches[0].expiryInDays} d` : ""}
                </p>
                {i.note && <p className="text-[10px] text-amber-300/90">{i.note}</p>}
              </div>
              <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/15">
                <div className={cn("h-full rounded-full", low ? "bg-red-400" : "bg-sky-400")} style={{ width: `${Math.min(100, (i.stock / (i.criticalThreshold * 4)) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </ModuleShell>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <p>
      <span className="font-bold tracking-wide text-sky-200/50 uppercase">{k}: </span>
      <span className="font-semibold text-white">{v}</span>
    </p>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className={cn(card, "px-3 py-2")}>
      <p className={cn("text-lg leading-none font-extrabold", tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-white")}>{value}</p>
      <p className="mt-1 text-[9px] font-bold tracking-wide text-sky-200/60 uppercase">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PEOPLE + ROSTER                                                     */
/* ------------------------------------------------------------------ */

const PERSONNEL_ROWS = [
  { id: "p-001", name: "Dr. Anjali Menon", role: "Expedition Commander", team: "Command", stationId: "maitri", status: "AT STATION", shift: "ALPHA", lastSyncMinutesAgo: 2, duty: "Expedition-wide coordination", emergencyContact: "On file — command channel" },
  { id: "p-002", name: "Cdr. Rajat Khanna", role: "Station Manager", team: "Maitri Operations", stationId: "maitri", status: "AT STATION", shift: "ALPHA", lastSyncMinutesAgo: 4, duty: "Station ops + helipad authority", emergencyContact: "On file — station channel" },
  { id: "p-003", name: "Dr. Ishaan Verma", role: "Glaciologist", team: "Ice Core Team 1", stationId: "camp-suhrid", status: "IN FIELD", shift: "ALPHA", lastSyncMinutesAgo: 43, duty: "Crevasse survey — Sector C fringe", emergencyContact: "On file — field ops" },
  { id: "p-004", name: "Tenzing Bhutia", role: "Field Researcher", team: "Lake Sediment Team", stationId: "camp-suhrid", status: "EMERGENCY", shift: "ALPHA", lastSyncMinutesAgo: 0, duty: "SOS active — immobilized, Sector 4", emergencyContact: "On file — field ops" },
  { id: "p-005", name: "Lt. Meera Pillai", role: "Medical Officer", team: "Medical", stationId: "maitri", status: "AT STATION", shift: "ALPHA", lastSyncMinutesAgo: 3, duty: "Clinic + emergency response lead", emergencyContact: "On file — med channel" },
  { id: "p-006", name: "Sgt. Devraj Rathore", role: "Helicopter Pilot", team: "Air Wing", stationId: "maitri", status: "IN TRANSIT", shift: "ALPHA", lastSyncMinutesAgo: 6, duty: "H-02 sling mission (delayed)", emergencyContact: "On file — air ops" },
  { id: "p-007", name: "Arjun Nair", role: "Logistics Officer", team: "Bharati Operations", stationId: "bharati", status: "AT STATION", shift: "BRAVO", lastSyncMinutesAgo: 5, duty: "Consignment verification", emergencyContact: "On file — logistics" },
  { id: "p-008", name: "Kavita Joshi", role: "Engineer", team: "Power & Mechanical", stationId: "camp-suhrid", status: "IN FIELD", shift: "BRAVO", lastSyncMinutesAgo: 38, duty: "Generator load audit (diesel draw)", emergencyContact: "On file — engineering" },
  { id: "p-009", name: "Farhan Sheikh", role: "Comms Engineer", team: "Comms", stationId: "bharati", status: "AT STATION", shift: "BRAVO", lastSyncMinutesAgo: 7, duty: "Satcom window scheduling", emergencyContact: "On file — comms" },
  { id: "p-010", name: "Dr. Sneha Kulkarni", role: "Atmospheric Scientist", team: "Atmospherics", stationId: "camp-larsemann", status: "AT STATION", shift: "CHARLIE", lastSyncMinutesAgo: 11, duty: "Kite-loon soundings (wind limited)", emergencyContact: "On file — science" },
  { id: "p-011", name: "Vikram Singh", role: "Technician", team: "Power & Mechanical", stationId: "maitri", status: "REST", shift: "OFF", lastSyncMinutesAgo: 62, duty: "Roster conflict under review", emergencyContact: "On file — station channel" },
  { id: "p-012", name: "Pooja Iyer", role: "Technician", team: "Power & Mechanical", stationId: "maitri", status: "AT STATION", shift: "ALPHA", lastSyncMinutesAgo: 8, duty: "Available for maintenance reassignment", emergencyContact: "On file — station channel" },
];

export function PeopleModule({ tab }: { tab: "people" | "roster" }) {
  const { rosterIssues, approveIntel } = useOps();
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("ALL");

  const rows = useMemo(() => {
    return PERSONNEL_ROWS.filter((p) => {
      const ql = q.toLowerCase();
      return !ql || `${p.name} ${p.role} ${p.team}`.toLowerCase().includes(ql);
    }).filter((p) => statusF === "ALL" || p.status === statusF);
  }, [q, statusF]);

  if (tab === "roster") {
    return (
      <ModuleShell title="Roster & Shift Management" sub="Daily / weekly assignments with AI conflict detection">
        <div className="space-y-1.5">
          {rosterIssues.map((iss) => (
            <div key={iss.id} className={cn(card, "p-3", iss.severity === "critical" && "ring-1 ring-red-400/40")}>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={iss.severity === "critical" ? "CRITICAL" : "HIGH"}>{iss.kind}</Chip>
                <p className="text-[12px] font-extrabold text-white">{iss.title}</p>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-sky-100/80">{iss.detail}</p>
              <ul className="mt-1.5 space-y-0.5">
                {iss.evidence.map((e) => (
                  <li key={e} className="text-[10px] text-sky-200/60">• {e}</li>
                ))}
              </ul>
              <p className="mt-1.5 rounded-lg bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-200">AI suggestion: {iss.suggestion}</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => approveIntel("rec-roster", "APPROVED")} className="rounded-full bg-sky-500 px-3 py-1 text-[10px] font-extrabold text-white hover:bg-sky-600">Apply fix</button>
                <span className="text-[9.5px] font-semibold text-sky-200/50">Human approval required — action is audit-logged</span>
              </div>
            </div>
          ))}
        </div>

        <h3 className="pt-2 text-[11px] font-extrabold tracking-widest text-sky-200 uppercase">Weekly roster grid</h3>
        <div className={cn(card, "overflow-x-auto p-2")}>
          <table className="w-full min-w-[640px] text-left text-[10.5px]">
            <thead>
              <tr className="text-sky-200/60">
                <th className="px-2 py-1 font-bold">Person</th>
                {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((d) => (
                  <th key={d} className="px-2 py-1 font-bold">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {["p-001", "p-003", "p-005", "p-006", "p-007", "p-010", "p-011"].map((pid) => {
                const p = PERSONNEL_ROWS.find((x) => x.id === pid);
                return (
                  <tr key={pid} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-bold text-white">{p?.name.split(" ").slice(-1)[0] ?? pid}</td>
                    {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((d) => {
                      const slots = ROSTER.filter((r) => r.personId === pid && r.day === d);
                      return (
                        <td key={d} className="px-2 py-1.5">
                          {slots.map((s) => (
                            <span key={s.id} className={cn("mr-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-extrabold", s.shift === "ALPHA" ? "bg-sky-500/25 text-sky-200" : s.shift === "BRAVO" ? "bg-indigo-500/25 text-indigo-200" : "bg-emerald-500/25 text-emerald-200")}>
                              {s.shift}
                            </span>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[9.5px] text-sky-200/50">{ROSTER.length} assignments this week · {PERSONNEL_ROWS.length} rostered personnel shown (SIMULATED)</p>
      </ModuleShell>
    );
  }

  return (
    <ModuleShell title="Personnel Dashboard" sub="People across stations and camps — status, connectivity, medical & duties">
      <div className="flex flex-wrap gap-1.5">
        {["ALL", "AT STATION", "IN FIELD", "IN TRANSIT", "REST", "EMERGENCY"].map((f) => (
          <button key={f} type="button" onClick={() => setStatusF(f)} className={cn("rounded-full px-2.5 py-1 text-[10px] font-extrabold", statusF === f ? "bg-sky-500 text-white" : "bg-white/10 text-sky-200/80 hover:bg-white/20")}>
            {f}
          </button>
        ))}
        <div className="relative ml-auto w-44">
          <Search className="absolute top-2 left-2 h-3.5 w-3.5 text-sky-200/50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="h-8 w-full rounded-lg border border-white/15 bg-white/10 pr-2 pl-7 text-[11px] font-semibold text-white placeholder:text-sky-200/40" />
        </div>
      </div>

      <div className={cn(card, "divide-y divide-white/10")}>
        {rows.map((p) => {
          const st = stationById(p.stationId);
          const ex = PERSONNEL_EXTRA[p.id];
          const emerg = p.status === "EMERGENCY";
          return (
            <div key={p.id} className={cn(row, emerg && "bg-red-500/10")}>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", emerg ? "animate-pulse bg-red-400" : p.status === "IN FIELD" ? "bg-amber-400" : p.status === "REST" ? "bg-slate-400" : "bg-emerald-400")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-extrabold text-white">{p.name}</p>
                  <Chip>{p.role}</Chip>
                  <Chip tone={emerg ? "CRITICAL" : p.status === "IN FIELD" ? "HIGH" : "INFORMATION"}>{p.status}</Chip>
                  {ex && <Chip tone={ex.connectivity === "OFFLINE" ? "HIGH" : "INFORMATION"}>{ex.connectivity}</Chip>}
                </div>
                <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
                  {p.team} · {st?.short ?? p.stationId} · shift {p.shift} · last sync {p.lastSyncMinutesAgo} min · {p.duty}
                  {ex ? ` · battery ${ex.battery}%` : ""}
                </p>
                {ex && <p className="text-[10px] text-sky-200/50">Medical: {ex.medical} · Emergency contact: {p.emergencyContact}</p>}
                {emerg && <p className="text-[10px] font-bold text-red-300">EMERGENCY — response assigned: S-04 + Maitri med team</p>}
              </div>
              {st && <LocateBtn lat={st.lat} lon={st.lon} label={p.name} />}
            </div>
          );
        })}
      </div>
    </ModuleShell>
  );
}

/* ------------------------------------------------------------------ */
/* TRANSPORT                                                           */
/* ------------------------------------------------------------------ */

export function TransportModule() {
  const { ops, scenario } = useOps();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ModuleShell title="Transport & Travel" sub="Ships · helicopters · aircraft · snow vehicles — complete mission timelines">
      <div className="space-y-1.5">
        {ops.transports.map((t) => {
          const open = openId === t.id;
          return (
            <div key={t.id} className={cn(card, "px-3 py-2.5")}>
              <button type="button" onClick={() => setOpenId(open ? null : t.id)} className="w-full text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12.5px] font-extrabold text-white">{t.name}</p>
                  <Chip>{t.kind}</Chip>
                  <Chip tone={t.status === "DELAYED" ? "HIGH" : t.status === "WEATHER HOLD" ? "MEDIUM" : "INFORMATION"}>{t.status}</Chip>
                  {t.delayDays ? <Chip tone="HIGH">+{t.delayDays} d</Chip> : null}
                  {scenario && t.id === "t-ship-01" && scenario.scenario.id === "ship-delay" && <Chip tone="CRITICAL">scenario active</Chip>}
                </div>
                <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
                  {t.origin} → {t.destination} · ETD {t.etd} · ETA {t.eta} · {t.capacity} · {t.personnelCount} pax
                </p>
                <p className="text-[10px] text-sky-200/50">{t.cargoSummary}</p>
              </button>
              {open && (
                <div className="mt-2.5 grid gap-2 rounded-lg bg-black/20 p-2.5 text-[11px] text-sky-100/90 sm:grid-cols-2">
                  <Fact k="Fuel" v={t.fuelNote} />
                  <Fact k="Weather" v={t.weatherNote} />
                  <div className="sm:col-span-2">
                    <p className="text-[9.5px] font-bold tracking-widest text-sky-200/50 uppercase">Mission timeline</p>
                    <ol className="mt-1 space-y-0.5 text-[10.5px]">
                      {[
                        `Scheduled at ${t.origin}`,
                        "Loading cargo & personnel",
                        `Departed (ETD ${t.etd})`,
                        "In transit — weather & route gated",
                        t.status === "COMPLETED" ? "Arrived & discharged" : `Expected arrival (ETA ${t.eta})`,
                        "Cargo verification at destination",
                      ].map((step, i) => {
                        const cur = t.status === "COMPLETED" ? 6 : t.status === "IN TRANSIT" ? 4 : 2;
                        return (
                          <li key={step} className={cn("flex items-center gap-1.5", i <= cur ? "text-white" : "text-sky-200/35")}>
                            <span className={cn("h-1 w-1 rounded-full", i <= cur ? "bg-sky-400" : "bg-white/20")} />
                            {step}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-sky-200/50">AI reschedules transport when weather, fuel, cargo or personnel constraints change — recommendations appear in POLAR INTELLIGENCE with human approval.</p>
    </ModuleShell>
  );
}

/* ------------------------------------------------------------------ */
/* WEATHER & HAZARDS                                                   */
/* ------------------------------------------------------------------ */

export function WeatherModule() {
  const { ops, goto } = useOps();
  return (
    <ModuleShell title="Weather & Hazards" sub="Feeds the Risk Engine — affects transport recommendations">
      <div className="grid gap-2 sm:grid-cols-2">
        {ops.stations.map((s) => {
          const risk = assessStationRisk(s);
          const w = s.weather;
          const riskTone = risk.level === "HIGH OPERATIONAL RISK" ? "CRITICAL" : risk.level === "ELEVATED RISK" ? "HIGH" : "INFORMATION";
          return (
            <div key={s.id} className={cn(card, "p-3")}>
              <div className="flex items-center gap-2">
                <p className="text-[12px] font-extrabold text-white">{s.short}</p>
                <Chip tone={riskTone as "CRITICAL"}>{risk.level}</Chip>
                <span className="ml-auto"><LocateBtn lat={s.lat} lon={s.lon} label={s.short} /></span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <WeatherStat v={`${w.tempC}°C`} k="temp" />
                <WeatherStat v={`${w.windKph} km/h`} k="wind" />
                <WeatherStat v={`${w.visibilityKm} km`} k="visibility" />
                <WeatherStat v={w.condition} k="condition" />
                <WeatherStat v={`${993 + (s.name.length % 7)} hPa`} k="pressure" />
                <WeatherStat v={w.windKph > 60 ? "Heavy" : w.windKph > 30 ? "Moderate" : "Light"} k="snowfall" />
              </div>
              {risk.factors.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {risk.factors.map((f) => (
                    <li key={f.label} className="text-[10px] font-semibold text-amber-200/90">• {f.label} (+{f.weight})</li>
                  ))}
                </ul>
              )}
              {s.hazardIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.hazardIds.map((h) => (
                    <span key={h} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold text-red-300">{h}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={cn(card, "flex flex-wrap items-center gap-3 p-3 text-[10px] font-bold text-sky-200/80")}>
        <span>Hazard levels:</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Normal</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Caution</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> High Risk</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Critical</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 text-[10px] text-sky-200" onClick={() => goto("home")}>View on map →</Button>
      </div>
    </ModuleShell>
  );
}

function WeatherStat({ v, k }: { v: string; k: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-1.5 py-1">
      <p className="truncate text-[11px] font-extrabold text-white">{v}</p>
      <p className="text-[8px] font-bold tracking-wide text-sky-200/50 uppercase">{k}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STATIONS                                                            */
/* ------------------------------------------------------------------ */

export function StationsModule() {
  const { ops, goto } = useOps();
  return (
    <ModuleShell title="Station & Camp Management" sub="Maitri · Bharati · Dakshin Gangotri · field camps — NCPOR-operated Indian bases">
      <div className="grid gap-2 sm:grid-cols-2">
        {ops.stations.map((s) => <StationCard key={s.id} s={s} onMap={() => goto("home", { lat: s.lat, lon: s.lon, label: s.short })} />)}
      </div>
    </ModuleShell>
  );
}

function StationCard({ s, onMap }: { s: Station; onMap: () => void }) {
  const fuel = computeDepletion(s).find((d) => d.resource === "Fuel");
  const risk = assessStationRisk(s);
  const inv = INVENTORY_FULL.filter((i) => i.stationId === s.id);
  const transport = TRANSPORTS.find((t) => t.id === s.nextTransportId);
  return (
    <div className={cn(card, "p-3", s.status === "critical" && "ring-1 ring-red-400/40")}>
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] font-extrabold text-white">{s.name}</p>
        <Chip tone={s.status === "critical" ? "CRITICAL" : s.status === "watch" ? "HIGH" : "INFORMATION"}>{s.status.toUpperCase()}</Chip>
        <button type="button" onClick={onMap} className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-sky-300 hover:bg-sky-500/10"><LocateFixed className="h-3.5 w-3.5" /></button>
      </div>
      <p className="mt-0.5 text-[10px] font-semibold text-sky-200/60">
        Est. {s.established} · {s.lat.toFixed(2)}°S {s.lon.toFixed(2)}°E · <span className="text-sky-300/80">geography REAL</span>, operations <span className="text-amber-300/90">SIMULATED</span>
      </p>
      <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[10px]">
        <Fact k="Personnel" v={`${s.personnel}/${s.capacity}`} />
        <Fact k="Fuel" v={`${s.fuelPct}% · crit ${fuel?.daysToCritical !== null && fuel ? `${fuel.daysToCritical.toFixed(0)}d` : "—"}`} />
        <Fact k="Food" v={`${s.foodDaysRemaining} d`} />
        <Fact k="Medical" v={`${s.medicalPct}%`} />
        <Fact k="Equipment" v={`${s.equipmentPct}%`} />
        <Fact k="Resupply" v={`${s.nextResupplyDays} d`} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {inv.slice(0, 3).map((i) => (
          <span key={i.id} className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold text-sky-100/80">{i.name.split(" (")[0]} {i.stock}{i.unit === "%" ? "%" : ""}</span>
        ))}
        {transport && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[9px] font-bold text-sky-200">Next: {transport.name}</span>}
      </div>
      <p className="mt-1.5 text-[10px] text-sky-100/70">{s.note}</p>
      {risk.level !== "NOMINAL" && (
        <p className="mt-1 text-[10px] font-bold text-red-300">{risk.level} — {risk.factors.length} factor{risk.factors.length === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EQUIPMENT & SAMPLES                                                 */
/* ------------------------------------------------------------------ */

export function EquipmentModule() {
  return (
    <ModuleShell title="Equipment & Asset Management" sub="Scientific + operational assets — condition, maintenance, inspections">
      <div className={cn(card, "divide-y divide-white/10")}>
        {EQUIPMENT.map((e) => {
          const st = stationById(e.stationId);
          const tone = e.condition === "Operational" ? "INFORMATION" : e.condition === "Missing" || e.condition === "Damaged" ? "CRITICAL" : "HIGH";
          return (
            <div key={e.id} className={cn(row, e.condition === "Missing" && "bg-red-500/10")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-extrabold text-white">{e.name}</p>
                  <Chip>{e.id} · {e.rfid}</Chip>
                  <Chip tone={tone as "CRITICAL"}>{e.condition}</Chip>
                  <Chip>{e.category}</Chip>
                </div>
                <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
                  {st?.short} · {e.location} · team {e.team} · last inspection {e.lastInspection} · next {e.nextMaintenance}
                </p>
              </div>
              {st && <LocateBtn lat={st.lat} lon={st.lon} label={e.name} />}
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-sky-200/50">Missing / damaged equipment feeds the Alert Center and anomaly detection automatically.</p>
    </ModuleShell>
  );
}

export function SamplesModule() {
  return (
    <ModuleShell title="Scientific Sample Tracking" sub="Chain of custody — tracked separately from standard cargo">
      <div className="space-y-2">
        {SAMPLES.map((s) => {
          const st = stationById(s.stationId);
          return (
            <div key={s.id} className={cn(card, "p-3")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-extrabold text-white">{s.id}</p>
                <Chip>{s.category}</Chip>
                <Chip tone={s.condition === "VERIFIED" ? "INFORMATION" : s.condition === "FLAGGED" ? "HIGH" : "MEDIUM"}>{s.condition}</Chip>
              </div>
              <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">
                {st?.short} · collected {s.collectedOn} by {s.collector} ({s.team}) · {s.storage} → {s.destination} · {s.transport}
              </p>
              <ol className="mt-2 space-y-1 border-l-2 border-sky-400/40 pl-3">
                {s.custody.map((c, i) => (
                  <li key={i} className="text-[10.5px]">
                    <span className="font-bold text-sky-200">{c.ts}</span> — <span className="font-semibold text-white">{c.actor}</span>: <span className="text-sky-100/70">{c.note}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </ModuleShell>
  );
}

/* ------------------------------------------------------------------ */
/* ALERTS                                                              */
/* ------------------------------------------------------------------ */

export function AlertsModule() {
  const { alerts, goto } = useOps();
  const [f, setF] = useState("ALL");
  const filtered = alerts.filter((a) => f === "ALL" || a.severity === f);
  return (
    <ModuleShell title="Alert Center" sub="Critical / High / Medium / Information — every alert links to its asset, person, station or map location">
      <div className="flex flex-wrap gap-1.5">
        {["ALL", "CRITICAL", "HIGH", "MEDIUM", "INFORMATION"].map((x) => (
          <button key={x} type="button" onClick={() => setF(x)} className={cn("rounded-full px-2.5 py-1 text-[10px] font-extrabold", f === x ? "bg-sky-500 text-white" : "bg-white/10 text-sky-200/80 hover:bg-white/20")}>
            {x}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {filtered.map((a) => (
          <div key={a.id} className={cn(card, "flex items-center gap-3 px-3 py-2.5", a.severity === "CRITICAL" && "ring-1 ring-red-400/40")}>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", a.severity === "CRITICAL" ? "animate-pulse bg-red-500" : a.severity === "HIGH" ? "bg-amber-400" : a.severity === "MEDIUM" ? "bg-sky-400" : "bg-slate-400")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={a.severity}>{a.type}</Chip>
                <p className="text-[12px] font-extrabold text-white">{a.title}</p>
              </div>
              <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">{a.detail}</p>
            </div>
            <span className="shrink-0 text-[9.5px] font-bold text-sky-200/50">{a.ts}</span>
            {a.entity.kind === "station" && (
              <button
                type="button"
                onClick={() => {
                  const st = STATIONS.find((x) => x.id === a.entity.id);
                  if (st) goto("home", { lat: st.lat, lon: st.lon, label: st.short });
                }}
                className="shrink-0 rounded-full bg-sky-500/20 px-2.5 py-1 text-[9.5px] font-extrabold text-sky-200 hover:bg-sky-500/30"
              >
                LOCATE
              </button>
            )}
          </div>
        ))}
      </div>
    </ModuleShell>
  );
}

/* ------------------------------------------------------------------ */
/* REPORTS                                                             */
/* ------------------------------------------------------------------ */

export function ReportsModule() {
  const { ops, audit, feed, queue } = useOps();
  const shipped = ops.shipments.reduce((a, s) => a + s.containersExpected, 0);
  const received = ops.shipments.reduce((a, s) => a + s.containersReceived, 0);
  const fuelBy = ops.stations.map((s) => ({ name: s.short, l: s.fuelBurnLPerDay, pct: s.fuelPct }));

  return (
    <ModuleShell title="Reports & Analytics" sub="Export-ready operational reports — every number derives from the shared operational state">
      <div className="grid gap-2 sm:grid-cols-2">
        <ReportCard title="Cargo performance">
          <Bar label="Containers received" now={received} total={shipped} tone="bg-sky-400" />
          <p className="text-[10.5px] text-sky-100/70">{received}/{shipped} containers across {ops.shipments.length} consignments · {ops.shipments.reduce((a, s) => a + s.containersUnverified, 0)} unverified</p>
        </ReportCard>
        <ReportCard title="Inventory & fuel consumption">
          {fuelBy.slice(0, 3).map((f) => <Bar key={f.name} label={`${f.name} · ${f.l.toLocaleString()} L/d`} now={f.pct} total={100} tone={f.pct < 45 ? "bg-red-400" : "bg-sky-400"} />)}
        </ReportCard>
        <ReportCard title="Transport performance">
          {ops.transports.slice(0, 4).map((t) => (
            <p key={t.id} className="flex justify-between text-[10.5px] text-sky-100/80"><span>{t.name}</span><span className="font-bold">{t.status}</span></p>
          ))}
        </ReportCard>
        <ReportCard title="AI recommendations & audit">
          <p className="text-[10.5px] text-sky-100/80">{feed.length} active insights · {feed.filter((f) => f.state === "APPROVED").length} approved · {feed.filter((f) => f.state === "REJECTED").length} rejected</p>
          <p className="mt-1 text-[10.5px] text-sky-100/80">{audit.length} audit entries · {queue.length} events in offline queue</p>
        </ReportCard>
        <ReportCard title="Personnel deployment">
          {ops.stations.map((s) => <Bar key={s.id} label={s.short} now={s.personnel} total={s.capacity} tone="bg-emerald-400" />)}
        </ReportCard>
        <ReportCard title="Offline synchronization">
          <p className="text-[10.5px] text-sky-100/80">{queue.length} events queued (P1 safety first) · sync drains P1 → P4 with server validation and conflict check.</p>
        </ReportCard>
      </div>
    </ModuleShell>
  );
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn(card, "p-3")}>
      <p className="text-[10px] font-extrabold tracking-widest text-sky-200 uppercase">{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function Bar({ label, now, total, tone }: { label: string; now: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((now / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold text-sky-100/80"><span>{label}</span><span>{pct}%</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/15"><div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GLOBAL SEARCH DIALOG                                                */
/* ------------------------------------------------------------------ */

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { goto } = useOps();
  // The query is executed on the server against indexed columns, so results
  // reflect what is actually stored rather than a client-side array filter.
  const live = usePolarisLive();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(q);
      live.search(q);
    }, 220);
    return () => clearTimeout(id);
    // `live.search` is stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hits = live.searchHits;
  const loading = debounced.trim().length >= 2 && live.state.controlRoom === "loading";

  const moduleFor = (kind: string): ModuleId =>
    kind === "Station"
      ? "stations"
      : kind === "Personnel"
        ? "people"
        : kind === "Cargo"
          ? "cargo"
          : kind === "Vehicle"
            ? "transport"
            : kind === "Convoy"
              ? "convoys"
              : kind === "Mission"
                ? "transport"
                : kind === "Hazard"
                  ? "routes"
                  : "incidents";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setQ("");
          setDebounced("");
          live.clearSearch();
        }
      }}
    >
      <DialogContent className="max-w-xl border-white/15 bg-[#12325a]/95 text-white">
        <DialogHeader>
          <DialogTitle className="text-base">Global search</DialogTitle>
          <DialogDescription className="text-sky-200/70">
            Runs against the database. Try a cargo id, a barcode, a station code, a person, a vehicle or a hazard zone.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything…"
          className="h-9 border-white/20 bg-white/10 text-[13px] font-bold text-white placeholder:text-sky-200/40"
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <button
              key={`${h.kind}-${h.id}`}
              type="button"
              onClick={() => {
                onOpenChange(false);
                if (h.lat !== undefined && h.lon !== undefined) {
                  goto("home", { lat: h.lat, lon: h.lon, label: h.label });
                } else {
                  goto(moduleFor(h.kind));
                }
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/10"
            >
              <span className="w-16 shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-center text-[8.5px] font-extrabold tracking-wide text-sky-200 uppercase">
                {h.kind}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-extrabold text-white">{h.label}</span>
                <span className="block truncate text-[10px] font-semibold text-sky-200/60">{h.sub}</span>
              </span>
              {h.lat !== undefined ? <LocateFixed className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : <Send className="h-3 w-3 shrink-0 text-sky-300/60" />}
            </button>
          ))}
          {debounced.trim().length >= 2 && hits.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] text-sky-200/60">
              {loading ? "Searching the database…" : `No stored record matches “${debounced}”.`}
            </p>
          ) : null}
          {q.trim().length < 2 ? (
            <p className="px-2 py-3 text-[11.5px] text-sky-200/50">Type at least two characters to search.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
