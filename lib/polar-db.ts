/**
 * POLARIS shared data model.
 *
 * This module is imported by BOTH the Convex backend (src/convex/*) and the
 * browser client (src/lib, src/components). Convex bundles run in its own
 * TypeScript project, so every shared type must be dependency-free and must not
 * import React, the DOM, or any Vite-only module.
 *
 * It defines:
 *   - the authoritative role / permission matrix (RBAC)
 *   - the P0–P5 sync priority ladder
 *   - sync, audit, notification, hazard and AI-recommendation shapes
 *   - the shape of the field-event envelope used by the offline queue
 *
 * All operational values in the seed are SIMULATED. Real geography (Maitri,
 * Bharati, South Pole, ice shelves) is real and is labelled as such.
 */

/* ------------------------------------------------------------------ */
/* Roles & permissions (RBAC)                                          */
/* ------------------------------------------------------------------ */

export const ROLES = [
  "ADMIN",
  "CONTROL_ROOM",
  "STATION_COMMANDER",
  "FIELD_OPERATOR",
  "MEDICAL_AUTHORITY",
  "FAMILY_MEMBER",
] as const;

export type PolarisRole = (typeof ROLES)[number];

/** Resource keys used for permission checks. */
export type Resource =
  | "missions"
  | "cargo"
  | "inventory"
  | "personnel"
  | "locations"
  | "hazards"
  | "transport"
  | "emergency"
  | "reports"
  | "ai"
  | "medical"
  | "family"
  | "wellbeing"
  | "audit"
  | "admin"
  | "tasks";

/**
 * Explicit allow-matrix. Anything not listed for a role is denied, so a new
 * role can never accidentally inherit operational data.
 *
 * Note FAMILY_MEMBER: only `family` (+ the linked person's own wellbeing
 * submission). No map, no cargo, no other personnel, no hazards, no medical.
 */
export const ROLE_PERMISSIONS: Record<PolarisRole, readonly Resource[]> = {
  ADMIN: [
    "missions",
    "cargo",
    "inventory",
    "personnel",
    "locations",
    "hazards",
    "transport",
    "emergency",
    "reports",
    "ai",
    "medical",
    "family",
    "wellbeing",
    "audit",
    "admin",
    "tasks",
  ],
  CONTROL_ROOM: [
    "missions",
    "cargo",
    "inventory",
    "personnel",
    "locations",
    "hazards",
    "transport",
    "emergency",
    "reports",
    "ai",
    "wellbeing",
    "tasks",
  ],
  STATION_COMMANDER: [
    "missions",
    "inventory",
    "personnel",
    "locations",
    "hazards",
    "transport",
    "emergency",
    "cargo",
    "tasks",
  ],
  FIELD_OPERATOR: ["locations", "hazards", "cargo", "tasks", "family", "missions"],
  MEDICAL_AUTHORITY: ["medical", "personnel", "emergency", "tasks"],
  FAMILY_MEMBER: ["family"],
};

export function can(role: PolarisRole, resource: Resource): boolean {
  return ROLE_PERMISSIONS[role].includes(resource);
}

export function assertCan(role: PolarisRole, resource: Resource): void {
  if (!can(role, resource)) {
    throw new Error(`FORBIDDEN: role ${role} may not access ${resource}`);
  }
}

/** Only these roles may see family communication content. */
export const FAMILY_VISIBLE_ROLES: readonly PolarisRole[] = [
  "ADMIN",
  "CONTROL_ROOM",
  "FIELD_OPERATOR",
];

/** Aggregate-only well-being visibility. */
export const WELLBEING_VISIBLE_ROLES: readonly PolarisRole[] = [
  "ADMIN",
  "CONTROL_ROOM",
  "MEDICAL_AUTHORITY",
];

/* ------------------------------------------------------------------ */
/* Connectivity & sync priority                                        */
/* ------------------------------------------------------------------ */

export const CONNECTIVITY_MODES = [
  "NORMAL",
  "WEAK",
  "VERY_LOW",
  "OFFLINE",
] as const;
export type ConnectivityMode = (typeof CONNECTIVITY_MODES)[number];

/**
 * P0–P5 sync priority. Lower number = transmitted first.
 * A family video can never overtake an SOS packet.
 */
export const SYNC_PRIORITIES = [0, 1, 2, 3, 4, 5] as const;
export type SyncPriority = (typeof SYNC_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<SyncPriority, string> = {
  0: "P0 · SOS / critical emergency",
  1: "P1 · personnel safety / active mission",
  2: "P2 · location / hazard / convoy",
  3: "P3 · cargo / inventory / transport",
  4: "P4 · family messages",
  5: "P5 · reports / analytics / large media",
};

/**
 * The canonical field-event vocabulary.
 *
 * This is the single source of truth for both the server-side sync engine and
 * the browser-side offline queue. It MUST stay a superset of both: the two
 * used to declare separate unions, which meant an event the field device
 * queued as P1 (`PERSONNEL_SAFETY`) fell through the server's default branch
 * and was re-sorted to P5 — demoted below family video. One list, one ladder.
 */
export type FieldEventType =
  | "SOS"
  | "PERSONNEL_SAFETY"
  | "CHECK_IN"
  | "TASK_COMPLETE"
  | "LOCATION_UPDATE"
  | "HAZARD_ACKNOWLEDGED"
  | "WEATHER_OBSERVATION"
  | "CARGO_SCAN"
  | "INVENTORY_UPDATE"
  | "TRANSPORT_UPDATE"
  | "FAMILY_REPLY"
  | "FIELD_NOTE"
  | "FIELD_REPORT";

/**
 * Deterministic priority mapping — the engine, not the client, decides.
 *
 * The `default` branch fails loudly rather than returning a quiet P5: silently
 * defaulting is how safety-critical traffic gets demoted, so an unrecognised
 * event type must be a compile error or a thrown error, never a low priority.
 */
export function priorityFor(type: FieldEventType): SyncPriority {
  switch (type) {
    case "SOS":
      return 0;
    case "PERSONNEL_SAFETY":
    case "CHECK_IN":
    case "TASK_COMPLETE":
      return 1;
    case "LOCATION_UPDATE":
    case "HAZARD_ACKNOWLEDGED":
    case "WEATHER_OBSERVATION":
      return 2;
    case "CARGO_SCAN":
    case "INVENTORY_UPDATE":
    case "TRANSPORT_UPDATE":
      return 3;
    case "FAMILY_REPLY":
      return 4;
    case "FIELD_NOTE":
    case "FIELD_REPORT":
      return 5;
    default: {
      const unknown: never = type;
      throw new Error(
        `UNMAPPED FIELD EVENT TYPE: ${JSON.stringify(unknown)} has no sync priority. ` +
          `Add it to FieldEventType and to priorityFor in src/lib/polar-db.ts.`,
      );
    }
  }
}

/** The immutable envelope written by the field device, per field action. */
export interface FieldEventEnvelope {
  /** Client-generated idempotency key (device clock + counter). */
  eventId: string;
  deviceId: string;
  type: FieldEventType;
  /** Epoch millis on the device when the event was recorded. */
  recordedAt: number;
  payload: Record<string, unknown>;
}

export interface SyncAck {
  eventId: string;
  status: "APPLIED" | "CONFLICT" | "REJECTED";
  reason?: string;
  serverVersion?: number;
}

export interface SyncBatchResult {
  uploaded: number;
  applied: number;
  conflicts: number;
  rejected: number;
  acks: SyncAck[];
  /** Highest-priority event that was transmitted in this batch. */
  topPriority: SyncPriority | null;
}

/* ------------------------------------------------------------------ */
/* GPS / location events                                               */
/* ------------------------------------------------------------------ */

export type ConnectivityStatus = "ONLINE" | "LOW" | "OFFLINE";

/** A location event as stored by the backend. */
export interface LocationRecord {
  deviceId: string;
  subjectId: string | null;
  subjectKind: "person" | "vehicle" | "convoy" | "station" | null;
  lat: number;
  lon: number;
  accuracyM: number;
  altitudeM: number | null;
  speedKph: number | null;
  headingDeg: number | null;
  batteryPct: number | null;
  connectivity: ConnectivityStatus;
  /** Epoch millis on the device. */
  ts: number;
  source: "GPS" | "SIMULATOR" | "MANUAL";
}

/**
 * Never present stale data as live. This is the single source of truth for how
 * a marker's freshness is described in the UI.
 */
export type Freshness =
  | { kind: "LIVE"; msAgo: number }
  | { kind: "STALE"; msAgo: number }
  | { kind: "OFFLINE"; msAgo: number };

export const FRESH_LIVE_MS = 2 * 60 * 1000;
export const FRESH_STALE_MS = 10 * 60 * 1000;

export function freshnessOf(ts: number, now: number, connectivity: ConnectivityStatus): Freshness {
  const msAgo = Math.max(0, now - ts);
  if (connectivity === "OFFLINE") return { kind: "OFFLINE", msAgo };
  if (msAgo <= FRESH_LIVE_MS) return { kind: "LIVE", msAgo };
  if (msAgo <= FRESH_STALE_MS) return { kind: "STALE", msAgo };
  return { kind: "STALE", msAgo };
}

export function freshnessLabel(f: Freshness): string {
  const mins = Math.floor(f.msAgo / 60000);
  const stamp = mins < 1 ? "JUST NOW" : mins < 60 ? `${mins} MIN AGO` : `${Math.floor(mins / 60)} H AGO`;
  if (f.kind === "LIVE") return `LIVE · ${stamp}`;
  if (f.kind === "OFFLINE") return `OFFLINE — LAST KNOWN POSITION (${stamp})`;
  return `LOCATION STALE — ${stamp}`;
}

/* ------------------------------------------------------------------ */
/* Hazards & geospatial results                                        */
/* ------------------------------------------------------------------ */

export const HAZARD_TYPES = [
  "CREVASSE",
  "WHITEOUT",
  "BLIZZARD",
  "UNSTABLE_ICE",
  "WEATHER_HAZARD",
  "RESTRICTED_ZONE",
  "ROUTE_CLOSURE",
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export type Severity = "critical" | "warning" | "info";

/** Polygonal hazard zone (approximated by a centroid + radius on the ice). */
export interface HazardZoneRecord {
  id: string;
  hazardType: HazardType;
  label: string;
  severity: Severity;
  lat: number;
  lon: number;
  radiusKm: number;
  source: string;
  validFrom: number;
  validUntil: number | null;
  description: string;
  /** Which published route (if any) this zone intersects. */
  routeId: string | null;
}

export interface GeofenceHit {
  hazardId: string;
  label: string;
  hazardType: HazardType;
  severity: Severity;
  distanceKm: number;
  insidePolygon: boolean;
  routeId: string | null;
  description: string;
}

/* ------------------------------------------------------------------ */
/* Convoys                                                             */
/* ------------------------------------------------------------------ */

export const CONVOY_LIFECYCLE = [
  "PLANNED",
  "ACTIVE",
  "ARRIVED",
  "RETURNING",
  "CANCELLED",
] as const;
export type ConvoyStatus = (typeof CONVOY_LIFECYCLE)[number];
export type CommsStatus = "CONNECTED" | "LOW" | "OFFLINE" | "MISSED_CHECK_IN";

export interface ConvoyRecord {
  id: string;
  name: string;
  missionId: string;
  routeId: string;
  originId: string;
  destinationId: string;
  personnelIds: string[];
  vehicleIds: string[];
  departureTs: number;
  expectedArrivalTs: number;
  lastCheckinTs: number | null;
  checkinIntervalMin: number;
  status: ConvoyStatus;
  comms: CommsStatus;
  fuelPct: number;
  emergencyStatus: "NONE" | "CHECK_IN_OVERDUE" | "SOS";
}

/* ------------------------------------------------------------------ */
/* Cargo & inventory                                                   */
/* ------------------------------------------------------------------ */

export const CARGO_LIFECYCLE = [
  "PLANNED",
  "PACKED",
  "SCANNED",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED",
  "RECEIVED",
  "IN_INVENTORY",
  "CONSUMED",
] as const;
export type CargoStatus = (typeof CARGO_LIFECYCLE)[number];

export interface CargoRecord {
  id: string;
  rfid: string;
  barcode: string;
  itemType: string;
  quantity: number;
  unit: string;
  weightKg: number;
  origin: string;
  destinationStationId: string;
  missionId: string;
  transportId: string | null;
  containersExpected: number;
  containersReceived: number;
  containersUnverified: number;
  status: CargoStatus;
  dispatchedTs: number | null;
  expectedArrivalTs: number;
  actualArrivalTs: number | null;
  expiresTs: number | null;
  responsiblePersonId: string;
  verification: "VERIFIED" | "PENDING" | "DISCREPANT";
  /** Monotonic version used for offline conflict detection. */
  version: number;
}

export interface InventoryRecord {
  id: string;
  item: string;
  category:
    | "FOOD"
    | "WATER"
    | "FUEL"
    | "DIESEL"
    | "MEDICAL"
    | "EMERGENCY"
    | "SCIENTIFIC"
    | "SPARES"
    | "CONSUMABLES";
  stationId: string;
  quantity: number;
  unit: string;
  batch: string;
  expiresTs: number | null;
  minThreshold: number;
  consumptionRatePerDay: number;
  incomingQuantity: number;
  incomingEtaTs: number | null;
  reservedQuantity: number;
  version: number;
}

/* ------------------------------------------------------------------ */
/* Emergency                                                           */
/* ------------------------------------------------------------------ */

export const SOS_STAGES = [
  "TRIGGERED",
  "ACKNOWLEDGED",
  "RESPONSE_ASSIGNED",
  "RESPONDING",
  "RESOLVED",
] as const;
export type SosStage = (typeof SOS_STAGES)[number];

export interface SosRecord {
  id: string;
  personId: string;
  deviceId: string;
  lat: number;
  lon: number;
  accuracyM: number;
  triggeredTs: number;
  batteryPct: number | null;
  routeId: string | null;
  convoyId: string | null;
  nearestHazardId: string | null;
  nearestStationId: string;
  nearestStationKm: number;
  connectivityAtTrigger: ConnectivityStatus;
  category: string;
  stage: SosStage;
  responseTeam: string | null;
  assignedVehicleIds: string[];
  actions: { ts: number; actor: string; action: string }[];
  resolution: string | null;
  resolvedTs: number | null;
}

/* ------------------------------------------------------------------ */
/* Family Home Link                                                    */
/* ------------------------------------------------------------------ */

export const FAMILY_MESSAGE_TYPES = ["TEXT", "VOICE", "VIDEO", "PHOTO"] as const;
export type FamilyMessageType = (typeof FAMILY_MESSAGE_TYPES)[number];

export const FAMILY_MESSAGE_STATES = [
  "DRAFT",
  "QUEUED",
  "COMPRESSING",
  "WAITING_FOR_CONNECTIVITY",
  "TRANSMITTING",
  "DELIVERED",
  "OPENED",
] as const;
export type FamilyMessageState = (typeof FAMILY_MESSAGE_STATES)[number];

export const DELIVERY_QUALITY = ["LOW", "MEDIUM", "HIGH"] as const;
export type DeliveryQuality = (typeof DELIVERY_QUALITY)[number];

export interface FamilyMessageRecord {
  id: string;
  familyMemberId: string;
  expeditionPersonId: string;
  direction: "FAMILY_TO_FIELD" | "FIELD_TO_FAMILY";
  type: FamilyMessageType;
  /** Conceptual encoding steps actually applied before queueing. */
  pipeline: string[];
  sizeBytes: number;
  audioExtractedFirst: boolean;
  quality: DeliveryQuality;
  state: FamilyMessageState;
  createdTs: number;
  deliveredTs: number | null;
  openedTs: number | null;
  /** Cleared from the field cache N days after delivery. */
  expiresTs: number | null;
  encrypted: boolean;
}

/* ------------------------------------------------------------------ */
/* Notifications, audit, AI                                            */
/* ------------------------------------------------------------------ */

export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL" | "SMS" | "SATELLITE";

export interface NotificationRecord {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  ts: number;
  /** Deep link target: a module id, entity id, or map coordinate. */
  linkEntity: { table: string; id: string } | null;
  linkLatLon: { lat: number; lon: number } | null;
  channels: NotificationChannel[];
  read: boolean;
  /** Roles allowed to see it. */
  audience: readonly PolarisRole[];
}

export interface AuditRecord {
  id: string;
  ts: number;
  actor: string;
  actorRole: PolarisRole | "SYSTEM";
  action: string;
  target: string;
  /** For AI-driven decisions: the recommendation that produced this action. */
  aiRecommendationId: string | null;
  reason: string | null;
  before: string | null;
  after: string | null;
  result: string;
}

export const RECOMMENDATION_STATES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "MODIFIED",
  "REJECTED",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

export interface AiRecommendationRecord {
  id: string;
  module: "PREDICTION" | "ANOMALY" | "RISK" | "OPTIMIZATION" | "RECOMMENDATION";
  title: string;
  recommendation: string;
  reason: string;
  dataUsed: string[];
  /** Deterministic evidence strength, not a fabricated probability. */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  impact: string;
  ts: number;
  state: RecommendationState;
  approvedBy: string | null;
  approvedTs: number | null;
  relatedEntities: { table: string; id: string }[];
}

/* ------------------------------------------------------------------ */
/* Realtime event bus                                                  */
/* ------------------------------------------------------------------ */

export const REALTIME_EVENTS = [
  "LOCATION_UPDATED",
  "CONVOY_UPDATED",
  "HAZARD_DETECTED",
  "WEATHER_UPDATED",
  "CARGO_SCANNED",
  "CARGO_DISCREPANCY",
  "INVENTORY_LOW",
  "SOS_TRIGGERED",
  "SOS_ACKNOWLEDGED",
  "SYNC_STARTED",
  "SYNC_COMPLETED",
  "CONNECTIVITY_CHANGED",
  "FAMILY_MESSAGE_AVAILABLE",
  "AI_RECOMMENDATION_CREATED",
  "CHECK_IN_OVERDUE",
  "CONFLICT_DETECTED",
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENTS)[number];

export interface RealtimeEvent {
  id: string;
  type: RealtimeEventType;
  ts: number;
  payload: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Well-being (non-diagnostic, aggregate-only to the control room)      */
/* ------------------------------------------------------------------ */

export const CHECKIN_LEVELS = ["GOOD", "OKAY", "LOW", "STRUGGLING"] as const;
export type CheckinLevel = (typeof CHECKIN_LEVELS)[number];

export const SUPPORT_ROUTES = ["FAMILY", "TEAM", "MEDICAL"] as const;
export type SupportRoute = (typeof SUPPORT_ROUTES)[number];

export interface WellbeingCheckinRecord {
  id: string;
  personId: string;
  ts: number;
  level: CheckinLevel;
  /** Optional, never surfaced to the control room. */
  supportRoute: SupportRoute | null;
  /** Private note — encrypted field, never returned outside owner/medical. */
  privateNote: string | null;
}

/** What the control room is allowed to see: counts only. */
export interface WellbeingAggregate {
  checkinsCompleted: number;
  teamSize: number;
  supportRequests: number;
  familyBacklog: number;
  connectivityDisruptions: number;
  lastCheckinTs: number | null;
}

/* ------------------------------------------------------------------ */
/* Integration adapters (future hardware / data sources)              */
/* ------------------------------------------------------------------ */

export interface TelemetryAdapter {
  id: string;
  kind: "GPS_TRACKER" | "RFID_READER" | "BARCODE_SCANNER" | "SATCOM" | "WEATHER_API" | "GIS_LAYER" | "VEHICLE_TELEMETRY" | "MEDICAL_SYSTEM" | "IDENTITY_SYSTEM";
  label: string;
  connected: boolean;
  /** Prototype ships with simulated sources only. */
  live: boolean;
  note: string;
}

export const INTEGRATION_ADAPTERS: TelemetryAdapter[] = [
  { id: "ad-gps", kind: "GPS_TRACKER", label: "Field GPS trackers (personnel & vehicles)", connected: true, live: false, note: "Simulated telemetry engine in this prototype. Replaceable by Iridium/GPS modem feed." },
  { id: "ad-rfid", kind: "RFID_READER", label: "RFID / barcode cargo readers", connected: true, live: false, note: "Scan pipeline implemented; physical readers plug into the same event contract." },
  { id: "ad-satcom", kind: "SATCOM", label: "Satellite communication link", connected: true, live: false, note: "Connectivity ladder + P0-P5 queue simulated; real satcom sits behind the same interface." },
  { id: "ad-weather", kind: "WEATHER_API", label: "Antarctic weather ingestion", connected: false, live: false, note: "Not connected. Ingested values are SIMULATED and labelled as such." },
  { id: "ad-gis", kind: "GIS_LAYER", label: "GIS / hazard polygon layers", connected: true, live: true, note: "Real EPSG:3031 basemap via NASA GIBS; hazard polygons authored from published crevasse-field data." },
  { id: "ad-vehicle", kind: "VEHICLE_TELEMETRY", label: "Snow vehicle telemetry", connected: true, live: false, note: "Fuel/route progress simulated from mission profiles." },
  { id: "ad-medical", kind: "MEDICAL_SYSTEM", label: "Medical system integration", connected: false, live: false, note: "Not connected. Store-and-forward medical queue implemented without diagnosis." },
  { id: "ad-identity", kind: "IDENTITY_SYSTEM", label: "NCPOR identity / roster feed", connected: false, live: false, note: "Not connected. Auth + RBAC implemented locally against the project identity provider." },
];
