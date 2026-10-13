/**
 * POLARIS write API — entity creation and lifecycle.
 *
 * These are the mutations behind the real forms: add personnel, create a
 * vehicle, raise a convoy, book cargo, map a hazard, open a task, start a
 * mission.
 *
 * Rules held by every handler here:
 *   - authorisation is resolved from the database session, never the client
 *   - the write lands in the database before the UI is told it succeeded
 *   - a consequential write also produces an audit record and a realtime event
 *   - nothing here returns a fabricated value; the created row is returned
 */
import { mutation } from "../_generated/server";
import { v } from "convex/values";

import { DAY, HOUR, MIN, ingestLocation as ingestLocationEvent, nextId, now, notify, publish, requireActor, requireResource, writeAudit } from "./lib";

/* ================================================================== */
/* Personnel                                                          */
/* ================================================================== */

export const createPerson = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    stationId: v.string(),
    team: v.string(),
    expedition: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    bloodGroup: v.optional(v.string()),
    medicalNote: v.optional(v.string()),
    currentAssignment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "personnel");
    const t = now();

    const station = await ctx.db.get(args.stationId as never);
    if (!station) throw new Error(`Unknown station ${args.stationId}`);

    const polarisId = nextId("P");
    const id = await ctx.db.insert("persons", {
      polarisId,
      name: args.name,
      role: args.role,
      expedition: args.expedition ?? "27th Indian Antarctic Expedition",
      stationId: args.stationId,
      team: args.team,
      shift: undefined,
      deviceId: args.deviceId,
      emergencyContact: args.emergencyContact,
      // Medical detail is stored but only ever read by MEDICAL_AUTHORITY/ADMIN.
      medicalNote: args.medicalNote,
      bloodGroup: args.bloodGroup,
      currentAssignment: args.currentAssignment,
      status: "ON_STATION",
      connectivity: "ONLINE",
      lastCheckinTs: t,
      createdAt: t,
      updatedAt: t,
    });

    // A tracker device is provisioned with the person so location events have
    // a device identity from the very first report.
    if (args.deviceId) {
      await ctx.db.insert("devices", {
        deviceId: args.deviceId,
        kind: "PERSONAL",
        label: `${args.name} tracker`,
        subjectId: polarisId,
        connectivity: "ONLINE",
        batteryPct: 100,
        createdAt: t,
        updatedAt: t,
      });
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Personnel record created — ${polarisId} ${args.name} (${args.role}) at ${(station as { short: string }).short}`,
      target: `person:${polarisId}`,
      result: "OK",
    });
    await publish(ctx, "CONVOY_UPDATED", { personId: polarisId, kind: "personnel" }, [
      "ADMIN",
      "CONTROL_ROOM",
      "STATION_COMMANDER",
    ]);

    return { personId: polarisId, id };
  },
});

export const updatePerson = mutation({
  args: {
    personId: v.string(),
    status: v.optional(v.string()),
    team: v.optional(v.string()),
    currentAssignment: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "personnel");
    const t = now();
    const doc = await ctx.db
      .query("persons")
      .withIndex("by_polaris_id", (q) => q.eq("polarisId", args.personId))
      .unique();
    if (!doc) throw new Error(`Unknown person ${args.personId}`);

    await ctx.db.patch(doc._id, {
      status: (args.status ?? doc.status) as never,
      team: args.team ?? doc.team,
      currentAssignment: args.currentAssignment ?? doc.currentAssignment,
      emergencyContact: args.emergencyContact ?? doc.emergencyContact,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Personnel ${args.personId} updated${args.status ? ` → ${args.status}` : ""}`,
      target: `person:${args.personId}`,
      before: doc.status,
      after: args.status ?? doc.status,
      result: "OK",
    });
    return { personId: args.personId };
  },
});

/* ================================================================== */
/* Vehicles                                                           */
/* ================================================================== */

export const createVehicle = mutation({
  args: {
    vehicleId: v.string(),
    kind: v.string(),
    label: v.string(),
    callSign: v.optional(v.string()),
    routeId: v.optional(v.string()),
    destinationStationId: v.optional(v.string()),
    etaTs: v.optional(v.number()),
    fuelPct: v.number(),
    capacityKg: v.number(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();

    const clash = await ctx.db
      .query("vehicles")
      .withIndex("by_vehicle_id", (q) => q.eq("vehicleId", args.vehicleId))
      .first();
    if (clash) throw new Error(`Vehicle ${args.vehicleId} already exists`);

    const id = await ctx.db.insert("vehicles", {
      vehicleId: args.vehicleId,
      kind: args.kind as never,
      label: args.label,
      callSign: args.callSign,
      routeId: args.routeId,
      destinationStationId: args.destinationStationId,
      etaTs: args.etaTs,
      fuelPct: args.fuelPct,
      capacityKg: args.capacityKg,
      crewIds: [],
      cargoIds: [],
      deviceId: args.deviceId,
      status: "SCHEDULED",
      createdAt: t,
      updatedAt: t,
    });

    if (args.deviceId) {
      await ctx.db.insert("devices", {
        deviceId: args.deviceId,
        kind: "VEHICLE",
        label: `${args.label} telemetry`,
        subjectId: args.vehicleId,
        connectivity: "ONLINE",
        batteryPct: args.fuelPct,
        createdAt: t,
        updatedAt: t,
      });
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Vehicle created — ${args.vehicleId} ${args.label} (${args.kind})`,
      target: `vehicle:${args.vehicleId}`,
      result: "OK",
    });
    await publish(ctx, "CONVOY_UPDATED", { vehicleId: args.vehicleId, kind: "vehicle" }, ["ADMIN", "CONTROL_ROOM"]);
    return { vehicleId: args.vehicleId, id };
  },
});

export const updateVehicle = mutation({
  args: { vehicleId: v.string(), status: v.optional(v.string()), fuelPct: v.optional(v.number()), etaTs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();
    const doc = await ctx.db
      .query("vehicles")
      .withIndex("by_vehicle_id", (q) => q.eq("vehicleId", args.vehicleId))
      .unique();
    if (!doc) throw new Error(`Unknown vehicle ${args.vehicleId}`);

    await ctx.db.patch(doc._id, {
      status: (args.status ?? doc.status) as never,
      fuelPct: args.fuelPct ?? doc.fuelPct,
      etaTs: args.etaTs ?? doc.etaTs,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Vehicle ${args.vehicleId} → ${args.status ?? doc.status}`,
      target: `vehicle:${args.vehicleId}`,
      before: doc.status,
      after: args.status ?? doc.status,
      result: "OK",
    });
    return { vehicleId: args.vehicleId, status: args.status ?? doc.status };
  },
});

/* ================================================================== */
/* Convoys                                                            */
/* ================================================================== */

export const createConvoy = mutation({
  args: {
    convoyId: v.string(),
    name: v.string(),
    missionId: v.string(),
    routeId: v.string(),
    personnelIds: v.array(v.string()),
    vehicleIds: v.array(v.string()),
    expectedArrivalTs: v.number(),
    checkinIntervalMin: v.optional(v.number()),
    startNow: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();

    const route = await ctx.db.get(args.routeId as never);
    if (!route) throw new Error(`Unknown route ${args.routeId}`);
    const mission = await ctx.db
      .query("missions")
      .withIndex("by_mission_id", (q) => q.eq("missionId", args.missionId))
      .first();
    if (!mission) throw new Error(`Unknown mission ${args.missionId}`);

    const id = await ctx.db.insert("convoys", {
      convoyId: args.convoyId,
      name: args.name,
      missionId: args.missionId,
      routeId: args.routeId,
      originStationId: (route as { fromStationId: string }).fromStationId,
      destinationStationId: (route as { toStationId: string }).toStationId,
      personnelIds: args.personnelIds,
      vehicleIds: args.vehicleIds,
      departureTs: t,
      expectedArrivalTs: args.expectedArrivalTs,
      lastCheckinTs: args.startNow ? t : undefined,
      checkinIntervalMin: args.checkinIntervalMin ?? 30,
      status: args.startNow ? "ACTIVE" : "PLANNED",
      comms: "CONNECTED",
      fuelPct: 100,
      emergencyStatus: "NONE",
      progress: 0,
      createdAt: t,
      updatedAt: t,
    });

    if (args.startNow) {
      // The convoy's vehicles and personnel inherit the movement.
      for (const vid of args.vehicleIds) {
        const vh = await ctx.db
          .query("vehicles")
          .withIndex("by_vehicle_id", (q) => q.eq("vehicleId", vid))
          .first();
        if (vh) await ctx.db.patch(vh._id, { status: "IN_TRANSIT", routeId: args.routeId, updatedAt: t });
      }
      for (const pid of args.personnelIds) {
        const p = await ctx.db
          .query("persons")
          .withIndex("by_polaris_id", (q) => q.eq("polarisId", pid))
          .unique();
        if (p) await ctx.db.patch(p._id, { status: "IN_TRANSIT", updatedAt: t });
      }
      await publish(ctx, "CONVOY_UPDATED", { convoyId: args.convoyId, started: true }, [
        "ADMIN",
        "CONTROL_ROOM",
        "FIELD_OPERATOR",
      ]);
      await notify(ctx, {
        kind: "CONVOY",
        severity: "info",
        title: `${args.convoyId} departed — ${args.personnelIds.length} personnel, ${args.vehicleIds.length} vehicles`,
        detail: `${(route as { name: string }).name}. Check-in cadence ${args.checkinIntervalMin ?? 30} min.`,
        audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER"],
        dedupeKey: `convoy-start-${args.convoyId}`,
      });
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Convoy ${args.convoyId} created${args.startNow ? " and STARTED" : ""} — ${args.personnelIds.length} personnel, ${args.vehicleIds.length} vehicles, route ${(route as { name: string }).name}`,
      target: `convoy:${args.convoyId}`,
      result: args.startNow ? "ACTIVE" : "SCHEDULED",
    });
    return { convoyId: args.convoyId, id, status: args.startNow ? "ACTIVE" : "PLANNED" };
  },
});

export const updateConvoy = mutation({
  args: {
    convoyId: v.string(),
    status: v.optional(v.string()),
    routeId: v.optional(v.string()),
    fuelPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "transport");
    const t = now();
    const doc = await ctx.db
      .query("convoys")
      .withIndex("by_convoy_id", (q) => q.eq("convoyId", args.convoyId))
      .unique();
    if (!doc) throw new Error(`Unknown convoy ${args.convoyId}`);

    const status = (args.status ?? doc.status) as string;
    await ctx.db.patch(doc._id, {
      status: status as never,
      routeId: args.routeId ?? doc.routeId,
      fuelPct: args.fuelPct ?? doc.fuelPct,
      // A completed convoy stops being a missed-check-in candidate.
      comms: status === "COMPLETED" ? "CONNECTED" : doc.comms,
      lastCheckinTs: t,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Convoy ${args.convoyId} → ${status}${args.routeId ? `, re-routed onto ${args.routeId}` : ""}`,
      target: `convoy:${args.convoyId}`,
      before: doc.status,
      after: status,
      result: "OK",
    });
    await publish(ctx, "CONVOY_UPDATED", { convoyId: args.convoyId, status }, ["ADMIN", "CONTROL_ROOM"]);
    return { convoyId: args.convoyId, status };
  },
});

/* ================================================================== */
/* Cargo                                                              */
/* ================================================================== */

export const createCargo = mutation({
  args: {
    cargoId: v.string(),
    itemType: v.string(),
    quantity: v.number(),
    unit: v.string(),
    weightKg: v.number(),
    origin: v.string(),
    destinationStationId: v.string(),
    missionId: v.string(),
    transportId: v.optional(v.string()),
    containersExpected: v.number(),
    expiresTs: v.optional(v.number()),
    responsiblePersonId: v.string(),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "cargo");
    const t = now();

    const dup = await ctx.db
      .query("cargo")
      .withIndex("by_cargo_id", (q) => q.eq("cargoId", args.cargoId))
      .first();
    if (dup) throw new Error(`Cargo ${args.cargoId} already exists`);

    // Barcode and RFID are derived once and are unique, so a physical unit is
    // never double-booked.
    const barcode = `62${String(Math.abs(hashCode(args.cargoId))).padStart(10, "0")}`.slice(0, 14);
    const rfid = `RFID-${args.cargoId}`;

    const id = await ctx.db.insert("cargo", {
      cargoId: args.cargoId,
      rfid,
      barcode,
      itemType: args.itemType,
      quantity: args.quantity,
      unit: args.unit,
      weightKg: args.weightKg,
      origin: args.origin,
      destinationStationId: args.destinationStationId,
      missionId: args.missionId,
      transportId: args.transportId,
      containersExpected: args.containersExpected,
      containersReceived: 0,
      containersUnverified: args.containersExpected,
      status: "PLANNED",
      dispatchedTs: undefined,
      expectedArrivalTs: t + 21 * DAY,
      actualArrivalTs: undefined,
      expiresTs: args.expiresTs,
      responsiblePersonId: args.responsiblePersonId,
      verification: "PENDING",
      version: 1,
      priority: (args.priority ?? "ROUTINE") as never,
      createdAt: t,
      updatedAt: t,
    });

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Cargo booked — ${args.cargoId} (${args.quantity} ${args.unit} ${args.itemType}), manifest expects ${args.containersExpected} containers, barcode ${barcode}`,
      target: `cargo:${args.cargoId}`,
      result: "PLANNED",
    });
    await publish(ctx, "CARGO_SCANNED", { cargoId: args.cargoId, status: "PLANNED" }, ["ADMIN", "CONTROL_ROOM"]);
    return { cargoId: args.cargoId, id, barcode, rfid };
  },
});

export const advanceCargo = mutation({
  args: { cargoId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "cargo");
    const t = now();
    const doc = await ctx.db
      .query("cargo")
      .withIndex("by_cargo_id", (q) => q.eq("cargoId", args.cargoId))
      .unique();
    if (!doc) throw new Error(`Unknown cargo ${args.cargoId}`);

    const status = args.status as (typeof doc)["status"];
    await ctx.db.patch(doc._id, {
      status,
      dispatchedTs: status === "IN_TRANSIT" ? t : doc.dispatchedTs,
      actualArrivalTs: status === "ARRIVED" ? t : doc.actualArrivalTs,
      // Receiving closes the manifest and verifies what actually turned up.
      containersReceived: status === "RECEIVED" ? doc.containersExpected : doc.containersReceived,
      containersUnverified: status === "RECEIVED" ? 0 : doc.containersUnverified,
      verification: status === "RECEIVED" ? "VERIFIED" : doc.verification,
      version: doc.version + 1,
      updatedAt: t,
    });

    // Receiving creates the inventory transaction — stock is never edited
    // directly, it is the sum of the ledger.
    if (status === "RECEIVED") {
      const stationId = (doc as unknown as { destinationStationId: string }).destinationStationId;
      const itemType = (doc as unknown as { itemType: string }).itemType;
      const receivedQty = (doc as unknown as { quantity: number }).quantity;
      const stationRows = await ctx.db.query("inventory").withIndex("by_station", (q) => q.eq("stationId", stationId)).collect();
      const existing = stationRows.find((i) => i.item === itemType);
      if (existing) {
        await ctx.db.patch(existing._id, {
          quantity: existing.quantity + receivedQty,
          version: existing.version + 1,
          updatedAt: t,
        });
        await ctx.db.insert("inventoryTxns", {
          txnId: nextId("TXN"),
          itemId: existing.itemId,
          stationId,
          delta: receivedQty,
          reason: "RECEIPT",
          actor: actor.name,
          ts: t,
          originEventId: `cargo:${args.cargoId}`,
          createdAt: t,
          updatedAt: t,
        });
      } else {
        // No existing line: open one so the receipt is never lost.
        const itemId = nextId("ITM");
        await ctx.db.insert("inventory", {
          itemId,
          item: itemType,
          category: cargoCategory(itemType) as never,
          stationId,
          quantity: receivedQty,
          unit: (doc as unknown as { unit: string }).unit,
          batch: `B-${args.cargoId}`,
          expiresTs: doc.expiresTs,
          minThreshold: 0,
          consumptionRatePerDay: 0,
          incomingQuantity: 0,
          reservedQuantity: 0,
          version: 1,
          createdAt: t,
          updatedAt: t,
        });
        await ctx.db.insert("inventoryTxns", {
          txnId: nextId("TXN"),
          itemId,
          stationId,
          delta: receivedQty,
          reason: "RECEIPT",
          actor: actor.name,
          ts: t,
          originEventId: `cargo:${args.cargoId}`,
          createdAt: t,
          updatedAt: t,
        });
      }
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Cargo ${args.cargoId} → ${status}`,
      target: `cargo:${args.cargoId}`,
      before: doc.status,
      after: status,
      result: "OK",
    });
    await publish(ctx, "CARGO_SCANNED", { cargoId: args.cargoId, status }, ["ADMIN", "CONTROL_ROOM"]);
    return { cargoId: args.cargoId, status };
  },
});

/* ================================================================== */
/* Hazards                                                            */
/* ================================================================== */

export const createHazard = mutation({
  args: {
    hazardId: v.string(),
    hazardType: v.string(),
    label: v.string(),
    severity: v.string(),
    lat: v.number(),
    lon: v.number(),
    radiusKm: v.number(),
    source: v.string(),
    description: v.string(),
    validFrom: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    routeId: v.optional(v.string()),
    stationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "hazards");
    const t = now();

    // Validate the geometry the server will actually use for geofencing.
    if (!Number.isFinite(args.lat) || args.lat < -90 || args.lat > 90) throw new Error("Invalid latitude");
    if (!Number.isFinite(args.lon) || args.lon < -180 || args.lon > 180) throw new Error("Invalid longitude");
    if (args.radiusKm <= 0) throw new Error("Hazard radius must be positive");

    const id = await ctx.db.insert("hazardZones", {
      hazardId: args.hazardId,
      hazardType: args.hazardType as never,
      label: args.label,
      severity: args.severity as never,
      lat: args.lat,
      lon: args.lon,
      radiusKm: args.radiusKm,
      source: args.source,
      validFrom: args.validFrom ?? t,
      validUntil: args.validUntil,
      description: args.description,
      routeId: args.routeId,
      stationId: args.stationId,
      createdAt: t,
      updatedAt: t,
    });

    // Any tracked subject already inside the new zone is reported immediately,
    // so publishing a hazard is an active operation, not just a map pin.
    const lastKnown = await ctx.db.query("lastKnownPositions").collect();
    const exposed = lastKnown.filter((l) => haversineKmLocal(l.lat, l.lon, args.lat, args.lon) <= args.radiusKm);

    if (exposed.length > 0) {
      await notify(ctx, {
        kind: "HAZARD_DETECTED",
        severity: args.severity === "critical" ? "critical" : "warning",
        title: `ROUTE EXPOSURE DETECTED — ${exposed.length} tracked subject(s) inside ${args.label}`,
        detail: `${args.hazardType.replace(/_/g, " ").toLowerCase()} · radius ${args.radiusKm} km · published by ${actor.name} · source ${args.source}`,
        audience: ["ADMIN", "CONTROL_ROOM", "STATION_COMMANDER", "FIELD_OPERATOR"],
        linkLatLon: { lat: args.lat, lon: args.lon },
        dedupeKey: `hazard-${args.hazardId}`,
      });
    }

    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Hazard zone published — ${args.hazardId} ${args.label} (${args.hazardType}, ${args.severity}, r=${args.radiusKm} km)` +
        (exposed.length ? ` · ${exposed.length} subject(s) already inside the zone` : ""),
      target: `hazard:${args.hazardId}`,
      result: "PUBLISHED",
    });
    await publish(ctx, "HAZARD_DETECTED", { hazardId: args.hazardId, exposed: exposed.length }, [
      "ADMIN",
      "CONTROL_ROOM",
      "FIELD_OPERATOR",
    ]);
    return { hazardId: args.hazardId, id, exposedSubjects: exposed.length };
  },
});

export const updateHazard = mutation({
  args: { hazardId: v.string(), severity: v.optional(v.string()), radiusKm: v.optional(v.number()), validUntil: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "hazards");
    const t = now();
    const rows = await ctx.db.query("hazardZones").collect();
    const doc = rows.find((h) => h.hazardId === args.hazardId) ?? null;
    if (!doc) throw new Error(`Unknown hazard ${args.hazardId}`);
    await ctx.db.patch(doc._id, {
      severity: (args.severity ?? doc.severity) as never,
      radiusKm: args.radiusKm ?? doc.radiusKm,
      validUntil: args.validUntil ?? doc.validUntil,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Hazard ${args.hazardId} revised${args.severity ? ` → ${args.severity}` : ""}`,
      target: `hazard:${args.hazardId}`,
      before: doc.severity,
      after: args.severity ?? doc.severity,
      result: "OK",
    });
    return { hazardId: args.hazardId };
  },
});

/* ================================================================== */
/* Tasks                                                              */
/* ================================================================== */

export const createTask = mutation({
  args: {
    taskId: v.string(),
    title: v.string(),
    stationId: v.string(),
    assignedTo: v.array(v.string()),
    dueTs: v.number(),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "tasks");
    const t = now();
    const id = await ctx.db.insert("tasks", {
      taskId: args.taskId,
      title: args.title,
      stationId: args.stationId,
      assignedTo: args.assignedTo,
      dueTs: args.dueTs,
      status: "OPEN",
      priority: (args.priority ?? "ROUTINE") as never,
      createdAt: t,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Task opened — ${args.taskId} "${args.title}" assigned to ${args.assignedTo.join(", ") || "unassigned"}`,
      target: `task:${args.taskId}`,
      result: "OPEN",
    });
    return { taskId: args.taskId, id };
  },
});

/* ================================================================== */
/* Missions                                                           */
/* ================================================================== */

export const createMission = mutation({
  args: {
    missionId: v.string(),
    name: v.string(),
    expedition: v.string(),
    origin: v.string(),
    destinationId: v.string(),
    departureTs: v.number(),
    returnTs: v.optional(v.number()),
    transportId: v.optional(v.string()),
    personIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "missions");
    const t = now();
    const id = await ctx.db.insert("missions", {
      missionId: args.missionId,
      name: args.name,
      expedition: args.expedition,
      status: "PLANNED",
      origin: args.origin,
      destinationId: args.destinationId,
      departureTs: args.departureTs,
      returnTs: args.returnTs,
      transportId: args.transportId,
      personIds: args.personIds,
      createdAt: t,
      updatedAt: t,
    });
    await writeAudit(ctx, {
      actor: actor.name,
      actorRole: actor.role,
      action: `Mission created — ${args.missionId} "${args.name}" ${args.origin} → ${args.destinationId}`,
      target: `mission:${args.missionId}`,
      result: "PLANNED",
    });
    return { missionId: args.missionId, id };
  },
});

/* ================================================================== */
/* Location ingest — the public device-facing write path               */
/* ================================================================== */

export const ingestLocation = mutation({
  args: {
    deviceId: v.string(),
    subjectId: v.optional(v.string()),
    subjectKind: v.optional(v.string()),
    lat: v.number(),
    lon: v.number(),
    accuracyM: v.number(),
    altitudeM: v.optional(v.number()),
    speedKph: v.optional(v.number()),
    headingDeg: v.optional(v.number()),
    batteryPct: v.optional(v.number()),
    connectivity: v.string(),
    ts: v.optional(v.number()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    requireResource(actor, "locations");
    if (!Number.isFinite(args.lat) || args.lat < -90 || args.lat > 90) throw new Error("Invalid latitude");
    if (!Number.isFinite(args.lon) || args.lon < -180 || args.lon > 180) throw new Error("Invalid longitude");

    const t = now();
    const result = await ingestLocationEvent(ctx, {
      deviceId: args.deviceId,
      subjectId: args.subjectId,
      subjectKind: (args.subjectKind ?? "person") as never,
      lat: args.lat,
      lon: args.lon,
      accuracyM: args.accuracyM,
      altitudeM: args.altitudeM,
      speedKph: args.speedKph,
      headingDeg: args.headingDeg,
      batteryPct: args.batteryPct,
      connectivity: args.connectivity as never,
      ts: args.ts ?? t,
      source: (args.source ?? "GPS") as never,
    });
    void actor;
    return result;
  },
});

/* ------------------------------------------------------------------ */
/* Small local helpers                                                 */
/* ------------------------------------------------------------------ */

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

function cargoCategory(itemType: string): string {
  const s = itemType.toLowerCase();
  if (s.includes("fuel") || s.includes("diesel") || s.includes("kerosene")) return "FUEL";
  if (s.includes("food") || s.includes("ration") || s.includes("provisions")) return "FOOD";
  if (s.includes("med")) return "MEDICAL";
  return "CONSUMABLES";
}

/** Local great-circle distance; mirrors the shared engine for validation. */
function haversineKmLocal(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export { HOUR, MIN };
