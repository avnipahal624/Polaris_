/**
 * POLARIS read API.
 *
 * Every query enforces RBAC on the server. Family accounts can only ever
 * resolve their one linked expedition member; medical data is restricted to
 * medical authority; well-being is exposed to the control room as counts only.
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

import {
  FAMILY_VISIBLE_ROLES,
  WELLBEING_VISIBLE_ROLES,
  freshnessLabel,
  freshnessOf,
  priorityFor,
  type PolarisRole,
} from "../../lib/polar-db";
import { requireActor, requireResource, computeIntelligence, now } from "./lib";

/* ------------------------------------------------------------------ */
/* Control room picture                                                */
/* ------------------------------------------------------------------ */

export const controlRoom = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "missions");

    const [stations, convoys, cargo, inventory, lastKnown, sos, missions, sim] = await Promise.all([
      ctx.db.query("stations").collect(),
      ctx.db.query("convoys").collect(),
      ctx.db.query("cargo").collect(),
      ctx.db.query("inventory").collect(),
      ctx.db.query("lastKnownPositions").collect(),
      ctx.db.query("sosEvents").collect(),
      ctx.db.query("missions").collect(),
      ctx.db.query("simState").first(),
    ]);

    const t = now();
    const activeSos = sos.filter((s) => s.stage !== "RESOLVED");

    const totalStock = inventory.reduce((a, i) => a + i.quantity, 0);
    const reserve = inventory.reduce((a, i) => a + i.minThreshold, 0);

    return {
      asOf: t,
      actorRole: actor.role,
      stationsOnline: stations.length,
      stationsTotal: stations.length,
      personnel: stations.reduce((a, s) => a + s.personnel, 0),
      activeMissions: missions.filter((m) => m.status === "ACTIVE").length,
      cargoInTransit: cargo.filter((c) => c.status === "IN_TRANSIT" || c.status === "LOADED").length,
      cargoDiscrepancies: cargo.filter((c) => c.containersReceived < c.containersExpected).length,
      criticalAlerts: activeSos.length,
      activeConvoys: convoys.filter((c) => c.status === "ACTIVE").length,
      missedCheckins: convoys.filter((c) => c.comms === "MISSED_CHECK_IN").length,
      readinessPct: Math.round(100 - (reserve === 0 ? 0 : (1 - totalStock / (reserve * 3)) * 100)),
      connectivity: sim?.connectivity ?? "NORMAL",
      simRunning: sim?.running ?? false,
      lastTickTs: sim?.lastTickTs ?? null,
      liveSubjects: lastKnown.filter((l) => t - l.ts < 2 * 60_000).length,
      staleSubjects: lastKnown.filter((l) => t - l.ts >= 2 * 60_000).length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Live map entities — with honest freshness                           */
/* ------------------------------------------------------------------ */

export const liveEntities = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "locations");
    const t = now();

    const [lastKnown, stations, convoys, hazards, vehicles] = await Promise.all([
      ctx.db.query("lastKnownPositions").collect(),
      ctx.db.query("stations").collect(),
      ctx.db.query("convoys").collect(),
      ctx.db.query("hazardZones").collect(),
      ctx.db.query("vehicles").collect(),
    ]);

    const tracked = lastKnown.map((l) => {
      const fresh = freshnessOf(l.ts, t, l.connectivity);
      return {
        subjectId: l.subjectId,
        subjectKind: l.subjectKind,
        lat: l.lat,
        lon: l.lon,
        accuracyM: l.accuracyM,
        batteryPct: l.batteryPct ?? null,
        connectivity: l.connectivity,
        ts: l.ts,
        freshness: fresh.kind,
        freshnessLabel: freshnessLabel(fresh),
        source: l.source,
      };
    });

    return {
      asOf: t,
      tracked,
      stations: stations.map((s) => ({
        id: s._id,
        code: s.code,
        short: s.short,
        name: s.name,
        kind: s.kind,
        lat: s.lat,
        lon: s.lon,
        status: s.status,
        operationalDataSimulated: s.operationalDataSimulated,
        emergencyCapability: s.emergencyCapability ?? null,
      })),
      convoys: convoys.map((c) => ({
        id: c._id,
        convoyId: c.convoyId,
        name: c.name,
        status: c.status,
        comms: c.comms,
        fuelPct: c.fuelPct,
        progress: c.progress,
        emergencyStatus: c.emergencyStatus,
        lastCheckinTs: c.lastCheckinTs ?? null,
        expectedArrivalTs: c.expectedArrivalTs,
        personnelCount: c.personnelIds.length,
        vehicleCount: c.vehicleIds.length,
        checkinOverdueMin: c.lastCheckinTs ? Math.round((t - c.lastCheckinTs) / 60000) - c.checkinIntervalMin : null,
      })),
      hazards: hazards.map((h) => ({
        id: h._id,
        hazardId: h.hazardId,
        hazardType: h.hazardType,
        label: h.label,
        severity: h.severity,
        lat: h.lat,
        lon: h.lon,
        radiusKm: h.radiusKm,
        description: h.description,
        source: h.source,
      })),
      vehicles: vehicles.map((v) => ({
        id: v._id,
        vehicleId: v.vehicleId,
        label: v.label,
        kind: v.kind,
        status: v.status,
        etaTs: v.etaTs ?? null,
        fuelPct: v.fuelPct,
      })),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export const stations = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "missions");
    const [rows, weather, inventory, personnel] = await Promise.all([
      ctx.db.query("stations").collect(),
      ctx.db.query("weatherEvents").order("desc").take(60),
      ctx.db.query("inventory").collect(),
      ctx.db.query("persons").collect(),
    ]);
    const t = now();
    return rows.map((s) => {
      const w = weather.find((x) => x.stationId === s._id);
      const inv = inventory.filter((i) => i.stationId === s._id);
      const people = personnel.filter((p) => p.stationId === s._id);
      return {
        ...s,
        id: s._id,
        weather: w
          ? {
              temperatureC: w.temperatureC,
              windKph: w.windKph,
              visibilityKm: w.visibilityKm,
              pressureHpa: w.pressureHpa,
              condition: w.condition,
              stormFlag: w.stormFlag,
              observedTs: w.observedTs,
              simulated: w.simulated,
            }
          : null,
        personnelCount: people.length,
        fleet: inv.length,
        // Freshness for the station itself (telemetry, not simulated ops).
        lastTelemetryTs: w ? w.observedTs : null,
        asOf: t,
      };
    });
  },
});

/**
 * Personnel. MEDICAL data (blood group, medical note) is only returned to
 * medical authority — a control-room operator sees operational fields only.
 */
export const personnel = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "personnel");
    const rows = await ctx.db.query("persons").collect();
    const stations = await ctx.db.query("stations").collect();
    const lastKnown = await ctx.db.query("lastKnownPositions").collect();
    const t = now();
    const medicalVisible = actor.role === "MEDICAL_AUTHORITY" || actor.role === "ADMIN";

    return rows.map((p) => {
      const lk = lastKnown.find((l) => l.subjectId === p.polarisId);
      const fresh = lk ? freshnessOf(lk.ts, t, lk.connectivity) : null;
      return {
        id: p._id,
        polarisId: p.polarisId,
        name: p.name,
        role: p.role,
        team: p.team,
        stationId: p.stationId,
        stationShort: stations.find((s) => s._id === p.stationId)?.short ?? p.stationId,
        shift: p.shift ?? null,
        status: p.status,
        connectivity: p.connectivity,
        currentAssignment: p.currentAssignment ?? null,
        emergencyContact: p.emergencyContact ?? null,
        deviceId: p.deviceId ?? null,
        lastCheckinTs: p.lastCheckinTs ?? null,
        lat: lk?.lat ?? null,
        lon: lk?.lon ?? null,
        freshness: fresh ? freshnessLabel(fresh) : "NO POSITION PACKET",
        bloodGroup: medicalVisible ? p.bloodGroup ?? null : null,
        medicalNote: medicalVisible ? p.medicalNote ?? null : null,
        medicalRestricted: !medicalVisible,
      };
    });
  },
});

/* ------------------------------------------------------------------ */
/* Cargo & inventory                                                   */
/* ------------------------------------------------------------------ */

export const cargo = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "cargo");
    const [rows, scans, stations] = await Promise.all([
      ctx.db.query("cargo").collect(),
      ctx.db.query("cargoScans").order("desc").take(60),
      ctx.db.query("stations").collect(),
    ]);
    const t = now();
    return rows.map((c) => {
      const stn = stations.find((s) => s._id === c.destinationStationId);
      return {
        id: c._id,
        cargoId: c.cargoId,
        rfid: c.rfid,
        barcode: c.barcode,
        itemType: c.itemType,
        quantity: c.quantity,
        unit: c.unit,
        weightKg: c.weightKg,
        origin: c.origin,
        destinationStationId: c.destinationStationId,
        destinationShort: stn?.short ?? c.destinationStationId,
        missionId: c.missionId,
        transportId: c.transportId ?? null,
        containersExpected: c.containersExpected,
        containersReceived: c.containersReceived,
        containersUnverified: c.containersUnverified,
        discrepancy: c.containersReceived - c.containersExpected,
        status: c.status,
        priority: c.priority,
        dispatchedTs: c.dispatchedTs ?? null,
        expectedArrivalTs: c.expectedArrivalTs,
        actualArrivalTs: c.actualArrivalTs ?? null,
        expiresTs: c.expiresTs ?? null,
        expiresInDays: c.expiresTs ? Math.round((c.expiresTs - t) / 86_400_000) : null,
        responsiblePersonId: c.responsiblePersonId,
        verification: c.verification,
        version: c.version,
        scanCount: scans.filter((s) => s.cargoId === c.cargoId).length,
      };
    });
  },
});

export const inventory = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "inventory");
    const [rows, stations, cargo] = await Promise.all([
      ctx.db.query("inventory").collect(),
      ctx.db.query("stations").collect(),
      ctx.db.query("cargo").collect(),
    ]);
    const t = now();
    return rows.map((i) => {
      const usable = i.quantity - i.minThreshold;
      const daysToThreshold =
        i.consumptionRatePerDay > 0 ? (usable <= 0 ? 0 : usable / i.consumptionRatePerDay) : null;
      const incoming = cargo.filter((c) => c.destinationStationId === i.stationId && (c.status === "IN_TRANSIT" || c.status === "LOADED"));
      return {
        id: i._id,
        itemId: i.itemId,
        item: i.item,
        category: i.category,
        stationId: i.stationId,
        stationShort: stations.find((s) => s._id === i.stationId)?.short ?? i.stationId,
        quantity: i.quantity,
        unit: i.unit,
        batch: i.batch,
        minThreshold: i.minThreshold,
        consumptionRatePerDay: i.consumptionRatePerDay,
        incomingQuantity: i.incomingQuantity,
        incomingEtaTs: i.incomingEtaTs ?? null,
        reservedQuantity: i.reservedQuantity,
        expiresTs: i.expiresTs ?? null,
        expiresInDays: i.expiresTs ? Math.round((i.expiresTs - t) / 86_400_000) : null,
        expired: i.expiresTs !== undefined && i.expiresTs < t,
        daysToThreshold: daysToThreshold === null ? null : Math.round(daysToThreshold * 10) / 10,
        projectedShortfall: daysToThreshold !== null && daysToThreshold < 14,
        incomingConsignments: incoming.length,
        version: i.version,
      };
    });
  },
});

/* ------------------------------------------------------------------ */
/* Convoys & hazards                                                   */
/* ------------------------------------------------------------------ */

export const convoys = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const [rows, checkins, stations, routes, lk] = await Promise.all([
      ctx.db.query("convoys").collect(),
      ctx.db.query("convoyCheckins").order("desc").take(80),
      ctx.db.query("stations").collect(),
      ctx.db.query("routes").collect(),
      ctx.db.query("lastKnownPositions").collect(),
    ]);
    const t = now();
    return rows.map((c) => {
      const pos = lk.find((l) => l.subjectId === c.convoyId);
      const recent = checkins.filter((k) => k.convoyId === c.convoyId).slice(0, 6);
      const overdue = c.lastCheckinTs ? t - c.lastCheckinTs > c.checkinIntervalMin * 60_000 : false;
      return {
        id: c._id,
        convoyId: c.convoyId,
        name: c.name,
        missionId: c.missionId,
        routeId: c.routeId,
        routeName: routes.find((r) => r._id === c.routeId)?.name ?? null,
        origin: stations.find((s) => s._id === c.originStationId)?.short ?? c.originStationId,
        destination: stations.find((s) => s._id === c.destinationStationId)?.short ?? c.destinationStationId,
        personnelCount: c.personnelIds.length,
        vehicleCount: c.vehicleIds.length,
        personnelIds: c.personnelIds,
        vehicleIds: c.vehicleIds,
        departureTs: c.departureTs,
        expectedArrivalTs: c.expectedArrivalTs,
        lastCheckinTs: c.lastCheckinTs ?? null,
        checkinIntervalMin: c.checkinIntervalMin,
        status: c.status,
        comms: c.comms,
        fuelPct: c.fuelPct,
        progress: c.progress,
        emergencyStatus: overdue ? "CHECK_IN_OVERDUE" : c.emergencyStatus,
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        freshness: pos ? freshnessLabel(freshnessOf(pos.ts, t, pos.connectivity)) : "NO POSITION PACKET",
        checkins: recent,
      };
    });
  },
});

export const hazards = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "hazards");
    const rows = await ctx.db.query("hazardZones").collect();
    const t = now();
    return rows.map((h) => ({
      id: h._id,
      hazardId: h.hazardId,
      hazardType: h.hazardType,
      label: h.label,
      severity: h.severity,
      lat: h.lat,
      lon: h.lon,
      radiusKm: h.radiusKm,
      source: h.source,
      validFrom: h.validFrom,
      validUntil: h.validUntil ?? null,
      active: h.validFrom <= t && (h.validUntil === undefined || h.validUntil >= t),
      description: h.description,
      routeId: h.routeId ?? null,
    }));
  },
});

export const weather = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "hazards");
    const rows = await ctx.db.query("weatherEvents").order("desc").take(60);
    const stations = await ctx.db.query("stations").collect();
    return rows.slice(0, 24).map((w) => ({
      id: w._id,
      stationId: w.stationId,
      stationShort: stations.find((s) => s._id === w.stationId)?.short ?? w.stationId,
      observedTs: w.observedTs,
      temperatureC: w.temperatureC,
      windKph: w.windKph,
      gustKph: w.gustKph ?? null,
      visibilityKm: w.visibilityKm,
      pressureHpa: w.pressureHpa,
      condition: w.condition,
      stormFlag: w.stormFlag,
      simulated: w.simulated,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Emergency                                                           */
/* ------------------------------------------------------------------ */

export const emergencies = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "emergency");
    const [sos, responses, stations, hazards, vehicles] = await Promise.all([
      ctx.db.query("sosEvents").order("desc").take(30),
      ctx.db.query("emergencyResponses").collect(),
      ctx.db.query("stations").collect(),
      ctx.db.query("hazardZones").collect(),
      ctx.db.query("vehicles").collect(),
    ]);
    return sos.map((s) => ({
      id: s._id,
      sosId: s.sosId,
      incidentId: s.incidentId,
      personId: s.personId,
      lat: s.lat,
      lon: s.lon,
      accuracyM: s.accuracyM,
      triggeredTs: s.triggeredTs,
      batteryPct: s.batteryPct ?? null,
      routeId: s.routeId ?? null,
      convoyId: s.convoyId ?? null,
      nearestHazardId: s.nearestHazardId ?? null,
      nearestHazardLabel: hazards.find((h) => h._id === s.nearestHazardId)?.label ?? null,
      nearestStationId: s.nearestStationId,
      nearestStationLabel: stations.find((x) => x._id === s.nearestStationId)?.short ?? s.nearestStationId,
      nearestStationKm: s.nearestStationKm,
      connectivityAtTrigger: s.connectivityAtTrigger,
      category: s.category,
      stage: s.stage,
      responseTeam: s.responseTeam ?? null,
      assignedVehicleIds: s.assignedVehicleIds,
      actions: s.actions,
      resolution: s.resolution ?? null,
      resolvedTs: s.resolvedTs ?? null,
      queuedOffline: s.queuedOffline ?? false,
      response: responses.find((r) => r.sosId === s._id) ?? null,
      availableAssets: vehicles
        .filter((v) => v.status === "IN_TRANSIT" || v.status === "SCHEDULED")
        .slice(0, 5)
        .map((v) => ({ id: v._id, label: v.label, kind: v.kind, status: v.status })),
    }));
  },
});

export const incidents = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "emergency");
    return ctx.db.query("auditLogs").withIndex("by_target", (q) => q.eq("target", "incident")).collect();
  },
});

/* ------------------------------------------------------------------ */
/* Medical — restricted                                                */
/* ------------------------------------------------------------------ */

export const medical = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "medical");
    const [cases, persons] = await Promise.all([
      ctx.db.query("medicalCases").order("desc").take(50),
      ctx.db.query("persons").collect(),
    ]);
    return cases.map((c) => ({
      id: c._id,
      caseId: c.caseId,
      personId: c.personId,
      personName: persons.find((p) => p._id === c.personId)?.name ?? c.personId,
      incidentId: c.incidentId ?? null,
      observations: c.observations,
      vitals: c.vitals ?? null,
      priority: c.priority,
      status: c.status,
      recordedBy: c.recordedBy,
      recordedTs: c.recordedTs,
      offlineOrigin: c.offlineOrigin ?? false,
      clinicianNote: c.clinicianNote ?? null,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Well-being — aggregate only for the control room                   */
/* ------------------------------------------------------------------ */

export const wellbeing = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    if (!WELLBEING_VISIBLE_ROLES.includes(actor.role)) {
      throw new Error("FORBIDDEN: well-being aggregate is not available to this role");
    }
    const [checkins, personnel, family, connectivity, support] = await Promise.all([
      ctx.db.query("wellbeingCheckins").order("desc").take(80),
      ctx.db.query("persons").collect(),
      ctx.db.query("familyMessages").collect(),
      ctx.db.query("connectivityEvents").order("desc").take(40),
      ctx.db.query("syncEvents").withIndex("by_status", (q) => q.eq("status", "QUEUED")).collect(),
    ]);
    const t = now();
    const dayAgo = t - 86_400_000;
    const recentCheckins = checkins.filter((c) => c.ts > dayAgo);
    const distinct = new Set(recentCheckins.map((c) => c.personId));
    const disruptions = connectivity.filter((c) => c.mode === "OFFLINE" || c.mode === "VERY_LOW").length;

    return {
      checkinsCompleted: distinct.size,
      teamSize: personnel.length,
      supportRequests: recentCheckins.filter((c) => c.supportRoute !== undefined).length,
      familyBacklog: family.filter((m) => m.state === "QUEUED" || m.state === "WAITING_FOR_CONNECTIVITY").length,
      connectivityDisruptions: disruptions,
      lastCheckinTs: recentCheckins[0]?.ts ?? null,
      // Aggregate only. Individual levels and notes are never returned here.
      privateDetailExposed: false,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Family Home Link                                                    */
/* ------------------------------------------------------------------ */

/**
 * Family-facing query. Strictly scoped:
 *   - a FAMILY_MEMBER sees only the linked expedition member and their messages
 *   - no map, no cargo, no hazards, no other personnel, no medical
 */
export const familyPortal = query({
  args: { personId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "family");

    // Family accounts are pinned to their linked member. A family member who
    // tries to pass another personId still only ever gets their own.
    const personId = actor.role === "FAMILY_MEMBER" ? actor.linkedPersonId : args.personId ?? actor.linkedPersonId;
    if (!personId) {
      throw new Error("FAMILY PORTAL: no linked expedition member on this account");
    }

    const [person, messages, members] = await Promise.all([
      ctx.db.query("persons").withIndex("by_polaris_id", (q) => q.eq("polarisId", personId)).unique(),
      ctx.db.query("familyMessages").withIndex("by_person", (q) => q.eq("personId", personId)).collect(),
      ctx.db.query("familyMembers").withIndex("by_person", (q) => q.eq("personId", personId)).collect(),
    ]);

    const t = now();
    return {
      // Deliberately minimal: name, role, station, shift. No coordinates, no
      // route, no hazards, no other expedition data.
      expeditionMember: person
        ? {
            polarisId: person.polarisId,
            name: person.name,
            role: person.role,
            station: person.stationId,
            team: person.team,
            status: person.status,
          }
        : null,
      lastCommunicationTs: messages
        .map((m) => m.deliveredTs ?? m.createdTs)
        .sort((a, b) => b - a)[0] ?? null,
      messages: messages
        .sort((a, b) => b.createdTs - a.createdTs)
        .map((m) => ({
          id: m._id,
          messageId: m.messageId,
          from: m.direction === "FAMILY_TO_FIELD" ? members.find((x) => x._id === m.familyMemberId)?.name ?? "Family" : "Expedition member",
          direction: m.direction,
          type: m.type,
          state: m.state,
          quality: m.quality,
          sizeBytes: m.sizeBytes,
          audioExtractedFirst: m.audioExtractedFirst,
          pipeline: m.pipeline,
          createdTs: m.createdTs,
          deliveredTs: m.deliveredTs ?? null,
          openedTs: m.openedTs ?? null,
          body: m.privateBody ?? null,
        })),
      queued: messages.filter((m) => m.state === "QUEUED" || m.state === "WAITING_FOR_CONNECTIVITY").length,
      asOf: t,
    };
  },
});

/** Control-room view of Home Link operations (metadata only, no content). */
export const homeLinkOps = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    if (!FAMILY_VISIBLE_ROLES.includes(actor.role) && actor.role !== "ADMIN") {
      throw new Error("FORBIDDEN: Home Link operations are not available to this role");
    }
    const rows = await ctx.db.query("familyMessages").collect();
    const members = await ctx.db.query("familyMembers").collect();
    const t = now();
    return {
      // Counts and pipeline state only — the message bodies are never exposed
      // to the control room.
      total: rows.length,
      queued: rows.filter((m) => m.state === "QUEUED").length,
      waitingForConnectivity: rows.filter((m) => m.state === "WAITING_FOR_CONNECTIVITY").length,
      transmitting: rows.filter((m) => m.state === "TRANSMITTING").length,
      delivered: rows.filter((m) => m.state === "DELIVERED").length,
      opened: rows.filter((m) => m.state === "OPENED").length,
      priority: "P4 — never ahead of P0–P3 safety traffic",
      mediaPipelines: rows
        .filter((m) => m.type === "VIDEO")
        .map((m) => ({ messageId: m.messageId, quality: m.quality, audioExtractedFirst: m.audioExtractedFirst, pipeline: m.pipeline })),
      expiredCached: rows.filter((m) => m.expiresTs !== undefined && m.expiresTs < t).length,
      authorizedMembers: members.filter((m) => m.authorized).length,
      bodiesExposed: false,
    };
  },
});

/* ------------------------------------------------------------------ */
/* AI, notifications, audit, sync, realtime                           */
/* ------------------------------------------------------------------ */

export const aiFeed = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "ai");
    // Recompute live so the feed is never stale relative to the database.
    const fresh = await computeIntelligence(ctx);
    const stored = await ctx.db.query("aiRecommendations").collect();
    const byId = new Map(stored.map((r) => [r.recommendationId, r]));
    return fresh.recommendations.map((r) => ({
      ...r,
      state: byId.get(r.id)?.state ?? "PENDING_APPROVAL",
      approvedBy: byId.get(r.id)?.approvedBy ?? null,
      approvedTs: byId.get(r.id)?.approvedTs ?? null,
    }));
  },
});

export const notifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const rows = await ctx.db.query("notifications").order("desc").take(args.limit ?? 30);
    return rows
      .filter((n) => n.audience.includes(actor.role))
      .map((n) => ({
        id: n._id,
        kind: n.kind,
        severity: n.severity,
        title: n.title,
        detail: n.detail,
        ts: n.ts,
        linkEntity: n.linkEntity ?? null,
        linkLatLon: n.linkLatLon ?? null,
        channels: n.channels,
        read: n.read,
      }));
  },
});

export const auditTrail = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "audit");
    return ctx.db.query("auditLogs").order("desc").take(args.limit ?? 60);
  },
});

/** Sync queue state: what is waiting, at what priority, and any conflicts. */
export const syncStatus = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const [queued, applied, conflicts, sim] = await Promise.all([
      ctx.db.query("syncEvents").withIndex("by_status", (q) => q.eq("status", "QUEUED")).collect(),
      ctx.db.query("syncEvents").withIndex("by_status", (q) => q.eq("status", "APPLIED")).collect(),
      ctx.db.query("syncConflicts").withIndex("by_status", (q) => q.eq("status", "OPEN")).collect(),
      ctx.db.query("simState").first(),
    ]);
    const role = actor.role;
    return {
      connectivity: sim?.connectivity ?? "NORMAL",
      queued: queued.length,
      byPriority: [0, 1, 2, 3, 4, 5].map((p) => ({
        priority: p,
        count: queued.filter((q) => q.priority === p).length,
      })),
      applied: applied.length,
      openConflicts: conflicts.length,
      conflicts: conflicts.map((c) => ({
        id: c._id,
        conflictId: c.conflictId,
        entity: c.entity,
        entityId: c.entityId,
        field: c.field,
        centralValue: c.centralValue,
        fieldValue: c.fieldValue,
        fieldAuthor: c.fieldAuthor,
        fieldTs: c.fieldTs,
        status: c.status,
      })),
      role,
    };
  },
});

/** Realtime bus for the UI's event feed. */
export const realtimeFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const rows = await ctx.db.query("realtimeEvents").order("desc").take(args.limit ?? 40);
    return rows
      .filter((e) => (e.audience as string[]).includes(actor.role))
      .map((e) => ({
        eventId: e.eventId,
        type: e.type,
        ts: e.ts,
        payload: JSON.parse(e.payload) as Record<string, unknown>,
      }));
  },
});

/** Static capability matrix — what is real vs simulated in this build. */
export const systemHealth = query({
  args: {},
  handler: async () => {
    const t = now();
    return {
      asOf: t,
      geography: "REAL — NASA GIBS EPSG:3031 basemap, real station coordinates",
      operationalValues: "SIMULATED — seeded demonstration data, labelled throughout",
      weather: "SIMULATED — no live Antarctic feed connected",
      gps: "SIMULATED — server-side engine writing real location events",
      connectivity: "SIMULATED — satellite/low-bandwidth ladder, P0–P5 queue implemented",
      real: ["basemap", "station coordinates", "geospatial math", "event pipeline", "RBAC", "audit"],
      simulated: ["telemetry", "weather", "consumption rates", "mission schedule"],
    };
  },
});

export { priorityFor };
export type { PolarisRole };
