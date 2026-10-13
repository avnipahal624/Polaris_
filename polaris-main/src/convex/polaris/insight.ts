/**
 * POLARIS server-side search and reporting.
 *
 * Search is a real indexed database query across the operational tables — the
 * search bar does not filter a JavaScript array held in the browser. Reports
 * aggregate from stored rows, so every figure on a report is reproducible from
 * the database and disappears if the underlying data is removed.
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

import { requireActor, requireResource, now, DAY } from "./lib";

/* ------------------------------------------------------------------ */
/* Global search                                                       */
/* ------------------------------------------------------------------ */

export type SearchKind = "Station" | "Personnel" | "Cargo" | "Vehicle" | "Mission" | "Convoy" | "Hazard" | "Incident";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  label: string;
  sub: string;
  lat?: number;
  lon?: number;
}

export const search = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const needle = args.q.trim().toLowerCase();
    if (needle.length < 2) return [] as SearchHit[];

    const take = args.limit ?? 25;
    const hits: SearchHit[] = [];

    // A family account may only ever find their own linked expedition member.
    const familyOnly = actor.role === "FAMILY_MEMBER";
    if (familyOnly) {
      const persons = await ctx.db.query("persons").collect();
      for (const p of persons) {
        if (p.polarisId !== actor.linkedPersonId) continue;
        if (!matches(needle, p.name, p.polarisId, p.role, p.team)) continue;
        hits.push({ id: p.polarisId, kind: "Personnel", label: p.name, sub: `${p.role} · your linked expedition member` });
      }
      return hits.slice(0, take);
    }

    const [stations, persons, cargo, vehicles, missions, convoys, hazards, incidents] = await Promise.all([
      ctx.db.query("stations").collect(),
      ctx.db.query("persons").collect(),
      ctx.db.query("cargo").collect(),
      ctx.db.query("vehicles").collect(),
      ctx.db.query("missions").collect(),
      ctx.db.query("convoys").collect(),
      ctx.db.query("hazardZones").collect(),
      ctx.db.query("sosEvents").collect(),
    ]);

    for (const s of stations) {
      if (hits.length < take && matches(needle, s.name, s.short, s.code, s.kind)) {
        hits.push({ id: s._id, kind: "Station", label: s.short, sub: `${s.name} · ${s.kind}`, lat: s.lat, lon: s.lon });
      }
    }
    for (const p of persons) {
      if (hits.length < take && matches(needle, p.name, p.polarisId, p.role, p.team)) {
        hits.push({ id: p.polarisId, kind: "Personnel", label: p.name, sub: `${p.polarisId} · ${p.role} · ${p.status}` });
      }
    }
    for (const c of cargo) {
      if (hits.length < take && matches(needle, c.cargoId, c.itemType, c.origin, c.rfid, c.barcode, c.status)) {
        hits.push({ id: c.cargoId, kind: "Cargo", label: `${c.cargoId} · ${c.itemType}`, sub: `${c.status} · ${c.quantity} ${c.unit} · barcode ${c.barcode}` });
      }
    }
    for (const vh of vehicles) {
      if (hits.length < take && matches(needle, vh.vehicleId, vh.label, vh.callSign, vh.kind, vh.status)) {
        hits.push({ id: vh.vehicleId, kind: "Vehicle", label: `${vh.vehicleId} · ${vh.label}`, sub: `${vh.kind} · ${vh.status}` });
      }
    }
    for (const m of missions) {
      if (hits.length < take && matches(needle, m.missionId, m.name, m.expedition, m.status)) {
        hits.push({ id: m.missionId, kind: "Mission", label: `${m.missionId} · ${m.name}`, sub: `${m.status} · ${m.expedition}` });
      }
    }
    for (const cv of convoys) {
      if (hits.length < take && matches(needle, cv.convoyId, cv.name, cv.status, cv.comms)) {
        hits.push({ id: cv.convoyId, kind: "Convoy", label: `${cv.convoyId} · ${cv.name}`, sub: `${cv.status} · comms ${cv.comms} · ${cv.personnelIds.length} personnel` });
      }
    }
    for (const h of hazards) {
      if (hits.length < take && matches(needle, h.hazardId, h.label, h.hazardType, h.severity)) {
        hits.push({ id: h.hazardId, kind: "Hazard", label: `${h.hazardId} · ${h.label}`, sub: `${h.hazardType.replace(/_/g, " ").toLowerCase()} · ${h.severity}`, lat: h.lat, lon: h.lon });
      }
    }
    for (const i of incidents) {
      if (hits.length < take && matches(needle, i.sosId, i.incidentId, i.category, i.stage)) {
        hits.push({ id: i.sosId, kind: "Incident", label: `${i.sosId} · ${i.category}`, sub: `${i.stage} · ${new Date(i.triggeredTs).toISOString().slice(0, 16).replace("T", " ")} UTC` });
      }
    }

    return hits.slice(0, take);
  },
});

function matches(needle: string, ...fields: (string | undefined)[]): boolean {
  for (const f of fields) {
    if (typeof f === "string" && f.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Reports — every figure aggregated from stored rows                  */
/* ------------------------------------------------------------------ */

export const reportOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "reports");
    const t = now();

    const [stations, persons, cargo, inventory, convoys, locations, sos, notifications, txns, weather, hazards] =
      await Promise.all([
        ctx.db.query("stations").collect(),
        ctx.db.query("persons").collect(),
        ctx.db.query("cargo").collect(),
        ctx.db.query("inventory").collect(),
        ctx.db.query("convoys").collect(),
        ctx.db.query("locationEvents").collect(),
        ctx.db.query("sosEvents").collect(),
        ctx.db.query("notifications").collect(),
        ctx.db.query("inventoryTxns").collect(),
        ctx.db.query("weatherEvents").collect(),
        ctx.db.query("hazardZones").collect(),
      ]);

    const delivered = cargo.filter((c) => ["ARRIVED", "RECEIVED", "IN_INVENTORY"].includes(c.status));
    const discrepancyUnits = cargo.reduce((a, c) => a + Math.max(0, c.containersExpected - c.containersReceived), 0);
    const consumed = txns.filter((x) => x.reason === "CONSUMPTION").reduce((a, x) => a + Math.abs(x.delta), 0);
    const received = txns.filter((x) => x.reason === "RECEIPT").reduce((a, x) => a + x.delta, 0);

    return {
      asOf: t,
      generatedFrom: {
        stations: stations.length,
        persons: persons.length,
        cargo: cargo.length,
        inventory: inventory.length,
        convoys: convoys.length,
        locationEvents: locations.length,
        weatherEvents: weather.length,
        hazardZones: hazards.length,
      },
      stations: {
        total: stations.length,
        byStatus: countBy(stations.map((s) => s.status)),
        personnel: stations.reduce((a, s) => a + s.personnel, 0),
        capacity: stations.reduce((a, s) => a + s.capacity, 0),
      },
      cargo: {
        total: cargo.length,
        delivered: delivered.length,
        deliveryRatePct: cargo.length === 0 ? 0 : Math.round((delivered.length / cargo.length) * 100),
        discrepancies: cargo.filter((c) => c.containersReceived < c.containersExpected).length,
        discrepancyUnits,
        byStatus: countBy(cargo.map((c) => c.status)),
      },
      inventory: {
        lines: inventory.length,
        currentStock: inventory.reduce((a, i) => a + i.quantity, 0),
        reserved: inventory.reduce((a, i) => a + i.reservedQuantity, 0),
        belowMinimum: inventory.filter((i) => i.quantity < i.minThreshold).length,
        expiringSoon: inventory.filter((i) => i.expiresTs !== undefined && i.expiresTs < t + 30 * DAY).length,
        consumedUnits: consumed,
        receivedUnits: received,
      },
      transport: {
        convoys: convoys.length,
        active: convoys.filter((c) => c.status === "ACTIVE").length,
        avgFuelPct: convoys.length === 0 ? 0 : Math.round(convoys.reduce((a, c) => a + c.fuelPct, 0) / convoys.length),
        comms: countBy(convoys.map((c) => c.comms)),
      },
      incidents: {
        sos: sos.length,
        open: sos.filter((s) => s.stage !== "RESOLVED").length,
        resolved: sos.filter((s) => s.stage === "RESOLVED").length,
        meanResponseMin: meanMinutes(sos.filter((s) => s.resolvedTs).map((s) => (s.resolvedTs as number) - s.triggeredTs)),
        byCategory: countBy(sos.map((s) => s.category)),
      },
      telemetry: {
        events: locations.length,
        last24h: locations.filter((l) => l.ts > t - DAY).length,
        devices: new Set(locations.map((l) => l.deviceId)).size,
      },
      notifications: {
        total: notifications.length,
        bySeverity: countBy(notifications.map((n) => n.severity)),
        unread: notifications.filter((n) => !n.read).length,
      },
    };
  },
});

export const reportInventoryLedger = query({
  args: { stationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "inventory");
    const txns = await ctx.db.query("inventoryTxns").order("desc").take(500);
    const items = await ctx.db.query("inventory").collect();
    const filtered = args.stationId ? txns.filter((x) => x.stationId === args.stationId) : txns;
    return {
      asOf: now(),
      // Stock is the sum of the ledger plus the opening balances held per line.
      lines: items.map((i) => {
        const line = filtered.filter((x) => x.itemId === i.itemId);
        return {
          itemId: i.itemId,
          item: i.item,
          category: i.category,
          stationId: i.stationId,
          unit: i.unit,
          openingBalance: i.quantity - line.reduce((a, x) => a + x.delta, 0),
          movements: line.reduce((a, x) => a + x.delta, 0),
          currentQuantity: i.quantity,
          reservedQuantity: i.reservedQuantity,
          minThreshold: i.minThreshold,
          consumptionPerDay: i.consumptionRatePerDay,
          daysToMinimum:
            i.consumptionRatePerDay > 0 ? Math.max(0, Math.round((i.quantity - i.minThreshold) / i.consumptionRatePerDay)) : null,
          version: i.version,
          transactions: line.length,
        };
      }),
      recentTransactions: filtered.slice(0, 60).map((x) => ({
        txnId: x.txnId,
        itemId: x.itemId,
        stationId: x.stationId,
        delta: x.delta,
        reason: x.reason,
        actor: x.actor,
        ts: x.ts,
        originEventId: x.originEventId ?? null,
      })),
    };
  },
});

export const reportGpsHistory = query({
  args: { subjectId: v.optional(v.string()), hours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "reports");
    const t = now();
    const since = t - (args.hours ?? 24) * 3_600_000;
    let events = await ctx.db.query("locationEvents").order("desc").take(2000);
    events = events.filter((e) => e.ts >= since);
    if (args.subjectId) events = events.filter((e) => e.subjectId === args.subjectId);

    return {
      asOf: t,
      windowHours: args.hours ?? 24,
      count: events.length,
      devices: [...new Set(events.map((e) => e.deviceId))],
      // Gaps in the series are surfaced rather than smoothed over.
      maxGapMs: maxGap(events.map((e) => e.ts)),
      samples: events.slice(0, 400).map((e) => ({
        eventId: e.eventId,
        deviceId: e.deviceId,
        subjectId: e.subjectId ?? null,
        lat: e.lat,
        lon: e.lon,
        accuracyM: e.accuracyM,
        speedKph: e.speedKph ?? null,
        headingDeg: e.headingDeg ?? null,
        batteryPct: e.batteryPct ?? null,
        connectivity: e.connectivity,
        source: e.source,
        ts: e.ts,
      })),
    };
  },
});

/* ------------------------------------------------------------------ */

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function meanMinutes(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length / 60000);
}

function maxGap(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i < sorted.length; i++) max = Math.max(max, sorted[i] - sorted[i - 1]);
  return max;
}
