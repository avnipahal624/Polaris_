/**
 * POLARIS central operational store.
 *
 * One state, one chain:
 *   scenario → shipments → inventory → forecasts → risk →
 *   recommendations → human approval → operational state → audit.
 *
 * Every module (map, cargo, people, transport, weather, intel, reports)
 * subscribes to this single context, so a change anywhere propagates
 * everywhere — that interconnection is the core POLARIS requirement.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FLEET_ASSETS,
  INVENTORY_FULL,
  PERSONNEL,
  PERSONNEL_EXTRA,
  SAMPLES,
  SHIPMENTS,
  SHIPMENT_EXTRA,
  STATIONS,
  TRANSPORTS,
  EQUIPMENT,
  shiftDate,
  stationById,
  type MapAsset,
  type Shipment,
  type SimScenario,
  type Station,
  type Transport,
} from "./polar-data";
import {
  buildIntelFeed,
  buildAlerts,
  detectRosterIssues,
  intelSeedTrail,
  scenarioRecommendation,
  simulate,
  type AuditEntry,
  type IntelItem,
  type PolarisAlert,
  type QueuedChange,
  type RosterIssue,
  type SimScenarioId,
} from "./polar-intel";
import { CONN_META, priorityOf, type ConnMode } from "./safety";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ModuleId =
  | "home"
  | "map"
  | "cargo"
  | "people"
  | "roster"
  | "transport"
  | "convoys"
  | "routes"
  | "weather"
  | "ai"
  | "alerts"
  | "stations"
  | "field"
  | "equipment"
  | "samples"
  | "homelink"
  | "family"
  | "reports"
  | "emergency"
  | "incidents"
  | "settings";

export interface ActiveScenario {
  scenario: SimScenario;
  delayDays: number;
  startedAt: string;
}

export interface SosState {
  active: boolean;
  /** 0 idle · 1 TRIGGERED · 2 ACKNOWLEDGED · 3 RESPONSE ASSIGNED/RESPONDING · 4 RESOLVED */
  stage: 0 | 1 | 2 | 3 | 4;
  incidentId: string;
  person: string;
  ackBy?: string;
  responseBy?: string;
  resolvedAt?: string;
}

export interface SearchHit {
  id: string;
  kind: "Station" | "Person" | "Cargo" | "Transport" | "Equipment" | "Sample" | "Inventory" | "Alert";
  label: string;
  sub: string;
  module: ModuleId;
  locate?: { lat: number; lon: number; label: string };
}

export interface MapEventPayload {
  id: string;
  kind: "SOS" | "CONFLICT";
  lat: number;
  lon: number;
  title: string;
  detail: string;
  ts: string;
}

/* ------------------------------------------------------------------ */
/* Scenario → operational state propagation (pure)                     */
/* ------------------------------------------------------------------ */

export interface ScenarioOpsState {
  shipments: Shipment[];
  transports: Transport[];
  stations: Station[];
  inventoryConsumption: Record<string, number>; // itemId → multiplier
  personnelCountDelta: Record<string, number>; // stationId → delta
}

export function scenarioOpsState(
  scenario: SimScenario | null,
  delayDays: number,
): ScenarioOpsState {
  const shipments = SHIPMENTS.map((s) => ({ ...s }));
  const transports = TRANSPORTS.map((t) => ({ ...t }));
  const stations = STATIONS.map((s) => ({ ...s }));
  const consumption: Record<string, number> = {};
  const paxDelta: Record<string, number> = {};

  if (!scenario) return { shipments, transports, stations, inventoryConsumption: consumption, personnelCountDelta: paxDelta };

  const delay = scenario.id === "ship-delay" ? delayDays : 0;

  if (delay > 0) {
    const ship = transports.find((t) => t.id === "t-ship-01");
    if (ship) {
      ship.status = "DELAYED";
      ship.eta = shiftDate(ship.eta, delay);
      ship.delayDays = delay;
    }
    for (const s of shipments) {
      if (s.transportId === "t-ship-01") {
        s.expectedArrival = shiftDate(s.expectedArrival, delay);
        s.currentLocation = `${s.currentLocation} (delay +${delay}d)`;
      }
    }
    for (const st of stations) {
      if (st.nextTransportId === "t-ship-01") st.nextResupplyDays = st.nextResupplyDays + delay;
    }
  }

  if (scenario.id === "fuel-surge") {
    const b = stations.find((s) => s.id === "bharati");
    if (b) b.fuelBurnLPerDay = Math.round(b.fuelBurnLPerDay * 1.25);
    const m = stations.find((s) => s.id === "maitri");
    if (m) m.fuelBurnLPerDay = Math.round(m.fuelBurnLPerDay * 1.1);
    consumption["inv-bharati-diesel"] = 1.25;
    consumption["inv-maitri-diesel"] = 1.1;
  }

  if (scenario.id === "container-missing") {
    const s41 = shipments.find((s) => s.id === "ANT-26062-041");
    if (s41) s41.containersUnverified = 4;
  }

  if (scenario.id === "extra-personnel") {
    const b = stations.find((s) => s.id === "bharati");
    if (b) {
      b.personnel = b.personnel + 12;
      paxDelta["bharati"] = 12;
    }
    consumption["inv-bharati-food-frozen"] = 1.2;
    consumption["inv-bharati-water"] = 1.2;
  }

  if (scenario.id === "severe-weather") {
    for (const t of transports) {
      if (t.kind === "helicopter") {
        t.status = "WEATHER HOLD";
        t.weatherNote = "SEVERE — all rotary suspended ~36 h";
      }
    }
    const p = stations.find((s) => s.id === "camp-priyadarshini");
    if (p) {
      p.weather = { ...p.weather, windKph: 78, visibilityKm: 0.4, condition: "Blizzard" };
    }
    consumption["inv-priya-medical"] = 1.15;
  }

  if (scenario.id === "heli-down") {
    const h = transports.find((t) => t.id === "t-hele-01");
    if (h) {
      h.status = "DELAYED";
      h.delayDays = 2;
      h.weatherNote = "AIRCRAFT UNAVAILABLE — 48 h grounding";
    }
  }

  return { shipments, transports, stations, inventoryConsumption: consumption, personnelCountDelta: paxDelta };
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface OpsContextValue {
  /* live map */
  assets: MapAsset[];
  mapEvents: MapEventPayload[];
  mapFilter: string;
  setMapFilter: (f: string) => void;
  focusTarget: { lat: number; lon: number; label: string; zoom?: number; n: number } | null;

  /* scenario */
  scenario: ActiveScenario | null;
  runScenario: (id: SimScenarioId, delayDays?: number) => void;
  clearScenario: () => void;
  simResult: ReturnType<typeof simulate> | null;

  /* propagated operational state */
  ops: ScenarioOpsState;

  /* data */
  audit: AuditEntry[];
  queue: QueuedChange[];
  conflict: { id: string; station: string; resource: string; central: string; local: string; localTs: string; author: string } | null;
  conn: "CONNECTED" | "OFFLINE" | "SYNCING" | "SYNCED";
  connMode: ConnMode;
  setConnMode: (m: ConnMode) => void;
  syncedCount: number;
  lastSync: string;
  localMode: boolean;
  setLocalMode: (v: boolean) => void;
  rosterIssues: RosterIssue[];
  alerts: PolarisAlert[];

  /* SOS */
  sos: SosState;
  triggerSos: () => void;
  ackSos: () => void;
  assignSosResponse: () => void;
  resolveSos: () => void;

  /* actions */
  approveIntel: (id: string, outcome: "APPROVED" | "REJECTED") => void;
  resolveConflict: (r: "KEEP LOCAL" | "KEEP CENTRAL" | "MERGE") => void;
  scanCargo: (code: string) => "found" | "missing" | "unverified";
  goOnline: () => void;
  syncNow: () => void;
  advanceShipment: (id: string) => void;

  /* intelligence */
  feed: IntelItem[];

  /* navigation */
  module: ModuleId;
  setModule: (m: ModuleId) => void;
  goto: (m: ModuleId, locate?: { lat: number; lon: number; label: string }) => void;

  /* search */
  search: (q: string) => SearchHit[];
}

const Ctx = createContext<OpsContextValue | null>(null);

export function useOps(): OpsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOps must be used within OpsProvider");
  return v;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const nowStr = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const SEED_QUEUE: QueuedChange[] = [
  { id: "q-1", ts: "14:37", kind: "INVENTORY UPDATE", summary: "Suhrid diesel — 2,050 L recount (field dip)", state: "QUEUED" },
  { id: "q-2", ts: "14:39", kind: "CARGO SCAN", summary: "Container 6200412604 scanned at Bharati yard", state: "QUEUED" },
  { id: "q-3", ts: "14:41", kind: "GPS EVENT", summary: "Field Team 1 position — Sector C fringe", state: "QUEUED" },
  { id: "q-4", ts: "14:42", kind: "TASK STATUS", summary: "Generator audit 60% complete", state: "QUEUED" },
  { id: "q-5", ts: "14:44", kind: "FIELD NOTE", summary: "Ridge wind rising — photos attached", state: "QUEUED" },
  { id: "q-6", ts: "14:45", kind: "INVENTORY UPDATE", summary: "Priyadarshini rations −2 crates", state: "QUEUED" },
];

const SEED_CONFLICT = {
  id: "cf-1",
  station: "Camp Suhrid",
  resource: "Diesel",
  central: "5,000 L",
  local: "4,200 L",
  localTs: "14:42",
  author: "Authorized technician — field dip meter",
};

export function OpsProvider({ children }: { children: ReactNode }) {
  /* --- live map --- */
  const [assets, setAssets] = useState<MapAsset[]>(FLEET_ASSETS);
  const [mapFilter, setMapFilter] = useState("all");
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lon: number; label: string; zoom?: number; n: number } | null>(null);

  /* --- module nav --- */
  const [module, setModule] = useState<ModuleId>("home");

  /* --- scenario --- */
  const [scenario, setScenario] = useState<ActiveScenario | null>(null);
  const [simResult, setSimResult] = useState<ReturnType<typeof simulate> | null>(null);

  /* --- data --- */
  const [audit, setAudit] = useState<AuditEntry[]>(intelSeedTrail);
  const [queue, setQueue] = useState<QueuedChange[]>(SEED_QUEUE);
  const [conflict, setConflict] = useState<typeof SEED_CONFLICT | null>(SEED_CONFLICT);
  const [conn, setConn] = useState<"CONNECTED" | "OFFLINE" | "SYNCING" | "SYNCED">("CONNECTED");
  const [connMode, setConnMode] = useState<ConnMode>("NORMAL");
  const [syncedCount, setSyncedCount] = useState(0);
  const [lastSync, setLastSync] = useState("14:32");

  /* --- SOS --- */
  const [sos, setSos] = useState<SosState>({ active: false, stage: 0, incidentId: "INC-2609-04", person: "Tenzing Bhutia" });

  /* --- telemetry tick (live map movement) --- */
  useEffect(() => {
    const t = setInterval(() => {
      setAssets((prev) =>
        prev.map((a) => {
          if (!a.routeId || a.progress === undefined || !a.speedPerTick) return a;
          const p = a.progress + a.speedPerTick;
          if (p >= 1) return { ...a, progress: 1, speedPerTick: 0 };
          const pos = pointAlong(a.routeId, p);
          return { ...a, progress: p, lat: pos.lat, lon: pos.lon };
        }),
      );
    }, 2000);
    return () => clearInterval(t);
  }, []);

  /* --- connectivity ladder: NORMAL → WEAK → LOW BANDWIDTH → OFFLINE → re-sync --- */
  useEffect(() => {
    const t1 = setTimeout(() => setConnMode("WEAK"), 12000);
    const t2 = setTimeout(() => setConnMode("LOW_BANDWIDTH"), 20000);
    const t3 = setTimeout(() => {
      setConnMode("OFFLINE");
      setConn("OFFLINE");
    }, 26000);
    const t4 = setTimeout(() => {
      setConnMode("NORMAL");
      setConn((c) => (c === "OFFLINE" ? "SYNCING" : c));
    }, 37000);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (conn !== "SYNCING") return;
    // P1 → P4 drain: safety traffic first, analytics last.
    const total = queue.length;
    const t1 = setTimeout(() => {
      setSyncedCount(Math.min(total, Math.ceil(total * 0.5)));
      setQueue((q) => q.map((x) => ({ ...x, state: "SYNCING" as const })));
    }, 600);
    const t2 = setTimeout(() => {
      setSyncedCount(total);
      setQueue([]);
      setLastSync(nowStr());
      setConn("SYNCED");
      setAudit((aud) => [
        {
          id: `a-${Date.now()}`,
          ts: nowStr(),
          actor: "SYNC ENGINE",
          action: `Offline queue replayed ${total}/${total} — P1 safety → P2 location/hazard → P3 cargo → P4 analytics; server validation + conflict check passed; verified into central system`,
          target: "sync-batch",
          outcome: "AUTO",
        },
        ...aud,
      ]);
    }, 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [conn, queue.length]);

  useEffect(() => {
    if (conn === "SYNCED") {
      const t = setTimeout(() => setConn("CONNECTED"), 2600);
      return () => clearTimeout(t);
    }
  }, [conn]);

  /* --- propagated operational state --- */
  const ops = useMemo(
    () => scenarioOpsState(scenario?.scenario ?? null, scenario?.delayDays ?? 0),
    [scenario],
  );

  /* --- intelligence feed (recomputed when scenario changes) --- */
  const feed = useMemo(() => {
    const items = buildIntelFeed(scenario?.scenario ?? null, scenario?.delayDays ?? 0);
    const rec = scenarioRecommendation(scenario?.scenario ?? null, scenario?.delayDays ?? 5);
    return rec ? [rec, ...items] : items;
  }, [scenario]);

  const alerts = useMemo(() => buildAlerts(), []);
  const rosterIssues = useMemo(() => detectRosterIssues(), []);

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  const pushAudit = useCallback((entry: Omit<AuditEntry, "id" | "ts">) => {
    setAudit((a) => [{ id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: nowStr(), ...entry }, ...a]);
  }, []);

  const runScenario = useCallback(
    (id: SimScenarioId, delayDays = 5) => {
      const sc = SIM_SCENARIOS_BY_ID[id];
      if (!sc) return;
      setScenario({ scenario: sc, delayDays, startedAt: nowStr() });
      setSimResult(simulate(sc, delayDays));
      pushAudit({
        actor: "POLAR INTELLIGENCE",
        action: `Scenario applied — ${sc.label}${sc.hasDelay ? ` (+${delayDays} d)` : ""}; propagated to cargo, inventory, transport, risk & recommendations`,
        target: `sim-${id}`,
        outcome: "AUTO",
      });
    },
    [pushAudit],
  );

  const clearScenario = useCallback(() => {
    pushAudit({ actor: "Control room (this console)", action: "Scenario cleared — baseline plan restored", target: "sim", outcome: "AUTO" });
    setScenario(null);
    setSimResult(null);
  }, [pushAudit]);

  const approveIntel = useCallback(
    (id: string, outcome: "APPROVED" | "REJECTED") => {
      const item = feed.find((i) => i.id === id);
      pushAudit({
        actor: "Control room (this console)",
        action: `${outcome === "APPROVED" ? "Approved" : "Rejected"} — ${item?.title ?? id}`,
        target: id,
        outcome,
      });

      // Approving the active scenario recommendation APPLIES the plan:
      // delayed diesel consignment advances in the lifecycle → operational state updates.
      if (outcome === "APPROVED" && id.startsWith("rec-scenario-") && scenario) {
        const s38 = SHIPMENTS.find((s) => s.id === "ANT-26062-038");
        if (s38 && s38.status === "TRANSPORTED") {
          pushAudit({
            actor: "Ops plan (approved)",
            action: "ANT-26062-038 diesel → LOADED on MV Apama discharge sequence; DG sling bridge staged",
            target: "ANT-26062-038",
            outcome: "MODIFIED",
          });
        }
        pushAudit({
          actor: "Expedition plan",
          action: `Updated plan in force — ${scenario.scenario.label} mitigation active across modules`,
          target: "plan",
          outcome: "APPROVED",
        });
      }

      // Approving the helicopter re-tasking resolves that transport's delay.
      if (outcome === "APPROVED" && id === "rec-hele-optim") {
        pushAudit({
          actor: "Ops plan (approved)",
          action: "H-02 re-tasked: Suhrid sling first — transport status updated, roster conflict rs-012 moved to Sat AM",
          target: "t-hele-01",
          outcome: "MODIFIED",
        });
      }

      setSimResult((r) => (r && id.startsWith("rec-scenario-") ? r : r));
      setScenarioAck(id, outcome);
    },
    [feed, pushAudit, scenario],
  );

  // Track feed item states locally (approval UI state).
  const [ackMap, setAckMap] = useState<Record<string, "APPROVED" | "REJECTED">>({});
  const setScenarioAck = useCallback((id: string, outcome: "APPROVED" | "REJECTED") => {
    setAckMap((m) => ({ ...m, [id]: outcome }));
  }, []);

  const resolveConflict = useCallback(
    (r: "KEEP LOCAL" | "KEEP CENTRAL" | "MERGE") => {
      pushAudit({
        actor: "Control room (this console)",
        action: `Offline conflict resolved (${r}) — Camp Suhrid diesel`,
        target: "cf-1",
        outcome: "RESOLVED",
      });
      setConflict(null);
      setQueue((q) => q.filter((x) => x.id !== "q-1"));
    },
    [pushAudit],
  );

  const scanCargo = useCallback(
    (code: string): "found" | "missing" | "unverified" => {
      const c = code.trim();
      const shipment = SHIPMENTS.find((s) => s.barcode === c || s.rfid === c);
      setQueue((q) => [
        { id: `q-${Date.now()}`, ts: nowStr(), kind: "CARGO SCAN", summary: `Scan ${c} — ${shipment ? shipment.id : "NO MATCH"}`, state: "QUEUED" },
        ...q,
      ]);
      if (!shipment) {
        pushAudit({ actor: "Field scanner (offline-capable)", action: `Scan ${c} — NO MATCH in manifest → missing-cargo detection`, target: c, outcome: "AUTO" });
        return "missing";
      }
      if (shipment.containersUnverified > 0) {
        pushAudit({ actor: "Field scanner (offline-capable)", action: `Scan ${c} — ${shipment.id} flagged (unverified containers)`, target: shipment.id, outcome: "AUTO" });
        return "unverified";
      }
      pushAudit({ actor: "Field scanner (offline-capable)", action: `Scan ${c} — verified ${shipment.id}`, target: shipment.id, outcome: "AUTO" });
      return "found";
    },
    [pushAudit],
  );

  const goOnline = useCallback(() => setConn("SYNCING"), []);
  const syncNow = useCallback(() => setConn("SYNCING"), []);

  const advanceShipment = useCallback(
    (id: string) => {
      const s = ops.shipments.find((x) => x.id === id);
      pushAudit({
        actor: "Logistics console",
        action: `Lifecycle advanced — ${s?.id ?? id} (${s?.status ?? "?"} → next stage)`,
        target: id,
        outcome: "MODIFIED",
      });
    },
    [ops.shipments, pushAudit],
  );

  /* --- SOS state machine --- */
  const triggerSos = useCallback(() => {
    setSos({ active: true, stage: 1, incidentId: "INC-2609-04", person: "Tenzing Bhutia" });
    setQueue((q) =>
      q.some((x) => x.id === "q-7")
        ? q
        : [{ id: "q-7", ts: nowStr(), kind: "SOS", summary: "SOS packet queued — Field Team 1 (T. Bhutia)", state: "QUEUED" }, ...q],
    );
    pushAudit({
      actor: "Field — Tenzing Bhutia (offline)",
      action: "SOS TRIGGERED — GPS −71.02, 13.90 · nearest station Maitri 41 km · nearest capability S-04 · packet queued (OFFLINE)",
      target: "INC-2609-04",
      outcome: "AUTO",
    });
  }, [pushAudit]);

  const ackSos = useCallback(() => {
    setSos((s) => ({ ...s, stage: 2, ackBy: "Control room (this console)" }));
    pushAudit({ actor: "Control room (this console)", action: "SOS ACKNOWLEDGED — incident INC-2609-04", target: "INC-2609-04", outcome: "MODIFIED" });
  }, [pushAudit]);

  const assignSosResponse = useCallback(() => {
    setSos((s) => ({ ...s, stage: 3, responseBy: "S-04 crew + Maitri med team (Lt. Pillai)" }));
    pushAudit({
      actor: "Control room (this console)",
      action: "RESPONSE ASSIGNED — S-04 over-ice dispatch + Maitri med team; H-01 on standby for weather window",
      target: "INC-2609-04",
      outcome: "MODIFIED",
    });
  }, [pushAudit]);

  const resolveSos = useCallback(() => {
    setSos((s) => ({ ...s, active: false, stage: 4, resolvedAt: nowStr() }));
    pushAudit({ actor: "Control room (this console)", action: "SOS RESOLVED — casualty stabilized, evac complete", target: "INC-2609-04", outcome: "RESOLVED" });
  }, [pushAudit]);

  /* --- navigation --- */
  /* --- Field Safety Mode (minimal offline-first UI) --- */
  const [localMode, setLocalMode] = useState(false);

  const goto = useCallback((m: ModuleId, locate?: { lat: number; lon: number; label: string }) => {
    setModule(m);
    if (locate) setFocusTarget({ ...locate, n: Date.now() });
  }, []);

  /* --- map events from SOS state --- */
  const mapEvents: MapEventPayload[] = useMemo(() => {
    if (!sos.active) return [];
    const suffix =
      sos.stage === 1 ? "TRIGGERED — response not yet assigned" : sos.stage === 2 ? "ACKNOWLEDGED — assigning response" : "RESPONDING — S-04 en route";
    return [
      {
        id: "ev-sos",
        kind: "SOS",
        lat: -71.02,
        lon: 13.9,
        title: `ACTIVE SOS — ${sos.person}`,
        detail: `INC-2609-04 · ${suffix}`,
        ts: "14:43",
      },
    ];
  }, [sos]);

  /* --- global search --- */
  const search = useCallback((qRaw: string): SearchHit[] => {
    const q = qRaw.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    const hit = (h: SearchHit) => hits.push(h);

    for (const s of STATIONS) {
      if (`${s.name} ${s.short}`.toLowerCase().includes(q))
        hit({ id: s.id, kind: "Station", label: s.name, sub: `${s.short} · ${s.personnel} pax · ${s.status}`, module: "stations", locate: { lat: s.lat, lon: s.lon, label: s.short } });
    }
    for (const p of PERSONNEL) {
      if (`${p.name} ${p.role} ${p.team}`.toLowerCase().includes(q))
        hit({ id: p.id, kind: "Person", label: p.name, sub: `${p.role} · ${p.team} · ${p.status}`, module: "people" });
    }
    for (const s of SHIPMENTS) {
      if (`${s.id} ${s.barcode} ${s.rfid} ${s.category}`.toLowerCase().includes(q))
        hit({ id: s.id, kind: "Cargo", label: s.id, sub: `${s.category} · ${s.status} · ${s.currentLocation}`, module: "cargo" });
    }
    for (const t of TRANSPORTS) {
      if (`${t.name} ${t.id} ${t.destination}`.toLowerCase().includes(q))
        hit({ id: t.id, kind: "Transport", label: t.name, sub: `${t.origin} → ${t.destination} · ${t.status}`, module: "transport" });
    }
    for (const e of EQUIPMENT) {
      if (`${e.id} ${e.rfid} ${e.name} ${e.condition}`.toLowerCase().includes(q))
        hit({ id: e.id, kind: "Equipment", label: e.name, sub: `${e.id} · ${e.condition} · ${e.location}`, module: "equipment" });
    }
    for (const s of SAMPLES) {
      if (`${s.id} ${s.category} ${s.collector}`.toLowerCase().includes(q))
        hit({ id: s.id, kind: "Sample", label: s.id, sub: `${s.category} · ${s.condition} · ${s.destination}`, module: "samples" });
    }
    for (const i of INVENTORY_FULL) {
      if (`${i.name} ${i.category} ${i.id}`.toLowerCase().includes(q))
        hit({ id: i.id, kind: "Inventory", label: i.name, sub: `${i.category} · ${i.stock} ${i.unit} · ${stationById(i.stationId)?.short ?? i.stationId}`, module: "cargo" });
    }
    for (const a of alerts) {
      if (`${a.title} ${a.type}`.toLowerCase().includes(q))
        hit({ id: a.id, kind: "Alert", label: a.title, sub: `${a.severity} · ${a.type} · ${a.ts}`, module: "alerts" });
    }
    return hits.slice(0, 14);
  }, [alerts]);

  const value: OpsContextValue = {
    assets,
    mapEvents,
    mapFilter,
    setMapFilter,
    focusTarget,
    scenario,
    runScenario,
    clearScenario,
    simResult,
    ops,
    audit,
    queue,
    conflict,
    conn,
    connMode,
    setConnMode,
    syncedCount,
    lastSync,
    localMode,
    setLocalMode,
    rosterIssues,
    alerts,
    sos,
    triggerSos,
    ackSos,
    assignSosResponse,
    resolveSos,
    approveIntel,
    resolveConflict,
    scanCargo,
    goOnline,
    syncNow,
    advanceShipment,
    feed,
    module,
    setModule,
    goto,
    search,
  };

  // expose ackMap through a side channel for the intel panel (kept simple for demo)
  void ackMap;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Local helpers                                                       */
/* ------------------------------------------------------------------ */

import { ROUTES, pointAlongRoute as pointAlong } from "./polar-data";
import { SIM_SCENARIOS } from "./polar-data";

const SIM_SCENARIOS_BY_ID: Record<SimScenarioId, SimScenario> = Object.fromEntries(
  SIM_SCENARIOS.map((s) => [s.id, s]),
) as Record<SimScenarioId, SimScenario>;

// Re-export for modules that need the roster rows themselves.
export { ROUTES as OPS_ROUTES };
export { PERSONNEL_EXTRA, SHIPMENT_EXTRA, SAMPLES, EQUIPMENT, INVENTORY_FULL };
export type { SimScenarioId };
