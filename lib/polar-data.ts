/**
 * POLARIS — seeded expedition dataset (SIMULATED DEMO DATA).
 * All values are realistic but synthetic; nothing here is a live feed.
 */

export type AssetKind = "ship" | "helicopter" | "aircraft" | "vehicle" | "person" | "cargo";
export type StationKind = "station" | "camp" | "depot";
export type OpStatus = "nominal" | "watch" | "critical";
export type TransportStatus =
  | "ON TIME"
  | "IN TRANSIT"
  | "DELAYED"
  | "WEATHER HOLD"
  | "COMPLETED"
  | "CANCELLED";
export type ShipmentStatus =
  | "AT HQ WAREHOUSE"
  | "LOADED"
  | "TRANSPORTED"
  | "ARRIVED"
  | "UNLOADED"
  | "RECEIVED"
  | "SCANNED"
  | "STORED"
  | "CONSUMED"
  | "CANCELLED";
export type HazardKind =
  | "CREVASSE FIELD"
  | "BLIZZARD ZONE"
  | "LOW VISIBILITY"
  | "RESTRICTED AREA"
  | "EXTREME WIND";

export interface Station {
  id: string;
  name: string;
  short: string;
  kind: StationKind;
  lat: number;
  lon: number;
  status: OpStatus;
  personnel: number;
  capacity: number;
  fuelPct: number;
  fuelL: number;
  fuelCapacityL: number;
  fuelBurnLPerDay: number;
  fuelBaselineBurnLPerDay: number;
  foodPct: number;
  foodDaysRemaining: number;
  medicalPct: number;
  equipmentPct: number;
  nextResupplyDays: number;
  weather: { tempC: number; windKph: number; visibilityKm: number; condition: string };
  hazardIds: string[];
  activeTasks: number;
  nextTransportId?: string;
  established: string;
  note: string;
}

export interface MapAsset {
  id: string;
  label: string;
  kind: AssetKind;
  lat: number;
  lon: number;
  stationId?: string;
  transportId?: string;
  detail: string;
  routeId?: string;
  progress?: number; // 0..1 along route, undefined = static
  speedPerTick?: number;
}

export interface Hazard {
  id: string;
  kind: HazardKind;
  label: string;
  severity: "critical" | "warning" | "info";
  /** SVG polygon points, computed in map space by the component. */
  lat: number;
  lon: number;
  radiusKm: number;
  note: string;
}

export interface Route {
  id: string;
  label: string;
  kind: "sea" | "ice" | "air";
  status: "active" | "planned";
  fromId: string;
  toId: string;
  /** Waypoints [lon, lat]. */
  waypoints: [number, number][];
  hazardIds?: string[];
}

export interface Shipment {
  id: string;
  status: ShipmentStatus;
  category: string;
  origin: string;
  destinationId: string;
  stationResponsible: string;
  weightKg: number;
  priority: "ROUTINE" | "HIGH" | "CRITICAL";
  containersExpected: number;
  containersReceived: number;
  containersUnverified: number;
  dispatchDate: string;
  expectedArrival: string;
  actualArrival?: string;
  currentLocation: string;
  transportId?: string;
  barcode: string;
  rfid: string;
}

export interface InventoryItem {
  id: string;
  stationId: string;
  category: string;
  name: string;
  stock: number;
  unit: string;
  minThreshold: number;
  criticalThreshold: number;
  consumptionPerDay: number;
  storageLocation: string;
  expiryBatches?: { count: number; expiryInDays: number; projectedUnused: number }[];
  note?: string;
}

export interface Personnel {
  id: string;
  name: string;
  role: string;
  team: string;
  stationId: string;
  status: "AT STATION" | "IN FIELD" | "IN TRANSIT" | "REST";
  shift: "ALPHA" | "BRAVO" | "CHARLIE" | "OFF";
  lastSyncMinutesAgo: number;
  duty: string;
  emergencyContact: string;
  expectedReturn?: string;
}

export interface Transport {
  id: string;
  name: string;
  kind: AssetKind;
  origin: string;
  destination: string;
  status: TransportStatus;
  etd: string;
  eta: string;
  cargoSummary: string;
  personnelCount: number;
  capacity: string;
  fuelNote: string;
  weatherNote: string;
  routeId?: string;
  delayDays?: number;
}

export const STATIONS: Station[] = [
  {
    id: "maitri",
    name: "Maitri Station",
    short: "MAITRI",
    kind: "station",
    lat: -70.75,
    lon: 11.73,
    status: "watch",
    personnel: 96,
    capacity: 110,
    fuelPct: 72,
    fuelL: 11880,
    fuelCapacityL: 16500,
    fuelBurnLPerDay: 980,
    fuelBaselineBurnLPerDay: 940,
    foodPct: 64,
    foodDaysRemaining: 41,
    medicalPct: 78,
    equipmentPct: 68,
    nextResupplyDays: 9,
    weather: { tempC: -18, windKph: 22, visibilityKm: 6, condition: "Light snow" },
    hazardIds: ["hz-01"],
    activeTasks: 14,
    nextTransportId: "t-svh-01",
    established: "1989",
    note: "Primary logistics hub for the Schirmacher Oasis region. Summer expedition HQ.",
  },
  {
    id: "bharati",
    name: "Bharati Station",
    short: "BHARATI",
    kind: "station",
    lat: -69.4,
    lon: 76.18,
    status: "critical",
    personnel: 58,
    capacity: 65,
    fuelPct: 38,
    fuelL: 8420,
    fuelCapacityL: 22000,
    fuelBurnLPerDay: 1120,
    fuelBaselineBurnLPerDay: 950,
    foodPct: 62,
    foodDaysRemaining: 17,
    medicalPct: 71,
    equipmentPct: 54,
    nextResupplyDays: 9,
    weather: { tempC: -14, windKph: 31, visibilityKm: 4, condition: "Snow showers" },
    hazardIds: ["hz-03", "hz-04"],
    activeTasks: 11,
    nextTransportId: "t-ship-01",
    established: "2012",
    note: "Larsemann Hills research station. Awaiting MV Apama resupply consignment.",
  },
  {
    id: "camp-suhrid",
    name: "Camp Suhrid",
    short: "CAMP SUHRID",
    kind: "camp",
    lat: -71.1,
    lon: 14.8,
    status: "watch",
    personnel: 9,
    capacity: 12,
    fuelPct: 41,
    fuelL: 2050,
    fuelCapacityL: 5000,
    fuelBurnLPerDay: 1450,
    fuelBaselineBurnLPerDay: 900,
    foodPct: 55,
    foodDaysRemaining: 12,
    medicalPct: 66,
    equipmentPct: 61,
    nextResupplyDays: 9,
    weather: { tempC: -21, windKph: 18, visibilityKm: 8, condition: "Clear" },
    hazardIds: ["hz-01"],
    activeTasks: 4,
    nextTransportId: "t-hele-01",
    established: "Seasonal",
    note: "Glaciology field camp on the polar ice shelf. Diesel generators running above baseline.",
  },
  {
    id: "camp-priyadarshini",
    name: "Camp Priyadarshini",
    short: "CAMP PRIYADARSHINI",
    kind: "camp",
    lat: -70.6,
    lon: 10.2,
    status: "critical",
    personnel: 6,
    capacity: 10,
    fuelPct: 58,
    fuelL: 1740,
    fuelCapacityL: 3000,
    fuelBurnLPerDay: 160,
    fuelBaselineBurnLPerDay: 150,
    foodPct: 70,
    foodDaysRemaining: 15,
    medicalPct: 74,
    equipmentPct: 59,
    nextResupplyDays: 9,
    weather: { tempC: -19, windKph: 46, visibilityKm: 2, condition: "Deteriorating" },
    hazardIds: ["hz-02"],
    activeTasks: 3,
    nextTransportId: "t-hele-02",
    established: "Seasonal",
    note: "Lake-sediment coring team. Blizzard system expected within 7 hours.",
  },
  {
    id: "camp-larsemann",
    name: "Camp Larsemann North",
    short: "CAMP LARSEMANN N",
    kind: "camp",
    lat: -68.9,
    lon: 77.5,
    status: "watch",
    personnel: 8,
    capacity: 10,
    fuelPct: 63,
    fuelL: 1890,
    fuelCapacityL: 3000,
    fuelBurnLPerDay: 140,
    fuelBaselineBurnLPerDay: 140,
    foodPct: 66,
    foodDaysRemaining: 18,
    medicalPct: 80,
    equipmentPct: 57,
    nextResupplyDays: 9,
    weather: { tempC: -12, windKph: 74, visibilityKm: 5, condition: "Gale gusts" },
    hazardIds: ["hz-05", "hz-04"],
    activeTasks: 2,
    established: "Seasonal",
    note: "Atmospheric monitoring detachment. Extreme wind advisories in effect.",
  },
  {
    id: "dg-depot",
    name: "Dakshin Gangotri Depot",
    short: "DG DEPOT",
    kind: "depot",
    lat: -70.45,
    lon: 12.0,
    status: "nominal",
    personnel: 7,
    capacity: 10,
    fuelPct: 85,
    fuelL: 12750,
    fuelCapacityL: 15000,
    fuelBurnLPerDay: 0,
    fuelBaselineBurnLPerDay: 0,
    foodPct: 90,
    foodDaysRemaining: 60,
    medicalPct: 85,
    equipmentPct: 72,
    nextResupplyDays: 9,
    weather: { tempC: -16, windKph: 12, visibilityKm: 9, condition: "Clear" },
    hazardIds: [],
    activeTasks: 1,
    established: "1983 (depot)",
    note: "Ice-shelf fuel and dry-store depot. Reserve buffer for the Schirmacher region.",
  },
];

export const HAZARDS: Hazard[] = [
  {
    id: "hz-01",
    kind: "CREVASSE FIELD",
    label: "Crevasse Field — Sector C",
    severity: "critical",
    lat: -70.95,
    lon: 13.4,
    radiusKm: 9,
    note: "Unbridged crevasses detected on the Suhrid over-ice route. Ground movement requires guided passage.",
  },
  {
    id: "hz-02",
    kind: "BLIZZARD ZONE",
    label: "Blizzard System — Priyadarshini",
    severity: "critical",
    lat: -70.35,
    lon: 9.4,
    radiusKm: 26,
    note: "Low-pressure system approaching from the northwest. Impact expected within 7 hours.",
  },
  {
    id: "hz-03",
    kind: "LOW VISIBILITY",
    label: "Low Visibility — Prydz Bay Coast",
    severity: "warning",
    lat: -68.8,
    lon: 74.8,
    radiusKm: 30,
    note: "Visibility below 2 km. VFR helicopter operations suspended along the coast.",
  },
  {
    id: "hz-04",
    kind: "RESTRICTED AREA",
    label: "Restricted — ASPA 135 Boundary",
    severity: "info",
    lat: -69.15,
    lon: 77.0,
    radiusKm: 12,
    note: "Protected ASMA zone. Entry with environmental permit only; no cargo staging.",
  },
  {
    id: "hz-05",
    kind: "EXTREME WIND",
    label: "Extreme Wind — Larsemann North",
    severity: "warning",
    lat: -68.75,
    lon: 77.9,
    radiusKm: 14,
    note: "Gusts to 110 km/h. Secure loose cargo; no external hoist operations.",
  },
];

export const ROUTES: Route[] = [
  {
    id: "r-ship",
    label: "MV Apama — sea approach",
    kind: "sea",
    status: "active",
    fromId: "sea-nw",
    toId: "bharati",
    waypoints: [
      [56, -64.6],
      [63, -66.4],
      [69, -68.2],
      [76.2, -69.4],
    ],
  },
  {
    id: "r-suhrid",
    label: "Maitri → Camp Suhrid (over-ice)",
    kind: "ice",
    status: "active",
    fromId: "maitri",
    toId: "camp-suhrid",
    waypoints: [
      [11.73, -70.75],
      [12.6, -70.9],
      [13.5, -70.98],
      [14.8, -71.1],
    ],
    hazardIds: ["hz-01"],
  },
  {
    id: "r-priya",
    label: "Maitri → Camp Priyadarshini",
    kind: "ice",
    status: "planned",
    fromId: "maitri",
    toId: "camp-priyadarshini",
    waypoints: [
      [11.73, -70.75],
      [11.1, -70.68],
      [10.2, -70.6],
    ],
    hazardIds: ["hz-02"],
  },
  {
    id: "r-larsemann",
    label: "Bharati → Camp Larsemann North",
    kind: "ice",
    status: "planned",
    fromId: "bharati",
    toId: "camp-larsemann",
    waypoints: [
      [76.18, -69.4],
      [76.9, -69.15],
      [77.5, -68.9],
    ],
    hazardIds: ["hz-03", "hz-05"],
  },
  {
    id: "r-air-203",
    label: "IA-203 air corridor",
    kind: "air",
    status: "active",
    fromId: "bharati",
    toId: "maitri",
    waypoints: [
      [76.18, -69.4],
      [58, -66.5],
      [40, -68.0],
      [11.73, -70.75],
    ],
    hazardIds: ["hz-03"],
  },
];

export const TRANSPORTS: Transport[] = [
  {
    id: "t-ship-01",
    name: "MV Apama",
    kind: "ship",
    origin: "Cape Town HQ Warehouse",
    destination: "Bharati",
    status: "IN TRANSIT",
    etd: "21 Sep",
    eta: "03 Oct",
    cargoSummary: "Diesel, dry rations, emergency equipment, science modules",
    personnelCount: 12,
    capacity: "1,000 t / 42 TEU",
    fuelNote: "Bunkers sufficient for approach + 4 days loiter",
    weatherNote: "Sea state 4, swell 2.5 m — within limits",
    routeId: "r-ship",
  },
  {
    id: "t-hele-01",
    name: "Helicopter H-02",
    kind: "helicopter",
    origin: "Maitri",
    destination: "Camp Suhrid",
    status: "DELAYED",
    etd: "15:30",
    eta: "16:40",
    cargoSummary: "Diesel sling load (1,200 L), camp spares",
    personnelCount: 0,
    capacity: "1,400 kg sling",
    fuelNote: "Sling mission burns 480 L — competes with survey tasking",
    weatherNote: "Window closes 18:00 ahead of approaching system",
    routeId: "r-suhrid",
    delayDays: 1,
  },
  {
    id: "t-hele-02",
    name: "Helicopter H-01",
    kind: "helicopter",
    origin: "Maitri",
    destination: "Camp Priyadarshini",
    status: "WEATHER HOLD",
    etd: "17:00",
    eta: "17:35",
    cargoSummary: "Food top-up, storm anchoring kit",
    personnelCount: 2,
    capacity: "6 pax / 900 kg",
    fuelNote: "Within limits",
    weatherNote: "HOLD — blizzard system ETA 7 h",
    routeId: "r-priya",
  },
  {
    id: "t-air-01",
    name: "Flight IA-203",
    kind: "aircraft",
    origin: "Bharati",
    destination: "Maitri",
    status: "IN TRANSIT",
    etd: "12:10",
    eta: "15:45",
    cargoSummary: "Priority mail, 2 pax rotation, medical re-supply",
    personnelCount: 4,
    capacity: "18 pax / 2.4 t",
    fuelNote: "Fuel + reserve nominal",
    weatherNote: "Cruise FL180, light ice below 8,000 ft",
    routeId: "r-air-203",
  },
  {
    id: "t-svh-01",
    name: "Snow Vehicle S-04",
    kind: "vehicle",
    origin: "Maitri",
    destination: "Camp Suhrid",
    status: "IN TRANSIT",
    etd: "13:10",
    eta: "16:00",
    cargoSummary: "Generator fuel (800 L), two technicians",
    personnelCount: 2,
    capacity: "2.5 t",
    fuelNote: "Crevasse route — guided passage mandatory",
    weatherNote: "Clear along route at last update",
    routeId: "r-suhrid",
  },
  {
    id: "t-svh-02",
    name: "Snow Vehicle S-02",
    kind: "vehicle",
    origin: "Maitri",
    destination: "DG Depot",
    status: "COMPLETED",
    etd: "09:40",
    eta: "11:20",
    cargoSummary: "Empty pallets return, mail",
    personnelCount: 1,
    capacity: "2.5 t",
    fuelNote: "Refuelled at depot",
    weatherNote: "Clear",
  },
];

export const SHIPMENTS: Shipment[] = [
  {
    id: "ANT-26062-041",
    status: "ARRIVED",
    category: "General resupply",
    origin: "Cape Town HQ Warehouse",
    destinationId: "bharati",
    stationResponsible: "Bharati",
    weightKg: 18400,
    priority: "HIGH",
    containersExpected: 40,
    containersReceived: 37,
    containersUnverified: 3,
    dispatchDate: "12 Sep",
    expectedArrival: "24 Sep",
    actualArrival: "24 Sep",
    currentLocation: "Bharati marshalling yard",
    barcode: "6200412604",
    rfid: "RF-ANT-041-2606",
  },
  {
    id: "ANT-26062-038",
    status: "TRANSPORTED",
    category: "Diesel fuel",
    origin: "Cape Town HQ Warehouse",
    destinationId: "bharati",
    stationResponsible: "Bharati",
    weightKg: 272000,
    priority: "CRITICAL",
    containersExpected: 34,
    containersReceived: 0,
    containersUnverified: 0,
    dispatchDate: "21 Sep",
    expectedArrival: "03 Oct",
    currentLocation: "Aboard MV Apama",
    transportId: "t-ship-01",
    barcode: "6200382603",
    rfid: "RF-ANT-038-2606",
  },
  {
    id: "ANT-26062-036",
    status: "LOADED",
    category: "Dry rations",
    origin: "Cape Town HQ Warehouse",
    destinationId: "maitri",
    stationResponsible: "Maitri",
    weightKg: 6400,
    priority: "HIGH",
    containersExpected: 12,
    containersReceived: 0,
    containersUnverified: 0,
    dispatchDate: "21 Sep",
    expectedArrival: "04 Oct",
    currentLocation: "HQ Warehouse — berth staged",
    transportId: "t-ship-01",
    barcode: "6200362603",
    rfid: "RF-ANT-036-2606",
  },
  {
    id: "ANT-26062-033",
    status: "TRANSPORTED",
    category: "Medical supplies",
    origin: "Maitri",
    destinationId: "camp-priyadarshini",
    stationResponsible: "Maitri",
    weightKg: 210,
    priority: "CRITICAL",
    containersExpected: 2,
    containersReceived: 0,
    containersUnverified: 0,
    dispatchDate: "25 Sep",
    expectedArrival: "25 Sep",
    currentLocation: "Staged at Maitri helipad — weather hold",
    transportId: "t-hele-02",
    barcode: "6200332603",
    rfid: "RF-ANT-033-2606",
  },
  {
    id: "ANT-26062-029",
    status: "STORED",
    category: "Science equipment",
    origin: "Cape Town HQ Warehouse",
    destinationId: "camp-suhrid",
    stationResponsible: "Maitri",
    weightKg: 980,
    priority: "ROUTINE",
    containersExpected: 6,
    containersReceived: 6,
    containersUnverified: 0,
    dispatchDate: "05 Sep",
    expectedArrival: "18 Sep",
    actualArrival: "18 Sep",
    currentLocation: "Camp Suhrid — stored, lifecycle complete",
    barcode: "6200292602",
    rfid: "RF-ANT-029-2606",
  },
];

export const INVENTORY: InventoryItem[] = [
  {
    id: "inv-bharati-diesel",
    stationId: "bharati",
    category: "Fuel",
    name: "Diesel (generators + fleet)",
    stock: 8420,
    unit: "L",
    minThreshold: 5000,
    criticalThreshold: 2500,
    consumptionPerDay: 1120,
    storageLocation: "Bharati tank farm A",
    note: "Consumption 18% above baseline — generator load high",
  },
  {
    id: "inv-bharati-food-frozen",
    stationId: "bharati",
    category: "Food",
    name: "Frozen provisions",
    stock: 62,
    unit: "% reserve",
    minThreshold: 40,
    criticalThreshold: 20,
    consumptionPerDay: 3.6,
    storageLocation: "Cold store B1",
    expiryBatches: [
      { count: 12, expiryInDays: 21, projectedUnused: 7 },
      { count: 4, expiryInDays: 45, projectedUnused: 0 },
    ],
  },
  {
    id: "inv-bharati-medical",
    stationId: "bharati",
    category: "Medical",
    name: "Medical consumables",
    stock: 71,
    unit: "% reserve",
    minThreshold: 50,
    criticalThreshold: 30,
    consumptionPerDay: 2.1,
    storageLocation: "Clinic, Bharati main",
    expiryBatches: [{ count: 3, expiryInDays: 34, projectedUnused: 0 }],
  },
  {
    id: "inv-bharati-jetfuel",
    stationId: "bharati",
    category: "Fuel",
    name: "Aviation fuel (Jet A-1)",
    stock: 2300,
    unit: "L",
    minThreshold: 2000,
    criticalThreshold: 1200,
    consumptionPerDay: 180,
    storageLocation: "Bharati fuel bay C",
  },
  {
    id: "inv-maitri-food-dry",
    stationId: "maitri",
    category: "Food",
    name: "Dry rations",
    stock: 64,
    unit: "% reserve",
    minThreshold: 40,
    criticalThreshold: 20,
    consumptionPerDay: 3.1,
    storageLocation: "Dry store, Maitri",
    expiryBatches: [
      { count: 12, expiryInDays: 21, projectedUnused: 7 },
      { count: 8, expiryInDays: 52, projectedUnused: 0 },
    ],
  },
  {
    id: "inv-maitri-diesel",
    stationId: "maitri",
    category: "Fuel",
    name: "Diesel (generators + fleet)",
    stock: 11880,
    unit: "L",
    minThreshold: 6000,
    criticalThreshold: 3000,
    consumptionPerDay: 980,
    storageLocation: "Maitri tank farm",
  },
  {
    id: "inv-suhrid-diesel",
    stationId: "camp-suhrid",
    category: "Fuel",
    name: "Diesel (camp generators)",
    stock: 2050,
    unit: "L",
    minThreshold: 1500,
    criticalThreshold: 800,
    consumptionPerDay: 1450,
    storageLocation: "Camp Suhrid fuel sled",
    note: "Expected 900 L/day — actual 1,450 L/day under review",
  },
  {
    id: "inv-priya-medical",
    stationId: "camp-priyadarshini",
    category: "Medical",
    name: "Field trauma kit",
    stock: 74,
    unit: "% reserve",
    minThreshold: 60,
    criticalThreshold: 40,
    consumptionPerDay: 1.2,
    storageLocation: "Camp P. med locker",
  },
  {
    id: "inv-maitri-batteries",
    stationId: "maitri",
    category: "Equipment",
    name: "LiFePO₄ field batteries",
    stock: 54,
    unit: "% reserve",
    minThreshold: 50,
    criticalThreshold: 30,
    consumptionPerDay: 1.4,
    storageLocation: "Maitri tech store",
  },
  {
    id: "inv-dg-fuel",
    stationId: "dg-depot",
    category: "Fuel",
    name: "Diesel reserve stock",
    stock: 12750,
    unit: "L",
    minThreshold: 5000,
    criticalThreshold: 2500,
    consumptionPerDay: 0,
    storageLocation: "Ice-shelf drum line",
    note: "Strategic reserve — 6 h rotary sling transfer to Bharati feasible",
  },
];

export const PERSONNEL: Personnel[] = [
  {
    id: "p-001",
    name: "Dr. Anjali Menon",
    role: "Expedition Commander",
    team: "Command",
    stationId: "maitri",
    status: "AT STATION",
    shift: "ALPHA",
    lastSyncMinutesAgo: 2,
    duty: "Expedition-wide coordination",
    emergencyContact: "On file — command channel",
  },
  {
    id: "p-002",
    name: "Cdr. Rajat Khanna",
    role: "Station Manager",
    team: "Maitri Operations",
    stationId: "maitri",
    status: "AT STATION",
    shift: "ALPHA",
    lastSyncMinutesAgo: 4,
    duty: "Station ops + helipad authority",
    emergencyContact: "On file — station channel",
  },
  {
    id: "p-003",
    name: "Dr. Ishaan Verma",
    role: "Glaciologist",
    team: "Ice Core Team 1",
    stationId: "camp-suhrid",
    status: "IN FIELD",
    shift: "ALPHA",
    lastSyncMinutesAgo: 43,
    duty: "Crevasse survey — Sector C fringe",
    emergencyContact: "On file — field ops",
    expectedReturn: "18:00",
  },
  {
    id: "p-004",
    name: "Tenzing Bhutia",
    role: "Field Researcher",
    team: "Lake Sediment Team",
    stationId: "camp-priyadarshini",
    status: "IN FIELD",
    shift: "ALPHA",
    lastSyncMinutesAgo: 9,
    duty: "Sediment core recovery",
    emergencyContact: "On file — field ops",
    expectedReturn: "17:30",
  },
  {
    id: "p-005",
    name: "Lt. Meera Pillai",
    role: "Medical Officer",
    team: "Medical",
    stationId: "maitri",
    status: "AT STATION",
    shift: "ALPHA",
    lastSyncMinutesAgo: 3,
    duty: "Clinic + emergency response lead",
    emergencyContact: "On file — med channel",
  },
  {
    id: "p-006",
    name: "Sgt. Devraj Rathore",
    role: "Helicopter Pilot",
    team: "Air Wing",
    stationId: "maitri",
    status: "IN TRANSIT",
    shift: "ALPHA",
    lastSyncMinutesAgo: 6,
    duty: "H-02 sling mission (delayed)",
    emergencyContact: "On file — air ops",
  },
  {
    id: "p-007",
    name: "Arjun Nair",
    role: "Logistics Officer",
    team: "Bharati Operations",
    stationId: "bharati",
    status: "AT STATION",
    shift: "BRAVO",
    lastSyncMinutesAgo: 5,
    duty: "Consignment ANT-26062-041 verification",
    emergencyContact: "On file — logistics",
  },
  {
    id: "p-008",
    name: "Kavita Joshi",
    role: "Engineer",
    team: "Power & Mechanical",
    stationId: "camp-suhrid",
    status: "IN FIELD",
    shift: "BRAVO",
    lastSyncMinutesAgo: 38,
    duty: "Generator load audit (diesel draw)",
    emergencyContact: "On file — engineering",
  },
  {
    id: "p-009",
    name: "Farhan Sheikh",
    role: "Communications Engineer",
    team: "Comms",
    stationId: "bharati",
    status: "AT STATION",
    shift: "BRAVO",
    lastSyncMinutesAgo: 7,
    duty: "Satcom window scheduling",
    emergencyContact: "On file — comms",
  },
  {
    id: "p-010",
    name: "Dr. Sneha Kulkarni",
    role: "Atmospheric Scientist",
    team: "Atmospherics",
    stationId: "camp-larsemann",
    status: "AT STATION",
    shift: "CHARLIE",
    lastSyncMinutesAgo: 11,
    duty: "Kite-loon soundings (wind limited)",
    emergencyContact: "On file — science",
  },
  {
    id: "p-011",
    name: "Vikram Singh",
    role: "Technician",
    team: "Power & Mechanical",
    stationId: "maitri",
    status: "REST",
    shift: "OFF",
    lastSyncMinutesAgo: 62,
    duty: "Roster conflict under review — two overlapping assignments",
    emergencyContact: "On file — station channel",
  },
  {
    id: "p-012",
    name: "Pooja Iyer",
    role: "Technician",
    team: "Power & Mechanical",
    stationId: "maitri",
    status: "AT STATION",
    shift: "ALPHA",
    lastSyncMinutesAgo: 8,
    duty: "Available for maintenance reassignment",
    emergencyContact: "On file — station channel",
  },
];

export const FLEET_ASSETS: MapAsset[] = [
  {
    id: "a-ship-01",
    label: "MV Apama",
    kind: "ship",
    lat: -66.9,
    lon: 60.5,
    transportId: "t-ship-01",
    routeId: "r-ship",
    progress: 0.55,
    speedPerTick: 0.0035,
    detail: "Supply ship — diesel, rations, emergency + science cargo for Bharati & Maitri",
  },
  {
    id: "a-helo-01",
    label: "H-01",
    kind: "helicopter",
    lat: -70.68,
    lon: 11.4,
    stationId: "maitri",
    transportId: "t-hele-02",
    detail: "Weather hold at Maitri helipad",
  },
  {
    id: "a-helo-02",
    label: "H-02",
    kind: "helicopter",
    lat: -70.79,
    lon: 11.95,
    stationId: "maitri",
    transportId: "t-hele-01",
    detail: "Delayed — three competing taskings under AI review",
  },
  {
    id: "a-air-01",
    label: "IA-203",
    kind: "aircraft",
    lat: -67.8,
    lon: 42,
    transportId: "t-air-01",
    routeId: "r-air-203",
    progress: 0.4,
    speedPerTick: 0.005,
    detail: "Fixed-wing rotation Bharati → Maitri",
  },
  {
    id: "a-svh-04",
    label: "S-04",
    kind: "vehicle",
    lat: -70.97,
    lon: 13.1,
    stationId: "maitri",
    transportId: "t-svh-01",
    routeId: "r-suhrid",
    progress: 0.78,
    speedPerTick: 0.0016,
    detail: "Snow vehicle — fuel sled to Camp Suhrid, last movement 14:20",
  },
  {
    id: "a-svh-02",
    label: "S-02",
    kind: "vehicle",
    lat: -70.5,
    lon: 12.15,
    stationId: "dg-depot",
    detail: "Parked at DG Depot after completed run",
  },
  {
    id: "a-field-01",
    label: "Field Team 1",
    kind: "person",
    lat: -71.02,
    lon: 13.9,
    stationId: "camp-suhrid",
    detail: "Dr. Ishaan Verma + 2 — crevasse survey, last sync 43 min ago",
  },
];

export const WEATHER_NOW = {
  tempC: -18,
  windKph: 22,
  visibilityKm: 6,
  condition: "Light snow",
  pressureHpa: 992,
};

export const KPI_SEED = {
  missionReadiness: 87,
  personnelOnIce: 184,
  personnelAuthorized: 190,
  cargoDeliveredPct: 98,
  alertsActive: 3,
};

/** Equirectangular projection into an 1000×640 map space. */
export const MAP_W = 1000;
export const MAP_H = 640;
const LAT_TOP = -64;
const LAT_BOTTOM = -78;
const LON_LEFT = -4;
const LON_RIGHT = 86;

export function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - LON_LEFT) / (LON_RIGHT - LON_LEFT)) * MAP_W;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * MAP_H;
  return { x, y };
}

export function pointAlongRoute(routeId: string, t: number): { lat: number; lon: number } {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route || route.waypoints.length < 2) return { lat: -70, lon: 12 };
  const clamped = Math.max(0, Math.min(1, t));
  const segFloat = clamped * (route.waypoints.length - 1);
  const seg = Math.min(Math.floor(segFloat), route.waypoints.length - 2);
  const f = segFloat - seg;
  const [lonA, latA] = route.waypoints[seg];
  const [lonB, latB] = route.waypoints[seg + 1];
  return { lat: latA + (latB - latA) * f, lon: lonA + (lonB - lonA) * f };
}

export function routePath(route: Route): string {
  return route.waypoints
    .map(([lon, lat], i) => {
      const { x, y } = project(lat, lon);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export const stationById = (id: string) => STATIONS.find((s) => s.id === id);
export const hazardById = (id: string) => HAZARDS.find((h) => h.id === id);
export const transportById = (id: string) => TRANSPORTS.find((t) => t.id === id);

/* ================================================================
   V2 — Integrated logistics layer (same simulated demo system)
   ================================================================ */

/* ---- Cargo lifecycle (Warehouse → … → Consumed/Deployed) ---- */

export const LIFECYCLE_STAGES = [
  "Warehouse",
  "Loaded",
  "Dispatched",
  "In Transit",
  "Arrived",
  "Unloaded",
  "Received",
  "Scanned",
  "Stored",
  "Consumed/Deployed",
] as const;

const LIFECYCLE_STATUS: Record<number, ShipmentStatus> = {
  0: "AT HQ WAREHOUSE",
  1: "LOADED",
  2: "TRANSPORTED",
  3: "TRANSPORTED",
  4: "ARRIVED",
  5: "UNLOADED",
  6: "RECEIVED",
  7: "SCANNED",
  8: "STORED",
  9: "CONSUMED",
};

export function lifecycleIndex(status: ShipmentStatus): number {
  const map: Record<ShipmentStatus, number> = {
    "AT HQ WAREHOUSE": 0,
    LOADED: 1,
    TRANSPORTED: 3,
    ARRIVED: 4,
    UNLOADED: 5,
    RECEIVED: 6,
    SCANNED: 7,
    STORED: 8,
    CONSUMED: 9,
    CANCELLED: -1,
  };
  return map[status];
}

export function advanceStatus(status: ShipmentStatus): ShipmentStatus {
  const i = lifecycleIndex(status);
  if (i < 0 || i >= 9) return status;
  return LIFECYCLE_STATUS[i + 1];
}

/* ---- Supplementary shipment + personnel fields (detail views) ---- */

export const SHIPMENT_EXTRA: Record<
  string,
  { responsible: string; quantity: string; receivedNote?: string }
> = {
  "ANT-26062-041": {
    responsible: "Arjun Nair — Bharati Logistics",
    quantity: "40 containers · mixed consignment",
    receivedNote: "3 containers seal-intact but RFID unverified",
  },
  "ANT-26062-038": { responsible: "Kavita Joshi — Power & Mechanical", quantity: "34 × 8,000 L iso-tank" },
  "ANT-26062-036": { responsible: "Cdr. Rajat Khanna — Maitri Ops", quantity: "12 pallets · 5,330 kg" },
  "ANT-26062-033": { responsible: "Lt. Meera Pillai — Medical", quantity: "2 cold-chain boxes" },
  "ANT-26062-029": { responsible: "Dr. Ishaan Verma — Ice Core Team 1", quantity: "6 crates · radar + core tooling" },
};

export const PERSONNEL_EXTRA: Record<
  string,
  { connectivity: "SATELLITE" | "VHF" | "WIFI" | "OFFLINE"; battery: number; medical: string }
> = {
  "p-001": { connectivity: "WIFI", battery: 84, medical: "Fit — full duties" },
  "p-002": { connectivity: "WIFI", battery: 91, medical: "Fit — full duties" },
  "p-003": { connectivity: "OFFLINE", battery: 38, medical: "Cold exposure watch — right hand" },
  "p-004": { connectivity: "OFFLINE", battery: 34, medical: "Immobilized — suspected ankle fracture (SOS)" },
  "p-005": { connectivity: "WIFI", battery: 88, medical: "Fit — on call" },
  "p-006": { connectivity: "VHF", battery: 76, medical: "Fit — duty limits OK" },
  "p-007": { connectivity: "WIFI", battery: 81, medical: "Fit — full duties" },
  "p-008": { connectivity: "SATELLITE", battery: 57, medical: "Fit — full duties" },
  "p-009": { connectivity: "WIFI", battery: 93, medical: "Fit — full duties" },
  "p-010": { connectivity: "WIFI", battery: 66, medical: "Fit — full duties" },
  "p-011": { connectivity: "WIFI", battery: 90, medical: "Fit — rest cycle" },
  "p-012": { connectivity: "WIFI", battery: 87, medical: "Fit — full duties" },
};

/* ---- Extended inventory categories ---- */

export const INVENTORY_EXTRA: InventoryItem[] = [
  {
    id: "inv-bharati-water",
    stationId: "bharati",
    category: "Water",
    name: "Potable water",
    stock: 74,
    unit: "% reserve",
    minThreshold: 50,
    criticalThreshold: 30,
    consumptionPerDay: 2.8,
    storageLocation: "Melt-water plant + tanks",
  },
  {
    id: "inv-maitri-emergency",
    stationId: "maitri",
    category: "Emergency",
    name: "Emergency rations & shelter kits",
    stock: 82,
    unit: "% reserve",
    minThreshold: 70,
    criticalThreshold: 50,
    consumptionPerDay: 0.4,
    storageLocation: "Maitri emergency store",
  },
  {
    id: "inv-bharati-protective",
    stationId: "bharati",
    category: "Protective Equipment",
    name: "Cold-weather suits (MK-III)",
    stock: 68,
    unit: "% reserve",
    minThreshold: 60,
    criticalThreshold: 45,
    consumptionPerDay: 1.1,
    storageLocation: "Bharati gear issue",
  },
  {
    id: "inv-suhrid-batteries",
    stationId: "camp-suhrid",
    category: "Batteries",
    name: "LiFePO₄ field batteries",
    stock: 47,
    unit: "% reserve",
    minThreshold: 50,
    criticalThreshold: 30,
    consumptionPerDay: 1.6,
    storageLocation: "Camp Suhrid tech box",
    note: "Below minimum reserve — replacement set aboard MV Apama",
  },
  {
    id: "inv-maitri-samples",
    stationId: "maitri",
    category: "Samples",
    name: "Freezer capacity (samples)",
    stock: 71,
    unit: "% free",
    minThreshold: 30,
    criticalThreshold: 15,
    consumptionPerDay: 1.2,
    storageLocation: "Maitri science freezer",
  },
];

export const INVENTORY_FULL: InventoryItem[] = [...INVENTORY, ...INVENTORY_EXTRA];

/* ---- Equipment & asset registry ---- */

export interface EquipmentRecord {
  id: string;
  rfid: string;
  category: "Science" | "Operational" | "Comms" | "Power";
  name: string;
  stationId: string;
  team: string;
  condition: "Operational" | "Maintenance" | "Damaged" | "Missing" | "Decommissioned";
  lastInspection: string;
  nextMaintenance: string;
  location: string;
}

export const EQUIPMENT: EquipmentRecord[] = [
  { id: "EQ-101", rfid: "RF-EQ-101", category: "Science", name: "Ice-core drill rig", stationId: "camp-suhrid", team: "Ice Core Team 1", condition: "Operational", lastInspection: "18 Sep", nextMaintenance: "12 Oct", location: "Camp Suhrid drill line" },
  { id: "EQ-118", rfid: "RF-EQ-118", category: "Power", name: "Generator G-2 (100 kVA)", stationId: "camp-suhrid", team: "Power & Mechanical", condition: "Maintenance", lastInspection: "20 Sep", nextMaintenance: "01 Oct — overdue 6 d", location: "Camp Suhrid power hut" },
  { id: "EQ-207", rfid: "RF-EQ-207", category: "Comms", name: "Satcom terminal B", stationId: "bharati", team: "Comms", condition: "Operational", lastInspection: "21 Sep", nextMaintenance: "19 Oct", location: "Bharati comms loft" },
  { id: "EQ-334", rfid: "RF-EQ-334", category: "Science", name: "Sediment corer (multi-tube)", stationId: "camp-priyadarshini", team: "Lake Sediment Team", condition: "Damaged", lastInspection: "22 Sep", nextMaintenance: "Awaiting damage assessment", location: "Camp P. science tent" },
  { id: "EQ-402", rfid: "RF-EQ-402", category: "Operational", name: "Snow vehicle sledge train", stationId: "maitri", team: "Logistics", condition: "Operational", lastInspection: "19 Sep", nextMaintenance: "08 Oct", location: "Maitri vehicle line" },
  { id: "EQ-511", rfid: "RF-EQ-511", category: "Science", name: "AWS mast anemometer", stationId: "camp-larsemann", team: "Atmospherics", condition: "Maintenance", lastInspection: "21 Sep", nextMaintenance: "27 Sep", location: "Larsemann N mast" },
  { id: "EQ-612", rfid: "RF-EQ-612", category: "Power", name: "Fuel transfer pump P-7", stationId: "dg-depot", team: "Logistics", condition: "Operational", lastInspection: "15 Sep", nextMaintenance: "15 Oct", location: "DG drum line" },
  { id: "EQ-777", rfid: "RF-EQ-777", category: "Comms", name: "Field radio pack (×6)", stationId: "camp-suhrid", team: "Comms", condition: "Missing", lastInspection: "—", nextMaintenance: "Loss reported 14:31", location: "Last seen — Sector C fringe" },
];

/* ---- Scientific sample tracking (chain of custody) ---- */

export interface SampleRecord {
  id: string;
  category: "Ice core" | "Sediment core" | "Air particulate";
  stationId: string;
  collector: string;
  team: string;
  collectedOn: string;
  storage: string;
  destination: string;
  transport: string;
  custody: { ts: string; actor: string; note: string }[];
  condition: "VERIFIED" | "IN CUSTODY" | "FLAGGED";
}

export const SAMPLES: SampleRecord[] = [
  {
    id: "SMP-001",
    category: "Ice core",
    stationId: "camp-suhrid",
    collector: "Dr. Ishaan Verma",
    team: "Ice Core Team 1",
    collectedOn: "19 Sep",
    storage: "−25°C freezer",
    destination: "NCPOR Goa — ice core archive",
    transport: "Flight IA-203 · planned 02 Oct",
    custody: [
      { ts: "19 Sep 16:20", actor: "Dr. I. Verma", note: "Core extracted — 84.2 m depth" },
      { ts: "19 Sep 18:05", actor: "Camp Suhrid science bay", note: "Logged into freezer, condition verified" },
      { ts: "22 Sep 10:15", actor: "H-02 crew", note: "Transferred to Maitri science freezer" },
    ],
    condition: "IN CUSTODY",
  },
  {
    id: "SMP-002",
    category: "Sediment core",
    stationId: "camp-priyadarshini",
    collector: "Tenzing Bhutia",
    team: "Lake Sediment Team",
    collectedOn: "21 Sep",
    storage: "+4°C chiller",
    destination: "NCPOR Goa — paleolimnology lab",
    transport: "Awaiting rotary slot — weather dependent",
    custody: [
      { ts: "21 Sep 15:40", actor: "T. Bhutia", note: "Multi-tube core recovered — Lake S-3" },
      { ts: "21 Sep 16:55", actor: "Camp P. lab", note: "Chilled storage — seal verified" },
      { ts: "25 Sep 09:30", actor: "POLAR INTELLIGENCE", note: "FLAGGED — blizzard exposure window under review" },
    ],
    condition: "FLAGGED",
  },
  {
    id: "SMP-031",
    category: "Air particulate",
    stationId: "camp-larsemann",
    collector: "Dr. Sneha Kulkarni",
    team: "Atmospherics",
    collectedOn: "24 Sep",
    storage: "Ambient sealed",
    destination: "IITM Pune — aerosol lab",
    transport: "Flight IA-203 · planned 02 Oct",
    custody: [
      { ts: "24 Sep 08:10", actor: "Dr. S. Kulkarni", note: "Filter cassette recovered — 72 h run" },
      { ts: "24 Sep 08:30", actor: "Camp Larsemann N", note: "Sealed + manifested" },
    ],
    condition: "VERIFIED",
  },
];

/* ---- Roster & shifts ---- */

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface RosterSlot {
  id: string;
  personId: string;
  stationId: string;
  day: Weekday;
  shift: "ALPHA" | "BRAVO" | "CHARLIE";
  duty: string;
}

export const ROSTER: RosterSlot[] = [
  { id: "rs-001", personId: "p-001", stationId: "maitri", day: "Mon", shift: "ALPHA", duty: "Expedition command" },
  { id: "rs-002", personId: "p-002", stationId: "maitri", day: "Mon", shift: "ALPHA", duty: "Station ops" },
  { id: "rs-003", personId: "p-005", stationId: "maitri", day: "Mon", shift: "ALPHA", duty: "Clinic duty" },
  { id: "rs-004", personId: "p-003", stationId: "camp-suhrid", day: "Mon", shift: "ALPHA", duty: "Crevasse survey — Sector C" },
  { id: "rs-005", personId: "p-008", stationId: "camp-suhrid", day: "Mon", shift: "BRAVO", duty: "Generator watch" },
  { id: "rs-006", personId: "p-003", stationId: "camp-suhrid", day: "Tue", shift: "ALPHA", duty: "Core processing" },
  { id: "rs-007", personId: "p-003", stationId: "camp-suhrid", day: "Wed", shift: "ALPHA", duty: "Survey line 3" },
  { id: "rs-008", personId: "p-003", stationId: "camp-suhrid", day: "Thu", shift: "ALPHA", duty: "Survey line 4" },
  { id: "rs-009", personId: "p-003", stationId: "camp-suhrid", day: "Fri", shift: "ALPHA", duty: "Survey line 5" },
  { id: "rs-010", personId: "p-003", stationId: "camp-suhrid", day: "Sat", shift: "ALPHA", duty: "Survey line 6" },
  { id: "rs-011", personId: "p-006", stationId: "maitri", day: "Fri", shift: "ALPHA", duty: "H-02 sling mission — Suhrid" },
  { id: "rs-012", personId: "p-006", stationId: "maitri", day: "Fri", shift: "BRAVO", duty: "Bharati escort flight" },
  { id: "rs-013", personId: "p-011", stationId: "maitri", day: "Wed", shift: "ALPHA", duty: "Maintenance — vehicle line" },
  { id: "rs-014", personId: "p-011", stationId: "maitri", day: "Wed", shift: "BRAVO", duty: "Generator hall watch" },
  { id: "rs-015", personId: "p-007", stationId: "bharati", day: "Tue", shift: "BRAVO", duty: "Consignment verification" },
  { id: "rs-016", personId: "p-009", stationId: "bharati", day: "Tue", shift: "BRAVO", duty: "Satcom window" },
  { id: "rs-017", personId: "p-010", stationId: "camp-larsemann", day: "Wed", shift: "CHARLIE", duty: "Sounding launch" },
];

/* ---- What-if scenario catalogue ---- */

export type SimScenarioId =
  | "ship-delay"
  | "heli-down"
  | "fuel-surge"
  | "severe-weather"
  | "container-missing"
  | "extra-personnel"
  | "route-hazard";

export interface SimScenario {
  id: SimScenarioId;
  label: string;
  detail: string;
  hasDelay?: boolean;
}

export const SIM_SCENARIOS: SimScenario[] = [
  { id: "ship-delay", label: "Supply ship delayed", detail: "MV Apama arrives late — every downstream forecast shifts", hasDelay: true },
  { id: "heli-down", label: "Helicopter unavailable", detail: "H-02 grounded 48 h — sling logistics re-plan" },
  { id: "fuel-surge", label: "Fuel consumption increases", detail: "Heating load +25% at Bharati, +10% at Maitri" },
  { id: "severe-weather", label: "Severe weather event", detail: "Blizzard over the Schirmacher sector — movements halt" },
  { id: "container-missing", label: "Cargo container missing", detail: "One more container unaccounted at Bharati yard" },
  { id: "extra-personnel", label: "Station receives extra personnel", detail: "Bharati +12 pax unplanned — consumption model shifts" },
  { id: "route-hazard", label: "Route becomes hazardous", detail: "Sector C crevasse field expands — over-ice route degraded" },
];

/* ---- Date + geo helpers ---- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Shift a "24 Sep" / "03 Oct" style demo date by N days. */
export function shiftDate(dateStr: string, days: number): string {
  const m = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (!m) return dateStr;
  const monthIdx = MONTHS.indexOf(m[2].slice(0, 1).toUpperCase() + m[2].slice(1).toLowerCase());
  if (monthIdx < 0) return dateStr;
  const d = new Date(2026, monthIdx, Number(m[1]));
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

/** Great-circle-ish distance (km) good enough for demo nearest-capability math. */
export function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
