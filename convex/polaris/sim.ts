/**
 * POLARIS GPS simulation engine.
 *
 * This is a SERVER-SIDE engine, not a frontend animation. Each tick:
 *   1. advances the convoy and its field personnel along real route geometry
 *   2. writes genuine location_events (device clock, accuracy, battery)
 *   3. runs the geospatial hazard check on the server
 *   4. emits notifications + AI recommendations when exposure is detected
 *   5. records convoy check-ins and detects missed check-ins
 *
 * A real GPS tracker feed would satisfy the same contract: the client only ever
 * sees the resulting rows, so replacing the simulator changes nothing upstream.
 */
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";

import { bearingDeg, haversineKm, pointAlongPath } from "../../lib/polar-geo";
import { nextId, now, MIN, DAY, geofence, ingestLocation, notify, publish, writeAudit } from "./lib";

interface SimConvoyRow {
  _id: any;
  convoyId: string;
  routeId: any;
  progress: number;
  fuelPct: number;
  status: string;
  personnelIds: string[];
  vehicleIds: string[];
  lastCheckinTs?: number;
  checkinIntervalMin: number;
  emergencyStatus: string;
  comms: string;
}

async function simRow(ctx: MutationCtx) {
  const row = await ctx.db.query("simState").first();
  if (!row) throw new Error("simState not seeded — run seedPolaris first");
  return row;
}

/** Deterministic pseudo-randomness so replays are reproducible. */
function wobble(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export const gpsTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sim = await simRow(ctx);
    if (!sim.running) return { running: false, tick: sim.tickCount };
    const t = now();
    const tick = sim.tickCount + 1;

    /* ---- connectivity influences how many devices report ---- */
    const degraded = sim.connectivity === "VERY_LOW" || sim.connectivity === "OFFLINE";

    /* ---- routes + hazards for geometry ---- */
    const routes = await ctx.db.query("routes").collect();
    const routeById = new Map(routes.map((r) => [r._id, r]));
    const convoys = await ctx.db.query("convoys").collect();
    const devices = await ctx.db.query("devices").collect();
    const deviceBySubject = new Map<string, (typeof devices)[number]>();
    for (const d of devices) {
      if (d.subjectId) deviceBySubject.set(d.subjectId, d);
    }

    let hazardAlerts = 0;
    let reported = 0;

    for (const cv of convoys as unknown as SimConvoyRow[]) {
      if (cv.status !== "ACTIVE") continue;
      const route = routeById.get(cv.routeId);
      if (!route) continue;

      /* advance along the real route geometry */
      const speed = 0.012 + wobble(tick + cv.convoyId.length) * 0.004;
      const progress = Math.min(0.99, cv.progress + speed);
      const pos = pointAlongPath(route.path, progress);
      const nextPos = pointAlongPath(route.path, Math.min(1, progress + 0.01));
      const heading = bearingDeg(pos, nextPos);
      const speedKph = Math.round(6 + Math.abs(wobble(tick * 3 + 1)) * 5);

      // fuel burns as the convoy moves
      const fuel = Math.max(5, Math.round((cv.fuelPct - 0.12) * 100) / 100);

      await ctx.db.patch(cv._id, { progress, fuelPct: fuel, updatedAt: t });

      const offlineDevices = degraded;
      const connectivity = sim.connectivity === "OFFLINE" ? "OFFLINE" : sim.connectivity === "VERY_LOW" || sim.connectivity === "WEAK" ? "LOW" : "ONLINE";

      /* ---- convoy check-in ---- */
      const last = cv.lastCheckinTs ?? t;
      if (t - last > cv.checkinIntervalMin * MIN) {
        await ctx.db.insert("convoyCheckins", {
          checkinId: nextId("CHK"),
          convoyId: cv.convoyId,
          deviceId: deviceBySubject.get(cv.personnelIds[0])?.deviceId ?? "DEV-000",
          ts: t,
          location: { lat: pos.lat, lon: pos.lon },
          fuelPct: fuel,
          personnelCount: cv.personnelIds.length,
          note: connectivity === "ONLINE" ? "Routine check-in" : "Check-in via store-and-forward",
          offlineOrigin: connectivity !== "ONLINE",
          createdAt: t,
          updatedAt: t,
        });
        await ctx.db.patch(cv._id, { lastCheckinTs: t, comms: connectivity === "ONLINE" ? "CONNECTED" : "LOW" });
        await publish(ctx, "CONVOY_UPDATED", { convoyId: cv.convoyId, lat: pos.lat, lon: pos.lon }, [
          "ADMIN",
          "CONTROL_ROOM",
          "STATION_COMMANDER",
        ]);
        await writeAudit(ctx, {
          actor: `Convoy ${cv.convoyId} device`,
          actorRole: "SYSTEM",
          action: `Check-in received — ${cv.convoyId} at ${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)} (${connectivity})`,
          target: `convoy:${cv.convoyId}`,
          result: "OK",
        });
      } else {
        await ctx.db.patch(cv._id, { comms: connectivity === "ONLINE" ? "CONNECTED" : "LOW" });
      }

      /* ---- convoy position ---- */
      const { hits } = await ingestLocation(ctx, {
        deviceId: deviceBySubject.get(cv.vehicleIds[0])?.deviceId ?? "DEV-000",
        subjectId: cv.convoyId,
        subjectKind: "convoy",
        lat: pos.lat,
        lon: pos.lon,
        accuracyM: 5,
        speedKph,
        headingDeg: Math.round(heading),
        batteryPct: 100,
        connectivity,
        ts: t,
        source: "SIMULATOR",
      });
      reported += 1;
      for (const hit of hits) {
        if (hit.insidePolygon && hit.severity === "critical") {
          hazardAlerts += 1;
          await notify(
            ctx,
            {
              kind: "HAZARD_EXPOSURE",
              severity: "critical",
              title: `ROUTE EXPOSURE DETECTED — ${cv.convoyId} inside ${hit.label}`,
              detail: `${cv.convoyId} is ${hit.distanceKm} km from ${hit.label} (${hit.hazardType}). Guided passage required.`,
              audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
              linkEntity: { table: "convoys", id: cv.convoyId },
              linkLatLon: { lat: pos.lat, lon: pos.lon },
              channels: ["IN_APP", "PUSH", "SATELLITE"],
            },
          );
          await publish(ctx, "HAZARD_DETECTED", { convoyId: cv.convoyId, hazard: hit.label, distanceKm: hit.distanceKm }, [
            "ADMIN",
            "CONTROL_ROOM",
            "FIELD_OPERATOR",
          ]);
          await writeAudit(ctx, {
            actor: "Hazard engine (PostGIS-equivalent geofence)",
            actorRole: "SYSTEM",
            action: `Geofence breach — ${cv.convoyId} inside ${hit.hazardId} (${hit.distanceKm} km)`,
            target: `convoy:${cv.convoyId}`,
            result: "ALERT_RAISED",
          });
        }
      }

      /* ---- personnel on the convoy report too (P2) ---- */
      if (!offlineDevices || tick % 2 === 0) {
        for (const pid of cv.personnelIds) {
          const dev = deviceBySubject.get(pid);
          if (!dev) continue;
          const jitter = 0.004;
          const pLat = pos.lat + wobble(tick + pid.length) * jitter;
          const pLon = pos.lon + wobble(tick + pid.length * 3) * jitter;
          const { hits: pHits } = await ingestLocation(ctx, {
            deviceId: dev.deviceId,
            subjectId: pid,
            subjectKind: "person",
            lat: pLat,
            lon: pLon,
            accuracyM: 8,
            speedKph,
            headingDeg: Math.round(heading),
            batteryPct: Math.max(4, (dev.batteryPct ?? 70) - 0.1),
            connectivity,
            ts: t,
            source: "SIMULATOR",
          });
          reported += 1;
          const person = await ctx.db.query("persons").withIndex("by_polaris_id", (q) => q.eq("polarisId", pid)).unique();
          if (person) {
            await ctx.db.patch(person._id, {
              status: "FIELD",
              connectivity: connectivity === "ONLINE" ? "ONLINE" : connectivity,
              lastCheckinTs: t,
              updatedAt: t,
            });
          }
          for (const hit of pHits) {
            if (hit.insidePolygon && hit.severity === "critical" && !hazardAlerts) {
              hazardAlerts += 1;
              await notify(ctx, {
                kind: "HAZARD_EXPOSURE",
                severity: "critical",
                title: `ROUTE EXPOSURE DETECTED — ${pid} inside ${hit.label}`,
                detail: `${person?.name ?? pid} is ${hit.distanceKm} km from ${hit.label}. Field warning issued.`,
                audience: ["ADMIN", "CONTROL_ROOM", "FIELD_OPERATOR"],
                linkEntity: { table: "persons", id: pid },
                linkLatLon: { lat: pLat, lon: pLon },
                channels: ["IN_APP", "PUSH", "SATELLITE"],
              });
            }
          }
        }
      }

      /* ---- arrival ---- */
      if (progress >= 0.985) {
        await ctx.db.patch(cv._id, { status: "ARRIVED", progress: 1, updatedAt: t });
        await notify(ctx, {
          kind: "CONVOY_ARRIVED",
          severity: "info",
          title: `${cv.convoyId} arrived at destination`,
          detail: "Convoy movement complete. Cargo verification and inventory receipt now open.",
          audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
          linkEntity: { table: "convoys", id: cv.convoyId },
        });
        await writeAudit(ctx, {
          actor: "Convoy system",
          actorRole: "SYSTEM",
          action: `${cv.convoyId} completed movement — status ARRIVED`,
          target: `convoy:${cv.convoyId}`,
          result: "OK",
        });
      }
    }

    /* ---- devices that are not on a convoy drift slowly (realistic idle) ---- */
    if (tick % 3 === 0 && !degraded) {
      const idle = (await ctx.db.query("lastKnownPositions").collect())
        .filter((q) => q.subjectKind === "person")
        .slice(0, 20);
      for (const lk of idle) {
        if (convoys.some((c) => (c as unknown as SimConvoyRow).personnelIds.includes(lk.subjectId))) continue;
        const dev = deviceBySubject.get(lk.subjectId);
        if (!dev || dev.connectivity === "OFFLINE") continue;
        const r = (lk.lat + wobble(tick + lk.subjectId.length) * 0.0012) % 90;
        await ingestLocation(ctx, {
          deviceId: dev.deviceId,
          subjectId: lk.subjectId,
          subjectKind: "person",
          lat: r,
          lon: lk.lon + wobble(tick * 5 + lk.subjectId.length) * 0.0012,
          accuracyM: 6,
          batteryPct: Math.max(4, (dev.batteryPct ?? 70) - 0.05),
          connectivity: "ONLINE",
          ts: t,
          source: "SIMULATOR",
        });
        reported += 1;
      }
    }

    /* ---- geofence sweep for any subject sitting inside a critical zone ---- */
    const lkAll = await ctx.db.query("lastKnownPositions").collect();
    for (const lk of lkAll) {
      const hits = await geofence(ctx, { lat: lk.lat, lon: lk.lon });
      const inside = hits.find((h) => h.insidePolygon && h.severity === "critical");
      if (inside && tick % 5 === 0) {
        await notify(
          ctx,
          {
            kind: "HAZARD_EXPOSURE",
            severity: "critical",
            title: `${lk.subjectId} is inside ${inside.label}`,
            detail: `Distance ${inside.distanceKm} km from zone centre. Last position ${new Date(lk.ts).toISOString()}.`,
            audience: ["ADMIN", "CONTROL_ROOM"],
            linkEntity: { table: "lastKnownPositions", id: lk.subjectId },
            linkLatLon: { lat: lk.lat, lon: lk.lon },
            dedupeKey: `sweep-${lk.subjectId}-${inside.hazardId}`,
          },
        );
      }
    }

    await ctx.db.patch(sim._id, { lastTickTs: t, tickCount: tick, updatedAt: t });
    return { running: true, tick, reported, hazardAlerts, progressAt: t };
  },
});

/** Start / stop / configure the simulator from the client. */
export const controlSim = internalMutation({
  args: { running: v.boolean(), tickMs: v.number() },
  handler: async (ctx, args) => {
    const sim = await simRow(ctx);
    await ctx.db.patch(sim._id, {
      running: args.running,
      startedAt: args.running ? now() : undefined,
      tickMs: args.tickMs,
      updatedAt: now(),
    });
    return { running: args.running };
  },
});
