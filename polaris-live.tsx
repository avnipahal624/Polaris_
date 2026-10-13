/**
 * POLARIS live data provider.
 *
 * This is the only place the application reads operational state from. Every
 * value here arrives over a WebSocket-backed Convex query subscription, which
 * means:
 *
 *   - the database is the source of truth, not a module constant
 *   - a second browser tab, or a second operator, sees the same numbers
 *   - a mutation performed anywhere re-renders this provider automatically
 *   - `undefined` means "still loading", and is never rendered as a number
 *
 * The static data in `polar-data.ts` is retained only as the offline fallback
 * cache and for presentation-only reference geometry; it is never used as a
 * substitute for a failed backend read.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { can, type PolarisRole, type Resource } from "./polar-db";
import {
  enqueue,
  nextBatch,
  markSyncing,
  applyAck,
  requeueStuck,
  stats as queueStats,
  recordSyncResult,
  allEvents,
  deviceId,
  type ConnectivityMode,
  type QueuedEvent,
  type SyncStats,
} from "./offline-queue";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type LoadState = "loading" | "ready" | "denied" | "error";

export interface PolarisLive {
  /* session */
  role: string | null;
  actorName: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => void;

  /* data-source honesty */
  environment: string;
  integrations: IntegrationsRow[];
  lastSyncTs: number | null;

  /* operational picture */
  controlRoom: ControlRoom | null;
  entities: LiveEntities | null;
  stations: StationRow[];
  personnel: PersonnelRow[];
  cargo: CargoRow[];
  inventory: InventoryRow[];
  convoys: ConvoyRow[];
  hazards: HazardRow[];
  weather: WeatherRow[];
  emergencies: EmergencyRow[];
  notifications: NotificationRow[];
  aiFeed: AiRow[];
  syncStatus: SyncStatus | null;
  audit: AuditRow[];
  searchHits: SearchHitRow[];
  search: (q: string) => void;
  clearSearch: () => void;

  /* load/error state per domain */
  state: Record<string, LoadState>;
  errorMessage: string | null;

  /* connectivity + offline queue */
  connMode: ConnectivityMode;
  setConnMode: (m: ConnectivityMode) => void;
  queue: QueuedEvent[];
  queueStats: SyncStats | null;
  syncNow: () => Promise<void>;

  /* actions */
  bootstrap: () => Promise<void>;
  /** Destructive: wipes and rebuilds the operational dataset from the seed. */
  rebuild: () => Promise<void>;
  setRunning: (running: boolean) => Promise<void>;
  tick: () => Promise<void>;
  raiseSos: (input: SosInput) => Promise<SosResult>;
  acknowledgeSos: (sosId: string) => Promise<void>;
  assignResponse: (sosId: string) => Promise<void>;
  resolveSos: (sosId: string) => Promise<void>;
  createPerson: (input: PersonInput) => Promise<void>;
  createVehicle: (input: VehicleInput) => Promise<void>;
  createConvoy: (input: ConvoyInput) => Promise<void>;
  createCargo: (input: CargoInput) => Promise<void>;
  createHazard: (input: HazardInput) => Promise<void>;
  createTask: (input: TaskInput) => Promise<void>;
  scanCargo: (code: string) => Promise<ScanResult>;
  updateInventory: (itemId: string, delta: number, reason: InventoryReason) => Promise<void>;
  updateTask: (taskId: string, status: string) => Promise<void>;
  sendFamilyMessage: (input: FamilyInput) => Promise<FamilyResult>;
  decideRecommendation: (id: string, decision: "APPROVED" | "MODIFIED" | "REJECTED", note?: string) => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  resolveConflict: (conflictId: string, resolution: "KEEP_CENTRAL" | "KEEP_FIELD" | "MERGED") => Promise<void>;
}

type IntegrationsRow = { id: string; label: string; state: string; capability: string; requiresEnv?: string; docs?: string };
export type ControlRoom = {
  asOf: number;
  actorRole: string;
  stationsOnline: number;
  stationsTotal: number;
  personnel: number;
  activeMissions: number;
  cargoInTransit: number;
  cargoDiscrepancies: number;
  criticalAlerts: number;
  activeConvoys: number;
  missedCheckins: number;
  readinessPct: number;
  connectivity: string;
  simRunning: boolean;
  lastTickTs: number | null;
  liveSubjects: number;
  staleSubjects: number;
};
export type LiveEntities = {
  asOf: number;
  tracked: {
    subjectId: string;
    subjectKind: string;
    lat: number;
    lon: number;
    accuracyM: number;
    batteryPct: number | null;
    connectivity: string;
    ts: number;
    freshness: string;
    freshnessLabel: string;
    source: string;
  }[];
  stations: {
    id: string;
    code: string;
    short: string;
    name: string;
    kind: string;
    lat: number;
    lon: number;
    status: string;
    operationalDataSimulated: boolean;
    emergencyCapability: string | null;
  }[];
  convoys: {
    id: string;
    convoyId: string;
    name: string;
    status: string;
    comms: string;
    fuelPct: number;
    progress: number;
    emergencyStatus: string;
    lastCheckinTs: number | null;
    expectedArrivalTs: number;
    personnelCount: number;
    vehicleCount: number;
    checkinOverdueMin: number | null;
  }[];
  hazards: { id: string; hazardId: string; hazardType: string; label: string; severity: string; lat: number; lon: number; radiusKm: number; description: string; source: string }[];
  vehicles: { id: string; vehicleId: string; label: string; kind: string; status: string; etaTs: number | null; fuelPct: number }[];
};
type StationRow = { id: string; short: string; name: string; code: string; kind: string; lat: number; lon: number; status: string; operationalDataSimulated: boolean; established: string; note: string; emergencyCapability?: string; weather: WeatherObs | null; personnelCount: number; fleet: number };
export type WeatherObs = { temperatureC: number; windKph: number; visibilityKm: number; pressureHpa: number; condition: string; stormFlag: boolean; observedTs: number; simulated: boolean };
type PersonnelRow = { id: string; polarisId: string; name: string; role: string; team: string; stationId: string; status: string; connectivity: string; deviceId?: string; emergencyContact?: string; currentAssignment?: string; bloodGroup?: string; lastCheckinTs?: number };
type CargoRow = { id: string; cargoId: string; barcode: string; rfid: string; itemType: string; quantity: number; unit: string; weightKg: number; origin: string; destinationStationId: string; missionId: string; status: string; containersExpected: number; containersReceived: number; containersUnverified: number; discrepancy: number; verification: string; version: number; expectedArrivalTs: number; expiresTs?: number; priority: string };
type InventoryRow = { id: string; itemId: string; item: string; category: string; stationId: string; quantity: number; unit: string; batch: string; minThreshold: number; consumptionRatePerDay: number; daysToThreshold: number | null; reservedQuantity: number; incomingQuantity: number; expiresTs?: number; version: number };
type ConvoyRow = { id: string; convoyId: string; name: string; status: string; comms: string; fuelPct: number; progress: number; emergencyStatus: string; routeId: string; originStationId: string; destinationStationId: string; personnelIds: string[]; vehicleIds: string[]; departureTs: number; expectedArrivalTs: number; lastCheckinTs?: number; checkinIntervalMin: number; checkinOverdueMin: number | null };
type HazardRow = { id: string; hazardId: string; hazardType: string; label: string; severity: string; lat: number; lon: number; radiusKm: number; source: string; description: string; validFrom: number; validUntil?: number };
type WeatherRow = { id: string; stationId: string; temperatureC: number; windKph: number; visibilityKm: number; pressureHpa: number; condition: string; stormFlag: boolean; simulated: boolean; observedTs: number };
type EmergencyRow = { id: string; incidentId: string; sosId: string; severity: string; location: { lat: number; lon: number }; hazardIds: string[]; responseTeam: string; assignedVehicleIds: string[]; status: string; openedTs: number; closedTs?: number };
type NotificationRow = { id: string; kind: string; severity: string; title: string; detail: string; ts: number; read: boolean; linkLatLon?: { lat: number; lon: number } };
export type AiRow = { id: string; module: string; title: string; recommendation: string; reason: string; dataUsed: string[]; confidence: string; impact: string; ts: number; state: string; approvedBy: string | null; approvedTs: number | null };
type SyncStatus = {
  connectivity: string;
  queued: number;
  byPriority: { priority: number; count: number }[];
  applied: number;
  openConflicts: number;
  conflicts: {
    id: string;
    conflictId: string;
    entity: string;
    entityId: string;
    field: string;
    centralValue: string;
    fieldValue: string;
    fieldAuthor: string;
    fieldTs: number;
    status: string;
  }[];
  role: string;
};
type AuditRow = { id: string; ts: number; actor: string; actorRole: string; action: string; target: string; result: string; before?: string; after?: string; aiRecommendationId?: string; reason?: string };
export type SearchHitRow = { id: string; kind: string; label: string; sub: string; lat?: number; lon?: number };

export interface SosInput { personId: string; deviceId: string; lat: number; lon: number; accuracyM: number; batteryPct: number; category: string; routeId?: string; convoyId?: string; connectivity: string; queuedOffline?: boolean }
export interface SosResult { sosId: string; nearestStation: string | null; nearestStationKm: number | null; hazard: { label: string; distanceKm: number; inside: boolean } | null; priority: number; queued: boolean; state: string }
export interface PersonInput { name: string; role: string; stationId: string; team: string; emergencyContact?: string; deviceId?: string; bloodGroup?: string; currentAssignment?: string }
export interface VehicleInput { vehicleId: string; kind: string; label: string; fuelPct: number; capacityKg: number; routeId?: string; destinationStationId?: string; deviceId?: string }
export interface ConvoyInput { convoyId: string; name: string; missionId: string; routeId: string; personnelIds: string[]; vehicleIds: string[]; expectedArrivalTs: number; checkinIntervalMin?: number; startNow?: boolean }
export interface CargoInput { cargoId: string; itemType: string; quantity: number; unit: string; weightKg: number; origin: string; destinationStationId: string; missionId: string; containersExpected: number; responsiblePersonId: string; priority?: string }
export interface HazardInput { hazardId: string; hazardType: string; label: string; severity: string; lat: number; lon: number; radiusKm: number; source: string; description: string }
export interface TaskInput { taskId: string; title: string; stationId: string; assignedTo: string[]; dueTs: number; priority?: string }
export interface ScanResult { result: string; cargoId: string | null; expected?: number; received?: number; discrepancy?: number; conflictId?: string }
export interface FamilyInput { familyMemberId: string; type: "TEXT" | "VOICE" | "VIDEO" | "PHOTO"; quality: "LOW" | "MEDIUM" | "HIGH"; body?: string; forceQueue?: boolean }
export interface FamilyResult { messageId: string; state: string; pipeline: string[]; audioExtractedFirst: boolean; sizeBytes: number; priority: string }
export type InventoryReason = "CONSUMPTION" | "RECEIPT" | "ADJUSTMENT" | "TRANSFER" | "EXPIRED";

/* ------------------------------------------------------------------ */

const LiveCtx = createContext<PolarisLive | null>(null);

export function usePolarisLive(): PolarisLive {
  const v = useContext(LiveCtx);
  if (!v) throw new Error("usePolarisLive must be used within PolarisLiveProvider");
  return v;
}

/** Map a Convex query's load state onto the domain's display state. */
function loadState(data: unknown, error: unknown): LoadState {
  if (error) return "error";
  if (data === undefined) return "loading";
  return "ready";
}

export function PolarisLiveProvider({ children }: { children: ReactNode }) {
  const { isLoading: authLoading, isAuthenticated, user, signOut } = useAuth();

  /* ---- identity ------------------------------------------------------ */
  // `bootstrap.session` is the only ungated query, so it is the one place the
  // operator's role can always be discovered. Every other subscription waits
  // on it.
  const sessionQ = useQuery(api.polaris.bootstrap.session);
  const role = (sessionQ?.role ?? null) as PolarisRole | null;

  /**
   * Subscriptions must never be opened speculatively.
   *
   * Each operational query enforces its own resource check server-side and
   * throws FORBIDDEN when the role lacks it. That is correct, but a React
   * `useQuery` surfaces the throw during render, so one query the operator was
   * never entitled to run takes the whole control room down with it. We ask
   * `can()` first and pass Convex's `"skip"` token instead. The server-side
   * check stays in place -- this is not a replacement for it, only a refusal
   * to make a doomed request.
   */
  const mayRead = useCallback(
    (resource: Resource) => role !== null && can(role, resource),
    [role],
  );

  /* ---- subscriptions ------------------------------------------------ */
  const needsSeed = useQuery(api.polaris.bootstrap.needsSeed);
  const controlRoom = useQuery(api.polaris.queries.controlRoom, mayRead("missions") ? {} : "skip");
  const entities = useQuery(api.polaris.queries.liveEntities, mayRead("locations") ? {} : "skip");
  const stationsQ = useQuery(api.polaris.queries.stations, mayRead("missions") ? {} : "skip");
  const personnelQ = useQuery(api.polaris.queries.personnel, mayRead("personnel") ? {} : "skip");
  const cargoQ = useQuery(api.polaris.queries.cargo, mayRead("cargo") ? {} : "skip");
  const inventoryQ = useQuery(api.polaris.queries.inventory, mayRead("inventory") ? {} : "skip");
  const convoysQ = useQuery(api.polaris.queries.convoys, mayRead("transport") ? {} : "skip");
  const hazardsQ = useQuery(api.polaris.queries.hazards, mayRead("hazards") ? {} : "skip");
  const weatherQ = useQuery(api.polaris.queries.weather, mayRead("hazards") ? {} : "skip");
  const emergenciesQ = useQuery(api.polaris.queries.emergencies, mayRead("emergency") ? {} : "skip");
  const notificationsQ = useQuery(
    api.polaris.queries.notifications,
    mayRead("emergency") ? { limit: 40 } : "skip",
  );
  const aiQ = useQuery(api.polaris.queries.aiFeed, mayRead("ai") ? {} : "skip");
  const syncQ = useQuery(api.polaris.queries.syncStatus, mayRead("missions") ? {} : "skip");
  const auditQ = useQuery(
    api.polaris.queries.auditTrail,
    mayRead("audit") ? { limit: 60 } : "skip",
  );
  const integrationsQ = useQuery(api.polaris.bootstrap.integrations);

  /* ---- mutations ---------------------------------------------------- */
  const mSeed = useMutation(api.polaris.bootstrap.seedPolaris);
  const mRebuild = useMutation(api.polaris.bootstrap.rebuildOperationalData);
  const mSetConn = useMutation(api.polaris.mutations.setConnectivity);
  const mSetSim = useMutation(api.polaris.mutations.startSimulation);
  const mTick = useMutation(api.polaris.mutations.runTick);
  const mSos = useMutation(api.polaris.mutations.triggerSos);
  const mAdvance = useMutation(api.polaris.mutations.advanceEmergency);
  const mScan = useMutation(api.polaris.mutations.scanCargo);
  const mInventory = useMutation(api.polaris.mutations.updateInventory);
  const mTask = useMutation(api.polaris.mutations.updateTask);
  const mFamily = useMutation(api.polaris.mutations.sendFamilyMessage);
  const mDecide = useMutation(api.polaris.mutations.decideRecommendation);
  const mRead = useMutation(api.polaris.mutations.markNotificationRead);
  const mConflict = useMutation(api.polaris.mutations.resolveConflict);
  const mSyncBatch = useMutation(api.polaris.mutations.syncBatch);
  const mPerson = useMutation(api.polaris.records.createPerson);
  const mVehicle = useMutation(api.polaris.records.createVehicle);
  const mConvoy = useMutation(api.polaris.records.createConvoy);
  const mCargo = useMutation(api.polaris.records.createCargo);
  const mHazard = useMutation(api.polaris.records.createHazard);
  const mTaskCreate = useMutation(api.polaris.records.createTask);
  const [searchTerm, setSearchTerm] = useState("");

  /* ---- server-side search (a real indexed query, not a client filter) */
  // The search query is skipped entirely for a one-character query, so a
  // half-typed term never issues a backend round trip.
  const searchArgs = searchTerm.trim().length >= 2 ? { q: searchTerm, limit: 25 } : "skip";
  const searchResults = useQuery(api.polaris.insight.search, searchArgs as never) as SearchHitRow[] | undefined;
  const [connMode, setConnModeState] = useState<ConnectivityMode>("CONNECTED");
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [qstats, setQstats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTs, setLastSyncTs] = useState<number | null>(null);

  const refreshQueue = useMemo(
    () => async () => {
      const [events, s] = await Promise.all([allEvents(), queueStats()]);
      setQueue(events);
      setQstats(s);
    },
    [],
  );

  useEffect(() => {
    void refreshQueue();
    // A tab that was closed mid-upload must not leave rows stuck on SYNCING.
    void requeueStuck().then(refreshQueue);
  }, [refreshQueue]);

  // Reflect the server's connectivity state (set by another operator/device).
  useEffect(() => {
    const mode = controlRoom?.connectivity;
    if (mode === "NORMAL") setConnModeState("CONNECTED");
    else if (mode === "WEAK") setConnModeState("LOW_BANDWIDTH");
    else if (mode === "VERY_LOW") setConnModeState("VERY_LOW_BANDWIDTH");
    else if (mode === "OFFLINE") setConnModeState("OFFLINE");
  }, [controlRoom?.connectivity]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && needsSeed === true) {
      void mSeed()
        .then((r) => {
          if (r.seeded) toast.success("Operational database initialised", { description: "Reference stations, routes, hazards and cargo are now stored in the database." });
        })
        .catch((e) => toast.error("Could not initialise the operational database", { description: String(e) }));
    }
  }, [authLoading, isAuthenticated, needsSeed, mSeed]);

  /* ---- helpers ------------------------------------------------------ */

  const setConnMode = async (m: ConnectivityMode) => {
    setConnModeState(m);
    const server = m === "CONNECTED" ? "NORMAL" : m === "LOW_BANDWIDTH" ? "WEAK" : m === "VERY_LOW_BANDWIDTH" ? "VERY_LOW" : "OFFLINE";
    try {
      await mSetConn({ mode: server as never, note: "Operator connectivity control" });
      if (m === "CONNECTED") void runSync();
    } catch (e) {
      toast.error("Unable to change connectivity", { description: String(e) });
    }
  };

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await requeueStuck();
      const batch = await nextBatch(connMode, 50);
      if (batch.length === 0) {
        await refreshQueue();
        setQstats((s) => (s ? { ...s, lastResult: "Nothing queued" } : s));
        return;
      }
      await markSyncing(batch.map((b) => b.eventId));
      const res = await mSyncBatch({
        deviceId: deviceId(),
        events: batch.map((b) => ({ eventId: b.eventId, type: b.type, recordedAt: b.recordedAt, payload: JSON.stringify(b.payload) })),
      });
      for (const ack of res.acks) {
        await applyAck({
          eventId: ack.eventId,
          status: ack.status as "APPLIED" | "CONFLICT" | "REJECTED",
          reason: ack.reason,
          serverVersion: ack.serverVersion,
        });
      }
      const ts = Date.now();
      await recordSyncResult(ts);
      setLastSyncTs(ts);
      await refreshQueue();
      toast.success(`Sync complete — ${res.applied} applied, ${res.conflicts} conflicts, ${res.rejected} rejected`, {
        description: `${res.uploaded} events uploaded, P0 first.`,
      });
    } catch (e) {
      await refreshQueue();
      toast.error("Unable to synchronise", { description: "Your field changes remain safely stored locally and will be retried." });
    } finally {
      setSyncing(false);
    }
  };

  /* ---- actions ------------------------------------------------------ */

  const bootstrap = async () => {
    try {
      const r = await mSeed({});
      if (r.seeded) toast.success("Operational database initialised");
      else toast.message("Database already initialised", { description: `Reason: ${r.reason ?? "ALREADY_SEEDED"}` });
    } catch (e) {
      // A seed that fails partway leaves real rows behind, so a plain retry
      // would be refused as ALREADY_SEEDED. Offer the clean rebuild instead of
      // leaving the operator with a half-populated database and no way out.
      toast.error("Initialisation failed", {
        description: String(e),
        action: { label: "Rebuild database", onClick: () => void rebuild() },
      });
    }
  };

  /** Wipe and rebuild the operational dataset from the reference seed. */
  const rebuild = async () => {
    try {
      const r = await mRebuild({});
      if (r.rebuilt) {
        toast.success("Operational database rebuilt", {
          description: "The previous dataset was replaced with a clean seed.",
        });
      } else {
        toast.error("Rebuild refused");
      }
    } catch (e) {
      toast.error("Rebuild failed", { description: String(e) });
    }
  };

  const setRunning = async (running: boolean) => {
    try {
      await mSetSim({ running });
      toast.success(running ? "GPS simulation started" : "GPS simulation stopped", {
        description: running ? "The server-side engine is writing real location events into the database." : undefined,
      });
    } catch (e) {
      toast.error("Could not change simulation state", { description: String(e) });
    }
  };

  const tick = async () => {
    try {
      await mTick({});
    } catch (e) {
      toast.error("Simulation tick failed", { description: String(e) });
    }
  };

  const raiseSos = async (input: SosInput): Promise<SosResult> => {
    const offline = connMode === "OFFLINE" || input.queuedOffline;
    if (offline) {
      // SOS must never sit behind a family video: it goes in at P0 and stays
      // on disk until the server confirms it.
      await enqueue("SOS", input as unknown as Record<string, unknown>, { recordedAt: Date.now() });
      await refreshQueue();
      return {
        sosId: `LOCAL-P0-${Date.now().toString(36).toUpperCase()}`,
        nearestStation: null,
        nearestStationKm: null,
        hazard: null,
        priority: 0,
        queued: true,
        state: "STORED LOCALLY AS P0 — TRANSMITS ON NEXT LINK",
      };
    }
    const r = await mSos(input as never);
    toast.error("EMERGENCY SOS TRANSMITTED", {
      description: `${r.sosId} · P0 · nearest ${r.nearestStation ?? "unknown station"}${
        r.hazard ? ` · hazard ${r.hazard.label} at ${r.hazard.distanceKm} km` : ""
      }`,
      duration: 12000,
    });
    return { ...r, queued: false, state: "TRANSMITTED" };
  };

  const stage = (s: string) => mAdvance({ sosId: s, stage: "ACKNOWLEDGED" as never });
  const acknowledgeSos = async (sosId: string) => {
    await stage(sosId);
    toast.success(`${sosId} acknowledged`, { description: "Recorded in the audit trail with your name and time." });
  };
  const assignResponse = async (sosId: string) => {
    await mAdvance({ sosId, stage: "RESPONSE_ASSIGNED" as never, responseTeam: "Maitri response team", vehicleIds: [] });
    toast.success("Response assigned");
  };
  const resolveSos = async (sosId: string) => {
    await mAdvance({ sosId, stage: "RESOLVED" as never, note: "Resolved by control room" });
    toast.success(`${sosId} resolved`);
  };

  const createPerson = async (i: PersonInput) => {
    const r = await mPerson(i);
    toast.success(`${r.personId} created`, { description: `${i.name} · ${i.role}` });
  };
  const createVehicle = async (i: VehicleInput) => {
    await mVehicle(i);
    toast.success(`${i.vehicleId} created`, { description: i.label });
  };
  const createConvoy = async (i: ConvoyInput) => {
    await mConvoy(i);
    toast.success(`${i.convoyId} ${i.startNow ? "started" : "created"}`, {
      description: `${i.personnelIds.length} personnel · ${i.vehicleIds.length} vehicles`,
    });
  };
  const createCargo = async (i: CargoInput) => {
    const r = await mCargo(i);
    toast.success(`${i.cargoId} booked`, { description: `Barcode ${r.barcode} · manifest expects ${i.containersExpected} containers` });
  };
  const createHazard = async (i: HazardInput) => {
    const r = await mHazard(i);
    toast[r.exposedSubjects > 0 ? "warning" : "success"](
      r.exposedSubjects > 0 ? `ROUTE EXPOSURE DETECTED — ${r.exposedSubjects} subject(s) inside the new zone` : `${i.hazardId} published`,
      { description: i.label },
    );
  };
  const createTask = async (i: TaskInput) => {
    await mTaskCreate(i);
    toast.success(`${i.taskId} opened`, { description: i.title });
  };

  const scanCargo = async (code: string): Promise<ScanResult> => {
    const stationsNow = stationsQ ?? [];
    const anchor = stationsNow[0];
    if (!anchor) return { result: "MISSING", cargoId: null };
    const r = await mScan({ code, deviceId: deviceId(), lat: anchor.lat, lon: anchor.lon });
    if (r.result === "MISSING") toast.error("MISSING CARGO", { description: "No manifest match — anomaly raised for verification." });
    else if (r.result === "UNVERIFIED") toast.warning("CONFLICT DETECTED", { description: "Central and field values differ; an authorised operator must resolve. Nothing was overwritten." });
    else if ((r.discrepancy ?? 0) < 0) toast.error("CARGO DISCREPANCY DETECTED", { description: `${Math.abs(r.discrepancy ?? 0)} container(s) unaccounted for.` });
    else toast.success("Scan verified", { description: r.cargoId ?? code });
    return r as ScanResult;
  };

  const updateInventory = async (itemId: string, delta: number, reason: InventoryReason) => {
    const r = await mInventory({ itemId, delta, reason });
    if (r.conflict) toast.warning("CONFLICT DETECTED", { description: "Central and field values differ. Nothing was overwritten — resolution required." });
    else toast.success("Inventory transaction recorded", { description: `${delta > 0 ? "+" : ""}${delta} · ${reason}` });
  };

  const updateTask = async (taskId: string, status: string) => {
    await mTask({ taskId, status });
    toast.success(`${taskId} → ${status}`);
  };

  const sendFamilyMessage = async (i: FamilyInput): Promise<FamilyResult> => {
    const r = await mFamily(i);
    if (r.state === "WAITING_FOR_CONNECTIVITY") {
      toast.message("Message queued", { description: "Encrypted locally and waiting for an available link. Not reported as delivered." });
    } else {
      toast.success("Message delivered", { description: r.audioExtractedFirst ? "Audio sent first; video waiting for sufficient bandwidth." : undefined });
    }
    return r;
  };

  const decideRecommendation = async (id: string, decision: "APPROVED" | "MODIFIED" | "REJECTED", note?: string) => {
    await mDecide({ recommendationId: id, decision, note });
    toast.success(`Recommendation ${decision.toLowerCase()}`, { description: "Recorded in the audit log with your name, the time and your reason." });
  };

  const markRead = async (notificationId: string) => {
    await mRead({ notificationId });
  };

  const resolveConflict = async (conflictId: string, resolution: "KEEP_CENTRAL" | "KEEP_FIELD" | "MERGED") => {
    await mConflict({ conflictId, resolution });
    toast.success("Conflict resolved", { description: "Written to the audit log." });
  };

  const search = (q: string) => setSearchTerm(q);
  const clearSearch = () => setSearchTerm("");

  /* ---- derived ------------------------------------------------------ */

  /**
   * `undefined` from a gated query means "not subscribed because this role may
   * not read it", which is `denied` -- not `loading`, and emphatically not
   * "ready with zero rows", which would tell the operator there is simply no
   * data when in fact they are not allowed to see any.
   */
  const gate = (data: unknown, resource: Resource): LoadState =>
    role === null ? "loading" : mayRead(resource) ? loadState(data, undefined) : "denied";

  const state: Record<string, LoadState> = {
    controlRoom: gate(controlRoom, "missions"),
    entities: gate(entities, "locations"),
    stations: gate(stationsQ, "missions"),
    personnel: gate(personnelQ, "personnel"),
    cargo: gate(cargoQ, "cargo"),
    inventory: gate(inventoryQ, "inventory"),
    convoys: gate(convoysQ, "transport"),
    hazards: gate(hazardsQ, "hazards"),
    weather: gate(weatherQ, "hazards"),
    emergencies: gate(emergenciesQ, "emergency"),
    notifications: gate(notificationsQ, "emergency"),
    ai: gate(aiQ, "ai"),
    audit: gate(auditQ, "audit"),
  };

  // A family account is a valid session with a deliberately narrow picture.
  // The role comes from the ungated `session` query, not from `controlRoom` --
  // a family member cannot read `missions`, so `controlRoom` is skipped for
  // them and deriving the role from it would silently read false.
  const isFamily = role === "FAMILY_MEMBER";

  const value: PolarisLive = {
    // Role comes from the ungated session query first; `controlRoom` is only a
    // fallback for the brief window before `session` resolves, and it is
    // skipped entirely for roles that cannot read `missions`.
    role: role ?? ((controlRoom?.actorRole as string) ?? (user && "role" in user ? ((user as { role?: string }).role ?? null) : null)),
    actorName: (user && "name" in user ? ((user as { name?: string }).name ?? null) : null) ?? null,
    isLoading: authLoading || needsSeed === undefined,
    isAuthenticated,
    signOut,

    environment: integrationsQ?.environment ?? "production",
    integrations: (integrationsQ?.integrations ?? []) as IntegrationsRow[],
    lastSyncTs: lastSyncTs ?? (controlRoom?.lastTickTs ?? null),

    controlRoom: (controlRoom ?? null) as ControlRoom | null,
    entities: (entities ?? null) as LiveEntities | null,
    stations: isFamily ? [] : ((stationsQ ?? []) as unknown as StationRow[]),
    personnel: isFamily ? [] : ((personnelQ ?? []) as unknown as PersonnelRow[]),
    cargo: isFamily ? [] : ((cargoQ ?? []) as unknown as CargoRow[]),
    inventory: isFamily ? [] : ((inventoryQ ?? []) as unknown as InventoryRow[]),
    convoys: isFamily ? [] : ((convoysQ ?? []) as unknown as ConvoyRow[]),
    hazards: isFamily ? [] : ((hazardsQ ?? []) as unknown as HazardRow[]),
    weather: isFamily ? [] : ((weatherQ ?? []) as unknown as WeatherRow[]),
    emergencies: isFamily ? [] : ((emergenciesQ ?? []) as unknown as EmergencyRow[]),
    notifications: ((notificationsQ ?? []) as unknown as NotificationRow[]) ?? [],
    aiFeed: isFamily ? [] : ((aiQ ?? []) as unknown as AiRow[]),
    syncStatus: (syncQ ?? null) as SyncStatus | null,
    // `mayRead("audit")` rather than `isFamily`: the audit trail is restricted
    // to administrators, so a control-room operator gets an empty list plus
    // `state.audit === "denied"` -- never a plausible-looking empty trail.
    audit: mayRead("audit") ? ((auditQ ?? []) as unknown as AuditRow[]) : [],
    searchHits: (searchTerm.trim().length >= 2 ? (searchResults ?? []) : []) as SearchHitRow[],
    search,
    clearSearch,

    state,
    errorMessage: null,

    connMode,
    setConnMode,
    queue,
    queueStats: qstats,
    syncNow: runSync,

    bootstrap,
    rebuild,
    setRunning,
    tick,
    raiseSos,
    acknowledgeSos,
    assignResponse,
    resolveSos,
    createPerson,
    createVehicle,
    createConvoy,
    createCargo,
    createHazard,
    createTask,
    scanCargo,
    updateInventory,
    updateTask,
    sendFamilyMessage,
    decideRecommendation,
    markRead,
    resolveConflict,
  };

  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export { api };
