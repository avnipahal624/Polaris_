import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v, Infer } from "convex/values";

import {
  CARGO_LIFECYCLE,
  CHECKIN_LEVELS,
  CONVOY_LIFECYCLE,
  DELIVERY_QUALITY,
  FAMILY_MESSAGE_STATES,
  FAMILY_MESSAGE_TYPES,
  HAZARD_TYPES,
  PRIORITY_LABEL,
  RECOMMENDATION_STATES,
  ROLES,
  SOS_STAGES,
  SUPPORT_ROUTES,
} from "../lib/polar-db";

/* ------------------------------------------------------------------ */
/* Validators                                                          */
/* ------------------------------------------------------------------ */

export const roleValidator = v.union(...ROLES.map((r) => v.literal(r)));
export type Role = Infer<typeof roleValidator>;

const severity = v.union(v.literal("critical"), v.literal("warning"), v.literal("info"));
const connectivity = v.union(v.literal("ONLINE"), v.literal("LOW"), v.literal("OFFLINE"));
const latLon = v.object({ lat: v.number(), lon: v.number() });
const entityRef = v.object({ table: v.string(), id: v.string() });

/** Every audit-visible table carries created/updated stamps. */
const stamps = {
  createdAt: v.number(),
  updatedAt: v.number(),
};

const schema = defineSchema(
  {
    ...authTables,

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      /** Person this account is bound to (operators, field crews, family). */
      personId: v.optional(v.string()),
      /** Family accounts may only ever see this one expedition member. */
      linkedPersonId: v.optional(v.string()),
    }).index("email", ["email"]),

    /* ---- people & devices ---- */

    persons: defineTable({
      polarisId: v.string(), // P-023
      name: v.string(),
      role: v.string(),
      expedition: v.string(),
      stationId: v.string(),
      team: v.string(),
      shift: v.optional(v.string()),
      deviceId: v.optional(v.string()),
      emergencyContact: v.optional(v.string()),
      /** Tightly permissioned: only MEDICAL_AUTHORITY / ADMIN may read. */
      medicalNote: v.optional(v.string()),
      bloodGroup: v.optional(v.string()),
      currentAssignment: v.optional(v.string()),
      status: v.union(
        v.literal("ON_STATION"),
        v.literal("FIELD"),
        v.literal("IN_TRANSIT"),
        v.literal("REST"),
        v.literal("OFFLINE"),
        v.literal("EMERGENCY"),
      ),
      connectivity: connectivity,
      lastCheckinTs: v.optional(v.number()),
      ...stamps,
    })
      .index("by_polaris_id", ["polarisId"])
      .index("by_station", ["stationId"])
      .index("by_device", ["deviceId"]),

    devices: defineTable({
      deviceId: v.string(), // DEV-104
      kind: v.union(v.literal("PERSONAL"), v.literal("VEHICLE"), v.literal("STATION"), v.literal("FIELD_TABLET")),
      label: v.string(),
      subjectId: v.optional(v.string()),
      connectivity: connectivity,
      batteryPct: v.optional(v.number()),
      firmware: v.optional(v.string()),
      lastEventTs: v.optional(v.number()),
      /** Set by the GPS simulator; real hardware would drive this instead. */
      simulated: v.optional(v.boolean()),
      ...stamps,
    })
      .index("by_device_id", ["deviceId"])
      .index("by_subject", ["subjectId"]),

    /* ---- geography ---- */

    stations: defineTable({
      code: v.string(), // MTRI / BHRT
      name: v.string(),
      short: v.string(),
      kind: v.union(v.literal("station"), v.literal("camp"), v.literal("depot")),
      lat: v.number(),
      lon: v.number(),
      established: v.string(),
      note: v.string(),
      /** Real coordinates; operational values below are SIMULATED. */
      operationalDataSimulated: v.boolean(),
      status: v.union(v.literal("nominal"), v.literal("watch"), v.literal("critical")),
      personnel: v.number(),
      capacity: v.number(),
      connectivity: connectivity,
      emergencyCapability: v.optional(v.string()),
      ...stamps,
    })
      .index("by_code", ["code"])
      .index("by_kind", ["kind"]),

    routes: defineTable({
      name: v.string(),
      fromStationId: v.string(),
      toStationId: v.string(),
      /** Ordered waypoints; the PostGIS-equivalent LINESTRING. */
      path: v.array(latLon),
      distanceKm: v.number(),
      status: v.union(v.literal("active"), v.literal("planned"), v.literal("closed")),
      surface: v.string(),
      ...stamps,
    }).index("by_status", ["status"]),

    hazardZones: defineTable({
      hazardId: v.string(), // HZ-01
      hazardType: v.union(...HAZARD_TYPES.map((h) => v.literal(h))),
      label: v.string(),
      severity,
      lat: v.number(),
      lon: v.number(),
      radiusKm: v.number(),
      source: v.string(),
      validFrom: v.number(),
      validUntil: v.optional(v.number()),
      description: v.string(),
      routeId: v.optional(v.string()),
      stationId: v.optional(v.string()),
      ...stamps,
    })
      .index("by_severity", ["severity"])
      .index("by_type", ["hazardType"])
      .index("by_route", ["routeId"]),

    weatherEvents: defineTable({
      stationId: v.string(),
      observedTs: v.number(),
      temperatureC: v.number(),
      windKph: v.number(),
      gustKph: v.optional(v.number()),
      visibilityKm: v.number(),
      pressureHpa: v.number(),
      precipitationMm: v.optional(v.number()),
      condition: v.string(),
      stormFlag: v.boolean(),
      /** Prototype weather is simulated and always labelled as such. */
      simulated: v.boolean(),
      ...stamps,
    })
      .index("by_station_time", ["stationId", "observedTs"])
      .index("by_time", ["observedTs"]),

    /* ---- missions, cargo, inventory ---- */

    missions: defineTable({
      missionId: v.string(), // M-27
      name: v.string(),
      expedition: v.string(),
      status: v.union(
        v.literal("PLANNED"),
        v.literal("ACTIVE"),
        v.literal("COMPLETED"),
        v.literal("DELAYED"),
        v.literal("CANCELLED"),
      ),
      origin: v.string(),
      destinationId: v.string(),
      departureTs: v.number(),
      returnTs: v.optional(v.number()),
      transportId: v.optional(v.string()),
      personIds: v.array(v.string()),
      ...stamps,
    })
      .index("by_mission_id", ["missionId"])
      .index("by_status", ["status"]),

    cargo: defineTable({
      cargoId: v.string(), // CARGO-00482
      rfid: v.string(),
      barcode: v.string(),
      itemType: v.string(),
      quantity: v.number(),
      unit: v.string(),
      weightKg: v.number(),
      origin: v.string(),
      destinationStationId: v.string(),
      missionId: v.string(),
      transportId: v.optional(v.string()),
      containersExpected: v.number(),
      containersReceived: v.number(),
      containersUnverified: v.number(),
      status: v.union(...CARGO_LIFECYCLE.map((s) => v.literal(s))),
      dispatchedTs: v.optional(v.number()),
      expectedArrivalTs: v.number(),
      actualArrivalTs: v.optional(v.number()),
      expiresTs: v.optional(v.number()),
      responsiblePersonId: v.string(),
      verification: v.union(v.literal("VERIFIED"), v.literal("PENDING"), v.literal("DISCREPANT")),
      /** Monotonic counter used for offline conflict detection. */
      version: v.number(),
      priority: v.union(v.literal("CRITICAL"), v.literal("HIGH"), v.literal("ROUTINE")),
      ...stamps,
    })
      .index("by_cargo_id", ["cargoId"])
      .index("by_barcode", ["barcode"])
      .index("by_rfid", ["rfid"])
      .index("by_status", ["status"])
      .index("by_destination", ["destinationStationId"]),

    cargoScans: defineTable({
      scanId: v.string(),
      cargoId: v.optional(v.string()),
      code: v.string(),
      deviceId: v.string(),
      scannedTs: v.number(),
      location: latLon,
      result: v.union(v.literal("VERIFIED"), v.literal("UNVERIFIED"), v.literal("MISSING")),
      quantityClaimed: v.optional(v.number()),
      actor: v.string(),
      /** Immutable: a scan is evidence, never edited. */
      immutable: v.literal(true),
      ...stamps,
    })
      .index("by_cargo", ["cargoId"])
      .index("by_time", ["scannedTs"]),

    inventory: defineTable({
      itemId: v.string(),
      item: v.string(),
      category: v.union(
        v.literal("FOOD"),
        v.literal("WATER"),
        v.literal("FUEL"),
        v.literal("DIESEL"),
        v.literal("MEDICAL"),
        v.literal("EMERGENCY"),
        v.literal("SCIENTIFIC"),
        v.literal("SPARES"),
        v.literal("CONSUMABLES"),
      ),
      stationId: v.string(),
      quantity: v.number(),
      unit: v.string(),
      batch: v.string(),
      expiresTs: v.optional(v.number()),
      minThreshold: v.number(),
      consumptionRatePerDay: v.number(),
      incomingQuantity: v.number(),
      incomingEtaTs: v.optional(v.number()),
      reservedQuantity: v.number(),
      version: v.number(),
      ...stamps,
    })
      .index("by_item_id", ["itemId"])
      .index("by_station", ["stationId"])
      .index("by_category", ["category"]),

    inventoryTxns: defineTable({
      txnId: v.string(),
      itemId: v.string(),
      stationId: v.string(),
      delta: v.number(),
      reason: v.union(
        v.literal("CONSUMPTION"),
        v.literal("RECEIPT"),
        v.literal("ADJUSTMENT"),
        v.literal("TRANSFER"),
        v.literal("EXPIRED"),
      ),
      actor: v.string(),
      ts: v.number(),
      /** Present when the txn originated on an offline field device. */
      originEventId: v.optional(v.string()),
      ...stamps,
    })
      .index("by_item", ["itemId"])
      .index("by_time", ["ts"]),

    /* ---- transport ---- */

    vehicles: defineTable({
      vehicleId: v.string(), // PB-07 / S-04
      kind: v.union(
        v.literal("ship"),
        v.literal("helicopter"),
        v.literal("aircraft"),
        v.literal("snow_vehicle"),
        v.literal("tractor"),
      ),
      label: v.string(),
      callSign: v.optional(v.string()),
      status: v.union(
        v.literal("SCHEDULED"),
        v.literal("LOADING"),
        v.literal("IN_TRANSIT"),
        v.literal("DELAYED"),
        v.literal("WEATHER_HOLD"),
        v.literal("ARRIVED"),
        v.literal("COMPLETED"),
        v.literal("CANCELLED"),
      ),
      routeId: v.optional(v.string()),
      destinationStationId: v.optional(v.string()),
      etaTs: v.optional(v.number()),
      fuelPct: v.number(),
      capacityKg: v.number(),
      crewIds: v.array(v.string()),
      cargoIds: v.array(v.string()),
      deviceId: v.optional(v.string()),
      ...stamps,
    })
      .index("by_vehicle_id", ["vehicleId"])
      .index("by_status", ["status"]),

    convoys: defineTable({
      convoyId: v.string(), // CV-07
      name: v.string(),
      missionId: v.string(),
      routeId: v.string(),
      originStationId: v.string(),
      destinationStationId: v.string(),
      personnelIds: v.array(v.string()),
      vehicleIds: v.array(v.string()),
      departureTs: v.number(),
      expectedArrivalTs: v.number(),
      lastCheckinTs: v.optional(v.number()),
      checkinIntervalMin: v.number(),
      status: v.union(...CONVOY_LIFECYCLE.map((s) => v.literal(s))),
      comms: v.union(
        v.literal("CONNECTED"),
        v.literal("LOW"),
        v.literal("OFFLINE"),
        v.literal("MISSED_CHECK_IN"),
      ),
      fuelPct: v.number(),
      emergencyStatus: v.union(
        v.literal("NONE"),
        v.literal("CHECK_IN_OVERDUE"),
        v.literal("SOS"),
      ),
      /** 0..1 along the route — the simulator writes this. */
      progress: v.number(),
      ...stamps,
    })
      .index("by_convoy_id", ["convoyId"])
      .index("by_status", ["status"]),

    convoyCheckins: defineTable({
      checkinId: v.string(),
      convoyId: v.string(),
      deviceId: v.string(),
      ts: v.number(),
      location: latLon,
      fuelPct: v.number(),
      personnelCount: v.number(),
      note: v.optional(v.string()),
      offlineOrigin: v.optional(v.boolean()),
      ...stamps,
    })
      .index("by_convoy", ["convoyId"])
      .index("by_time", ["ts"]),

    /* ---- live telemetry ---- */

    locationEvents: defineTable({
      eventId: v.string(),
      deviceId: v.string(),
      subjectId: v.optional(v.string()),
      subjectKind: v.union(
        v.literal("person"),
        v.literal("vehicle"),
        v.literal("convoy"),
        v.literal("station"),
      ),
      lat: v.number(),
      lon: v.number(),
      accuracyM: v.number(),
      altitudeM: v.optional(v.number()),
      speedKph: v.optional(v.number()),
      headingDeg: v.optional(v.number()),
      batteryPct: v.optional(v.number()),
      connectivity: connectivity,
      /** Device clock — freshness is computed against this, never faked. */
      ts: v.number(),
      ingestedAt: v.number(),
      source: v.union(v.literal("GPS"), v.literal("SIMULATOR"), v.literal("MANUAL")),
      ...stamps,
    })
      .index("by_device_time", ["deviceId", "ts"])
      .index("by_subject", ["subjectId"])
      .index("by_time", ["ts"]),

    /** Latest-known pointer per subject, so the map is one query not N. */
    lastKnownPositions: defineTable({
      subjectId: v.string(),
      subjectKind: v.union(
        v.literal("person"),
        v.literal("vehicle"),
        v.literal("convoy"),
        v.literal("station"),
      ),
      lat: v.number(),
      lon: v.number(),
      accuracyM: v.number(),
      batteryPct: v.optional(v.number()),
      connectivity: connectivity,
      ts: v.number(),
      source: v.union(v.literal("GPS"), v.literal("SIMULATOR"), v.literal("MANUAL")),
      updatedAt: v.number(),
    }).index("by_subject", ["subjectId"]),

    /* ---- emergencies ---- */

    sosEvents: defineTable({
      sosId: v.string(), // SOS-0047
      incidentId: v.string(),
      personId: v.string(),
      deviceId: v.string(),
      lat: v.number(),
      lon: v.number(),
      accuracyM: v.number(),
      triggeredTs: v.number(),
      batteryPct: v.optional(v.number()),
      routeId: v.optional(v.string()),
      convoyId: v.optional(v.string()),
      nearestHazardId: v.optional(v.string()),
      nearestStationId: v.string(),
      nearestStationKm: v.number(),
      connectivityAtTrigger: connectivity,
      category: v.string(),
      stage: v.union(...SOS_STAGES.map((s) => v.literal(s))),
      responseTeam: v.optional(v.string()),
      assignedVehicleIds: v.array(v.string()),
      actions: v.array(v.object({ ts: v.number(), actor: v.string(), action: v.string() })),
      resolution: v.optional(v.string()),
      resolvedTs: v.optional(v.number()),
      /** True when the SOS sat in the offline P0 queue before transmitting. */
      queuedOffline: v.optional(v.boolean()),
      ...stamps,
    })
      .index("by_sos_id", ["sosId"])
      .index("by_stage", ["stage"])
      .index("by_person", ["personId"]),

    emergencyResponses: defineTable({
      incidentId: v.string(),
      sosId: v.string(),
      severity,
      location: latLon,
      hazardIds: v.array(v.string()),
      weatherSnapshot: v.optional(v.string()),
      routeId: v.optional(v.string()),
      responseTeam: v.string(),
      assignedVehicleIds: v.array(v.string()),
      status: v.union(
        v.literal("OPEN"),
        v.literal("ASSIGNED"),
        v.literal("EN_ROUTE"),
        v.literal("ON_SCENE"),
        v.literal("CLOSED"),
      ),
      openedTs: v.number(),
      closedTs: v.optional(v.number()),
      ...stamps,
    }).index("by_sos", ["sosId"]),

    medicalCases: defineTable({
      caseId: v.string(),
      personId: v.string(),
      incidentId: v.optional(v.string()),
      observations: v.string(),
      vitals: v.optional(v.string()),
      attachments: v.array(v.string()),
      priority: v.union(v.literal("ROUTINE"), v.literal("URGENT"), v.literal("CRITICAL")),
      status: v.union(
        v.literal("RECORDED_FIELD"),
        v.literal("QUEUED"),
        v.literal("TRANSMITTED"),
        v.literal("UNDER_REVIEW"),
        v.literal("RESOLVED"),
      ),
      recordedBy: v.string(),
      recordedTs: v.number(),
      /** Store-and-forward: written offline, transmitted when link allows. */
      offlineOrigin: v.optional(v.boolean()),
      /** POLARIS never diagnoses — it only prioritises transmission. */
      clinicianNote: v.optional(v.string()),
      ...stamps,
    })
      .index("by_person", ["personId"])
      .index("by_status", ["status"]),

    /* ---- work ---- */

    tasks: defineTable({
      taskId: v.string(),
      title: v.string(),
      stationId: v.string(),
      assignedTo: v.array(v.string()),
      dueTs: v.number(),
      status: v.union(
        v.literal("OPEN"),
        v.literal("IN_PROGRESS"),
        v.literal("BLOCKED"),
        v.literal("DONE"),
        v.literal("CANCELLED"),
      ),
      priority: v.union(v.literal("CRITICAL"), v.literal("HIGH"), v.literal("ROUTINE")),
      ...stamps,
    })
      .index("by_station", ["stationId"])
      .index("by_status", ["status"]),

    roster: defineTable({
      rosterId: v.string(),
      personId: v.string(),
      stationId: v.string(),
      day: v.string(),
      shift: v.union(v.literal("ALPHA"), v.literal("BRAVO"), v.literal("CHARLIE"), v.literal("OFF")),
      duty: v.string(),
      ...stamps,
    })
      .index("by_person", ["personId"])
      .index("by_station_day", ["stationId", "day"]),

    /* ---- offline sync ---- */

    syncEvents: defineTable({
      eventId: v.string(), // client-generated idempotency key
      deviceId: v.string(),
      type: v.string(),
      priority: v.number(),
      recordedAt: v.number(),
      receivedAt: v.number(),
      payload: v.string(), // JSON — union-typed payloads need a string in Convex
      status: v.union(
        v.literal("APPLIED"),
        v.literal("CONFLICT"),
        v.literal("REJECTED"),
        v.literal("QUEUED"),
      ),
      reason: v.optional(v.string()),
      appliedTable: v.optional(v.string()),
      appliedId: v.optional(v.string()),
      ...stamps,
    })
      .index("by_device", ["deviceId"])
      .index("by_status", ["status"])
      .index("by_priority", ["priority"]),

    syncConflicts: defineTable({
      conflictId: v.string(),
      eventId: v.string(),
      entity: v.string(),
      entityId: v.string(),
      field: v.string(),
      centralValue: v.string(),
      fieldValue: v.string(),
      deviceId: v.string(),
      fieldAuthor: v.string(),
      fieldTs: v.number(),
      centralTs: v.number(),
      status: v.union(
        v.literal("OPEN"),
        v.literal("KEEP_CENTRAL"),
        v.literal("KEEP_FIELD"),
        v.literal("MERGED"),
      ),
      resolvedBy: v.optional(v.string()),
      resolvedTs: v.optional(v.number()),
      ...stamps,
    })
      .index("by_status", ["status"])
      .index("by_conflict_id", ["conflictId"])
      .index("by_entity", ["entity", "entityId"]),

    /* ---- family home link ---- */

    familyMembers: defineTable({
      familyId: v.string(),
      name: v.string(),
      relationship: v.string(),
      personId: v.string(), // linked expedition member — the only person they can see
      authorized: v.boolean(),
      deviceId: v.optional(v.string()),
      ...stamps,
    })
      .index("by_person", ["personId"])
      .index("by_family_id", ["familyId"]),

    familyMessages: defineTable({
      messageId: v.string(),
      familyMemberId: v.string(),
      personId: v.string(),
      direction: v.union(v.literal("FAMILY_TO_FIELD"), v.literal("FIELD_TO_FAMILY")),
      type: v.union(...FAMILY_MESSAGE_TYPES.map((t) => v.literal(t))),
      pipeline: v.array(v.string()),
      sizeBytes: v.number(),
      audioExtractedFirst: v.boolean(),
      quality: v.union(...DELIVERY_QUALITY.map((q) => v.literal(q))),
      state: v.union(...FAMILY_MESSAGE_STATES.map((s) => v.literal(s))),
      createdTs: v.number(),
      deliveredTs: v.optional(v.number()),
      openedTs: v.optional(v.number()),
      expiresTs: v.optional(v.number()),
      encrypted: v.boolean(),
      /** Never surfaced outside the family link. */
      privateBody: v.optional(v.string()),
      ...stamps,
    })
      .index("by_person", ["personId"])
      .index("by_state", ["state"])
      .index("by_direction", ["direction"]),

    /* ---- well-being (non-diagnostic) ---- */

    wellbeingCheckins: defineTable({
      checkinId: v.string(),
      personId: v.string(),
      ts: v.number(),
      level: v.union(...CHECKIN_LEVELS.map((l) => v.literal(l))),
      supportRoute: v.optional(v.union(...SUPPORT_ROUTES.map((s) => v.literal(s)))),
      privateNote: v.optional(v.string()),
      ...stamps,
    })
      .index("by_person", ["personId"])
      .index("by_time", ["ts"]),

    /* ---- platform services ---- */

    notifications: defineTable({
      notificationId: v.string(),
      kind: v.string(),
      severity,
      title: v.string(),
      detail: v.string(),
      ts: v.number(),
      linkEntity: v.optional(entityRef),
      linkLatLon: v.optional(latLon),
      channels: v.array(v.string()),
      read: v.boolean(),
      audience: v.array(v.string()),
      ...stamps,
    })
      .index("by_ts", ["ts"])
      .index("by_severity", ["severity"]),

    aiRecommendations: defineTable({
      recommendationId: v.string(),
      module: v.union(
        v.literal("PREDICTION"),
        v.literal("ANOMALY"),
        v.literal("RISK"),
        v.literal("OPTIMIZATION"),
        v.literal("RECOMMENDATION"),
      ),
      title: v.string(),
      recommendation: v.string(),
      reason: v.string(),
      dataUsed: v.array(v.string()),
      confidence: v.union(v.literal("HIGH"), v.literal("MEDIUM"), v.literal("LOW")),
      impact: v.string(),
      ts: v.number(),
      state: v.union(...RECOMMENDATION_STATES.map((s) => v.literal(s))),
      approvedBy: v.optional(v.string()),
      approvedTs: v.optional(v.number()),
      relatedEntities: v.array(entityRef),
      ...stamps,
    })
      .index("by_state", ["state"])
      .index("by_module", ["module"]),

    realtimeEvents: defineTable({
      eventId: v.string(),
      type: v.string(),
      ts: v.number(),
      payload: v.string(),
      audience: v.array(v.string()),
      ...stamps,
    })
      .index("by_ts", ["ts"])
      .index("by_type", ["type"]),

    auditLogs: defineTable({
      auditId: v.string(),
      ts: v.number(),
      actor: v.string(),
      actorRole: v.string(),
      action: v.string(),
      target: v.string(),
      aiRecommendationId: v.optional(v.string()),
      reason: v.optional(v.string()),
      before: v.optional(v.string()),
      after: v.optional(v.string()),
      result: v.string(),
    })
      .index("by_ts", ["ts"])
      .index("by_target", ["target"])
      .index("by_actor", ["actor"]),

    /** Singleton-ish simulation control for the GPS engine + demo mode. */
    simState: defineTable({
      running: v.boolean(),
      startedAt: v.optional(v.number()),
      lastTickTs: v.optional(v.number()),
      tickMs: v.number(),
      tickCount: v.number(),
      /** Degraded connectivity applied by the demo controls. */
      connectivity: v.union(
        v.literal("NORMAL"),
        v.literal("WEAK"),
        v.literal("VERY_LOW"),
        v.literal("OFFLINE"),
      ),
      seed: v.number(),
      ...stamps,
    }).index("by_running", ["running"]),

    connectivityEvents: defineTable({
      eventId: v.string(),
      ts: v.number(),
      mode: v.union(
        v.literal("NORMAL"),
        v.literal("WEAK"),
        v.literal("VERY_LOW"),
        v.literal("OFFLINE"),
      ),
      note: v.string(),
      ...stamps,
    })
      .index("by_ts", ["ts"]),
  },
  {
    // Kept off for the prototype: the auth tables ship with fields this
    // project's auth providers write that are not part of the domain model.
    schemaValidation: false,
  },
);

export { PRIORITY_LABEL };
export default schema;
