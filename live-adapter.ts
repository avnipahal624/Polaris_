/**
 * Backend rows -> map shapes.
 *
 * The Antarctic map component is deliberately left untouched: it already knows
 * how to draw a station, a tracked entity, a hazard and a route in EPSG:3031
 * with the approved styling. This module is the seam that decides *where those
 * things are*, and it answers only from the database.
 *
 * The honesty rule lives here: an entity whose last GPS packet is old is still
 * drawn, but at its last known position and carrying the stale label the server
 * computed from the device clock. It is never interpolated forward into a fake
 * live dot.
 */
import type { Hazard, HazardKind, MapAsset, Station } from "./polar-data";
import type { HazardType, Severity } from "./polar-db";
import type { LiveEntities } from "./polaris-live";

/* ------------------------------------------------------------------ */
/* Stations                                                            */
/* ------------------------------------------------------------------ */

export function stationsToMapAssets(rows: LiveEntities["stations"], fallback: Station[]): MapAsset[] {
  // With no rows there is nothing to place. Reference geography is not
  // re-invented here — it comes from the database like everything else.
  if (rows.length === 0) return [];
  return rows.map((s) => {
    const ref = fallback.find((f) => f.short === s.short);
    return {
      id: s.id,
      label: s.short,
      kind: "ship",
      lat: s.lat,
      lon: s.lon,
      stationId: s.id,
      detail: `${s.name} · ${s.kind}${s.operationalDataSimulated ? " · operational values SIMULATED" : ""}${
        s.emergencyCapability ? ` · ${s.emergencyCapability}` : ref?.note ? ` · ${ref.note}` : ""
      }`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Tracked subjects                                                    */
/* ------------------------------------------------------------------ */

export interface TrackedView {
  asset: MapAsset;
  freshness: "LIVE" | "STALE" | "OFFLINE";
  freshnessLabel: string;
  accuracyM: number;
  batteryPct: number | null;
  connectivity: string;
  source: string;
  ts: number;
}

export function trackedToViews(entities: LiveEntities | null): TrackedView[] {
  if (!entities) return [];
  return entities.tracked.map((t) => {
    const freshness = (t.freshness === "LIVE" ? "LIVE" : t.freshness === "OFFLINE" ? "OFFLINE" : "STALE") as
      | "LIVE"
      | "STALE"
      | "OFFLINE";
    return {
      asset: {
        id: t.subjectId,
        label: t.subjectId,
        kind: t.subjectKind === "vehicle" ? "vehicle" : "person",
        lat: t.lat,
        lon: t.lon,
        detail: `${t.subjectKind} · ${t.freshnessLabel} · ±${t.accuracyM} m${
          t.batteryPct !== null ? ` · battery ${t.batteryPct}%` : ""
        } · ${t.connectivity} · source ${t.source}`,
      },
      freshness,
      freshnessLabel: t.freshnessLabel,
      accuracyM: t.accuracyM,
      batteryPct: t.batteryPct,
      connectivity: t.connectivity,
      source: t.source,
      ts: t.ts,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Hazards                                                             */
/* ------------------------------------------------------------------ */

export function hazardZonesFrom(entities: LiveEntities | null): Hazard[] {
  if (!entities) return [];
  return entities.hazards.map((h) => ({
    id: h.id,
    kind: mapHazardKind(h.hazardType),
    label: h.label,
    severity: h.severity as Severity,
    lat: h.lat,
    lon: h.lon,
    radiusKm: h.radiusKm,
    note: `${h.hazardType.replace(/_/g, " ").toLowerCase()} · ${h.radiusKm} km radius · ${h.source}`,
  }));
}

function mapHazardKind(t: string): HazardKind {
  switch (t as HazardType) {
    case "CREVASSE":
      return "CREVASSE FIELD";
    case "WHITEOUT":
    case "BLIZZARD":
    case "WEATHER_HAZARD":
      return "BLIZZARD ZONE";
    case "UNSTABLE_ICE":
      return "EXTREME WIND";
    case "RESTRICTED_ZONE":
      return "RESTRICTED AREA";
    default:
      return "LOW VISIBILITY";
  }
}

/* ------------------------------------------------------------------ */
/* Convoys — positioned from their own last-known GPS packet            */
/* ------------------------------------------------------------------ */

export function convoyViews(entities: LiveEntities | null, tracked: TrackedView[]): MapAsset[] {
  if (!entities) return [];
  const byId = new Map(tracked.map((t) => [t.asset.id, t]));
  const out: MapAsset[] = [];
  for (const cv of entities.convoys) {
    const pos = byId.get(cv.convoyId);
    out.push({
      id: cv.id,
      label: cv.convoyId,
      kind: "ship",
      lat: pos?.asset.lat ?? 0,
      lon: pos?.asset.lon ?? 0,
      detail:
        `${cv.name} · ${cv.status} · comms ${cv.comms} · fuel ${cv.fuelPct}% · ` +
        `${cv.personnelCount} personnel / ${cv.vehicleCount} vehicles · ` +
        (pos ? pos.freshnessLabel : "NO POSITION PACKET YET"),
    });
    // A convoy with no packet has no coordinates; dropping it is correct.
    if (!pos) out.pop();
  }
  return out;
}

/** Weather observation marker for the station it was measured at. */
export function weatherViews(
  weather: { stationId: string; temperatureC: number; windKph: number; visibilityKm: number; condition: string; stormFlag: boolean; simulated: boolean; observedTs: number }[],
  entities: LiveEntities | null,
): MapAsset[] {
  if (!entities) return [];
  const stationAt = new Map(entities.stations.map((s) => [s.id, s]));
  return weather
    .filter((w) => stationAt.has(w.stationId))
    .map((w) => {
      const s = stationAt.get(w.stationId)!;
      return {
        id: `wx-${w.stationId}`,
        label: s.short,
        kind: "ship",
        lat: s.lat,
        lon: s.lon,
        detail:
          `${w.temperatureC}°C · wind ${w.windKph} km/h · vis ${w.visibilityKm} km · ${w.condition}` +
          ` · observed ${new Date(w.observedTs).toISOString().slice(11, 16)} UTC` +
          ` · ${w.simulated ? "SIMULATED" : "LIVE"}`,
      };
    });
}
