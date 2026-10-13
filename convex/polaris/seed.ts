/**
 * POLARIS seed.
 *
 * Real geography (Maitri, Bharati, Dakshin Gangotri, camps, published ice-shelf
 * and crevasse geography) with clearly SIMULATED operational values. Every
 * operational figure carries a `operationalDataSimulated` / `simulated` flag so
 * the UI can label it honestly.
 */
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { writeAudit, nextId, DAY, HOUR, MIN, now } from "./lib";
import { pointAlongPath } from "../../lib/polar-geo";

const T0 = () => now();

async function wipe(ctx: MutationCtx) {
  const tables = [
    "lastKnownPositions",
    "locationEvents",
    "syncConflicts",
    "syncEvents",
    "convoyCheckins",
    "cargoScans",
    "inventoryTxns",
    "familyMessages",
    "familyMembers",
    "wellbeingCheckins",
    "medicalCases",
    "emergencyResponses",
    "sosEvents",
    "aiRecommendations",
    "notifications",
    "realtimeEvents",
    "roster",
    "tasks",
    "weatherEvents",
    "convoys",
    "vehicles",
    "routes",
    "hazardZones",
    "cargo",
    "inventory",
    "missions",
    "stations",
    "persons",
    "devices",
    "auditLogs",
    "connectivityEvents",
    "simState",
  ] as const;
  for (const table of tables) {
    const rows = await ctx.db.query(table).collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    await wipe(ctx);
    const t = T0();
    const ts = t;
    const up = t;
    // Generic so each row keeps its literal field types for Convex's validators.
    const st = <T extends Record<string, unknown>>(a: T) => ({ createdAt: t, updatedAt: t, ...a });

    /* ---------------- stations & camps (REAL coordinates) ---------------- */

    const maitri = await ctx.db.insert(
      "stations",
      st({
        code: "MTRI",
        name: "Maitri (V83)",
        short: "MAITRI",
        kind: "station",
        lat: -70.7586,
        lon: 11.7286,
        established: "1989 · 9th Antarctic station operated by India",
        note: "Schirmacher Oasis, East Antarctica. Real station coordinates; operational values below are SIMULATED.",
        operationalDataSimulated: true,
        status: "nominal",
        personnel: 48,
        capacity: 55,
        connectivity: "ONLINE",
        emergencyCapability: "Medical officer, 2 × snow vehicle, H-01 rotary available",
      }),
    );

    const bharati = await ctx.db.insert(
      "stations",
      st({
        code: "BHRT",
        name: "Bharati (V83)",
        short: "BHARATI",
        kind: "station",
        lat: -69.4067,
        lon: 76.1868,
        established: "2012 · India's third research station",
        note: "Larsemann Hills, East Antarctica. Real station coordinates; operational values below are SIMULATED.",
        operationalDataSimulated: true,
        status: "watch",
        personnel: 41,
        capacity: 50,
        connectivity: "LOW",
        emergencyCapability: "Medical officer, 1 × snow vehicle, comms relay to Maitri",
      }),
    );

    const dakshin = await ctx.db.insert(
      "stations",
      st({
        code: "DGRP",
        name: "Dakshin Gangotri Depot (B03)",
        short: "DG DEPOT",
        kind: "depot",
        lat: -70.4521,
        lon: 12.0,
        established: "1983 · first Indian station, now a logistics depot",
        note: "Central ice depot. Real location; operational values SIMULATED.",
        operationalDataSimulated: true,
        status: "nominal",
        personnel: 7,
        capacity: 12,
        connectivity: "ONLINE",
        emergencyCapability: "Generator crew, sled tractor, fuel farm",
      }),
    );

    const campSuhrid = await ctx.db.insert(
      "stations",
      st({
        code: "CMP-SUH",
        name: "Camp Suhrid",
        short: "CAMP SUHRID",
        kind: "camp",
        lat: -71.1,
        lon: 14.8,
        established: "Seasonal glaciology field camp",
        note: "Glaciology camp on the northern ice shelf, 41 km from Maitri. Location realistic, operations SIMULATED.",
        operationalDataSimulated: true,
        status: "critical",
        personnel: 9,
        capacity: 12,
        connectivity: "OFFLINE",
        emergencyCapability: "Snow vehicle S-04, generator hut, cached beacon",
      }),
    );

    const campPriya = await ctx.db.insert(
      "stations",
      st({
        code: "CMP-PRI",
        name: "Camp Priyadarshini",
        short: "CAMP PRIYADARSHINI",
        kind: "camp",
        lat: -70.6,
        lon: 10.2,
        established: "Seasonal lake-sediment coring camp",
        note: "Ronne Ice Shelf margin. Location realistic, operations SIMULATED.",
        operationalDataSimulated: true,
        status: "critical",
        personnel: 6,
        capacity: 10,
        connectivity: "OFFLINE",
        emergencyCapability: "Cached beacon, no vehicle assigned",
      }),
    );

    const larsemann = await ctx.db.insert(
      "stations",
      st({
        code: "CMP-LSN",
        name: "Camp Larsemann North",
        short: "CAMP LARSEMANN N",
        kind: "camp",
        lat: -68.9,
        lon: 77.5,
        established: "Seasonal atmospheric monitoring detachment",
        note: "Larsemann Hills. Location realistic, operations SIMULATED.",
        operationalDataSimulated: true,
        status: "watch",
        personnel: 8,
        capacity: 10,
        connectivity: "LOW",
        emergencyCapability: "Generator hut, Kite-loon sounding kit",
      }),
    );

    const allStations = [maitri, bharati, dakshin, campSuhrid, campPriya, larsemann];

    /* ---------------- hazard zones (real published geography) ---------------- */

    const hzCrevasse = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-01",
        hazardType: "CREVASSE",
        label: "Crevasse Field — Sector C",
        severity: "critical",
        lat: -70.95,
        lon: 13.4,
        radiusKm: 9,
        source: "National Centre for Polar and Ocean Research survey (published crevasse mapping)",
        validFrom: ts - 30 * DAY,
        description:
          "Unbridged crevasses detected on the Maitri → Camp Suhrid over-ice route. Guided passage required for any ground movement.",
      }),
    );

    const hzBlizzard = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-02",
        hazardType: "BLIZZARD",
        label: "Blizzard System — Priyadarshini",
        severity: "critical",
        lat: -70.35,
        lon: 9.4,
        radiusKm: 26,
        source: "Simulated weather ingestion (labelled SIMULATED)",
        validFrom: ts,
        validUntil: ts + 18 * HOUR,
        description: "Low-pressure system approaching from the north-west. Ground movement suspended inside the zone.",
      }),
    );

    const hzLowVis = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-03",
        hazardType: "WHITEOUT",
        label: "Low Visibility — Prydz Bay Coast",
        severity: "warning",
        lat: -68.8,
        lon: 74.8,
        radiusKm: 30,
        source: "Simulated weather ingestion (labelled SIMULATED)",
        validFrom: ts - 6 * HOUR,
        description: "Visibility below 2 km along the coast. VFR helicopter operations suspended.",
      }),
    );

    const hzRestricted = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-04",
        hazardType: "RESTRICTED_ZONE",
        label: "Restricted — ASPA 135 Boundary",
        severity: "info",
        lat: -69.15,
        lon: 77.0,
        radiusKm: 12,
        source: "Antarctic Treaty Secretariat designated area",
        validFrom: ts - 365 * DAY,
        description: "Biological prospecting area. Entry requires prior notification; no ground movement without approval.",
      }),
    );

    const hzIce = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-05",
        hazardType: "UNSTABLE_ICE",
        label: "Fast Ice — Camp Suhrid approach",
        severity: "warning",
        lat: -71.02,
        lon: 14.1,
        radiusKm: 6,
        source: "Field observation (SIMULATED)",
        validFrom: ts - 2 * DAY,
        description: "Fast-ice weakness on the northern approach. Load limit reduced to 4 t per vehicle.",
      }),
    );

    const hzWhiteout = await ctx.db.insert(
      "hazardZones",
      st({
        hazardId: "HZ-06",
        hazardType: "WHITEOUT",
        label: "Whiteout — Schirmacher Sector",
        severity: "warning",
        lat: -70.7,
        lon: 11.2,
        radiusKm: 14,
        source: "Simulated weather ingestion (labelled SIMULATED)",
        validFrom: ts - 3 * HOUR,
        validUntil: ts + 9 * HOUR,
        description: "Surface features invisible. Convoy speed limit 5 km/h with GPS waypoint spacing tightened.",
      }),
    );

    /* ---------------- routes ---------------- */

    const rSuhrid = await ctx.db.insert(
      "routes",
      st({
        name: "Maitri → Camp Suhrid",
        fromStationId: maitri,
        toStationId: campSuhrid,
        path: [
          { lat: -70.7586, lon: 11.7286 },
          { lat: -70.79, lon: 12.35 },
          { lat: -70.87, lon: 12.92 },
          { lat: -70.95, lon: 13.4 },
          { lat: -71.02, lon: 14.05 },
          { lat: -71.1, lon: 14.8 },
        ],
        distanceKm: 41,
        status: "active",
        surface: "Sea ice / firn — guided passage required past Sector C",
      }),
    );

    await ctx.db.patch(hzCrevasse, { routeId: rSuhrid });
    await ctx.db.patch(hzIce, { routeId: rSuhrid });

    const rPriya = await ctx.db.insert(
      "routes",
      st({
        name: "Maitri → Camp Priyadarshini",
        fromStationId: maitri,
        toStationId: campPriya,
        path: [
          { lat: -70.7586, lon: 11.7286 },
          { lat: -70.6, lon: 11.0 },
          { lat: -70.48, lon: 10.5 },
          { lat: -70.6, lon: 10.2 },
        ],
        distanceKm: 22,
        status: "active",
        surface: "Blue-ice / compacted snow",
      }),
    );
    await ctx.db.patch(hzBlizzard, { routeId: rPriya });

    const rBharati = await ctx.db.insert(
      "routes",
      st({
        name: "Maitri → Bharati",
        fromStationId: maitri,
        toStationId: bharati,
        path: [
          { lat: -70.7586, lon: 11.7286 },
          { lat: -70.4, lon: 20.0 },
          { lat: -70.1, lon: 40.0 },
          { lat: -69.8, lon: 60.0 },
          { lat: -69.4067, lon: 76.1868 },
        ],
        distanceKm: 3180,
        status: "active",
        surface: "Coastal sea ice — air-supported resupply preferred",
      }),
    );

    const rDepot = await ctx.db.insert(
      "routes",
      st({
        name: "Maitri → DG Depot",
        fromStationId: maitri,
        toStationId: dakshin,
        path: [
          { lat: -70.7586, lon: 11.7286 },
          { lat: -70.6, lon: 11.85 },
          { lat: -70.4521, lon: 12.0 },
        ],
        distanceKm: 34,
        status: "active",
        surface: "Firn — tractor and sled route",
      }),
    );

    const rLarsemann = await ctx.db.insert(
      "routes",
      st({
        name: "Bharati → Camp Larsemann North",
        fromStationId: bharati,
        toStationId: larsemann,
        path: [
          { lat: -69.4067, lon: 76.1868 },
          { lat: -69.1, lon: 76.8 },
          { lat: -68.9, lon: 77.5 },
        ],
        distanceKm: 88,
        status: "planned",
        surface: "Rock / snowfield traverse",
      }),
    );

    /* ---------------- personnel + devices ---------------- */

    const personSeed = [
      { pid: "P-001", name: "Dr. Anjali Menon", role: "Expedition Commander", station: maitri, team: "Command", shift: "ALPHA", duty: "Expedition-wide coordination", device: "DEV-101", battery: 91, conn: "ONLINE" as const, status: "ON_STATION" as const, med: "No known chronic condition", blood: "B+" },
      { pid: "P-002", name: "Cdr. Rajat Khanna", role: "Station Manager", station: maitri, team: "Maitri Operations", shift: "ALPHA", duty: "Station ops + helipad authority", device: "DEV-102", battery: 84, conn: "ONLINE" as const, status: "ON_STATION" as const, med: "Hypertension — medication in clinic", blood: "O+" },
      { pid: "P-003", name: "Dr. Ishaan Verma", role: "Glaciologist", station: campSuhrid, team: "Ice Core Team 1", shift: "ALPHA", duty: "Crevasse survey — Sector C fringe", device: "DEV-103", battery: 58, conn: "OFFLINE" as const, status: "FIELD" as const, med: "No known chronic condition", blood: "A+" },
      { pid: "P-004", name: "Tenzing Bhutia", role: "Field Researcher", station: campSuhrid, team: "Lake Sediment Team", shift: "ALPHA", duty: "Sediment coring — Sector 4 approach", device: "DEV-104", battery: 34, conn: "OFFLINE" as const, status: "FIELD" as const, med: "Asthma — inhalers at both station and field cache", blood: "AB+" },
      { pid: "P-005", name: "Lt. Meera Pillai", role: "Medical Officer", station: maitri, team: "Medical", shift: "ALPHA", duty: "Clinic + emergency response lead", device: "DEV-105", battery: 96, conn: "ONLINE" as const, status: "ON_STATION" as const, med: "Physician", blood: "A-" },
      { pid: "P-006", name: "Sgt. Devraj Rathore", role: "Helicopter Pilot", station: maitri, team: "Air Wing", shift: "ALPHA", duty: "H-02 sling mission", device: "DEV-106", battery: 77, conn: "ONLINE" as const, status: "IN_TRANSIT" as const, med: "No known chronic condition", blood: "O-" },
      { pid: "P-007", name: "Arjun Nair", role: "Logistics Officer", station: bharati, team: "Bharati Operations", shift: "BRAVO", duty: "Consignment verification", device: "DEV-107", battery: 63, conn: "LOW" as const, status: "ON_STATION" as const, med: "No known chronic condition", blood: "B-" },
      { pid: "P-008", name: "Kavita Joshi", role: "Engineer", station: campSuhrid, team: "Power & Mechanical", shift: "BRAVO", duty: "Generator load audit", device: "DEV-108", battery: 41, conn: "OFFLINE" as const, status: "FIELD" as const, med: "No known chronic condition", blood: "O+" },
      { pid: "P-009", name: "Farhan Sheikh", role: "Comms Engineer", station: bharati, team: "Comms", shift: "BRAVO", duty: "Satcom window scheduling", device: "DEV-109", battery: 88, conn: "LOW" as const, status: "ON_STATION" as const, med: "No known chronic condition", blood: "A+" },
      { pid: "P-010", name: "Dr. Sneha Kulkarni", role: "Atmospheric Scientist", station: larsemann, team: "Atmospherics", shift: "CHARLIE", duty: "Kite-loon soundings (wind limited)", device: "DEV-110", battery: 72, conn: "LOW" as const, status: "ON_STATION" as const, med: "No known chronic condition", blood: "B+" },
      { pid: "P-011", name: "Vikram Singh", role: "Technician", station: maitri, team: "Power & Mechanical", shift: "OFF", duty: "Rest period after night maintenance", device: "DEV-111", battery: 55, conn: "ONLINE" as const, status: "REST" as const, med: "Recovering from hand injury", blood: "O+" },
      { pid: "P-012", name: "Pooja Iyer", role: "Technician", station: maitri, team: "Power & Mechanical", shift: "ALPHA", duty: "Available for maintenance reassignment", device: "DEV-112", battery: 94, conn: "ONLINE" as const, status: "ON_STATION" as const, med: "No known chronic condition", blood: "A-" },
    ];

    const personIds: Record<string, string> = {};
    for (const p of personSeed) {
      const id = await ctx.db.insert(
        "persons",
        st({
          polarisId: p.pid,
          name: p.name,
          role: p.role,
          expedition: "27th Indian Scientific Expedition (SIMULATED roster)",
          stationId: p.station,
          team: p.team,
          shift: p.shift,
          deviceId: p.device,
          emergencyContact: "On file — NCPOR emergency desk",
          medicalNote: p.med,
          bloodGroup: p.blood,
          currentAssignment: p.duty,
          status: p.status,
          connectivity: p.conn,
          lastCheckinTs: t - (p.conn === "OFFLINE" ? 43 * MIN : 5 * MIN),
        }),
      );
      personIds[p.pid] = id;
      await ctx.db.insert(
        "devices",
        st({
          deviceId: p.device,
          kind: "PERSONAL",
          label: `${p.name} tracker`,
          subjectId: p.pid,
          connectivity: p.conn,
          batteryPct: p.battery,
          firmware: "SIM-FW-1.4.2",
          simulated: true,
        }),
      );
    }

    const deviceFor = (pid: string) => personSeed.find((p) => p.pid === pid)?.device ?? "DEV-000";

    /* ---------------- vehicles ---------------- */

    const ship = await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-SHIP-APAMA",
        kind: "ship",
        label: "MV Apama",
        callSign: "VORA",
        status: "IN_TRANSIT",
        destinationStationId: maitri,
        etaTs: t + 6 * DAY,
        fuelPct: 82,
        capacityKg: 180000,
        crewIds: ["P-002", "P-006"],
        cargoIds: [],
        deviceId: "DEV-SHP-01",
      }),
    );

    const heli = await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-HEL-02",
        kind: "helicopter",
        label: "Helicopter H-02",
        callSign: "H02",
        status: "DELAYED",
        routeId: rSuhrid,
        destinationStationId: campSuhrid,
        etaTs: t + 3 * HOUR,
        fuelPct: 68,
        capacityKg: 1200,
        crewIds: ["P-006"],
        cargoIds: [],
        deviceId: "DEV-HEL-02",
      }),
    );

    const air = await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-AIR-203",
        kind: "aircraft",
        label: "Flight IA-203 · Bharati",
        callSign: "IA203",
        status: "ONLINE" as never as "SCHEDULED",
        destinationStationId: bharati,
        etaTs: t + 2 * DAY,
        fuelPct: 91,
        capacityKg: 5200,
        crewIds: ["P-009"],
        cargoIds: [],
        deviceId: "DEV-AIR-203",
      }),
    );

    const svh = await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-SVH-04",
        kind: "snow_vehicle",
        label: "Snow Vehicle S-04",
        callSign: "S04",
        status: "IN_TRANSIT",
        routeId: rSuhrid,
        destinationStationId: campSuhrid,
        etaTs: t + 90 * MIN,
        fuelPct: 54,
        capacityKg: 3500,
        crewIds: ["P-008"],
        cargoIds: [],
        deviceId: "DEV-SVH-04",
      }),
    );

    await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-SVH-05",
        kind: "snow_vehicle",
        label: "Snow Vehicle S-05",
        callSign: "S05",
        status: "IN_TRANSIT",
        routeId: rSuhrid,
        destinationStationId: campSuhrid,
        etaTs: t + 100 * MIN,
        fuelPct: 61,
        capacityKg: 3500,
        crewIds: ["P-012"],
        cargoIds: [],
        deviceId: "DEV-SVH-05",
      }),
    );

    await ctx.db.insert(
      "vehicles",
      st({
        vehicleId: "VH-SVH-02",
        kind: "snow_vehicle",
        label: "Snow Vehicle S-02",
        callSign: "S02",
        status: "SCHEDULED",
        routeId: rDepot,
        destinationStationId: dakshin,
        etaTs: t + 5 * HOUR,
        fuelPct: 88,
        capacityKg: 3500,
        crewIds: [],
        cargoIds: [],
        deviceId: "DEV-SVH-02",
      }),
    );

    // Telemetry devices for the tracked vehicles. `subjectId` is the POLARIS
    // vehicle id, so the map can join telemetry to the transport record.
    for (const vid of [ship, heli, air, svh]) {
      const v = await ctx.db.get(vid);
      if (!v) continue;
      await ctx.db.insert(
        "devices",
        st({
          deviceId: v.deviceId ?? `DEV-${v.vehicleId}`,
          kind: "VEHICLE",
          label: `${v.label} telemetry`,
          subjectId: v.vehicleId,
          connectivity: "ONLINE",
          batteryPct: v.fuelPct,
          simulated: true,
        }),
      );
    }

    /* ---------------- cargo ---------------- */

    const cargoSeed = [
      { id: "CARGO-00482", rfid: "RF-CARGO-0482", barcode: "6200482000147", item: "Frozen vegetables", cat: "FOOD", qty: 240, unit: "kg", kg: 240, dest: maitri, mission: "M-27", transport: ship, exp: 210, expDays: 300, resp: "P-007", prio: "ROUTINE" as const },
      { id: "CARGO-00483", rfid: "RF-CARGO-0483", barcode: "6200483000115", item: "Diesel reserve (ISO tank)", cat: "FUEL", qty: 18000, unit: "L", kg: 16200, dest: maitri, mission: "M-27", transport: ship, exp: null, expDays: null, resp: "P-002", prio: "CRITICAL" as const },
      { id: "CARGO-00491", rfid: "RF-CARGO-0491", barcode: "6200491000183", item: "Medical consumables — trauma set", cat: "MEDICAL", qty: 42, unit: "cases", kg: 180, dest: bharati, mission: "M-27", transport: ship, exp: 120, expDays: 180, resp: "P-005", prio: "CRITICAL" as const },
      { id: "CARGO-00495", rfid: "RF-CARGO-0495", barcode: "6200495000159", item: "Scientific equipment — GNSS receivers", cat: "SCIENTIFIC", qty: 14, unit: "units", kg: 96, dest: bharati, mission: "M-27", transport: ship, exp: null, expDays: null, resp: "P-010", prio: "HIGH" as const },
      { id: "CARGO-00502", rfid: "RF-CARGO-0502", barcode: "6200502000121", item: "Winter ration packs", cat: "FOOD", qty: 320, unit: "packs", kg: 4800, dest: campSuhrid, mission: "M-27", transport: heli, exp: 45, expDays: 90, resp: "P-003", prio: "HIGH" as const },
    ];

    const cargoIds: Record<string, string> = {};
    for (const c of cargoSeed) {
      const id = await ctx.db.insert(
        "cargo",
        st({
          cargoId: c.id,
          rfid: c.rfid,
          barcode: c.barcode,
          itemType: c.item,
          quantity: c.qty,
          unit: c.unit,
          weightKg: c.kg,
          origin: "Port Blair / Chennai (India)",
          destinationStationId: c.dest,
          missionId: c.mission,
          transportId: c.transport,
          containersExpected: c.unit === "cases" ? 42 : c.qty > 1000 ? 40 : 20,
          containersReceived: c.unit === "cases" ? 42 : c.qty > 1000 ? 37 : 20,
          containersUnverified: c.unit === "cases" ? 0 : c.qty > 1000 ? 3 : 0,
          status: c.transport === heli ? "LOADED" : "IN_TRANSIT",
          dispatchedTs: t - 3 * DAY,
          expectedArrivalTs: t + 6 * DAY,
          expiresTs: c.expDays === null ? undefined : t + c.expDays * DAY,
          responsiblePersonId: c.resp,
          verification: c.unit === "cases" || c.qty <= 1000 ? "VERIFIED" : "DISCREPANT",
          version: 1,
          priority: c.prio,
        }),
      );
      cargoIds[c.id] = id;
    }

    /* ---------------- inventory ---------------- */

    const invSeed = [
      { id: "INV-MT-FUEL", item: "Diesel", cat: "DIESEL" as const, stn: maitri, qty: 42000, unit: "L", rate: 2600, min: 15000, inc: 18000, incEta: t + 6 * DAY, batch: "B-2612", exp: undefined, res: 4000 },
      { id: "INV-BH-FUEL", item: "Diesel", cat: "DIESEL" as const, stn: bharati, qty: 9800, unit: "L", rate: 1180, min: 6000, inc: 0, incEta: undefined, batch: "B-2609", exp: undefined, res: 1500 },
      { id: "INV-MT-FOOD", item: "Rations (fresh + frozen)", cat: "FOOD" as const, stn: maitri, qty: 9800, unit: "kg", rate: 210, min: 3000, inc: 2400, incEta: t + 6 * DAY, batch: "B-2603", exp: t + 21 * DAY, res: 500 },
      { id: "INV-BH-FOOD", item: "Frozen provisions", cat: "FOOD" as const, stn: bharati, qty: 5400, unit: "kg", rate: 165, min: 2200, inc: 1200, incEta: t + 6 * DAY, batch: "B-2601", exp: t + 30 * DAY, res: 300 },
      { id: "INV-MT-MED", item: "Medical consumables", cat: "MEDICAL" as const, stn: maitri, qty: 640, unit: "cases", rate: 6, min: 220, inc: 42, incEta: t + 6 * DAY, batch: "M-2608", exp: t + 180 * DAY, res: 80 },
      { id: "INV-MT-WATER", item: "Potable water (melted)", cat: "WATER" as const, stn: maitri, qty: 5200, unit: "L", rate: 420, min: 1800, inc: 0, incEta: undefined, batch: "W-2610", exp: undefined, res: 200 },
      { id: "INV-SU-FUEL", item: "Diesel", cat: "DIESEL" as const, stn: campSuhrid, qty: 2200, unit: "L", rate: 300, min: 1200, inc: 2400, incEta: t + 2 * HOUR, batch: "B-2608", exp: undefined, res: 300 },
      { id: "INV-SU-EMG", item: "Emergency rations + flares", cat: "EMERGENCY" as const, stn: campSuhrid, qty: 96, unit: "packs", rate: 1.5, min: 40, inc: 0, incEta: undefined, batch: "E-2607", exp: t + 400 * DAY, res: 20 },
      { id: "INV-PRI-FUEL", item: "Diesel", cat: "DIESEL" as const, stn: campPriya, qty: 1450, unit: "L", rate: 240, min: 1100, inc: 0, incEta: undefined, batch: "B-2607", exp: undefined, res: 250 },
      { id: "INV-BH-SCI", item: "Scientific spares & sensors", cat: "SCIENTIFIC" as const, stn: bharati, qty: 148, unit: "units", rate: 1.1, min: 60, inc: 14, incEta: t + 6 * DAY, batch: "S-2605", exp: undefined, res: 20 },
    ];

    for (const i of invSeed) {
      await ctx.db.insert(
        "inventory",
        st({
          itemId: i.id,
          item: i.item,
          category: i.cat,
          stationId: i.stn,
          quantity: i.qty,
          unit: i.unit,
          batch: i.batch,
          expiresTs: i.exp,
          minThreshold: i.min,
          consumptionRatePerDay: i.rate,
          incomingQuantity: i.inc,
          incomingEtaTs: i.incEta,
          reservedQuantity: i.res,
          version: 1,
        }),
      );
    }

    /* ---------------- weather (SIMULATED) ---------------- */

    const weatherSeed = [
      { stn: maitri, t: -18, w: 22, gust: 31, vis: 16, p: 992, cond: "Light snow", storm: false },
      { stn: bharati, t: -12, w: 74, gust: 96, vis: 5, p: 978, cond: "Gale gusts", storm: true },
      { stn: dakshin, t: -24, w: 18, vis: 20, p: 1004, cond: "Clear", storm: false },
      { stn: campSuhrid, t: -26, w: 34, gust: 48, vis: 9, p: 986, cond: "Drifting snow", storm: false },
      { stn: campPriya, t: -19, w: 46, gust: 63, vis: 2, p: 971, cond: "Deteriorating", storm: true },
      { stn: larsemann, t: -12, w: 74, gust: 96, vis: 5, p: 978, cond: "Gale gusts", storm: true },
    ];
    for (const w of weatherSeed) {
      await ctx.db.insert(
        "weatherEvents",
        st({
          stationId: w.stn,
          observedTs: t - 12 * MIN,
          temperatureC: w.t,
          windKph: w.w,
          gustKph: w.gust,
          visibilityKm: w.vis,
          pressureHpa: w.p,
          precipitationMm: w.vis < 3 ? 4.2 : 0.6,
          condition: w.cond,
          stormFlag: w.storm,
          simulated: true,
        }),
      );
    }

    /* ---------------- convoy ---------------- */

    const convoy = await ctx.db.insert(
      "convoys",
      st({
        convoyId: "CV-07",
        name: "CONVOY 07",
        missionId: "M-27",
        routeId: rSuhrid,
        originStationId: maitri,
        destinationStationId: campSuhrid,
        personnelIds: ["P-003", "P-004", "P-008"],
        vehicleIds: ["VH-SVH-04", "VH-SVH-05"],
        departureTs: t - 2 * HOUR,
        expectedArrivalTs: t + 2 * HOUR,
        lastCheckinTs: t - 6 * MIN,
        checkinIntervalMin: 30,
        status: "ACTIVE",
        comms: "CONNECTED",
        fuelPct: 68,
        emergencyStatus: "NONE",
        progress: 0.34,
      }),
    );

    await ctx.db.insert(
      "convoys",
      st({
        convoyId: "CV-03",
        name: "CONVOY 03",
        missionId: "M-27",
        routeId: rPriya,
        originStationId: maitri,
        destinationStationId: campPriya,
        personnelIds: ["P-012"],
        vehicleIds: [],
        departureTs: t - 5 * HOUR,
        expectedArrivalTs: t + HOUR,
        lastCheckinTs: t - 17 * MIN,
        checkinIntervalMin: 30,
        status: "ACTIVE",
        comms: "LOW",
        fuelPct: 44,
        emergencyStatus: "NONE",
        progress: 0.71,
      }),
    );

    /* ---------------- tasks ---------------- */

    await ctx.db.insert(
      "tasks",
      st({
        taskId: "TASK-201",
        title: "Generator load audit — Camp Suhrid",
        stationId: campSuhrid,
        assignedTo: ["P-008"],
        dueTs: t + 4 * HOUR,
        status: "IN_PROGRESS",
        priority: "HIGH",
      }),
    );
    await ctx.db.insert(
      "tasks",
      st({
        taskId: "TASK-202",
        title: "Verify incoming consignment container count",
        stationId: bharati,
        assignedTo: ["P-007"],
        dueTs: t + 30 * HOUR,
        status: "OPEN",
        priority: "CRITICAL",
      }),
    );
    await ctx.db.insert(
      "tasks",
      st({
        taskId: "TASK-203",
        title: "Consume batch B-2601 before expiry",
        stationId: bharati,
        assignedTo: ["P-009", "P-010"],
        dueTs: t + 21 * DAY,
        status: "OPEN",
        priority: "ROUTINE",
      }),
    );

    /* ---------------- roster ---------------- */

    const rosterSeed: { id: string; p: string; stn: string; day: string; shift: "ALPHA" | "BRAVO" | "CHARLIE" | "OFF"; duty: string }[] = [
      { id: "RS-001", p: "P-001", stn: maitri, day: "Mon", shift: "ALPHA", duty: "Expedition command" },
      { id: "RS-002", p: "P-002", stn: maitri, day: "Mon", shift: "ALPHA", duty: "Station ops" },
      { id: "RS-003", p: "P-005", stn: maitri, day: "Mon", shift: "ALPHA", duty: "Clinic duty" },
      { id: "RS-004", p: "P-003", stn: campSuhrid, day: "Mon", shift: "ALPHA", duty: "Crevasse survey — Sector C" },
      { id: "RS-005", p: "P-008", stn: campSuhrid, day: "Mon", shift: "BRAVO", duty: "Generator watch" },
      { id: "RS-006", p: "P-006", stn: maitri, day: "Fri", shift: "ALPHA", duty: "H-02 sling mission — Suhrid" },
      { id: "RS-007", p: "P-006", stn: maitri, day: "Fri", shift: "BRAVO", duty: "Bharati escort flight" },
      { id: "RS-008", p: "P-007", stn: bharati, day: "Tue", shift: "BRAVO", duty: "Consignment verification" },
      { id: "RS-009", p: "P-010", stn: larsemann, day: "Wed", shift: "CHARLIE", duty: "Sounding launch" },
    ];
    for (const r of rosterSeed) {
      await ctx.db.insert(
        "roster",
        st({
          rosterId: r.id,
          personId: r.p,
          stationId: r.stn,
          day: r.day,
          shift: r.shift,
          duty: r.duty,
        }),
      );
    }

    /* ---------------- family (Home Link) ---------------- */

    const familyArjun = await ctx.db.insert(
      "familyMembers",
      st({
        familyId: "FM-001",
        name: "Mom",
        relationship: "Parent",
        personId: "P-007",
        authorized: true,
      }),
    );
    await ctx.db.insert(
      "familyMembers",
      st({
        familyId: "FM-002",
        name: "Diya Nair",
        relationship: "Sister",
        personId: "P-007",
        authorized: true,
      }),
    );
    await ctx.db.insert(
      "familyMembers",
      st({
        familyId: "FM-003",
        name: "Dad",
        relationship: "Parent",
        personId: "P-007",
        authorized: true,
      }),
    );

    await ctx.db.insert(
      "familyMessages",
      st({
        messageId: nextId("FAM"),
        familyMemberId: familyArjun,
        personId: "P-007",
        direction: "FAMILY_TO_FIELD",
        type: "TEXT",
        pipeline: ["PLAINTEXT", "ENCRYPTED", "QUEUED (P4)", "TRANSMITTED", "DELIVERED", "OPENED"],
        sizeBytes: 64,
        audioExtractedFirst: false,
        quality: "LOW",
        state: "OPENED",
        createdTs: t - 3 * HOUR,
        deliveredTs: t - 3 * HOUR + 6 * MIN,
        openedTs: t - 3 * HOUR + 9 * MIN,
        expiresTs: t + 60 * DAY,
        encrypted: true,
        privateBody: "Take care ❤️",
      }),
    );

    await ctx.db.insert(
      "wellbeingCheckins",
      st({
        checkinId: nextId("WBI"),
        personId: "P-007",
        ts: t - 2 * HOUR,
        level: "OKAY",
        supportRoute: undefined,
      }),
    );
    await ctx.db.insert(
      "wellbeingCheckins",
      st({
        checkinId: nextId("WBI"),
        personId: "P-003",
        ts: t - 26 * HOUR,
        level: "LOW",
        supportRoute: "TEAM",
      }),
    );
    await ctx.db.insert(
      "wellbeingCheckins",
      st({
        checkinId: nextId("WBI"),
        personId: "P-008",
        ts: t - 30 * HOUR,
        level: "STRUGGLING",
        supportRoute: "FAMILY",
      }),
    );

    await ctx.db.insert(
      "medicalCases",
      st({
        caseId: nextId("MED"),
        personId: "P-011",
        incidentId: undefined,
        observations: "Laceration to right hand during night maintenance; bleeding controlled in the field.",
        vitals: "HR 96 · BP 128/82 · Alert",
        attachments: [],
        priority: "ROUTINE",
        status: "TRANSMITTED",
        recordedBy: "P-012",
        recordedTs: t - 5 * HOUR,
        offlineOrigin: true,
        clinicianNote: "Reviewed at Maitri clinic; sutured. Off field duties for 48 h.",
      }),
    );

    /* ---------------- mission ---------------- */

    await ctx.db.insert(
      "missions",
      st({
        missionId: "M-27",
        name: "27th Indian Scientific Expedition — resupply & traverse",
        expedition: "27th ISE",
        status: "ACTIVE",
        origin: "India",
        destinationId: bharati,
        departureTs: t - 30 * DAY,
        returnTs: t + 60 * DAY,
        transportId: ship,
        personIds: ["P-001", "P-002", "P-003", "P-004", "P-005", "P-006", "P-007"],
      }),
    );

    /* ---------------- connectivity + sim control ---------------- */

    await ctx.db.insert(
      "connectivityEvents",
      st({ eventId: nextId("CON"), ts: t - 5 * HOUR, mode: "NORMAL", note: "Satcom window nominal" }),
    );
    await ctx.db.insert(
      "connectivityEvents",
      st({ eventId: nextId("CON"), ts: t - 40 * MIN, mode: "WEAK", note: "Suhrid + Priyadarshini on store-and-forward" }),
    );
    await ctx.db.insert(
      "simState",
      st({ running: false, tickMs: 5000, tickCount: 0, connectivity: "NORMAL", seed: 20260927 }),
    );

    /* ---------------- audit seed ---------------- */

    await writeAudit(ctx, {
      actor: "POLARIS System",
      actorRole: "SYSTEM",
      action: "Seed loaded — stations Maitri & Bharati (real coordinates) with SIMULATED operational values",
      target: "expedition:M-27",
      result: "OK",
    });
    await writeAudit(ctx, {
      actor: "Comms — Farhan Sheikh",
      actorRole: "STATION_COMMANDER",
      action: "Connectivity degraded NORMAL → LOW; field devices switched to store-and-forward",
      target: "station:bharati",
      result: "OK",
    });
    await writeAudit(ctx, {
      actor: "Control Room Operator 04",
      actorRole: "CONTROL_ROOM",
      action: "Opened incident INC-2609-04 review for Camp Suhrid field team",
      target: "convoy:CV-07",
      result: "OK",
    });

    // Give the convoy devices a last-known position so the map is populated
    // before the simulator is started.
    const routePath = (
      await ctx.db.get(rSuhrid)
    )?.path ?? [];
    const start = pointAlongPath(routePath, 0.34);
    for (const [subjectId, deviceId] of [
      ["P-003", deviceFor("P-003")],
      ["P-004", deviceFor("P-004")],
      ["P-008", deviceFor("P-008")],
    ] as const) {
      await ctx.db.insert(
        "lastKnownPositions",
        st({
          subjectId,
          subjectKind: "person",
          lat: start.lat,
          lon: start.lon,
          accuracyM: 8,
          batteryPct: 58,
          connectivity: subjectId === "P-003" ? "OFFLINE" : "LOW",
          ts: t - 6 * MIN,
          source: "SIMULATOR",
          updatedAt: t,
        }),
      );
      await ctx.db.insert(
        "locationEvents",
        st({
          eventId: nextId("LOC"),
          deviceId,
          subjectId,
          subjectKind: "person",
          lat: start.lat,
          lon: start.lon,
          accuracyM: 8,
          batteryPct: 58,
          connectivity: "LOW",
          ts: t - 6 * MIN,
          ingestedAt: t,
          source: "SIMULATOR",
        }),
      );
    }

    return {
      stations: allStations.length,
      hazards: 6,
      routes: 5,
      convoy,
      persons: personSeed.length,
      cargo: cargoSeed.length,
    };
  },
});
