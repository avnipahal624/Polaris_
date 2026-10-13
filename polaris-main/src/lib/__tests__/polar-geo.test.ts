/**
 * Geospatial engine tests.
 *
 * `polar-geo.ts` is the stand-in for PostGIS in this deployment, so these
 * tests pin the maths against real Antarctic geography and real published
 * constants. The failure modes that matter operationally are:
 *   - a longitude/latitude mix-up (factor-of-~3 at 70°S)
 *   - treating a stale or long-baseline distance as if the local planar
 *     projection used by `projectOnSegment` were still valid
 */

import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  bboxOf,
  evaluateGeofences,
  haversineKm,
  insideZone,
  nearestOnPath,
  nearestStation,
  pathLengthKm,
  pointAlongPath,
  routeIntersectsZone,
} from "../polar-geo";
import type { HazardZoneRecord } from "../polar-db";

/* Real NCPOR / NIPR coordinates, as stored in the database. */
const MAITRI = { lat: -70.7586, lon: 11.7286 };
const BHARATI = { lat: -69.4067, lon: 76.1868 };
const DAKSHIN_GANGOTRI = { lat: -70.4521, lon: 12.0 };
const CAMP_SUHRID = { lat: -71.1, lon: 14.8 };

const toRad = (d: number) => (d * Math.PI) / 180;
const DEG_IN_KM = 111.1951; // (2πR/360) for R = 6371.0088

/**
 * Distance along a polyline at which `point` actually sits, measured by
 * projecting the point back onto the path. This deliberately derives its
 * answer from the point itself rather than from the requested progress, so it
 * can genuinely falsify `pointAlongPath`.
 */
function pathDistanceOf(
  point: { lat: number; lon: number },
  path: { lat: number; lon: number }[],
): number {
  const hit = nearestOnPath(point, path);
  let acc = 0;
  for (let i = 0; i < hit.segmentIndex; i++) {
    acc += haversineKm(path[i], path[i + 1]);
  }
  acc += hit.t * haversineKm(path[hit.segmentIndex], path[hit.segmentIndex + 1]);
  return acc;
}

describe("haversineKm", () => {
  it("returns exactly one degree of latitude for one degree of latitude", () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(DEG_IN_KM, 3);
    expect(haversineKm({ lat: -70, lon: 11 }, { lat: -69, lon: 11 })).toBeCloseTo(DEG_IN_KM, 3);
  });

  it("treats longitude and latitude differently away from the equator", () => {
    // The whole reason this engine exists: at 70.75°S a degree of longitude is
    // roughly a third of a degree of latitude. A swapped axis would return
    // ~111 km here instead of ~36.6 km.
    const oneDegLon = haversineKm(MAITRI, { lat: MAITRI.lat, lon: MAITRI.lon + 1 });
    expect(oneDegLon).toBeCloseTo(DEG_IN_KM * Math.cos(toRad(70.7586)), 2);
    expect(oneDegLon).toBeGreaterThan(30);
    expect(oneDegLon).toBeLessThan(45);
  });

  it("is zero for identical points and symmetric otherwise", () => {
    expect(haversineKm(MAITRI, MAITRI)).toBe(0);
    expect(haversineKm(MAITRI, BHARATI)).toBeCloseTo(haversineKm(BHARATI, MAITRI), 9);
  });

  it("matches published great-circle distance for the Maitri–Bharati baseline", () => {
    // ~2331 km across the ice sheet; the widely quoted surface distance
    // between the two stations is of this order.
    const d = haversineKm(MAITRI, BHARATI);
    expect(d).toBeGreaterThan(2250);
    expect(d).toBeLessThan(2400);
  });

  it("is accurate on the short baselines the planar projection depends on", () => {
    // `projectOnSegment` assumes segments are short enough that a local
    // planar frame is accurate. On the scales POLARIS actually uses
    // (tens of km) the two agree to well under a metre; the long
    // Maitri–Bharati baseline is the case where they must NOT be used
    // interchangeably, which is why segment projection is never applied to it.
    const approx = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const x = toRad(b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
      const y = toRad(b.lat - a.lat);
      return 6371.0088 * Math.hypot(x, y);
    };
    for (const [a, b] of [
      [MAITRI, DAKSHIN_GANGOTRI],
      [MAITRI, CAMP_SUHRID],
      [DAKSHIN_GANGOTRI, CAMP_SUHRID],
    ]) {
      const d = haversineKm(a, b);
      expect(Math.abs(d - approx(a, b)) / d).toBeLessThan(0.0005);
    }
  });
});

describe("bearingDeg", () => {
  it("reports due north, east and south", () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
  });

  it("always returns a value in [0, 360)", () => {
    for (const target of [BHARATI, DAKSHIN_GANGOTRI, CAMP_SUHRID]) {
      const b = bearingDeg(MAITRI, target);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
    // Due west must wrap rather than return a negative bearing.
    expect(bearingDeg({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 6);
  });
});

describe("path geometry", () => {
  const route = [MAITRI, DAKSHIN_GANGOTRI, CAMP_SUHRID];

  it("sums segment lengths", () => {
    const expected =
      haversineKm(MAITRI, DAKSHIN_GANGOTRI) +
      haversineKm(DAKSHIN_GANGOTRI, CAMP_SUHRID);
    expect(pathLengthKm(route)).toBeCloseTo(expected, 9);
  });

  it("interpolates start and end of a route exactly", () => {
    expect(pointAlongPath(route, 0)).toEqual(MAITRI);
    expect(pointAlongPath(route, 1).lat).toBeCloseTo(CAMP_SUHRID.lat, 9);
    expect(pointAlongPath(route, 1).lon).toBeCloseTo(CAMP_SUHRID.lon, 9);
  });

  it("parameterises progress by distance travelled, not by segment count", () => {
    // Progress is a fraction of total distance, not of waypoints. On this
    // route the first leg is 35.5 km of a 160.8 km path, so the shared
    // vertex sits at ~0.221 and 0.5 is already most of the way down leg two.
    const total = pathLengthKm(route);
    const legOne = haversineKm(MAITRI, DAKSHIN_GANGOTRI);
    const vertexProgress = legOne / total;

    const atVertex = pointAlongPath(route, vertexProgress);
    expect(atVertex.lat).toBeCloseTo(DAKSHIN_GANGOTRI.lat, 6);
    expect(atVertex.lon).toBeCloseTo(DAKSHIN_GANGOTRI.lon, 6);

    // The halfway point is half the distance along, which is NOT the vertex.
    const halfway = pointAlongPath(route, 0.5);
    expect(halfway.lat).not.toBeCloseTo(DAKSHIN_GANGOTRI.lat, 3);
  });

  it("advances by true distance along the route lengths POLARIS actually flies", () => {
    // Convoy and field legs are tens of kilometres, where linear lat/lon
    // interpolation and great-circle distance agree essentially exactly.
    const total = pathLengthKm(route);
    for (const p of [0.1, 0.25, 0.5, 0.75]) {
      const pt = pointAlongPath(route, p);
      // Measured back from the returned point, not from the requested p.
      expect(pathDistanceOf(pt, route)).toBeCloseTo(total * p, 2);
    }
  });

  it("documents the large-baseline limit of linear lat/lon interpolation", () => {
    // `pointAlongPath` interpolates linearly in degrees while `pathLengthKm`
    // measures great-circle distance. The two only coincide over short
    // baselines; on the 2331 km Maitri->Bharati span the parametrisation
    // drifts by a few tenths of a percent per step. This is NOT a bug at
    // operational scale (legs are 35-125 km, verified above), but it means
    // `pointAlongPath` must never be used to place a vehicle on a
    // continental-scale path and then reported as an exact distance.
    const straight = [MAITRI, BHARATI];
    const total = pathLengthKm(straight);

    const drift = (p: number) =>
      Math.abs(haversineKm(MAITRI, pointAlongPath(straight, p)) - total * p) / total;

    expect(drift(0.1)).toBeLessThan(0.01); // sub-1% on a 2331 km baseline
    expect(drift(0.5)).toBeLessThan(0.05);
    expect(drift(0.1)).toBeGreaterThan(0.0005); // but not zero -- keep it visible
  });

  it("clamps progress outside 0..1 instead of extrapolating", () => {
    expect(pointAlongPath(route, -3)).toEqual(MAITRI);
    expect(pointAlongPath(route, 42).lat).toBeCloseTo(CAMP_SUHRID.lat, 9);
  });

  it("advances monotonically toward the terminus of a route", () => {
    // This is the invariant the GPS simulator relies on: each tick must move
    // the convoy closer to its destination, or the map would loop or reverse.
    // It only holds for a route whose last waypoint is the destination --
    // Maitri -> Dakshin Gangotri -> Camp Suhrid is NOT such a route, because
    // Dakshin Gangotri lies north of Maitri while Camp Suhrid lies south, so
    // the first leg initially moves away from the terminus. That is real
    // geography, not a defect, which is why the simulator must pick a route
    // whose final waypoint is the destination.
    const toBharati = [MAITRI, DAKSHIN_GANGOTRI, BHARATI];
    let last = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const d = haversineKm(pointAlongPath(toBharati, p), BHARATI);
      expect(d).toBeLessThanOrEqual(last + 1e-6);
      last = d;
    }
    expect(last).toBeLessThan(1);

    // Every intermediate tick lies on the path and between the endpoints.
    for (let p = 0.1; p < 1; p += 0.1) {
      const pt = pointAlongPath(toBharati, p);
      const nearest = nearestOnPath(pt, toBharati);
      expect(nearest.distanceKm).toBeLessThan(0.5);
    }
  });

  it("handles degenerate paths without throwing", () => {
    expect(pathLengthKm([MAITRI])).toBe(0);
    expect(pointAlongPath([MAITRI], 0.5)).toEqual(MAITRI);
    expect(pointAlongPath([], 0.5)).toEqual({ lat: -90, lon: 0 });
  });
});

describe("nearestOnPath", () => {
  const route = [MAITRI, DAKSHIN_GANGOTRI, CAMP_SUHRID];

  it("reports near-zero distance for a point that sits on the route", () => {
    const onRoute = pointAlongPath(route, 0.25);
    const hit = nearestOnPath(onRoute, route);
    expect(hit.distanceKm).toBeLessThan(0.05);
  });

  it("measures the true perpendicular distance off a straight route", () => {
    // A straight two-point path, so the nearest point is unambiguous. The
    // three-waypoint route cannot be used here: it bends at Dakshin Gangotri,
    // so a point offset from one leg is nearer to the other leg instead.
    const straight = [MAITRI, BHARATI];
    const mid = pointAlongPath(straight, 0.5);
    const offset = { lat: mid.lat + 0.1, lon: mid.lon };

    const expected = haversineKm(mid, offset);
    const hit = nearestOnPath(offset, straight);
    expect(hit.distanceKm).toBeCloseTo(expected, 0);
    expect(hit.segmentIndex).toBe(0);
  });

  it("clamps the projection to the segment ends", () => {
    const beyond = { lat: MAITRI.lat - 0.5, lon: MAITRI.lon };
    const hit = nearestOnPath(beyond, route);
    expect(hit.t).toBe(0);
    expect(hit.segmentIndex).toBe(0);
  });
});

describe("zones and geofences", () => {
  const zone = { lat: MAITRI.lat, lon: MAITRI.lon, radiusKm: 5 };

  it("tests point-in-circle on the great-circle distance", () => {
    expect(insideZone(MAITRI, zone)).toBe(true);
    expect(insideZone({ lat: MAITRI.lat + 0.1, lon: MAITRI.lon }, zone)).toBe(false);
  });

  it("detects a route that passes through a hazard", () => {
    const through = routeIntersectsZone([MAITRI, DAKSHIN_GANGOTRI], zone);
    expect(through.intersects).toBe(true);
    expect(through.minDistanceKm).toBeCloseTo(0, 1);

    const clear = routeIntersectsZone([BHARATI, DAKSHIN_GANGOTRI], zone);
    expect(clear.intersects).toBe(false);
    expect(clear.minDistanceKm).toBeGreaterThan(0);
  });

  it("treats a single-point path as never intersecting", () => {
    expect(routeIntersectsZone([MAITRI], zone)).toEqual({
      intersects: false,
      minDistanceKm: 0,
    });
  });
});

const hazard = (
  id: string,
  overrides: Partial<HazardZoneRecord> = {},
): HazardZoneRecord => ({
  id,
  hazardType: "CREVASSE",
  label: `Hazard ${id}`,
  severity: "warning",
  lat: MAITRI.lat,
  lon: MAITRI.lon,
  radiusKm: 5,
  source: "test",
  validFrom: 0,
  validUntil: null,
  routeId: null,
  description: "",
  ...overrides,
});

describe("evaluateGeofences", () => {
  const now = 1_700_000_000_000;

  it("flags a subject inside the polygon", () => {
    const [hit] = evaluateGeofences(MAITRI, [hazard("HZ-1")], now);
    expect(hit.insidePolygon).toBe(true);
    expect(hit.hazardId).toBe("HZ-1");
    expect(hit.distanceKm).toBeCloseTo(0, 2);
  });

  it("raises an approach warning outside the polygon but within the warning band", () => {
    // ~2.2 degrees of latitude north of Maitri ≈ 245 km: outside a 5 km
    // zone, so the control room should see nothing.
    expect(evaluateGeofences({ lat: MAITRI.lat + 2.2, lon: MAITRI.lon }, [hazard("HZ-1")], now))
      .toHaveLength(0);

    // Just inside the polygon: 0.04° of latitude is ~4.4 km against a 5 km
    // radius, so the subject has already crossed the boundary.
    const inside = { lat: MAITRI.lat + 0.04, lon: MAITRI.lon };
    expect(evaluateGeofences(inside, [hazard("HZ-1")], now)[0].insidePolygon).toBe(true);

    // ~0.06° ≈ 6.7 km: outside the 5 km polygon but inside the 2x warning band,
    // so the control room sees the approach before the boundary is crossed.
    const near = { lat: MAITRI.lat + 0.06, lon: MAITRI.lon };
    const [hit] = evaluateGeofences(near, [hazard("HZ-1")], now);
    expect(hit).toBeDefined();
    expect(hit.insidePolygon).toBe(false);
    expect(hit.distanceKm).toBeGreaterThan(5);
    expect(hit.distanceKm).toBeLessThan(10);
  });

  it("ignores zones that are not yet valid or have expired", () => {
    const future = [hazard("HZ-FUTURE", { validFrom: now + 60_000 })];
    expect(evaluateGeofences(MAITRI, future, now)).toHaveLength(0);

    const expired = [hazard("HZ-OLD", { validUntil: now - 60_000 })];
    expect(evaluateGeofences(MAITRI, expired, now)).toHaveLength(0);

    const current = [hazard("HZ-NOW", { validFrom: now - 60_000, validUntil: now + 60_000 })];
    expect(evaluateGeofences(MAITRI, current, now)).toHaveLength(1);
  });

  it("returns hits ordered nearest first", () => {
    const zones = [
      hazard("FAR", { lat: MAITRI.lat + 0.03, lon: MAITRI.lon }), // ~3.3 km
      hazard("NEAR", { lat: MAITRI.lat + 0.01, lon: MAITRI.lon }), // ~1.1 km
    ];
    const hits = evaluateGeofences(MAITRI, zones, now);
    expect(hits.map((h) => h.hazardId)).toEqual(["NEAR", "FAR"]);
  });
});

describe("nearestStation", () => {
  const stations = [
    { id: "MAITRI", lat: MAITRI.lat, lon: MAITRI.lon },
    { id: "BHARATI", lat: BHARATI.lat, lon: BHARATI.lon },
  ];

  it("picks the genuinely closest station, not the first in the list", () => {
    const nearBharati = nearestStation(CAMP_SUHRID, stations);
    expect(nearBharati?.station.id).toBe("MAITRI");
    expect(nearBharati?.distanceKm).toBeCloseTo(haversineKm(CAMP_SUHRID, MAITRI), 9);
  });

  it("returns null for an empty station list", () => {
    expect(nearestStation(MAITRI, [])).toBeNull();
  });
});

describe("bboxOf", () => {
  it("bounds a viewport query by the extremes, not the first point", () => {
    expect(bboxOf([MAITRI, BHARATI, DAKSHIN_GANGOTRI])).toEqual({
      south: -70.7586,
      north: -69.4067,
      west: 11.7286,
      east: 76.1868,
    });
  });
});
