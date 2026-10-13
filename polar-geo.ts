/**
 * POLARIS geospatial engine.
 *
 * Pure, dependency-free maths shared by the Convex backend and the client.
 * Polar stereographic distances are computed on a sphere (haversine) because
 * every POLARIS radius in the operational picture is far below the scale where
 * the ellipsoidal correction would matter; using one consistent metric keeps
 * hazard proximity, nearest-station and distance-along-route numbers mutually
 * consistent.
 */
import type { GeofenceHit, HazardZoneRecord } from "./polar-db";

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees 0–360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Nearest point on a geodesic path and its distance from p.
 * Used for "how far is this convoy from that hazard" and route progress.
 */
export function nearestOnPath(
  p: LatLon,
  path: LatLon[],
): { point: LatLon; distanceKm: number; segmentIndex: number; t: number } {
  let best = { point: path[0] ?? p, distanceKm: Number.POSITIVE_INFINITY, segmentIndex: 0, t: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const proj = projectOnSegment(p, a, b);
    if (proj.distanceKm < best.distanceKm) {
      best = { point: proj.point, distanceKm: proj.distanceKm, segmentIndex: i, t: proj.t };
    }
  }
  return best;
}

/**
 * Project a point onto a short geodesic segment by working in a local planar
 * frame anchored at a. Segments here are tens of kilometres at most, so the
 * planar approximation of the projection is well within a metre.
 */
function projectOnSegment(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { point: LatLon; distanceKm: number; t: number } {
  const kmPerDegLat = 111.195;
  const kmPerDegLon = 111.195 * Math.cos(toRad(a.lat));
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * kmPerDegLon;
  const by = (b.lat - a.lat) * kmPerDegLat;
  const px = (p.lon - a.lon) * kmPerDegLon;
  const py = (p.lat - a.lat) * kmPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return {
    point: { lat: a.lat + (cy / kmPerDegLat), lon: a.lon + (cx / kmPerDegLon) },
    distanceKm: Math.hypot(px - cx, py - cy),
    t,
  };
}

/** Interpolate a position along a path at 0..1 progress. */
export function pointAlongPath(path: LatLon[], progress: number): LatLon {
  if (path.length === 0) return { lat: -90, lon: 0 };
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineKm(path[i], path[i + 1]);
    segs.push(d);
    total += d;
  }
  let remaining = total * clamped;
  for (let i = 0; i < segs.length; i++) {
    if (remaining <= segs[i] || i === segs.length - 1) {
      const t = segs[i] === 0 ? 0 : remaining / segs[i];
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
        lon: path[i].lon + (path[i + 1].lon - path[i].lon) * t,
      };
    }
    remaining -= segs[i];
  }
  return path[path.length - 1];
}

/** Total path length in kilometres. */
export function pathLengthKm(path: LatLon[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += haversineKm(path[i], path[i + 1]);
  return total;
}

/**
 * Point-in-circle test expressed against a published polygon approximation.
 * POLARIS hazard zones are authored as a centroid + radius on the ice sheet;
 * this is the equivalent of a PostGIS ST_Contains on the stored polygon.
 */
export function insideZone(p: LatLon, zone: { lat: number; lon: number; radiusKm: number }): boolean {
  return haversineKm(p, zone) <= zone.radiusKm;
}

/**
 * Server-side geofence evaluation. This is the only place hazard proximity is
 * computed — the client never performs its own spatial reasoning.
 */
export function evaluateGeofences(
  p: LatLon,
  zones: HazardZoneRecord[],
  now: number,
): GeofenceHit[] {
  const hits: GeofenceHit[] = [];
  for (const z of zones) {
    if (z.validFrom > now) continue;
    if (z.validUntil !== null && z.validUntil < now) continue;
    const distanceKm = haversineKm(p, z);
    const inside = distanceKm <= z.radiusKm;
    // A warning band one radius beyond the polygon, so the control room sees
    // an approach before the boundary is crossed.
    if (!inside && distanceKm > z.radiusKm * 2) continue;
    hits.push({
      hazardId: z.id,
      label: z.label,
      hazardType: z.hazardType,
      severity: z.severity,
      distanceKm: Math.round(distanceKm * 100) / 100,
      insidePolygon: inside,
      routeId: z.routeId,
      description: z.description,
    });
  }
  return hits.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Nearest station by great-circle distance. */
export function nearestStation<T extends { id: string; lat: number; lon: number }>(
  p: LatLon,
  stations: T[],
): { station: T; distanceKm: number } | null {
  let best: { station: T; distanceKm: number } | null = null;
  for (const s of stations) {
    const d = haversineKm(p, s);
    if (!best || d < best.distanceKm) best = { station: s, distanceKm: d };
  }
  return best;
}

/** Does a straight path segment pass within `toleranceKm` of a zone? */
export function routeIntersectsZone(
  path: LatLon[],
  zone: { lat: number; lon: number; radiusKm: number },
): { intersects: boolean; minDistanceKm: number } {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    const d = projectOnSegment(zone, path[i], path[i + 1]).distanceKm;
    if (d < min) min = d;
  }
  if (!Number.isFinite(min)) return { intersects: false, minDistanceKm: 0 };
  return { intersects: min <= zone.radiusKm, minDistanceKm: Math.round(min * 100) / 100 };
}

/** Bounding box helper for viewport queries. */
export function bboxOf(points: LatLon[]): { south: number; west: number; north: number; east: number } {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
}
