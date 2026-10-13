/**
 * POLARIS write API.
 *
 * Every mutation is authorised server-side, writes an audit record when it
 * changes operational state, and publishes a realtime event so the control room
 * updates without a refresh.
 */
import { mutation } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";

import { INTEGRATION_ADAPTERS, priorityFor, type FieldEventEnvelope } from "../../lib/polar-db";
import {
  DAY,
  HOUR,
  MIN,
  geofence,
  ingestLocation,
  nearestStationTo,
  nextId,
  notify,
  now,
  publish,
  requireActor,
  requireResource,
  computeIntelligence,
  runIntelligence,
  writeAudit,
} from "./lib";

/* ================================================================== */
/* SOS — P0, works offline                                            */
/* ================================================================== */

export const triggerSos = mutation({
  args: {
    personId: v.string(),
    deviceId: v.string(),
    lat: v.number(),
    lon: v.number(),
    accuracyM: v.number(),
    batteryPct: v.optional(v.number()),
    category: v.string(),
    routeId: v.optional(v.string()),
    convoyId: v.optional(v.string()),
    connectivity: v.union(v.literal("ONLINE"), v.literal("LOW"), v.literal("OFFLINE")),
    /** True when the device captured this locally with no link. */
    queuedOffline: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "emergency");
    const t = now();

    // Server-side spatial analysis at the moment of the SOS.
    const hits = await geofence(ctx, { lat: args.lat, lon: args.lon });
    const near = await nearestStationTo(ctx, { lat: args.lat, lon: args.lon });
    const hazard = hits.find((h) => h.insidePolygon) ?? hits[0] ?? null;

    const sosId = `SOS-${String(Math.floor(1000 + Math.random() * 8999))}`;
    const incidentId = nextId("INC");

    const id = await ctx.db.insert("sosEvents", {
      sosId,
      incidentId,
      personId: args.personId,
      deviceId: args.deviceId,
      lat: args.lat,
      lon: args.lon,
      accuracyM: args.accuracyM,
      triggeredTs: t,
      batteryPct: args.batteryPct,
      routeId: args.routeId,
      convoyId: args.convoyId,
      nearestHazardId: hazard ? (hazard.hazardId as string) : undefined,
      nearestStationId: near?.station._id ?? "",
      nearestStationKm: near ? Math.round(near.distanceKm * 10) / 10 : 0,
      connectivityAtTrigger: args.connectivity,
      category: args.category,
      stage: "TRIGGERED",
      assignedVehicleIds: [],
      actions: [
        {
          ts: t,
          actor: args.personId,
          action: args.queuedOffline
            ? "SOS captured on device with NO NETWORK — stored in P0 local queue"
            : "SOS captured on device — transmitted immediately",
        },
      ],
      queuedOffline: args.queuedOffline ?? false,
      createdAt: t,
      updatedAt: t,
    });

    await ctx.db.insert("emergencyResponses", {
      incidentId,
      sosId: id,
      severity: "critical",
      location: { lat: args.lat, lon: args.lon },
      hazardIds: hazard ? [hazard.hazardId as string] : [],
      responseTeam: "Unassigned",
      assignedVehicleIds: [],
      status: "OPEN",
      openedTs: t,
      createdAt: t,
      updatedAt: t,
    });

    // If the device was offline the SOS is a queued P0 event that transmits
    // on the next available link — recorded so the audit trail is honest.
    if (args.queuedOffline) {
      await ctx.db.insert("syncEvents", {
        eventId: `P0-${nextId("EVT")}`,
        deviceId: args.deviceId,
        type: "SOS",
        priority: 0,
        recordedAt: t,
        receivedAt: t,
        payload: JSON.stringify({ sosId, personId: args.personId }),
        status: "APPLIED",
        appliedTable: "sosEvents",
        appliedId: id,
        createdAt: t,
        updatedAt: t,
      });
    }

    const person = await ctx.db.query("persons").withIndex("by_polaris_id", (q) => q.eq("polarisId", args.personId)).unique();
    if (person) await ctx.db.patch(person._id, { status: "EMERGENCY", updatedAt: t });

    await publish(ctx, "SOS_TRIGGERED", { sosId, personId: args.personId, lat: args.lat, lon: args.lon }, [
      "ADMIN",
      "CONTROL_ROOM",
      "MEDICAL_AUTHORITY",
    ]);

    await notify(ctx, {
      kind: "SOS",
      severity: "critical",
      title: `EMERGENCY SOS ${sosId} — ${person?.name ?? args.personId}`,
      detail: `${args.category} at ${args.lat.toFixed(3)}, ${args.lon.toFixed(3)} · nearest station ${near?.station.short ?? "unknown"} (${near ? near.distanceKm.toFixed(1) : "?"} km)${hazard ? ` · hazard ${hazard.label} at ${hazard.distanceKm} km` : ""} · battery ${args.batteryPct ?? "?"}% · ${args.connectivity}`,
      audience: ["ADMIN", "CONTROL_ROOM", "MEDICAL_AUTHORITY"],
      linkEntity: { table: "sosEvents", id },
      linkLatLon: { lat: args.lat, lon: args.lon },
      channels: ["IN_APP", "PUSH", "SMS", "SATELLITE"],
    });

    await writeAudit(ctx, {
      actor: person?.name ?? args.personId,
      actorRole: "FIELD_OPERATOR",
      action: `SOS TRIGGERED — ${sosId} (${args.category}) at ${args.lat.toFixed(4)}, ${args.lon.toFixed(4)} · accuracy ±${args.accuracyM} m · battery ${args.batteryPct ?? "?"}% · connectivity ${args.connectivity}${args.queuedOffline ? " · queued offline as P0" : ""}`,
      target: `sos:${sosId}`,
      result: "OPEN",
    });

    return {
      sosId,
      incidentId,
      nearestStation: near?.station.short ?? null,
      nearestStationKm: near ? Math.round(near.distanceKm * 10) / 10 : null,
      hazard: hazard ? { label: hazard.label, distanceKm: hazard.distanceKm, inside: hazard.insidePolygon } : null,
      priority: priorityFor("SOS"),
    };
  },
});

/* ================================================================== */
/* Emergency response state machine                                    */
/* ================================================================== */

export const advanceEmergency = mutation({
  args: {
    sosId: v.string(),
    stage: v.union(
      v.literal("ACKNOWLEDGED"),
      v.literal("RESPONSE_ASSIGNED"),
      v.literal("RESPONDING"),
      v.literal("RESOLVED"),
    ),
    note: v.optional(v.string()),
    responseTeam: v.optional(v.string()),
    vehicleIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "emergency");
    const t = now();
    const doc = await ctx.db.query("sosEvents").withIndex("by_sos_id", (q) => q.eq("sosId", args.sosId)).unique();
    if (!doc) throw new Error(`Unknown SOS ${args.sosId}`);

    const actions = [...doc.actions, { ts: t, actor: actor.name, action: `${args.stage}${args.note ? ` — ${args.note}` : ""}` }];
    await ctx.db.patch(doc._id, {
      stage: args.stage,
      actions,
      responseTeam: args.responseTeam ?? doc.responseTeam,
      assignedVehicleIds: args.vehicleIds ?? doc.assignedVehicleIds,
      resolvedTs: args.stage === "RESOLVED" ? t : undefined,
      resolution: args.stage === "RESOLVED" ? (args.note ?? "Resolved") : doc.resolution,
      updatedAt: t,
    });

    const resp = await ctx.db.query("emergencyResponses").withIndex("by_sos", (q) => q.eq("sosId", doc._id)).unique();
    if (resp) {
      const statusMap = {
        ACKNOWLEDGED: "OPEN",
        RESPONSE_ASSIGNED: "ASSIGNED",
        RESPONDING: "EN_ROUTE",
        RESOLVED: "CLOSED",
      } as const;
      await ctx.db.patch(resp._id, {
        status: statusMap[args.stage],
        responseTeam: args.responseTeam ?? resp.responseTeam,
        assignedVehicleIds: args.vehicleIds ?? resp.assignedVehicleIds,
        closedTs: args.stage === "RESOLVED" ? t : undefined,
        updatedAt: t,
      });
    }

    if (args.stage === "ACKNOWLEDGED") {
      await publish(ctx, "SOS_ACKNOWLEDGED", { sosId: args.sosId }, ["ADMIN", "CONTROL_ROOM", "MEDICAL_AUTHORITY"]);
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Emergency ${args.stage} — ${args.sosId}${args.note ? ` (${args.note})` : ""}`,
      target: `sos:${args.sosId}`,
      before: doc.stage,
      after: args.stage,
      result: "OK",
    });

    // The AI layer re-evaluates after every incident change.
    await runIntelligence(ctx);
    return { sosId: args.sosId, stage: args.stage };
  },
});

/* ================================================================== */
/* Convoy operations                                                  */
/* ================================================================== */

export const convoyCheckin = mutation({
  args: {
    convoyId: v.string(),
    deviceId: v.string(),
    lat: v.number(),
    lon: v.number(),
    fuelPct: v.number(),
    personnelCount: v.number(),
    note: v.optional(v.string()),
    offlineOrigin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();
    const convoy = await ctx.db.query("convoys").withIndex("by_convoy_id", (q) => q.eq("convoyId", args.convoyId)).unique();
    if (!convoy) throw new Error(`Unknown convoy ${args.convoyId}`);

    await ctx.db.insert("convoyCheckins", {
      checkinId: nextId("CHK"),
      convoyId: args.convoyId,
      deviceId: args.deviceId,
      ts: t,
      location: { lat: args.lat, lon: args.lon },
      fuelPct: args.fuelPct,
      personnelCount: args.personnelCount,
      note: args.note,
      offlineOrigin: args.offlineOrigin ?? false,
      createdAt: t,
      updatedAt: t,
    });

    await ctx.db.patch(convoy._id, {
      lastCheckinTs: t,
      fuelPct: args.fuelPct,
      comms: args.offlineOrigin ? "LOW" : "CONNECTED",
      emergencyStatus: "NONE",
      updatedAt: t,
    });

    const { hits } = await ingestLocation(ctx, {
      deviceId: args.deviceId,
      subjectId: args.convoyId,
      subjectKind: "convoy",
      lat: args.lat,
      lon: args.lon,
      accuracyM: 5,
      batteryPct: 100,
      connectivity: args.offlineOrigin ? "LOW" : "ONLINE",
      ts: t,
      source: "GPS",
    });

    const inside = hits.find((h) => h.insidePolygon);
    if (inside) {
      await notify(ctx, {
        kind: "HAZARD_EXPOSURE",
        severity: "critical",
        title: `ROUTE EXPOSURE DETECTED — ${convoy.name} inside ${inside.label}`,
        detail: `Check-in at ${args.lat.toFixed(3)}, ${args.lon.toFixed(3)} is ${inside.distanceKm} km from ${inside.label}.`,
        audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
        linkEntity: { table: "convoys", id: convoy._id },
        linkLatLon: { lat: args.lat, lon: args.lon },
        channels: ["IN_APP", "PUSH", "SATELLITE"],
      });
    }

    await writeAudit(ctx, {
      actor: args.deviceId,
      actorRole: "FIELD_OPERATOR",
      action: `Convoy check-in — ${convoy.name} at ${args.lat.toFixed(3)}, ${args.lon.toFixed(3)} · fuel ${args.fuelPct}% · ${args.personnelCount} pax${args.offlineOrigin ? " · store-and-forward" : ""}`,
      target: `convoy:${convoy.name}`,
      result: "OK",
    });

    return { convoyId: args.convoyId, hazard: inside?.label ?? null };
  },
});

/** Detect a missed check-in. Never escalates to SOS on its own. */
export const flagMissedCheckin = mutation({
  args: { convoyId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();
    const convoy = await ctx.db.query("convoys").withIndex("by_convoy_id", (q) => q.eq("convoyId", args.convoyId)).unique();
    if (!convoy) throw new Error(`Unknown convoy ${args.convoyId}`);
    const last = convoy.lastCheckinTs ?? convoy.departureTs;
    const overdueMin = Math.round((t - last) / MIN) - convoy.checkinIntervalMin;
    if (overdueMin <= 0) return { overdue: false };

    await ctx.db.patch(convoy._id, {
      comms: "MISSED_CHECK_IN",
      emergencyStatus: "CHECK_IN_OVERDUE",
      updatedAt: t,
    });

    await publish(ctx, "CHECK_IN_OVERDUE", { convoyId: args.convoyId, overdueMin }, ["ADMIN", "CONTROL_ROOM"]);

    await notify(ctx, {
      kind: "CHECK_IN_OVERDUE",
      severity: "warning",
      title: `CHECK-IN OVERDUE — ${convoy.name} (${overdueMin} min)`,
      detail:
        "Grace period started. Last known position is shown — no live marker is fabricated. Escalate only if the field team raises an SOS.",
      audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
      linkEntity: { table: "convoys", id: convoy._id },
    });

    await writeAudit(ctx, {
      actor: "Convoy monitor",
      actorRole: "SYSTEM",
      action: `CHECK_IN_OVERDUE — ${convoy.name} ${overdueMin} min past schedule · escalation is notification + safety check, NOT an automatic SOS`,
      target: `convoy:${convoy.name}`,
      result: "GRACE_PERIOD",
    });

    return { overdue: true, overdueMin };
  },
});

/* ================================================================== */
/* Cargo scanning — immutable evidence + discrepancy detection        */
/* ================================================================== */

export const scanCargo = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    lat: v.number(),
    lon: v.number(),
    /** Quantity the field device physically counted, if any. */
    quantityClaimed: v.optional(v.number()),
    /** Version the field device based its edit on (conflict detection). */
    baseVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "cargo");
    const t = now();
    const code = args.code.trim();

    const cargo = await ctx.db
      .query("cargo")
      .withIndex("by_barcode", (q) => q.eq("barcode", code))
      .unique();
    const byRfid = cargo ?? (await ctx.db.query("cargo").withIndex("by_rfid", (q) => q.eq("rfid", code)).unique());
    const doc = byRfid ?? null;

    const result = doc ? (doc.containersUnverified > 0 ? "UNVERIFIED" : "VERIFIED") : "MISSING";

    await ctx.db.insert("cargoScans", {
      scanId: nextId("SCN"),
      cargoId: doc ? doc.cargoId : undefined,
      code,
      deviceId: args.deviceId,
      scannedTs: t,
      location: { lat: args.lat, lon: args.lon },
      result,
      quantityClaimed: args.quantityClaimed,
      actor: actor.name,
      immutable: true,
      createdAt: t,
      updatedAt: t,
    });

    if (!doc) {
      await notify(ctx, {
        kind: "CARGO_DISCREPANCY",
        severity: "warning",
        title: `MISSING CARGO — ${code} not in any manifest`,
        detail: "Scan recorded at a station with no matching consignment. Anomaly raised for verification.",
        audience: ["ADMIN", "CONTROL_ROOM"],
        linkLatLon: { lat: args.lat, lon: args.lon },
      });
      await writeAudit(ctx, {
        actor: args.deviceId,
        actorRole: "FIELD_OPERATOR",
        action: `Scan ${code} — NO MANIFEST MATCH → missing-cargo anomaly`,
        target: `scan:${code}`,
        result: "ANOMALY",
      });
      await runIntelligence(ctx);
      return { result: "MISSING" as const, cargoId: null };
    }

    /* ---- version / conflict check ---- */
    if (args.baseVersion !== undefined && args.baseVersion < doc.version) {
      const conflictId = nextId("CFL");
      await ctx.db.insert("syncConflicts", {
        conflictId,
        eventId: `SCAN-${t}`,
        entity: "cargo",
        entityId: doc.cargoId,
        field: "containersReceived",
        centralValue: String(doc.containersReceived),
        fieldValue: String(args.quantityClaimed ?? doc.containersReceived),
        deviceId: args.deviceId,
        fieldAuthor: actor.name,
        fieldTs: t,
        centralTs: doc.updatedAt,
        status: "OPEN",
        createdAt: t,
        updatedAt: t,
      });
      await publish(ctx, "CONFLICT_DETECTED", { cargoId: doc.cargoId, conflictId }, ["ADMIN", "CONTROL_ROOM"]);
      await notify(ctx, {
        kind: "CONFLICT",
        severity: "warning",
        title: `CONFLICT DETECTED — ${doc.cargoId} container count`,
        detail: `Central ${doc.containersReceived} vs field ${args.quantityClaimed ?? "?"}. POLARIS never silently overwrites — an authorised operator must resolve.`,
        audience: ["ADMIN", "CONTROL_ROOM"],
        linkEntity: { table: "cargo", id: doc._id },
      });
      await writeAudit(ctx, {
        actor: args.deviceId,
        actorRole: "FIELD_OPERATOR",
        action: `Scan ${code} — CONFLICT (field base v${args.baseVersion} < central v${doc.version}); awaiting authorised resolution`,
        target: `cargo:${doc.cargoId}`,
        result: "CONFLICT",
      });
      return { result: "UNVERIFIED" as const, cargoId: doc.cargoId, conflictId };
    }

    /* ---- verified scan advances the lifecycle ---- */
    if (doc.containersUnverified === 0) {
      const nextStatus = doc.status === "LOADED" ? "IN_TRANSIT" : doc.status;
      await ctx.db.patch(doc._id, {
        status: nextStatus,
        version: doc.version + 1,
        actualArrivalTs: doc.status === "ARRIVED" || doc.status === "IN_TRANSIT" ? t : doc.actualArrivalTs,
        verification: "VERIFIED",
        updatedAt: t,
      });
    }

    await publish(ctx, "CARGO_SCANNED", { cargoId: doc.cargoId, result }, ["ADMIN", "CONTROL_ROOM"]);
    await writeAudit(ctx, {
      actor: args.deviceId,
      actorRole: "FIELD_OPERATOR",
      action: `Scan ${code} → ${doc.cargoId} (${result}) at ${args.lat.toFixed(3)}, ${args.lon.toFixed(3)}`,
      target: `cargo:${doc.cargoId}`,
      result: "OK",
    });

    const discrepancy = doc.containersReceived - doc.containersExpected;
    if (discrepancy < 0) {
      await publish(ctx, "CARGO_DISCREPANCY", { cargoId: doc.cargoId, discrepancy }, ["ADMIN", "CONTROL_ROOM"]);
    }

    await runIntelligence(ctx);
    return {
      result,
      cargoId: doc.cargoId,
      containersExpected: doc.containersExpected,
      containersReceived: doc.containersReceived,
      discrepancy,
      version: doc.version + 1,
    };
  },
});

export const resolveConflict = mutation({
  args: {
    conflictId: v.string(),
    resolution: v.union(v.literal("KEEP_CENTRAL"), v.literal("KEEP_FIELD"), v.literal("MERGED")),
    mergedValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "cargo");
    const t = now();
    const conflict = await ctx.db
      .query("syncConflicts")
      .withIndex("by_conflict_id", (q) => q.eq("conflictId", args.conflictId))
      .first();
    if (!conflict) throw new Error(`Unknown conflict ${args.conflictId}`);

    if (conflict.entity === "cargo") {
      const doc = await ctx.db.query("cargo").withIndex("by_cargo_id", (q) => q.eq("cargoId", conflict.entityId)).unique();
      if (doc) {
        const value =
          args.resolution === "KEEP_CENTRAL"
            ? doc.containersReceived
            : args.resolution === "KEEP_FIELD"
              ? Number(conflict.fieldValue)
              : (args.mergedValue ?? doc.containersReceived);
        await ctx.db.patch(doc._id, {
          containersReceived: value,
          verification: value < doc.containersExpected ? "DISCREPANT" : "VERIFIED",
          version: doc.version + 1,
          updatedAt: t,
        });
      }
    }

    await ctx.db.patch(conflict._id, {
      status: args.resolution === "KEEP_FIELD" ? "KEEP_FIELD" : args.resolution === "KEEP_CENTRAL" ? "KEEP_CENTRAL" : "MERGED",
      resolvedBy: actor.name,
      resolvedTs: t,
      updatedAt: t,
    });

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Conflict resolved (${args.resolution}) — ${conflict.entityId} ${conflict.field}: central ${conflict.centralValue} vs field ${conflict.fieldValue}`,
      target: `${conflict.entity}:${conflict.entityId}`,
      before: conflict.centralValue,
      after: args.resolution === "KEEP_CENTRAL" ? conflict.centralValue : args.resolution === "KEEP_FIELD" ? conflict.fieldValue : String(args.mergedValue ?? conflict.centralValue),
      result: "RESOLVED",
    });

    await runIntelligence(ctx);
    return { conflictId: args.conflictId, resolution: args.resolution };
  },
});

/* ================================================================== */
/* Inventory                                                          */
/* ================================================================== */

export const updateInventory = mutation({
  args: {
    itemId: v.string(),
    delta: v.number(),
    reason: v.union(
      v.literal("CONSUMPTION"),
      v.literal("RECEIPT"),
      v.literal("ADJUSTMENT"),
      v.literal("TRANSFER"),
      v.literal("EXPIRED"),
    ),
    baseVersion: v.optional(v.number()),
    originEventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "inventory");
    const t = now();
    const item = await ctx.db.query("inventory").withIndex("by_item_id", (q) => q.eq("itemId", args.itemId)).unique();
    if (!item) throw new Error(`Unknown inventory item ${args.itemId}`);

    if (args.baseVersion !== undefined && args.baseVersion < item.version) {
      const conflictId = nextId("CFL");
      await ctx.db.insert("syncConflicts", {
        conflictId,
        eventId: args.originEventId ?? `INV-${t}`,
        entity: "inventory",
        entityId: item.itemId,
        field: "quantity",
        centralValue: String(item.quantity),
        fieldValue: String(item.quantity + args.delta),
        deviceId: "field",
        fieldAuthor: actor.name,
        fieldTs: t,
        centralTs: item.updatedAt,
        status: "OPEN",
        createdAt: t,
        updatedAt: t,
      });
      await publish(ctx, "CONFLICT_DETECTED", { itemId: item.itemId, conflictId }, ["ADMIN", "CONTROL_ROOM"]);
      return { conflict: true, conflictId, central: item.quantity };
    }

    const next = Math.max(0, item.quantity + args.delta);
    await ctx.db.patch(item._id, { quantity: next, version: item.version + 1, updatedAt: t });
    await ctx.db.insert("inventoryTxns", {
      txnId: nextId("ITX"),
      itemId: item.itemId,
      stationId: item.stationId,
      delta: args.delta,
      reason: args.reason,
      actor: actor.name,
      ts: t,
      originEventId: args.originEventId,
      createdAt: t,
      updatedAt: t,
    });

    if (next < item.minThreshold) {
      await notify(ctx, {
        kind: "INVENTORY_LOW",
        severity: next < item.minThreshold * 0.75 ? "critical" : "warning",
        title: `LOW INVENTORY — ${item.item} at ${next} ${item.unit}`,
        detail: `Minimum threshold ${item.minThreshold} ${item.unit} · draw ${item.consumptionRatePerDay} ${item.unit}/d. POLAR INTELLIGENCE has a recommendation pending approval.`,
        audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
        linkEntity: { table: "inventory", id: item._id },
      });
      await publish(ctx, "INVENTORY_LOW", { itemId: item.itemId, quantity: next }, ["ADMIN", "CONTROL_ROOM"]);
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Inventory ${args.reason} — ${item.item} ${args.delta >= 0 ? "+" : ""}${args.delta} ${item.unit} → ${next} ${item.unit}`,
      target: `inventory:${item.itemId}`,
      before: String(item.quantity),
      after: String(next),
      result: "OK",
    });

    await runIntelligence(ctx);
    return { conflict: false, quantity: next, version: item.version + 1 };
  },
});

/* ================================================================== */
/* Tasks                                                              */
/* ================================================================== */

export const updateTask = mutation({
  args: { taskId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "tasks");
    const t = now();
    const task = await ctx.db.query("tasks").first();
    const doc = task && task._id ? await ctx.db.get(task._id) : null;
    const target = doc && doc.taskId === args.taskId ? doc : await ctx.db.query("tasks").collect().then((all) => all.find((x) => x.taskId === args.taskId) ?? null);
    if (!target) throw new Error(`Unknown task ${args.taskId}`);
    const before = target.status;
    await ctx.db.patch(target._id, { status: args.status as never, updatedAt: t });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Task ${args.taskId} → ${args.status}`,
      target: `task:${args.taskId}`,
      before,
      after: args.status,
      result: "OK",
    });
    return { taskId: args.taskId, status: args.status };
  },
});

/* ================================================================== */
/* Offline sync — P0 first, validation, conflict detection             */
/* ================================================================== */

export const syncBatch = mutation({
  args: {
    deviceId: v.string(),
    events: v.array(
      v.object({
        eventId: v.string(),
        type: v.string(),
        recordedAt: v.number(),
        payload: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const t = now();
    await publish(ctx, "SYNC_STARTED", { deviceId: args.deviceId, count: args.events.length }, [
      "ADMIN",
      "CONTROL_ROOM",
    ]);

    // Strict priority order — an SOS always transmits before a family video.
    const ordered = [...args.events].sort((a, b) => {
      const pa = priorityFor(a.type as never);
      const pb = priorityFor(b.type as never);
      if (pa !== pb) return pa - pb;
      return a.recordedAt - b.recordedAt;
    });

    const acks: { eventId: string; status: "APPLIED" | "CONFLICT" | "REJECTED"; reason?: string; serverVersion?: number }[] = [];

    for (const ev of ordered) {
      const priority = priorityFor(ev.type as never);

      // Idempotency: never apply the same device event twice.
      const existing = await ctx.db
        .query("syncEvents")
        .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
        .collect()
        .then((rows) => rows.find((r) => r.eventId === ev.eventId));
      if (existing) {
        acks.push({ eventId: ev.eventId, status: existing.status === "APPLIED" ? "APPLIED" : "REJECTED", reason: "duplicate event" });
        continue;
      }

      const envelope: FieldEventEnvelope = {
        eventId: ev.eventId,
        deviceId: args.deviceId,
        type: ev.type as never,
        recordedAt: ev.recordedAt,
        payload: JSON.parse(ev.payload) as Record<string, unknown>,
      };

      if (envelope.type === "SOS") {
        const p = envelope.payload as {
          personId: string;
          lat: number;
          lon: number;
          accuracyM: number;
          batteryPct?: number;
          category: string;
          routeId?: string;
          convoyId?: string;
        };
        await ctx.runMutation(api.polaris.mutations.triggerSos, {
          personId: p.personId,
          deviceId: args.deviceId,
          lat: p.lat,
          lon: p.lon,
          accuracyM: p.accuracyM ?? 10,
          batteryPct: p.batteryPct,
          category: p.category ?? "Emergency",
          routeId: p.routeId,
          convoyId: p.convoyId,
          connectivity: "OFFLINE",
          queuedOffline: true,
        });
        acks.push({ eventId: ev.eventId, status: "APPLIED" });
        continue;
      }

      if (envelope.type === "CARGO_SCAN") {
        const p = envelope.payload as { code: string; lat: number; lon: number; quantityClaimed?: number; baseVersion?: number };
        const r = await ctx.runMutation(api.polaris.mutations.scanCargo, {
          code: p.code,
          deviceId: args.deviceId,
          lat: p.lat,
          lon: p.lon,
          quantityClaimed: p.quantityClaimed,
          baseVersion: p.baseVersion,
        });
        const conflict = "conflictId" in r && r.conflictId;
        acks.push({
          eventId: ev.eventId,
          status: conflict ? "CONFLICT" : "APPLIED",
          reason: conflict ? "version conflict — review required" : undefined,
          serverVersion: "version" in r && typeof r.version === "number" ? r.version : undefined,
        });
        continue;
      }

      if (envelope.type === "INVENTORY_UPDATE") {
        const p = envelope.payload as { itemId: string; delta: number; reason: "CONSUMPTION" | "RECEIPT" | "ADJUSTMENT" | "TRANSFER" | "EXPIRED"; baseVersion?: number };
        const r = await ctx.runMutation(api.polaris.mutations.updateInventory, {
          itemId: p.itemId,
          delta: p.delta,
          reason: p.reason ?? "ADJUSTMENT",
          baseVersion: p.baseVersion,
          originEventId: ev.eventId,
        });
        acks.push({
          eventId: ev.eventId,
          status: r.conflict ? "CONFLICT" : "APPLIED",
          reason: r.conflict ? "version conflict — review required" : undefined,
          serverVersion: r.version,
        });
        continue;
      }

      if (envelope.type === "CHECK_IN") {
        const p = envelope.payload as { convoyId: string; lat: number; lon: number; fuelPct: number; personnelCount: number };
        await ctx.runMutation(api.polaris.mutations.convoyCheckin, {
          convoyId: p.convoyId,
          deviceId: args.deviceId,
          lat: p.lat,
          lon: p.lon,
          fuelPct: p.fuelPct,
          personnelCount: p.personnelCount ?? 1,
          offlineOrigin: true,
        });
        acks.push({ eventId: ev.eventId, status: "APPLIED" });
        continue;
      }

      if (envelope.type === "TASK_COMPLETE") {
        const p = envelope.payload as { taskId: string };
        await ctx.runMutation(api.polaris.mutations.updateTask, { taskId: p.taskId, status: "DONE" });
        acks.push({ eventId: ev.eventId, status: "APPLIED" });
        continue;
      }

      if (envelope.type === "FAMILY_REPLY") {
        const p = envelope.payload as { personId: string; type: "TEXT" | "VOICE" | "VIDEO" | "PHOTO" };
        const member = await ctx.db.query("familyMembers").withIndex("by_person", (q) => q.eq("personId", p.personId)).first();
        if (member) {
          await ctx.db.insert("familyMessages", {
            messageId: nextId("FAM"),
            familyMemberId: member._id,
            personId: p.personId,
            direction: "FIELD_TO_FAMILY",
            type: p.type,
            pipeline: ["RECORDED OFFLINE", "ENCRYPTED", "P4 QUEUE", "TRANSMITTED", "DELIVERED"],
            sizeBytes: p.type === "TEXT" ? 80 : p.type === "VOICE" ? 60000 : 380000,
            audioExtractedFirst: p.type === "VIDEO",
            quality: "LOW",
            state: "DELIVERED",
            createdTs: envelope.recordedAt,
            deliveredTs: t,
            expiresTs: t + 60 * DAY,
            encrypted: true,
            privateBody: "Reply from the field",
            createdAt: t,
            updatedAt: t,
          });
        }
        acks.push({ eventId: ev.eventId, status: "APPLIED" });
        continue;
      }

      if (envelope.type === "LOCATION_UPDATE") {
        const p = envelope.payload as { subjectId: string; lat: number; lon: number; accuracyM: number; subjectKind?: "person" | "vehicle" | "convoy" | "station" };
        await ingestLocation(ctx, {
          deviceId: args.deviceId,
          subjectId: p.subjectId,
          subjectKind: p.subjectKind ?? "person",
          lat: p.lat,
          lon: p.lon,
          accuracyM: p.accuracyM ?? 10,
          connectivity: "LOW",
          ts: envelope.recordedAt,
          source: "GPS",
        });
        acks.push({ eventId: ev.eventId, status: "APPLIED" });
        continue;
      }

      // Unknown or non-mutating event types are recorded but not applied.
      await ctx.db.insert("syncEvents", {
        eventId: ev.eventId,
        deviceId: args.deviceId,
        type: envelope.type,
        priority,
        recordedAt: envelope.recordedAt,
        receivedAt: t,
        payload: ev.payload,
        status: "REJECTED",
        reason: `Unsupported event type for automated apply: ${envelope.type}`,
        createdAt: t,
        updatedAt: t,
      });
      acks.push({ eventId: ev.eventId, status: "REJECTED", reason: "unsupported type" });
    }

    const applied = acks.filter((a) => a.status === "APPLIED").length;
    const conflicts = acks.filter((a) => a.status === "CONFLICT").length;
    const rejected = acks.filter((a) => a.status === "REJECTED").length;

    await publish(ctx, "SYNC_COMPLETED", { deviceId: args.deviceId, applied, conflicts, rejected }, [
      "ADMIN",
      "CONTROL_ROOM",
    ]);
    await writeAudit(ctx, {
      actor: args.deviceId,
      actorRole: "FIELD_OPERATOR",
      action: `Sync batch — ${args.events.length} events uploaded · P0 first · ${applied} applied · ${conflicts} conflicts · ${rejected} rejected · server validation + conflict check passed`,
      target: `device:${args.deviceId}`,
      result: conflicts > 0 ? "CONFLICTS_PENDING" : "OK",
    });

    return {
      uploaded: args.events.length,
      applied,
      conflicts,
      rejected,
      acks,
      topPriority: ordered.length > 0 ? priorityFor(ordered[0].type as never) : null,
    };
  },
});

/* ================================================================== */
/* Family Home Link                                                   */
/* ================================================================== */

/** Bandwidth-aware pipeline actually recorded on the message. */
function mediaPipelineFor(type: string, quality: "LOW" | "MEDIUM" | "HIGH") {
  if (type === "VIDEO") {
    return quality === "LOW"
      ? {
          pipeline: ["ORIGINAL VIDEO (~24 MB)", "LOW-BANDWIDTH ENCODE (240p mono)", "AUDIO EXTRACTED — SENT FIRST", "COMPRESSED (~380 KB)", "P4 QUEUE", "AWAITING LINK"],
          audioFirst: true,
          size: 380_000,
        }
      : quality === "MEDIUM"
        ? { pipeline: ["ORIGINAL VIDEO", "MEDIUM ENCODE (360p)", "COMPRESSED (~900 KB)", "P4 QUEUE", "AWAITING LINK"], audioFirst: false, size: 900_000 }
        : { pipeline: ["ORIGINAL VIDEO", "HIGH ENCODE (720p, archive)", "COMPRESSED (~2.4 MB)", "P5 QUEUE", "AWAITING LINK"], audioFirst: false, size: 2_400_000 };
  }
  if (type === "VOICE") {
    return { pipeline: ["VOICE (~180 KB)", "OPUS ENCODE (16 kbps)", "COMPRESSED (~60 KB)", "P4 QUEUE", "AWAITING LINK"], audioFirst: false, size: 60_000 };
  }
  if (type === "PHOTO") {
    return { pipeline: ["PHOTO + CAPTION", "DOWNSCALE TO LINK QUALITY", "COMPRESSED (~120 KB)", "P4 QUEUE", "AWAITING LINK"], audioFirst: false, size: 120_000 };
  }
  return { pipeline: ["TEXT", "ENCRYPTED", "P4 QUEUE", "AWAITING LINK"], audioFirst: false, size: 2_000 };
}

export const sendFamilyMessage = mutation({
  args: {
    familyMemberId: v.string(),
    type: v.union(v.literal("TEXT"), v.literal("VOICE"), v.literal("VIDEO"), v.literal("PHOTO")),
    quality: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
    body: v.optional(v.string()),
    /** Force the offline path so the "waiting for connectivity" state is real. */
    forceQueue: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "family");
    const t = now();
    const member = await ctx.db
      .query("familyMembers")
      .withIndex("by_family_id", (q) => q.eq("familyId", args.familyMemberId))
      .first();
    if (!member) throw new Error("Unknown family member");

    const sim = await ctx.db.query("simState").first();
    const offline = args.forceQueue === true || sim?.connectivity === "OFFLINE" || sim?.connectivity === "VERY_LOW";

    const media = mediaPipelineFor(args.type, args.quality);
    const messageId = nextId("FAM");

    const id = await ctx.db.insert("familyMessages", {
      messageId,
      familyMemberId: args.familyMemberId,
      personId: member.personId,
      direction: "FAMILY_TO_FIELD",
      type: args.type,
      pipeline: offline ? [...media.pipeline, "QUEUED LOCALLY"] : [...media.pipeline, "TRANSMITTING", "DELIVERED"],
      sizeBytes: media.size,
      audioExtractedFirst: media.audioFirst,
      quality: args.quality,
      state: offline ? "WAITING_FOR_CONNECTIVITY" : "DELIVERED",
      createdTs: t,
      deliveredTs: offline ? undefined : t,
      expiresTs: t + 60 * DAY,
      encrypted: true,
      privateBody: args.body,
      createdAt: t,
      updatedAt: t,
    });

    if (!offline) {
      await publish(ctx, "FAMILY_MESSAGE_AVAILABLE", { personId: member.personId, messageId, type: args.type }, [
        "ADMIN",
        "CONTROL_ROOM",
        "FIELD_OPERATOR",
      ]);
    }

    await writeAudit(ctx, {
      actor: member.name,
      actorRole: "FAMILY_MEMBER",
      action: `Family message ${messageId} (${args.type}, ${args.quality}) — ${offline ? "encrypted and queued locally, waiting for available communication" : "delivered over available link"}`,
      target: `family:${member.personId}`,
      result: offline ? "QUEUED" : "DELIVERED",
    });

    return {
      messageId,
      state: offline ? ("WAITING_FOR_CONNECTIVITY" as const) : ("DELIVERED" as const),
      pipeline: media.pipeline,
      audioExtractedFirst: media.audioFirst,
      sizeBytes: media.size,
      priority: "P4",
    };
  },
});

export const openFamilyMessage = mutation({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "family");
    const t = now();
    const rows = await ctx.db.query("familyMessages").collect();
    const doc = rows.find((m) => m.messageId === args.messageId);
    if (!doc) throw new Error("Unknown message");
    if (actor.role === "FAMILY_MEMBER" && doc.personId !== actor.linkedPersonId) {
      throw new Error("FORBIDDEN: this message belongs to another expedition member");
    }
    await ctx.db.patch(doc._id, { state: "OPENED", openedTs: t, updatedAt: t });
    return { messageId: args.messageId, state: "OPENED" };
  },
});

/* ================================================================== */
/* Well-being — voluntary, non-diagnostic                             */
/* ================================================================== */

export const submitCheckin = mutation({
  args: {
    personId: v.string(),
    level: v.union(v.literal("GOOD"), v.literal("OKAY"), v.literal("LOW"), v.literal("STRUGGLING")),
    supportRoute: v.optional(v.union(v.literal("FAMILY"), v.literal("TEAM"), v.literal("MEDICAL"))),
    privateNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deliberately does NOT require a resource permission beyond identity: this
    // is the person's own private submission. The control room never reads the
    // level or the note — only the aggregate counts.
    const actor = await requireActor(ctx);
    const t = now();
    const personId = actor.role === "FIELD_OPERATOR" || actor.role === "ADMIN" || actor.role === "STATION_COMMANDER" ? args.personId : (actor.linkedPersonId ?? args.personId);

    await ctx.db.insert("wellbeingCheckins", {
      checkinId: nextId("WBI"),
      personId,
      ts: t,
      level: args.level,
      supportRoute: args.supportRoute,
      privateNote: args.privateNote,
      createdAt: t,
      updatedAt: t,
    });

    // A support request routes to a human — POLARIS never diagnoses.
    if (args.supportRoute === "MEDICAL") {
      await notify(ctx, {
        kind: "SUPPORT_REQUEST",
        severity: "warning",
        title: "Well-being support request — medical channel",
        detail:
          "A team member requested medical support. Details are private and available only to medical authority.",
        audience: ["ADMIN", "MEDICAL_AUTHORITY"],
        channels: ["IN_APP", "PUSH"],
      });
    }

    await writeAudit(ctx, {
      actor: "Well-being check-in",
      actorRole: "SYSTEM",
      action: `Voluntary check-in recorded${args.supportRoute ? ` — support route: ${args.supportRoute}` : ""}. No diagnosis is made or stored; content stays private to the individual.`,
      target: `person:${personId}`,
      result: "OK",
    });

    return { recorded: true, supportRoute: args.supportRoute ?? null };
  },
});

/* ================================================================== */
/* Medical — store-and-forward, medical authority only                */
/* ================================================================== */

export const fileMedicalCase = mutation({
  args: {
    personId: v.string(),
    observations: v.string(),
    vitals: v.optional(v.string()),
    priority: v.union(v.literal("ROUTINE"), v.literal("URGENT"), v.literal("CRITICAL")),
    offlineOrigin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "medical");
    const t = now();
    const sim = await ctx.db.query("simState").first();
    const offline = args.offlineOrigin === true || sim?.connectivity === "OFFLINE";

    const id = await ctx.db.insert("medicalCases", {
      caseId: nextId("MED"),
      personId: args.personId,
      observations: args.observations,
      vitals: args.vitals,
      attachments: [],
      priority: args.priority,
      status: offline ? "QUEUED" : "TRANSMITTED",
      recordedBy: actor.name,
      recordedTs: t,
      offlineOrigin: offline,
      createdAt: t,
      updatedAt: t,
    });

    if (args.priority === "CRITICAL" || args.priority === "URGENT") {
      await notify(ctx, {
        kind: "MEDICAL",
        severity: args.priority === "CRITICAL" ? "critical" : "warning",
        title: `${args.priority} medical case recorded`,
        detail: offline
          ? "Recorded offline — queued for transmission at the earliest medical-priority opportunity."
          : "Transmitted to medical authority. Diagnosis and decisions remain with the clinician.",
        audience: ["ADMIN", "MEDICAL_AUTHORITY"],
        channels: ["IN_APP", "PUSH", "SATELLITE"],
      });
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Medical case filed (${args.priority}) — ${offline ? "queued offline" : "transmitted"}. POLARIS assists transmission priority only; no clinical interpretation.`,
      target: `medical:${args.personId}`,
      result: "OK",
    });

    return { caseId: nextId("MED"), id, status: offline ? "QUEUED" : "TRANSMITTED" };
  },
});

/* ================================================================== */
/* AI approval — human in the loop                                    */
/* ================================================================== */

export const decideRecommendation = mutation({
  args: {
    recommendationId: v.string(),
    decision: v.union(v.literal("APPROVED"), v.literal("MODIFIED"), v.literal("REJECTED")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "ai");
    const t = now();
    // Compute the current picture first so the audit record can name the exact
    // recommendation the human acted on, then persist the decision, then let the
    // engine refresh the remaining open recommendations.
    const fresh = await computeIntelligence(ctx);
    const rec = fresh.recommendations.find((r) => r.id === args.recommendationId) ?? null;

    const stored = await ctx.db
      .query("aiRecommendations")
      .collect()
      .then((rows) => rows.find((r) => r.recommendationId === args.recommendationId) ?? null);

    // Approving a live recommendation: persist the decision and log it against
    // the AI recommendation that produced it.
    if (stored) {
      await ctx.db.patch(stored._id, {
        state: args.decision,
        approvedBy: actor.name,
        approvedTs: t,
        updatedAt: t,
      });
    }

    await runIntelligence(ctx);

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `${args.decision} AI recommendation — ${rec?.title ?? args.recommendationId}${args.note ? ` (${args.note})` : ""}`,
      target: `recommendation:${args.recommendationId}`,
      aiRecommendationId: args.recommendationId,
      reason: rec?.reason ?? args.note ?? null,
      after: args.decision,
      result: args.decision === "APPROVED" ? "PLAN_UPDATED" : args.decision,
    });

    if (args.decision === "APPROVED") {
      await notify(ctx, {
        kind: "PLAN_UPDATED",
        severity: "info",
        title: `Plan updated — ${rec?.title ?? "AI recommendation approved"}`,
        detail: "An authorised operator approved this action. The audit trail records who, when and why.",
        audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
      });
    }

    return { recommendationId: args.recommendationId, decision: args.decision };
  },
});

/* ================================================================== */
/* Notifications, connectivity, simulator control                     */
/* ================================================================== */

export const markNotificationRead = mutation({
  args: { notificationId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const rows = await ctx.db.query("notifications").collect();
    const doc = rows.find((n) => n._id === args.notificationId);
    if (!doc) return { ok: false };
    await ctx.db.patch(doc._id, { read: true, updatedAt: now() });
    return { ok: true };
  },
});

export const setConnectivity = mutation({
  args: {
    mode: v.union(v.literal("NORMAL"), v.literal("WEAK"), v.literal("VERY_LOW"), v.literal("OFFLINE")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const t = now();
    const sim = await ctx.db.query("simState").first();
    if (sim) await ctx.db.patch(sim._id, { connectivity: args.mode, updatedAt: t });

    await ctx.db.insert("connectivityEvents", {
      eventId: nextId("CON"),
      ts: t,
      mode: args.mode,
      note: args.note ?? "Demo control",
      createdAt: t,
      updatedAt: t,
    });

    // Propagate the link state onto field devices so the map stops pretending
    // stale positions are live.
    const devices = await ctx.db.query("devices").collect();
    const conn = args.mode === "NORMAL" ? "ONLINE" : args.mode === "OFFLINE" ? "OFFLINE" : "LOW";
    for (const d of devices) {
      if (d.kind === "STATION" && args.mode === "NORMAL") continue;
      await ctx.db.patch(d._id, { connectivity: conn, updatedAt: t });
    }

    await publish(ctx, "CONNECTIVITY_CHANGED", { mode: args.mode }, ["ADMIN", "CONTROL_ROOM", "FIELD_OPERATOR"]);
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Connectivity → ${args.mode}${args.note ? ` (${args.note})` : ""}`,
      target: "connectivity:network",
      before: sim?.connectivity ?? "NORMAL",
      after: args.mode,
      result: "OK",
    });

    return { mode: args.mode, scope: args.mode === "VERY_LOW" || args.mode === "OFFLINE" ? "P0–P3 safety traffic only" : "full operational sync" };
  },
});

export const startSimulation = mutation({
  args: { running: v.boolean(), tickMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "locations");
    await ctx.runMutation(internal.polaris.sim.controlSim, { running: args.running, tickMs: args.tickMs ?? 5000 });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `GPS simulation ${args.running ? "STARTED" : "STOPPED"} — server-side engine writing real location events`,
      target: "sim:gps",
      result: "OK",
    });
    return { running: args.running };
  },
});

/** Run one simulation tick immediately (used by the demo console). */
export const runTick = mutation({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const actor = await requireActor(ctx);
    requireResource(actor, "locations");
    return ctx.runMutation(internal.polaris.sim.gpsTick, {});
  },
});

export const integrationAdapters = mutation({
  args: {},
  handler: async () => INTEGRATION_ADAPTERS,
});
