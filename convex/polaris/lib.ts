/**
 * POLARIS backend core.
 *
 * Everything the Convex functions share: identity + RBAC, geospatial
 * evaluation, POLAR INTELLIGENCE, the audit writer, the notification engine
 * and the realtime event bus.
 *
 * Design rules enforced here:
 *   - authorisation is checked server-side on every read and write
 *   - hazard proximity is computed on the server, never in the client
 *   - freshness is derived from the device timestamp, never faked
 *   - every consequential action writes an audit record
 *   - the AI layer recommends; it never mutates operational state
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

import {
  can,
  priorityFor,
  type AiRecommendationRecord,
  type AuditRecord,
  type FieldEventEnvelope,
  type GeofenceHit,
  type HazardZoneRecord,
  type NotificationChannel,
  type NotificationRecord,
  type PolarisRole,
  type RealtimeEventType,
  type Resource,
  type Severity,
} from "../../lib/polar-db";
import {
  bearingDeg,
  evaluateGeofences,
  haversineKm,
  nearestStation,
  nearestOnPath,
  pointAlongPath,
  routeIntersectsZone,
} from "../../lib/polar-geo";

/* ------------------------------------------------------------------ */
/* Ids & time                                                          */
/* ------------------------------------------------------------------ */

let counter = 0;
export function nextId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36).padStart(4, "0")}`;
}

export const now = () => Date.now();
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* Identity & RBAC                                                     */
/* ------------------------------------------------------------------ */

export interface Actor {
  userId: Id<"users"> | null;
  name: string;
  role: PolarisRole;
  /** For family accounts: the single expedition member they may see. */
  linkedPersonId: string | null;
}

/**
 * The demo control room runs as CONTROL_ROOM. In a real deployment this comes
 * from the NCPOR identity provider; the project already federates a signed-in
 * operator identity through Convex Auth, and the role is read from the user
 * record. Anonymous demo sessions are treated as CONTROL_ROOM so the prototype
 * is explorable, but they are labelled as such everywhere in the UI.
 */
export async function requireActor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return {
      userId: null,
      name: "Demo Operator (anonymous)",
      role: "CONTROL_ROOM",
      linkedPersonId: null,
    };
  }
  const user = await ctx.db.get(userId);
  const role = ((user as { role?: PolarisRole } | null)?.role ?? "CONTROL_ROOM") as PolarisRole;
  return {
    userId,
    name: (user as { name?: string } | null)?.name ?? (user as { email?: string } | null)?.email ?? "operator",
    role,
    linkedPersonId: (user as { linkedPersonId?: string } | null)?.linkedPersonId ?? null,
  };
}

export function requireResource(actor: Actor, resource: Resource): void {
  if (!can(actor.role, resource)) {
    throw new Error(`FORBIDDEN: ${actor.role} may not access ${resource}`);
  }
}

/* ------------------------------------------------------------------ */
/* Audit writer                                                        */
/* ------------------------------------------------------------------ */

export interface AuditInput {
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  aiRecommendationId?: string | null;
  reason?: string | null;
  before?: string | null;
  after?: string | null;
  result?: string;
}

export async function writeAudit(ctx: MutationCtx, input: AuditInput): Promise<Id<"auditLogs">> {
  return ctx.db.insert("auditLogs", {
    auditId: nextId("AUD"),
    ts: now(),
    actor: input.actor,
    actorRole: input.actorRole,
    action: input.action,
    target: input.target,
    aiRecommendationId: input.aiRecommendationId ?? undefined,
    reason: input.reason ?? undefined,
    before: input.before ?? undefined,
    after: input.after ?? undefined,
    result: input.result ?? "OK",
  });
}

/* ------------------------------------------------------------------ */
/* Notification engine                                                 */
/* ------------------------------------------------------------------ */

export interface NotificationInput {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  audience: readonly PolarisRole[];
  linkEntity?: { table: string; id: string } | null;
  linkLatLon?: { lat: number; lon: number } | null;
  channels?: NotificationChannel[];
  /** Suppress duplicates of the same kind within this window. */
  dedupeKey?: string;
}

export async function notify(ctx: MutationCtx, input: NotificationInput): Promise<Id<"notifications">> {
  if (input.dedupeKey) {
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_ts")
      .order("desc")
      .take(40);
    const cutoff = now() - 5 * MIN;
    const dupe = recent.find(
      (n) => n.ts > cutoff && n.title === input.title && n.kind === input.kind,
    );
    if (dupe) return dupe._id;
  }
  return ctx.db.insert("notifications", {
    notificationId: nextId("NTF"),
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    ts: now(),
    linkEntity: input.linkEntity ?? undefined,
    linkLatLon: input.linkLatLon ?? undefined,
    channels: input.channels ?? ["IN_APP"],
    read: false,
    audience: [...input.audience],
    createdAt: now(),
    updatedAt: now(),
  });
}

/* ------------------------------------------------------------------ */
/* Realtime event bus                                                  */
/* ------------------------------------------------------------------ */

export async function publish(
  ctx: MutationCtx,
  type: RealtimeEventType,
  payload: Record<string, unknown>,
  audience: readonly PolarisRole[],
): Promise<Id<"realtimeEvents">> {
  return ctx.db.insert("realtimeEvents", {
    eventId: nextId("EVT"),
    type,
    ts: now(),
    payload: JSON.stringify(payload),
    audience: [...audience],
    createdAt: now(),
    updatedAt: now(),
  });
}

/* ------------------------------------------------------------------ */
/* Geospatial reads                                                    */
/* ------------------------------------------------------------------ */

/** Rows -> the transport shape the shared geospatial engine understands. */
function toHazardRecords(rows: Doc<"hazardZones">[]): HazardZoneRecord[] {
  return rows.map((h) => ({
    id: h._id,
    hazardType: h.hazardType,
    label: h.label,
    severity: h.severity,
    lat: h.lat,
    lon: h.lon,
    radiusKm: h.radiusKm,
    source: h.source,
    validFrom: h.validFrom,
    validUntil: h.validUntil ?? null,
    description: h.description,
    routeId: h.routeId ?? null,
  }));
}

export async function activeHazards(ctx: QueryCtx | MutationCtx): Promise<HazardZoneRecord[]> {
  const t = now();
  const all = await ctx.db.query("hazardZones").collect();
  return toHazardRecords(
    all.filter((h) => h.validFrom <= t && (h.validUntil === undefined || h.validUntil >= t)),
  );
}

/** Server-side geofence check for a position. This is the only place it happens. */
export async function geofence(
  ctx: QueryCtx | MutationCtx,
  point: { lat: number; lon: number },
): Promise<GeofenceHit[]> {
  return evaluateGeofences(point, await activeHazards(ctx), now());
}

export async function nearestStationTo(ctx: QueryCtx | MutationCtx, point: { lat: number; lon: number }) {
  const rows = await ctx.db.query("stations").collect();
  // Keep the full station row so callers get `.short` / `.code`, not just coords.
  return nearestStation(
    point,
    rows.map((s) => ({ ...s, id: s._id })),
  );
}

/**
 * Ingest a location event: store the immutable event, update the last-known
 * pointer, then evaluate geofences. Returns the exposure hits found.
 */
export async function ingestLocation(
  ctx: MutationCtx,
  input: {
    deviceId: string;
    subjectId?: string;
    subjectKind?: "person" | "vehicle" | "convoy" | "station";
    lat: number;
    lon: number;
    accuracyM: number;
    altitudeM?: number;
    speedKph?: number;
    headingDeg?: number;
    batteryPct?: number;
    connectivity: "ONLINE" | "LOW" | "OFFLINE";
    ts: number;
    source: "GPS" | "SIMULATOR" | "MANUAL";
  },
) {
  const ts = input.ts;
  const eventId = nextId("LOC");
  await ctx.db.insert("locationEvents", {
    eventId,
    deviceId: input.deviceId,
    subjectId: input.subjectId,
    subjectKind: input.subjectKind ?? "person",
    lat: input.lat,
    lon: input.lon,
    accuracyM: input.accuracyM,
    altitudeM: input.altitudeM,
    speedKph: input.speedKph,
    headingDeg: input.headingDeg,
    batteryPct: input.batteryPct,
    connectivity: input.connectivity,
    ts,
    ingestedAt: now(),
    source: input.source,
    createdAt: now(),
    updatedAt: now(),
  });

  if (input.subjectId) {
    const existing = await ctx.db
      .query("lastKnownPositions")
      .withIndex("by_subject", (q) => q.eq("subjectId", input.subjectId!))
      .unique();
    const doc = {
      subjectId: input.subjectId,
      subjectKind: input.subjectKind ?? "person",
      lat: input.lat,
      lon: input.lon,
      accuracyM: input.accuracyM,
      batteryPct: input.batteryPct,
      connectivity: input.connectivity,
      ts,
      source: input.source,
      updatedAt: now(),
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("lastKnownPositions", doc);

    const dev = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", input.deviceId))
      .unique();
    if (dev) {
      await ctx.db.patch(dev._id, {
        connectivity: input.connectivity === "ONLINE" ? "ONLINE" : input.connectivity,
        batteryPct: input.batteryPct ?? dev.batteryPct,
        lastEventTs: ts,
        updatedAt: now(),
      });
    }
  }

  const hits = await geofence(ctx, { lat: input.lat, lon: input.lon });
  await publish(ctx, "LOCATION_UPDATED", { subjectId: input.subjectId, lat: input.lat, lon: input.lon }, [
    "ADMIN",
    "CONTROL_ROOM",
    "STATION_COMMANDER",
    "MEDICAL_AUTHORITY",
  ]);
  return { eventId, hits };
}

/* ------------------------------------------------------------------ */
/* POLAR INTELLIGENCE ENGINE (server-side, over real rows)             */
/* ------------------------------------------------------------------ */

export interface IntelligenceResult {
  recommendations: AiRecommendationRecord[];
}

function daysToThreshold(
  quantity: number,
  threshold: number,
  consumptionPerDay: number,
): number | null {
  if (consumptionPerDay <= 0) return null;
  const usable = quantity - threshold;
  if (usable <= 0) return 0;
  return usable / consumptionPerDay;
}

/**
 * Recompute the whole decision-support picture from the database.
 * Called after any state change, so the feed can never drift from reality.
 */
export async function computeIntelligence(
  ctx: QueryCtx | MutationCtx,
): Promise<IntelligenceResult> {
  const [stations, inventory, cargo, convoys, weather, hazards, routes, vehicles] = await Promise.all([
    ctx.db.query("stations").collect(),
    ctx.db.query("inventory").collect(),
    ctx.db.query("cargo").collect(),
    ctx.db.query("convoys").collect(),
    ctx.db.query("weatherEvents").order("desc").take(40),
    ctx.db.query("hazardZones").collect(),
    ctx.db.query("routes").collect(),
    ctx.db.query("vehicles").collect(),
  ]);

  const out: AiRecommendationRecord[] = [];
  const t = now();

  /* ---- PREDICTION: supply / fuel / demand / expiry ---- */
  for (const item of inventory) {
    const station = stations.find((s) => s._id === item.stationId);
    const stationName = station?.short ?? item.stationId;
    const delayFactor = cargo.some(
      (c) => c.destinationStationId === item.stationId && c.status === "IN_TRANSIT",
    ) ? 0 : 1;
    const eta = item.incomingEtaTs ?? null;
    const effective = eta && eta > t + 5 * DAY && delayFactor === 0 ? eta : eta;

    const days = daysToThreshold(item.quantity, item.minThreshold, item.consumptionRatePerDay);
    if (days !== null && days <= 14) {
      const covered = effective !== null && effective <= t + days * DAY;
      out.push({
        id: nextId("REC"),
        module: "PREDICTION",
        title: `${item.item} below reserve in ${days.toFixed(1)} d`,
        recommendation: covered
          ? `Confirm inbound ${item.item} consignment and hold consumption at current rate.`
          : `Bring forward an additional ${Math.ceil((item.minThreshold - item.quantity + item.consumptionRatePerDay * 7) / 100) * 100} ${item.unit} of ${item.item} to ${stationName}.`,
        reason: `Stock ${item.quantity} ${item.unit} · daily draw ${item.consumptionRatePerDay} ${item.unit}/d · minimum ${item.minThreshold} ${item.unit}${
          effective ? ` · next inbound ETA in ${Math.max(0, Math.round((effective - t) / DAY))} d` : " · no inbound scheduled"
        }.`,
        dataUsed: [
          `inventory:${item.itemId}`,
          `station:${item.stationId}`,
          effective ? "cargo:incoming" : "cargo:none-inbound",
        ],
        confidence: days < 7 ? "HIGH" : "MEDIUM",
        impact: days < 5 ? "Operational risk if the inbound leg slips" : "Manageable with current schedule",
        ts: t,
        state: "PENDING_APPROVAL",
        approvedBy: null,
        approvedTs: null,
        relatedEntities: [
          { table: "inventory", id: item._id },
          { table: "stations", id: item.stationId },
        ],
      });
    }

    if (item.expiresTs && item.expiresTs < t + 30 * DAY) {
      const projectedUnused = Math.max(
        0,
        Math.round(item.quantity - item.consumptionRatePerDay * ((item.expiresTs - t) / DAY)),
      );
      if (projectedUnused > 0) {
        out.push({
          id: nextId("REC"),
          module: "ANOMALY",
          title: `EXPIRY — ${projectedUnused} ${item.unit} of ${item.item} at risk`,
          recommendation: `Reorder the meal/rotation plan to consume batch ${item.batch} first.`,
          reason: `Batch expires in ${Math.max(0, Math.round((item.expiresTs - t) / DAY))} days; projected unused at current draw is ${projectedUnused} ${item.unit}.`,
          dataUsed: [`inventory:${item.itemId}`],
          confidence: "HIGH",
          impact: "Wasted expedition stores and a station-level supply dip",
          ts: t,
          state: "PENDING_APPROVAL",
          approvedBy: null,
          approvedTs: null,
          relatedEntities: [{ table: "inventory", id: item._id }],
        });
      }
    }
  }

  /* ---- ANOMALY: cargo discrepancy ---- */
  for (const c of cargo) {
    const short = c.containersReceived - c.containersExpected;
    if (short < 0) {
      const ship = vehicles.find((v) => v._id === c.transportId);
      out.push({
        id: nextId("REC"),
        module: "ANOMALY",
        title: `CARGO DISCREPANCY — ${c.cargoId} short ${Math.abs(short)} container(s)`,
        recommendation: `Freeze manifest closure on ${c.cargoId} and re-scan the ${Math.abs(short)} unaccounted unit(s) before discharge closes.`,
        reason: `Expected ${c.containersExpected}, received ${c.containersReceived}, unverified ${c.containersUnverified}${
          ship ? ` · ${ship.label} in ${ship.status}` : ""
        }. Offline scans are reconciled through the sync queue, not overwritten.`,
        dataUsed: [`cargo:${c.cargoId}`, c.transportId ? `vehicle:${c.transportId}` : "vehicle:none"],
        confidence: c.containersUnverified > 0 ? "HIGH" : "MEDIUM",
        impact: "Inventory cannot be closed for the destination until the discrepancy is resolved",
        ts: t,
        state: "PENDING_APPROVAL",
        approvedBy: null,
        approvedTs: null,
        relatedEntities: [{ table: "cargo", id: c._id }],
      });
    }
  }

  /* ---- RISK + OPTIMIZATION: route exposure from weather & hazards ---- */
  for (const route of routes) {
    if (route.status !== "active") continue;
    const path = route.path;
    let worstSeverity: Severity | null = null;
    let worst: { label: string; km: number } | null = null;
    for (const h of hazards) {
      if (h.validFrom > t || (h.validUntil !== undefined && h.validUntil < t)) continue;
      const check = routeIntersectsZone(path, h);
      if (check.intersects || check.minDistanceKm < h.radiusKm * 0.75) {
        const rank = h.severity === "critical" ? 3 : h.severity === "warning" ? 2 : 1;
        const best = worstSeverity === "critical" ? 3 : worstSeverity === "warning" ? 2 : worstSeverity ? 1 : 0;
        if (rank >= best) {
          worstSeverity = h.severity;
          worst = { label: h.label, km: check.minDistanceKm };
        }
      }
    }
    if (worst && worstSeverity && worstSeverity !== "info") {
      const activeConvoy = convoys.find((c) => c.routeId === route._id && c.status === "ACTIVE");
      const galeStation = stations.find(
        (s) => weather.some((w) => w.stationId === s._id && w.windKph > 55),
      );
      out.push({
        id: nextId("REC"),
        module: "RISK",
        title: `ROUTE EXPOSURE — ${route.name} crosses ${worst.label}`,
        recommendation: activeConvoy
          ? `Hold convoy ${activeConvoy.name} and re-route via the longer southern alignment${galeStation ? `; ${galeStation.short} gusts also exceed the movement gate` : ""}.`
          : `Mark ${route.name} as guided-passage-only until the zone is re-surveyed.`,
        reason: `Minimum clearance ${worst.km} km from a ${worstSeverity} hazard zone${
          galeStation ? ` · ${galeStation.short} wind above 55 km/h` : ""
        }.`,
        dataUsed: [`route:${route._id}`, "hazard:spatial-intersection", "weather:latest"],
        confidence: worstSeverity === "critical" ? "HIGH" : "MEDIUM",
        impact: activeConvoy
          ? "Directly affects a moving convoy; ETA and fuel both change"
          : "Affects the next movement scheduled on this route",
        ts: t,
        state: "PENDING_APPROVAL",
        approvedBy: null,
        approvedTs: null,
        relatedEntities: [
          { table: "routes", id: route._id },
          ...(activeConvoy ? [{ table: "convoys", id: activeConvoy._id }] : []),
        ],
      });
    }
  }

  /* ---- ANOMALY: missed check-in (NOT an automatic emergency) ---- */
  for (const cv of convoys) {
    if (cv.status !== "ACTIVE") continue;
    const last = cv.lastCheckinTs ?? cv.departureTs;
    const overdueMin = (t - last) / MIN;
    if (overdueMin > cv.checkinIntervalMin) {
      out.push({
        id: nextId("REC"),
        module: "ANOMALY",
        title: `CHECK-IN OVERDUE — ${cv.name} (${Math.round(overdueMin - cv.checkinIntervalMin)} min past schedule)`,
        recommendation: `Notify control room, open a grace period and request a safety check. Escalate to SOS only if the field team raises it.`,
        reason: `Last check-in ${Math.round(overdueMin)} min ago against a ${cv.checkinIntervalMin} min cadence; comms state ${cv.comms}.`,
        dataUsed: [`convoy:${cv._id}`, "checkin:cadence"],
        confidence: "MEDIUM",
        impact: "Position unknown — last known position is shown, never a live marker",
        ts: t,
        state: "PENDING_APPROVAL",
        approvedBy: null,
        approvedTs: null,
        relatedEntities: [{ table: "convoys", id: cv._id }],
      });
    }
  }

  /* ---- PREDICTION: expiry of cargo already on the ice ---- */
  for (const c of cargo) {
    if (!c.expiresTs || c.status !== "IN_INVENTORY") continue;
    if (c.expiresTs < t + 45 * DAY) {
      out.push({
        id: nextId("REC"),
        module: "PREDICTION",
        title: `EXPIRY FORECAST — ${c.cargoId}`,
        recommendation: "Consume this consignment ahead of later batches.",
        reason: `Expires in ${Math.round((c.expiresTs - t) / DAY)} days at ${c.quantity} ${c.unit}.`,
        dataUsed: [`cargo:${c.cargoId}`],
        confidence: "MEDIUM",
        impact: "Expedition stores wasted if rotation is unchanged",
        ts: t,
        state: "PENDING_APPROVAL",
        approvedBy: null,
        approvedTs: null,
        relatedEntities: [{ table: "cargo", id: c._id }],
      });
    }
  }

  return { recommendations: out };
}

/**
 * Recompute AND persist. Only a mutation may do this — a query uses
 * `computeIntelligence` so a read never mutates the database.
 */
export async function runIntelligence(ctx: MutationCtx): Promise<IntelligenceResult> {
  const { recommendations } = await computeIntelligence(ctx);
  const t = now();
  // Replace the open recommendations; approved history is kept in the audit log.
  const open = await ctx.db
    .query("aiRecommendations")
    .withIndex("by_state", (q) => q.eq("state", "PENDING_APPROVAL"))
    .collect();
  for (const rec of open) await ctx.db.delete(rec._id);
  for (const r of recommendations) {
    await ctx.db.insert("aiRecommendations", {
      recommendationId: r.id,
      module: r.module,
      title: r.title,
      recommendation: r.recommendation,
      reason: r.reason,
      dataUsed: r.dataUsed,
      confidence: r.confidence,
      impact: r.impact,
      ts: r.ts,
      state: r.state,
      approvedBy: r.approvedBy ?? undefined,
      approvedTs: r.approvedTs ?? undefined,
      relatedEntities: r.relatedEntities,
      createdAt: t,
      updatedAt: t,
    });
    await publish(ctx, "AI_RECOMMENDATION_CREATED", { title: r.title, id: r.id }, [
      "ADMIN",
      "CONTROL_ROOM",
    ]);
  }
  return { recommendations };
}

/* ------------------------------------------------------------------ */
/* Geospatial convenience re-exports                                   */
/* ------------------------------------------------------------------ */

export { haversineKm, bearingDeg, nearestOnPath, pointAlongPath, nearestStation, routeIntersectsZone, evaluateGeofences };

/* ------------------------------------------------------------------ */
/* Sync helpers                                                        */
/* ------------------------------------------------------------------ */

/** Sort strictly by priority then by device timestamp — P0 always first. */
export function orderEventsForSync(events: FieldEventEnvelope[]) {
  return [...events].sort((a, b) => {
    const pa = priorityFor(a.type);
    const pb = priorityFor(b.type);
    if (pa !== pb) return pa - pb;
    return a.recordedAt - b.recordedAt;
  });
}

/** Optimistic-concurrency check for offline writes. */
export function detectVersionConflict(
  centralVersion: number,
  baseVersion: number | undefined,
): { conflict: boolean; reason?: string } {
  if (baseVersion === undefined) return { conflict: false };
  if (baseVersion < centralVersion) {
    return {
      conflict: true,
      reason: `Field device edited from version ${baseVersion}; central is at version ${centralVersion}`,
    };
  }
  return { conflict: false };
}

export type { Doc, Id };
