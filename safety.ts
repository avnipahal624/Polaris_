/**
 * POLARIS safety layer — convoys, incidents, hazard-aware routing,
 * priority-aware sync and the connectivity ladder.
 *
 * Design lesson (operational, not sensational): Antarctic field incidents
 * happen during movement, in hazardous terrain, when communication and
 * response logistics are critical. POLARIS therefore connects
 * Movement → Route → Hazard → Weather → Connectivity → Check-in → SOS → Response
 * as ONE chain.
 */
import { HAZARDS, ROUTES, TRANSPORTS, hazardById, stationById, type Route } from "./polar-data";

/* ------------------------------------------------------------------ */
/* Connectivity ladder                                                 */
/* ------------------------------------------------------------------ */

export type ConnMode = "NORMAL" | "WEAK" | "LOW_BANDWIDTH" | "OFFLINE";

export const CONN_META: Record<ConnMode, { label: string; tone: string; note: string }> = {
  NORMAL: { label: "NORMAL", tone: "text-emerald-300 bg-emerald-500/15", note: "Full sync and operational data" },
  WEAK: { label: "WEAK", tone: "text-sky-300 bg-sky-500/15", note: "Text-first payloads, images deferred" },
  LOW_BANDWIDTH: { label: "LOW BANDWIDTH", tone: "text-amber-300 bg-amber-500/15", note: "Mission-critical only — imagery, analytics and large datasets deferred" },
  OFFLINE: { label: "OFFLINE", tone: "text-amber-200 bg-amber-500/20", note: "Local operation — all actions queue encrypted, sync on reconnect" },
};

/** What stays live / cached in LOW_BANDWIDTH or OFFLINE. */
export const CRITICAL_OFFLINE_SCOPE = [
  "SOS & emergency",
  "Personnel status & location",
  "Hazards & crevasse zones",
  "Active routes",
  "Cargo status & manifests",
  "Critical inventory",
  "Weather warnings",
  "Emergency contacts",
  "Offline Antarctic map",
  "Saved routes",
];

/* ------------------------------------------------------------------ */
/* Priority-aware synchronization                                      */
/* ------------------------------------------------------------------ */

export type SyncPriority = 1 | 2 | 3 | 4;

export const PRIORITY_META: Record<SyncPriority, { label: string; scope: string; tone: string }> = {
  1: { label: "P1", scope: "SOS · Emergency · Personnel safety", tone: "bg-red-500/20 text-red-300" },
  2: { label: "P2", scope: "Location · Hazard · Active mission", tone: "bg-amber-500/20 text-amber-300" },
  3: { label: "P3", scope: "Cargo · Inventory · Transport", tone: "bg-sky-500/20 text-sky-300" },
  4: { label: "P4", scope: "Reports · Analytics · Images · Non-critical", tone: "bg-white/10 text-sky-200/70" },
};

export function priorityOf(kind: string): SyncPriority {
  if (kind === "SOS") return 1;
  if (kind === "GPS EVENT" || kind === "HAZARD REPORT" || kind === "TASK STATUS") return 2;
  if (kind === "CARGO SCAN" || kind === "INVENTORY UPDATE") return 3;
  return 4;
}

/* ------------------------------------------------------------------ */
/* Convoys — field movement safety                                     */
/* ------------------------------------------------------------------ */

export interface Convoy {
  id: string;
  name: string;
  personnel: number;
  vehicles: string[];
  routeId?: string;
  from: string;
  to: string;
  departure: string;
  expectedArrival: string;
  /** derived: CONNECTED · LOW CONNECTIVITY · LAST SYNC Xm · MISSED CHECK-IN */
  comms: "CONNECTED" | "LOW CONNECTIVITY" | "MISSED CHECK-IN";
  lastSyncMinAgo: number;
  checkInDue: string;
  emergencyContact: string;
  lastKnown?: { lat: number; lon: number };
  cargoSummary: string;
}

export const CONVOYS: Convoy[] = [
  {
    id: "cv-07",
    name: "CONVOY 07",
    personnel: 6,
    vehicles: ["S-04", "S-05", "S-02"],
    routeId: "r-suhrid",
    from: "Maitri",
    to: "Camp Suhrid",
    departure: "13:10",
    expectedArrival: "16:00",
    comms: "CONNECTED",
    lastSyncMinAgo: 2,
    checkInDue: "Every 30 min",
    emergencyContact: "Maitri station ops — VHF 6",
    lastKnown: { lat: -70.97, lon: 13.1 },
    cargoSummary: "Generator fuel (800 L), camp spares",
  },
  {
    id: "cv-03",
    name: "CONVOY 03",
    personnel: 4,
    vehicles: ["S-07", "S-08"],
    routeId: "r-larsemann",
    from: "Bharati",
    to: "Camp Larsemann N",
    departure: "14:40",
    expectedArrival: "17:10",
    comms: "LOW CONNECTIVITY",
    lastSyncMinAgo: 17,
    checkInDue: "Every 45 min",
    emergencyContact: "Bharati station ops — Satcom B",
    lastKnown: { lat: -69.15, lon: 76.9 },
    cargoSummary: "Atmospherics instruments, mail",
  },
  {
    id: "cv-05",
    name: "CONVOY 05",
    personnel: 5,
    vehicles: ["S-03", "S-06"],
    routeId: "r-priya",
    from: "Maitri",
    to: "Camp Priyadarshini",
    departure: "15:20",
    expectedArrival: "17:30",
    comms: "MISSED CHECK-IN",
    lastSyncMinAgo: 52,
    checkInDue: "17:30 — OVERDUE 22 min",
    emergencyContact: "Maitri station ops — VHF 6",
    lastKnown: { lat: -70.68, lon: 11.1 },
    cargoSummary: "Storm anchoring kit, rations",
  },
];

export function convoyStatusLine(c: Convoy): string {
  if (c.comms === "MISSED CHECK-IN") return `${c.personnel} personnel · ${c.vehicles.length} vehicles · ${c.from} → ${c.to} · LAST SYNC ${c.lastSyncMinAgo} MIN AGO`;
  if (c.comms === "LOW CONNECTIVITY") return `${c.personnel} personnel · ${c.vehicles.length} vehicles · ${c.from} → ${c.to} · LOW CONNECTIVITY · LAST SYNC ${c.lastSyncMinAgo} MIN AGO`;
  return `${c.personnel} personnel · ${c.vehicles.length} vehicles · ${c.from} → ${c.to} · Connected`;
}

/** Available response resources for an incident near a position. */
export function responseResourcesNear(lat: number, lon: number): { name: string; kind: string; note: string }[] {
  return [
    { name: "Snow Vehicle S-03", kind: "vehicle", note: "Ready at Maitri vehicle line — 25 min to muster" },
    { name: "Helicopter H-01", kind: "helicopter", note: "Weather hold at Maitri helipad — flies when visibility recovers" },
    { name: "Maitri medical team", kind: "team", note: "Lt. M. Pillai + 2 — 15 min muster" },
    { name: "DG Depot depot team", kind: "team", note: "Strategic backup — 6 h notice" },
  ];
}

/* ------------------------------------------------------------------ */
/* Hazard-aware routing                                                */
/* ------------------------------------------------------------------ */

export type Exposure = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface RouteExposure {
  routeId: string;
  label: string;
  kind: Route["kind"];
  from: string;
  to: string;
  exposure: Exposure;
  factors: { label: string; weight: number }[];
  score: number;
  why: string[];
  alternative?: string;
  affectedConvoys: string[];
}

export function assessRouteExposure(routeId: string): RouteExposure | null {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) return null;
  const hazards = (route.hazardIds ?? []).map((h) => hazardById(h)).filter((h): h is NonNullable<typeof h> => Boolean(h));
  const from = stationById(route.fromId)?.short ?? route.fromId;
  const to = stationById(route.toId)?.short ?? route.toId;

  const factors: { label: string; weight: number }[] = [];
  const why: string[] = [];
  let score = 0;

  for (const h of hazards) {
    const w = h.severity === "critical" ? 30 : h.severity === "warning" ? 18 : 6;
    factors.push({ label: `${h.kind} intersects route (+${w})`, weight: w });
    why.push(`${h.label} intersects the planned alignment — ${h.note}`);
    score += w;
  }

  // Weather at destination station
  const dest = stationById(route.toId);
  if (dest) {
    if (dest.weather.visibilityKm <= 2) {
      factors.push({ label: `Visibility deteriorating (${dest.weather.visibilityKm} km at ${dest.short}) (+14)`, weight: 14 });
      why.push(`Visibility at ${dest.short} is ${dest.weather.visibilityKm} km — below the 2 km movement gate.`);
      score += 14;
    }
    if (dest.weather.windKph >= 45) {
      factors.push({ label: `Wind increasing (${dest.weather.windKph} km/h at ${dest.short}) (+10)`, weight: 10 });
      why.push(`Sustained wind ${dest.weather.windKph} km/h at ${dest.short} — convoys and hoist ops affected.`);
      score += 10;
    }
  }

  score = Math.min(100, score);
  const exposure: Exposure = score >= 55 ? "CRITICAL" : score >= 35 ? "HIGH" : score >= 15 ? "MODERATE" : "LOW";

  const alternative =
    route.id === "r-suhrid"
      ? "Alternative: southern detour via benchmark B-12 adds 6 km but avoids the expanded crevasse fringe; guided passage still mandatory."
      : route.id === "r-priya"
        ? "Alternative: delay departure until the system passes (~7 h) — no safe detour exists around the blizzard cell."
        : route.id === "r-larsemann"
          ? "Alternative: coastal ice route via waypoint LC-4; adds 40 min, avoids the extreme-wind corridor."
          : undefined;

  const affectedConvoys = CONVOYS.filter((c) => c.routeId === route.id).map((c) => c.name);

  return { routeId: route.id, label: route.label, kind: route.kind, from, to, exposure, factors, score, why, alternative, affectedConvoys };
}

export const EXPOSURE_TONE: Record<Exposure, string> = {
  LOW: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/40",
  MODERATE: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/40",
  HIGH: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40",
  CRITICAL: "bg-red-500/15 text-red-300 ring-1 ring-red-400/40",
};

export const ROUTES_EXPOSED = ROUTES.filter((r) => r.status === "active" || r.status === "planned")
  .map((r) => assessRouteExposure(r.id))
  .filter((e): e is RouteExposure => e !== null && (e.exposure === "HIGH" || e.exposure === "CRITICAL"));

/* ------------------------------------------------------------------ */
/* Incident / safety history                                           */
/* ------------------------------------------------------------------ */

export interface IncidentRecord {
  id: string;
  date: string;
  time: string;
  location: string;
  people: string;
  mission: string;
  hazard: string;
  weather: string;
  comms: string;
  actions: string[];
  responseTime: string;
  resolution: string;
  open?: boolean;
}

export const INCIDENTS_SEED: IncidentRecord[] = [
  {
    id: "INC-2609-04",
    date: "26 Sep 2026",
    time: "14:43",
    location: "Camp B — Sector 4 approach (−71.02, 13.90)",
    people: "Tenzing Bhutia (Field Researcher)",
    mission: "CONVOY 07 support · sediment recovery",
    hazard: "Crevasse Field — Sector C",
    weather: "−21°C, wind 18 km/h, blizzard approaching within 7 h",
    comms: "OFFLINE — SOS stored locally, priority transmission queued",
    actions: ["GPS captured on device", "SOS queued locally (P1)", "HQ alert on packet receipt", "S-04 + med team dispatched", "H-01 on standby"],
    responseTime: "11 min from packet receipt to response assignment",
    resolution: "In progress — casualty stabilized, evac pending weather window",
    open: true,
  },
  {
    id: "INC-2609-02",
    date: "19 Sep 2026",
    time: "06:55",
    location: "Camp Suhrid power hut",
    people: "Kavita Joshi + 1",
    mission: "Generator maintenance",
    hazard: "Equipment fault (fuel line)",
    weather: "−24°C, clear",
    comms: "NORMAL",
    actions: ["Generator G-2 isolated", "Fuel line clamped", "Fire watch posted", "Replacement pump flown in on H-02"],
    responseTime: "3 h 40 min (parts flight)",
    resolution: "Resolved — generator back online; maintenance cadence increased",
  },
  {
    id: "INC-2608-11",
    date: "14 Jan 2026",
    time: "11:20",
    location: "Over-ice route, 6 km S of Schirmacher",
    people: "CONVOY 02 (4 pax)",
    mission: "Resupply traverse",
    hazard: "Crevasse — unbridged, hidden by snow bridge",
    weather: "−8°C, vis 8 km",
    comms: "WEAK — VHF only",
    actions: ["Lead vehicle snow-bridge collapse (no injuries)", "Route halted", "Guided probe of alternate line", "Route segment re-surveyed and flagged"],
    responseTime: "38 min to convoy extract",
    resolution: "Resolved — crevasse field re-mapped; guided passage made mandatory on this segment",
  },
];

/* ------------------------------------------------------------------ */
/* Field safety mode actions                                           */
/* ------------------------------------------------------------------ */

export const FIELD_ACTIONS = [
  { id: "map", label: "MAP", note: "Offline map · saved routes" },
  { id: "scan", label: "SCAN", note: "Cargo & RFID — queues offline" },
  { id: "tasks", label: "TASKS", note: "Task status updates" },
  { id: "hazards", label: "HAZARDS", note: "Cached crevasse zones" },
  { id: "weather", label: "WEATHER", note: "Last cached warnings" },
  { id: "sos", label: "SOS", note: "Works with no network" },
  { id: "sync", label: "SYNC", note: "Priority queue status" },
] as const;

export type FieldActionId = (typeof FIELD_ACTIONS)[number]["id"];
