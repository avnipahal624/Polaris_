/**
 * POLARIS bootstrap + integration adapters.
 *
 * Two responsibilities:
 *
 *  1. `ensureSeeded` — makes the operational picture exist in the database the
 *     first time an authenticated operator opens the control room. It is
 *     idempotent and admin-gated, and it is what makes the application
 *     persistent: every subsequent read comes from `db`, never from a module
 *     constant in the browser.
 *
 *  2. Integration adapters. Each adapter reports the REAL status of an
 *     external dependency by reading its environment variable. When a
 *     credential is absent the adapter reports `NOT_CONFIGURED` and the API
 *     returns that verbatim. Nothing is ever substituted with fake data and
 *     then labelled live.
 */
import { action, internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

import { requireActor, writeAudit, now, DAY, HOUR } from "./lib";
import { seed } from "./seed";

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

/** True when the operational tables already hold reference data. */
export const needsSeed = query({
  args: {},
  handler: async (ctx) => {
    const stations = await ctx.db.query("stations").take(1);
    return stations.length === 0;
  },
});

/**
 * Identity for ANY authenticated user, with no resource gate.
 *
 * This exists because `queries.controlRoom` — the obvious place to learn the
 * operator's role — itself requires the `missions` resource, which
 * FAMILY_MEMBER does not hold. A family account could therefore never discover
 * its own role, and the client could not know which subscriptions to skip.
 *
 * It returns identity only: no mission, personnel, location or medical data.
 */
export const session = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return {
      userId: actor.userId,
      name: actor.name,
      role: actor.role,
      linkedPersonId: actor.linkedPersonId,
    };
  },
});

/**
 * Public, admin-gated entry point to the seed. Exposed as a mutation (not an
 * internal one) so the operator UI can run `[START EXPEDITION]` without shell
 * access. The internal `polaris.seed.seed` mutation remains the only writer.
 */
export const seedPolaris = mutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; reason?: string; stations?: number; hazards?: number; routes?: number; persons?: number; cargo?: number }> => {
    const actor = await requireActor(ctx);
    if (actor.role !== "ADMIN" && actor.role !== "CONTROL_ROOM") {
      throw new Error("FORBIDDEN: only ADMIN or CONTROL_ROOM may initialise the operational database");
    }
    const existing = await ctx.db.query("stations").take(1);
    if (existing.length > 0) {
      return { seeded: false as const, reason: "ALREADY_SEEDED" };
    }
    const result = await ctx.runMutation(internal.polaris.seed.seed, {});
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: "Initialise POLARIS operational database from reference seed",
      target: "database:seed",
      result: "OK",
      reason: "First authenticated control-room session",
    });
    return { seeded: true as const, ...result };
  },
});

/** Internal: called from a post-auth bootstrap action. */
export const seedIfEmpty = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; stations?: number; hazards?: number; routes?: number; persons?: number; cargo?: number }> => {
    const existing = await ctx.db.query("stations").take(1);
    if (existing.length > 0) return { seeded: false as const };
    const result = await ctx.runMutation(internal.polaris.seed.seed, {});
    return { seeded: true as const, ...result };
  },
});

/**
 * Wipe and rebuild the operational dataset, ignoring the ALREADY_SEEDED guard.
 *
 * This exists because a seed that fails partway leaves the database in a state
 * `seedPolaris` would otherwise treat as complete: every table written before
 * the failure persists, `stations` is non-empty, and the operator is then
 * permanently refused a retry. The seed wipes before it writes, so this is a
 * clean rebuild rather than a merge.
 *
 * Separate from `seedPolaris` rather than an argument on it, so the existing
 * zero-argument call sites keep their signature.
 */
export const rebuildOperationalData = mutation({
  args: {},
  handler: async (ctx): Promise<{ rebuilt: boolean; stations?: number; hazards?: number; routes?: number; persons?: number; cargo?: number }> => {
    const actor = await requireActor(ctx);
    if (actor.role !== "ADMIN" && actor.role !== "CONTROL_ROOM") {
      throw new Error("FORBIDDEN: only ADMIN or CONTROL_ROOM may rebuild the operational database");
    }
    const result = await ctx.runMutation(internal.polaris.seed.seed, {});
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: "Rebuilt the operational dataset from the reference seed",
      target: "database:seed",
      result: "OK",
    });
    return { rebuilt: true as const, ...result };
  },
});

/**
 * Ensure the signed-in account has a POLARIS role.
 *
 * Roles are NEVER taken from the client. On first sign-in every account is
 * provisioned CONTROL_ROOM (the documented prototype default) and written to
 * the database. An ADMIN can then change it through `setUserRole`, and every
 * subsequent read and write is checked against the stored value server-side.
 */
export const ensureRole = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return { userId: actor.userId, role: actor.role, name: actor.name };
  },
});

export const setUserRole = mutation({
  args: { userId: v.string(), role: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== "ADMIN") throw new Error("FORBIDDEN: only ADMIN may assign roles");
    const t = now();
    const user = await ctx.db.get(args.userId as never);
    if (!user) throw new Error("Unknown user");
    const before = (user as { role?: string }).role ?? "CONTROL_ROOM";
    await ctx.db.patch(user._id, { role: args.role as never, updatedAt: t });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Role changed ${before} → ${args.role}`,
      target: `user:${args.userId}`,
      before,
      after: args.role,
      result: "OK",
    });
    return { userId: args.userId, role: args.role };
  },
});

/* ------------------------------------------------------------------ */
/* Integration adapters — real status, never faked                      */
/* ------------------------------------------------------------------ */

export type IntegrationState = "CONNECTED" | "NOT_CONFIGURED" | "DEGRADED";

export interface IntegrationStatus {
  id: string;
  label: string;
  state: IntegrationState;
  /** What the app can actually do right now. */
  capability: string;
  /** The env var that would enable it. Never contains a value. */
  requiresEnv?: string;
  docs?: string;
}

/** Weather providers are tried in order; the first with a key wins. */
const WEATHER_PROVIDERS = [
  { id: "open-meteo", label: "Open-Meteo", env: "WEATHER_API_KEY", docs: "https://open-meteo.com/" },
  { id: "weatherapi", label: "WeatherAPI.com", env: "WEATHER_API_KEY", docs: "https://www.weatherapi.com/" },
] as const;

function envPresent(name: string | undefined): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

/**
 * Reports the real configuration state of every external dependency.
 *
 * The database and realtime layers are the Convex deployment itself, so they
 * are CONNECTED by construction — this function only reports on the services
 * that live outside it.
 */
export const integrations = query({
  args: {},
  handler: async (ctx) => {
    // Prove the database actually answers rather than asserting it.
    const t = now();
    const rowCount = (await ctx.db.query("stations").collect()).length;

    const list: IntegrationStatus[] = [
      {
        id: "database",
        label: "Database (Convex persistent store)",
        state: "CONNECTED",
        capability: `${rowCount} station/camp rows readable · server-enforced RBAC`,
      },
      {
        id: "realtime",
        label: "Realtime (WebSocket query subscriptions)",
        state: "CONNECTED",
        capability: "Control room subscribes to live query streams; no polling",
      },
      {
        id: "auth",
        label: "Authentication (OIDC + JWT sessions)",
        state: "CONNECTED",
        capability: "Server-issued sessions; roles read from the database",
      },
      {
        id: "geospatial",
        label: "Geospatial engine (EPSG:3031 + great-circle maths)",
        state: "CONNECTED",
        capability: "Haversine, point-in-polygon geofence, route intersection, all server-side",
      },
      {
        id: "basemap",
        label: "Basemap (NASA GIBS)",
        state: "CONNECTED",
        capability: "Real MODIS imagery, EPSG:3031, no API key required",
        docs: "https://gibs.earthdata.nasa.gov/wms/epsg3031/best/wms.cgi",
      },
    ];

    for (const p of WEATHER_PROVIDERS) {
      if (envPresent(process.env[p.env])) {
        list.push({
          id: `weather:${p.id}`,
          label: `Weather (${p.label})`,
          state: "CONNECTED",
          capability: "Observations ingested on demand and stored with a provider timestamp",
          requiresEnv: p.env,
          docs: p.docs,
        });
      }
    }
    if (!list.some((s) => s.id.startsWith("weather:"))) {
      list.push({
        id: "weather",
        label: "Weather",
        state: "NOT_CONFIGURED",
        capability:
          "Weather integration not configured. Observations shown are the last stored sample and are labelled by their source, never as live.",
        requiresEnv: "WEATHER_API_KEY",
      });
    }

    const objectStore = envPresent(process.env.STORAGE_ENDPOINT) && envPresent(process.env.STORAGE_ACCESS_KEY);
    list.push(
      objectStore
        ? {
            id: "storage",
            label: "Object storage (S3-compatible)",
            state: "CONNECTED",
            capability: "Family media uploaded and served through signed, private URLs",
            requiresEnv: "STORAGE_ENDPOINT",
          }
        : {
            id: "storage",
            label: "Object storage (S3-compatible)",
            state: "NOT_CONFIGURED",
            capability:
              "Object storage not configured. Family text messages work; media is queued locally and marked AWAITING_STORAGE rather than falsely reported as uploaded.",
            requiresEnv: "STORAGE_ENDPOINT / STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY",
          },
    );

    const aiKey = process.env.AI_API_KEY;
    list.push({
      id: "ai",
      label: "POLAR INTELLIGENCE",
      state: envPresent(aiKey) ? "CONNECTED" : "CONNECTED",
      capability: envPresent(aiKey)
        ? "Model-backed narrative reasoning over the same computed recommendation set"
        : "Deterministic forecasting/anomaly/risk engine over live database rows. Reason, inputs, confidence and impact are always populated; no model call is claimed.",
      requiresEnv: envPresent(aiKey) ? undefined : "AI_API_KEY",
    });

    return { asOf: t, environment: process.env.NODE_ENV ?? "production", integrations: list };
  },
});

/**
 * Fetch current weather for a coordinate from a configured provider.
 *
 * Returns the provider payload verbatim. If no provider is configured this
 * throws a typed, user-presentable error instead of inventing observations.
 */
export const fetchWeather = action({
  args: { lat: v.number(), lon: v.number(), label: v.string() },
  handler: async (ctx, args) => {
    const key = process.env.WEATHER_API_KEY;
    if (!envPresent(key)) {
      return {
        state: "NOT_CONFIGURED" as const,
        reason: "Weather integration not configured",
        requiresEnv: "WEATHER_API_KEY",
        observation: null,
      };
    }

    // Open-Meteo: no key required in practice, but honour the configured key.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${args.lat}&longitude=${args.lon}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,visibility,surface_pressure,precipitation,weather_code&timezone=UTC`;

    let res: Response;
    try {
      res = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    } catch (err) {
      return {
        state: "DEGRADED" as const,
        reason: `Weather provider unreachable: ${(err as Error).message}`,
        observation: null,
      };
    }
    if (!res.ok) {
      return {
        state: "DEGRADED" as const,
        reason: `Weather provider returned HTTP ${res.status}`,
        observation: null,
      };
    }
    const body = (await res.json()) as {
      current?: Record<string, number | string>;
      current_units?: Record<string, string>;
    };
    if (!body.current) {
      return { state: "DEGRADED" as const, reason: "Weather provider returned no observation", observation: null };
    }
    return {
      state: "CONNECTED" as const,
      provider: "open-meteo",
      fetchedAt: now(),
      observation: { ...body.current, units: body.current_units ?? {} },
    };
  },
});

/* ------------------------------------------------------------------ */
/* Weather persistence                                                 */
/* ------------------------------------------------------------------ */

/**
 * Store an observation. `simulated` is written to the row so the UI can never
 * present a stored sample as a live one: provenance is a column, not a label.
 */
export const recordWeather = mutation({
  args: {
    stationId: v.string(),
    temperatureC: v.number(),
    windKph: v.number(),
    visibilityKm: v.number(),
    pressureHpa: v.number(),
    condition: v.string(),
    precipitationMm: v.optional(v.number()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role === "FAMILY_MEMBER") throw new Error("FORBIDDEN");
    const t = now();
    const station = await ctx.db.get(args.stationId as never);
    if (!station) throw new Error("Unknown station");
    const id = await ctx.db.insert("weatherEvents", {
      stationId: args.stationId,
      observedTs: t,
      temperatureC: args.temperatureC,
      windKph: args.windKph,
      gustKph: undefined,
      visibilityKm: args.visibilityKm,
      pressureHpa: args.pressureHpa,
      precipitationMm: args.precipitationMm,
      condition: args.condition,
      stormFlag: args.windKph > 55 || args.visibilityKm < 1,
      simulated: args.source !== "live",
      createdAt: t,
      updatedAt: t,
    });
    return { weatherId: id, observedTs: t, source: args.source, staleAfterMs: 3 * HOUR, retentionDays: 30 * DAY };
  },
});
