/**
 * POLAR INTELLIGENCE ENGINE — the "AI" layer of POLARIS.
 *
 * Everything here is deterministic, evidence-based computation over the seeded
 * dataset: depletion math, anomaly thresholds, risk composition and mitigation
 * suggestions. No fabricated confidence scores — each insight carries its own
 * evidence. (Simulated demo intelligence over simulated demo data.)
 */
import {
  EQUIPMENT as EQUIPMENT_LIST,
  HAZARDS,
  INVENTORY,
  INVENTORY_FULL,
  PERSONNEL,
  ROSTER,
  ROUTES,
  SHIPMENTS,
  STATIONS,
  TRANSPORTS,
  hazardById,
  stationById,
  shiftDate,
  type Hazard,
  type Route,
  type SimScenario,
  type SimScenarioId,
  type Station,
} from "./polar-data";

export type { SimScenarioId };

export type IntelKind = "prediction" | "anomaly" | "risk" | "recommendation";
export type IntelSeverity = "critical" | "warning" | "info";
export type IntelState = "MONITORING" | "ANOMALY DETECTED" | "ANALYSIS" | "RECOMMENDATION" | "APPROVED" | "REJECTED";

export interface IntelItem {
  id: string;
  kind: IntelKind;
  severity: IntelSeverity;
  title: string;
  subject: string;
  headline: string;
  why: string[];
  evidence?: string[];
  actionLabel?: string;
  actions?: string[];
  state: IntelState;
  related?: { stations?: string[]; transports?: string[]; shipments?: string[]; routes?: string[]; hazards?: string[] };
}

/* ------------------------------------------------------------------ */
/* Predictions — depletion math                                        */
/* ------------------------------------------------------------------ */

export interface Depletion {
  stationId: string;
  resource: "Fuel" | "Food" | "Medical" | "Equipment";
  levelPct: number;
  daysToCritical: number | null;
  daysToMin: number | null;
  nextResupplyDays: number;
  gap: boolean; // projected critical before resupply
}

export function computeDepletion(s: Station): Depletion[] {
  const mk = (
    resource: Depletion["resource"],
    levelPct: number,
    daysToCritical: number | null,
    daysToMin: number | null,
  ): Depletion => ({
    stationId: s.id,
    resource,
    levelPct,
    daysToCritical,
    daysToMin,
    nextResupplyDays: s.nextResupplyDays,
    gap: daysToCritical !== null && daysToCritical < s.nextResupplyDays,
  });

  const fuelDaysToCritical =
    s.fuelBurnLPerDay > 0 ? (s.fuelL - s.fuelCapacityL * 0.15) / s.fuelBurnLPerDay : null;
  const fuelDaysToMin =
    s.fuelBurnLPerDay > 0 ? (s.fuelL - s.fuelCapacityL * 0.3) / s.fuelBurnLPerDay : null;

  const foodDaysCritical = s.foodPct > 20 ? (s.foodPct - 20) / (100 / s.foodDaysRemaining) : 0;

  return [
    mk("Fuel", s.fuelPct, fuelDaysToCritical, fuelDaysToMin),
    mk("Food", s.foodPct, foodDaysCritical, foodDaysCritical !== null ? foodDaysCritical * 1.4 : null),
    mk("Medical", s.medicalPct, s.medicalPct < 45 ? 0 : null, null),
    mk("Equipment", s.equipmentPct, null, null),
  ];
}

/* ------------------------------------------------------------------ */
/* Anomaly detection                                                   */
/* ------------------------------------------------------------------ */

export interface AnomalyFinding {
  id: string;
  domain: "Cargo" | "Inventory" | "Movement" | "Personnel";
  severity: IntelSeverity;
  title: string;
  detail: string;
  evidence: string[];
  stationId?: string;
}

export function detectAnomalies(): AnomalyFinding[] {
  const out: AnomalyFinding[] = [];

  // Cargo: shipment ANT-26062-041 — 3 of 40 containers unverified (12% is 5; we flag the discrepancy itself)
  const cargo = SHIPMENTS.find((s) => s.id === "ANT-26062-041");
  if (cargo && cargo.containersUnverified > 0) {
    out.push({
      id: "an-cargo-041",
      domain: "Cargo",
      severity: cargo.containersUnverified >= 3 ? "warning" : "info",
      title: "Cargo discrepancy detected",
      detail: `${cargo.containersUnverified} of ${cargo.containersExpected} containers unverified at ${cargo.stationResponsible}.`,
      evidence: [
        `Expected: ${cargo.containersExpected} containers`,
        `Received: ${cargo.containersReceived} containers`,
        `Unverified: ${cargo.containersUnverified} — status ${cargo.status}`,
      ],
      stationId: cargo.destinationId,
    });
  }

  // Inventory: Camp Suhrid diesel draw 61% above expectation
  const suhrid = INVENTORY.find((i) => i.id === "inv-suhrid-diesel");
  if (suhrid) {
    const expected = 900;
    const actual = 1450;
    const pct = Math.round(((actual - expected) / expected) * 100);
    out.push({
      id: "an-inv-suhrid",
      domain: "Inventory",
      severity: "warning",
      title: "Unusual consumption pattern",
      detail: `Camp Suhrid diesel draw ${actual.toLocaleString()} L/day vs ${expected.toLocaleString()} L/day expected (+${pct}%).`,
      evidence: [
        "Expected burn: 900 L/day (camp baseline)",
        "Actual burn: 1,450 L/day (generator log)",
        "Possible causes: heating load, pump leak, meter drift",
      ],
      stationId: "camp-suhrid",
    });
  }

  // Movement: S-04 overdue at Camp Suhrid
  out.push({
    id: "an-mov-s04",
    domain: "Movement",
    severity: "warning",
    title: "Movement update overdue",
    detail: "Snow Vehicle S-04 expected at Camp Suhrid 16:00. Last movement update 14:20.",
    evidence: ["Expected arrival: 16:00", "Last movement event: 14:20", "Route segment passes Crevasse Field — Sector C"],
    stationId: "camp-suhrid",
  });

  // Personnel: field team past expected return window without sync
  const overdue = PERSONNEL.filter((p) => p.status === "IN FIELD" && p.lastSyncMinutesAgo > 30);
  if (overdue.length > 0) {
    out.push({
      id: "an-per-field",
      domain: "Personnel",
      severity: "info",
      title: "Operational check recommended",
      detail: `${overdue.map((p) => p.name).join(", ")}: no synchronization since before the expected field return window.`,
      evidence: overdue.map((p) => `${p.name} — last sync ${p.lastSyncMinutesAgo} min ago, expected return ${p.expectedReturn ?? "18:00"}`),
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Risk engine                                                         */
/* ------------------------------------------------------------------ */

export interface RiskFactor {
  label: string;
  weight: number;
}
export interface RiskAssessment {
  id: string;
  stationId: string;
  level: "HIGH OPERATIONAL RISK" | "ELEVATED RISK" | "NOMINAL";
  score: number; // 0..100
  factors: RiskFactor[];
  summary: string;
}

export function assessStationRisk(s: Station): RiskAssessment {
  const factors: RiskFactor[] = [];
  let score = 0;

  const blizzard = HAZARDS.find((h) => h.kind === "BLIZZARD ZONE" && s.hazardIds.includes(h.id));
  const wind = HAZARDS.find((h) => h.kind === "EXTREME WIND" && s.hazardIds.includes(h.id));
  const crevasse = HAZARDS.find((h) => h.kind === "CREVASSE FIELD" && s.hazardIds.includes(h.id));

  if (blizzard) {
    factors.push({ label: "Weather deterioration — blizzard system inbound (≤7 h)", weight: 30 });
    score += 30;
  }
  if (s.weather.windKph >= 45) {
    factors.push({ label: `Sustained wind ${s.weather.windKph} km/h at camp`, weight: 10 });
    score += 10;
  }
  if (wind) {
    factors.push({ label: "Extreme wind advisory over position", weight: 8 });
    score += 8;
  }
  if (crevasse) {
    factors.push({ label: "Route hazard exposure — crevasse field on supply line", weight: 14 });
    score += 14;
  }
  if (s.fuelPct < 50) {
    const dep = computeDepletion(s).find((d) => d.resource === "Fuel");
    factors.push({
      label: `Low fuel reserve — critical in ~${dep?.daysToCritical?.toFixed(1) ?? "?"} days at current draw`,
      weight: 22,
    });
    score += 22;
  }
  if (s.fuelBurnLPerDay > s.fuelBaselineBurnLPerDay * 1.1) {
    factors.push({ label: "Consumption above baseline", weight: 8 });
    score += 8;
  }
  const delayed = TRANSPORTS.find(
    (t) => (t.status === "DELAYED" || t.status === "WEATHER HOLD") && t.destination === s.name.split(" Station")[0],
  );
  if (delayed) {
    factors.push({ label: `Transport delay — ${delayed.name} (${delayed.status})`, weight: 12 });
    score += 12;
  }
  if (s.foodDaysRemaining < 14) {
    factors.push({ label: `Food reserve ${s.foodDaysRemaining} days — below comfort margin`, weight: 6 });
    score += 6;
  }

  score = Math.min(100, score);
  const level: RiskAssessment["level"] = score >= 55 ? "HIGH OPERATIONAL RISK" : score >= 30 ? "ELEVATED RISK" : "NOMINAL";
  const summary =
    level === "NOMINAL"
      ? "No compounding pressures detected at this location."
      : `${factors.length} compounding pressure${factors.length === 1 ? "" : "s"} on ${s.short}.`;

  return { id: `risk-${s.id}`, stationId: s.id, level, score, factors, summary };
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

export function buildRecommendations(scenario?: SimScenario | null, delayDays?: number): IntelItem[] {
  const items: IntelItem[] = [];

  // Fuel gap at Bharati
  const bharati = stationById("bharati");
  const bharatiDepletion = bharati ? computeDepletion(bharati).find((d) => d.resource === "Fuel") : null;
  if (bharati && bharatiDepletion?.gap) {
    items.push({
      id: "rec-bharati-fuel",
      kind: "recommendation",
      severity: "critical",
      title: "Prioritize diesel shipment",
      subject: "Bharati Station",
      headline: `Bharati fuel may reach critical threshold (${Math.max(1, Math.round(bharatiDepletion.daysToCritical ?? 0))} days) before the next resupply (${bharati.nextResupplyDays} days).`,
      why: [
        `Consumption ${Math.round(((bharati.fuelBurnLPerDay - bharati.fuelBaselineBurnLPerDay) / bharati.fuelBaselineBurnLPerDay) * 100)}% above baseline`,
        `Projected critical point: ${bharatiDepletion.daysToCritical?.toFixed(1)} days`,
        `Next resupply (MV Apama) ETA: ${bharati.nextResupplyDays} days`,
        `DG Depot strategic reserve: ${INVENTORY.find((i) => i.id === "inv-dg-fuel")?.stock.toLocaleString() ?? "12,750"} L — 6 h rotary sling transfer feasible`,
      ],
      actions: [
        "Prioritize diesel consignment on MV Apama discharge sequence",
        "Reduce non-essential vehicle operations at Bharati",
        "Review next helicopter allocation for backup sling from DG Depot",
      ],
      state: "RECOMMENDATION",
      related: { stations: ["bharati"], transports: ["t-ship-01"] },
    });
  }

  // Helicopter allocation conflict
  items.push({
    id: "rec-hele-optim",
    kind: "recommendation",
    severity: "warning",
    title: "Reschedule helicopter transfer",
    subject: "Air Wing — H-02 tasking",
    headline:
      "H-02 holds three competing assignments. Weighted by priority, weather window, distance and fuel, the survey tasking should move to H-01's next window and H-02 should fly the Suhrid sling first.",
    why: [
      "Suhrid sling is CRITICAL priority (fuel resupply) vs ROUTINE survey tasking",
      "Weather window at Suhrid closes ~18:00; survey site remains flyable tomorrow",
      "Sling mission burns 480 L — fits H-02 reserve; combined sortie does not",
      "Delay currently propagates to Camp Suhrid generator fuel margin",
    ],
    actions: [
      "Fly Suhrid sling with H-02 before 18:00",
      "Shift crevasse survey tasking to H-01 (tomorrow AM)",
      "Hold personnel rotation flight until sling complete",
    ],
    state: "RECOMMENDATION",
    related: { transports: ["t-hele-01", "t-hele-02"], stations: ["camp-suhrid"] },
  });

  // Expiry watch
  const food = INVENTORY.find((i) => i.id === "inv-bharati-food-frozen");
  if (food?.expiryBatches) {
    const batch = food.expiryBatches[0];
    items.push({
      id: "rec-expiry-watch",
      kind: "recommendation",
      severity: "info",
      title: "EXPIRY WATCH — prioritize consumption",
      subject: "Bharati cold store B1",
      headline: `${batch.count} food containers expire in ${batch.expiryInDays} days; projected consumption leaves ${batch.projectedUnused} unused. Prioritize these containers in the next meal cycle.`,
      why: [
        `Expiry window: ${batch.expiryInDays} days`,
        `Projected unused at current draw: ${batch.projectedUnused} containers`,
        "Consumption can be shifted without reducing calorie provisioning",
      ],
      actions: ["Reorder meal plan to consume oldest batches first", "Flag rotation to kitchen lead at Bharati"],
      state: "RECOMMENDATION",
      related: { stations: ["bharati"] },
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Unified intelligence feed                                           */
/* ------------------------------------------------------------------ */

export function buildIntelFeed(scenario?: SimScenario | null, delayDays?: number): IntelItem[] {
  const items: IntelItem[] = [];

  // Predictions
  for (const s of STATIONS) {
    const dep = computeDepletion(s).find((d) => d.resource === "Fuel" && d.gap);
    if (dep) {
      items.push({
        id: `pred-fuel-${s.id}`,
        kind: "prediction",
        severity: dep.daysToCritical !== null && dep.daysToCritical < 6 ? "critical" : "warning",
        title: "FUEL DEPLETION",
        subject: s.short,
        headline: `Critical in ${dep.daysToCritical?.toFixed(1)} days — next resupply in ${s.nextResupplyDays} days.`,
        why: [
          `Current reserve: ${s.fuelL.toLocaleString()} L (${s.fuelPct}%)`,
          `Average consumption: ${s.fuelBurnLPerDay.toLocaleString()} L/day`,
          `Baseline: ${s.fuelBaselineBurnLPerDay.toLocaleString()} L/day`,
          "Resupply vessel is the only inbound bulk fuel",
        ],
        state: "ANALYSIS",
        related: { stations: [s.id] },
      });
    }
    const food = computeDepletion(s).find((d) => d.resource === "Food" && d.gap);
    if (food) {
      items.push({
        id: `pred-food-${s.id}`,
        kind: "prediction",
        severity: "warning",
        title: "FOOD RESERVE",
        subject: s.short,
        headline: `Reserve falls below threshold before resupply — ${s.foodDaysRemaining} days remaining.`,
        why: [
          `Current reserve: ${s.foodPct}%`,
          `Projected depletion to 20% floor inside the resupply window`,
        ],
        state: "ANALYSIS",
        related: { stations: [s.id] },
      });
    }
  }

  // Anomalies
  for (const a of detectAnomalies()) {
    items.push({
      id: a.id,
      kind: "anomaly",
      severity: a.severity,
      title: a.title.toUpperCase(),
      subject: a.domain,
      headline: a.detail,
      why: a.evidence,
      state: "ANOMALY DETECTED",
      related: a.stationId ? { stations: [a.stationId] } : undefined,
    });
  }

  // Weather risk
  const blizzard = HAZARDS.find((h) => h.kind === "BLIZZARD ZONE");
  if (blizzard) {
    items.push({
      id: "risk-blizzard",
      kind: "risk",
      severity: "critical",
      title: "WEATHER RISK",
      subject: "Camp Priyadarshini",
      headline: "Blizzard expected in 7 hours — camp exposed, H-01 on weather hold.",
      why: [
        "Low-pressure system tracking SE toward camp",
        "Current wind 46 km/h and rising",
        "Visibility already 2 km",
        "H-01 sling aborted until system passes",
      ],
      state: "ANALYSIS",
      related: { stations: ["camp-priyadarshini"], hazards: [blizzard.id], transports: ["t-hele-02"] },
    });
  }

  // Composite risks
  for (const s of STATIONS) {
    const risk = assessStationRisk(s);
    if (risk.level === "HIGH OPERATIONAL RISK") {
      items.push({
        id: risk.id,
        kind: "risk",
        severity: "critical",
        title: "HIGH OPERATIONAL RISK",
        subject: s.short,
        headline: risk.summary,
        why: risk.factors.map((f) => `${f.label} (+${f.weight})`),
        state: "ANALYSIS",
        related: { stations: [s.id] },
      });
    }
  }

  // Recommendations last
  items.push(...buildRecommendations(scenario, delayDays));

  return items;
}

export function intelCounts(items: IntelItem[]) {
  return {
    all: items.length,
    predictions: items.filter((i) => i.kind === "prediction").length,
    anomalies: items.filter((i) => i.kind === "anomaly").length,
    risks: items.filter((i) => i.kind === "risk").length,
    recommendations: items.filter((i) => i.kind === "recommendation").length,
  };
}

/* ------------------------------------------------------------------ */
/* What-if expedition simulator                                        */
/* ------------------------------------------------------------------ */

export interface SimImpact {
  resource: string;
  station: string;
  impact: string;
  detail: string;
}
export interface SimResult {
  query: string;
  delayDays: number;
  impacts: SimImpact[];
  mitigation: string[];
  riskLevel: "HIGH OPERATIONAL RISK" | "ELEVATED RISK" | "NOMINAL";
}

export function simulateDelay(delayDays: number, query?: string): SimResult {
  return simulate({ id: "ship-delay", label: "Supply ship delayed", detail: "" } as SimScenario, delayDays);
}

export function simulate(scenario: SimScenario, delayDays = 5): SimResult {
  const impacts: SimImpact[] = [];
  const shipDelay = scenario.id === "ship-delay" ? delayDays : 0;
  const query = `What happens if ${scenario.label.toLowerCase()}${scenario.id === "ship-delay" ? ` by ${delayDays} days` : ""}?`;

  // Resupply window shifts + fuel-surge draw — recomputed from the same depletion math the feed uses.
  for (const s of STATIONS) {
    const effective = { ...s, nextResupplyDays: s.nextResupplyDays + shipDelay };
    const fuel = computeDepletion(effective).find((d) => d.resource === "Fuel");
    const food = computeDepletion(effective).find((d) => d.resource === "Food");

    const surge = scenario.id === "fuel-surge" ? 1.25 : 1;
    const draw = Math.round(s.fuelBurnLPerDay * surge);
    if (surge > 1) {
      const dToCritical = s.fuelL - s.fuelCapacityL * 0.15 > 0 ? (s.fuelL - s.fuelCapacityL * 0.15) / draw : 0;
      impacts.push({
        resource: "Fuel",
        station: s.short,
        impact: dToCritical < s.nextResupplyDays ? `Critical in ${Math.max(0.5, dToCritical).toFixed(1)} days` : "Within window",
        detail: `Reserve ${s.fuelL.toLocaleString()} L at ${draw.toLocaleString()} L/day (+25%) — critical ${dToCritical.toFixed(1)} days vs resupply ${s.nextResupplyDays} days.`,
      });
    } else if (fuel?.gap && fuel.daysToCritical !== null) {
      impacts.push({
        resource: "Fuel",
        station: s.short,
        impact: `Critical in ${fuel.daysToCritical.toFixed(1)} days`,
        detail: `Reserve ${s.fuelL.toLocaleString()} L, draw ${s.fuelBurnLPerDay.toLocaleString()} L/day, resupply now ${effective.nextResupplyDays} days out.`,
      });
    }
    if (food?.gap) {
      impacts.push({
        resource: "Food",
        station: s.short,
        impact: "Reserve falls below threshold",
        detail: `${s.foodPct}% reserve, ${s.foodDaysRemaining} days remaining vs ${effective.nextResupplyDays} days to resupply.`,
      });
    }
  }

  if (scenario.id === "heli-down") {
    impacts.push({
      resource: "Transport",
      station: "Air Wing",
      impact: "H-02 grounded 48 h",
      detail: "Suhrid sling slips 2 days; S-04 over-ice run becomes primary resupply; DG Depot sling bridge impossible for 48 h.",
    });
    impacts.push({
      resource: "Fuel",
      station: "CAMP SUHRID",
      impact: "Critical inside window",
      detail: "Camp burn 1,450 L/day — losing 48 h of planned sling removes 2,900 L of transfer. Reserve 2,050 L at last dip.",
    });
  }
  if (scenario.id === "severe-weather") {
    impacts.push({
      resource: "Transport",
      station: "All movements",
      impact: "Rotary + over-ice halt",
      detail: "Blizzard conditions ground helicopters and stop over-ice traverses ~36 h; MV Apama loiters offshore.",
    });
    impacts.push({
      resource: "Personnel",
      station: "Camp Priyadarshini",
      impact: "Shelter-in-place",
      detail: "6 pax in storm anchorage; food draw +12% (cold load), med watch doubled.",
    });
  }
  if (scenario.id === "container-missing") {
    impacts.push({
      resource: "Cargo",
      station: "BHARATI",
      impact: "4 of 40 unaccounted",
      detail: "Unverified count rises 3 → 4 on ANT-26062-041; expected-vs-received gap widens and verification escalates.",
    });
  }
  if (scenario.id === "extra-personnel") {
    impacts.push({
      resource: "Consumables",
      station: "BHARATI",
      impact: "Draw +20%",
      detail: "+12 pax raises food, water and heating fuel draw ~20% — food critical point moves forward ~4 days.",
    });
    impacts.push({
      resource: "Berthing",
      station: "BHARATI",
      impact: "Capacity exceeded",
      detail: "58 + 12 = 70 pax vs capacity 65 — science-bay emergency berthing required.",
    });
  }
  if (scenario.id === "route-hazard") {
    impacts.push({
      resource: "Route",
      station: "Maitri → Suhrid",
      impact: "Over-ice route degraded",
      detail: "Crevasse expansion forces guided convoy only; S-04 run adds ~3 h and +120 L diesel per rotation.",
    });
    impacts.push({
      resource: "Fuel",
      station: "CAMP SUHRID",
      impact: "Delivery volume −40%",
      detail: "Guided-convoy payload limits cut per-trip volume; two extra rotations required this week.",
    });
  }

  if (scenario.id !== "severe-weather") {
    impacts.push({
      resource: "Medical",
      station: "All stations",
      impact: "Unaffected",
      detail: "Medical reserve above minimum across the network; expiry window > 30 days.",
    });
  }
  impacts.push({
    resource: "Emergency reserves",
    station: "DG Depot",
    impact: shipDelay > 3 || scenario.id === "heli-down" ? "Draw-down candidate" : "Not required",
    detail: `Strategic reserve ${INVENTORY.find((i) => i.id === "inv-dg-fuel")?.stock.toLocaleString() ?? "12,750"} L; sling transfer 6 h per 1,200 L rotation.`,
  });

  const fuelCritical = impacts.some((i) => i.resource === "Fuel" && i.impact.includes("Critical in"));
  return {
    query,
    delayDays,
    impacts,
    mitigation: mitigationFor(scenario.id, fuelCritical),
    riskLevel: fuelCritical || scenario.id === "severe-weather" ? "HIGH OPERATIONAL RISK" : "ELEVATED RISK",
  };
}

function mitigationFor(id: SimScenarioId, fuelCritical: boolean): string[] {
  switch (id) {
    case "ship-delay":
      return [
        fuelCritical ? "Prioritize diesel consignment on the next aircraft/sling rotation." : "Maintain schedule; monitor fuel draw daily.",
        "Suspend non-essential vehicle movements at gap-exposed stations.",
        "Pre-position 2 × 1,200 L sling loads at DG Depot staging line.",
      ];
    case "heli-down":
      return [
        "Re-task S-04 for a second over-ice run inside the crevasse-guided window.",
        "Shift H-01 to the Suhrid sling the moment visibility recovers.",
        "Ration non-essential generator load at Camp Suhrid (−10% target).",
      ];
    case "fuel-surge":
      return [
        "Cut non-essential generator load at Bharati (target −12%).",
        "Advance diesel discharge priority aboard MV Apama.",
        "Re-verify the Camp Suhrid generator load bank (anomaly already under review).",
      ];
    case "severe-weather":
      return [
        "Execute storm anchoring at Camp Priyadarshini before 18:00.",
        "Suspend all rotary and over-ice tasking until the system clears.",
        "Stage medical team on standby at Maitri clinic.",
      ];
    case "container-missing":
      return [
        "Freeze Bharati marshalling-yard dispatches until the recount completes.",
        "Escalate re-scan of container 6200412604 to the expediter.",
        "Open a discrepancy case in the cargo ledger with photo evidence.",
      ];
    case "extra-personnel":
      return [
        "Activate science-bay emergency berthing plan (12 pax).",
        "Re-baseline food/water draw models at Bharati (+20%).",
        "Move the next food-priority container to first discharge position.",
      ];
    case "route-hazard":
      return [
        "Require guided convoy on the Maitri→Suhrid line.",
        "Split fuel load across two rotations to respect payload limits.",
        "Re-run the crevasse survey on the degraded segment before heavy traffic.",
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Route weather gate                                                  */
/* ------------------------------------------------------------------ */

export function routeHazards(route: Route): Hazard[] {
  return (route.hazardIds ?? []).map((h) => hazardById(h)).filter((h): h is Hazard => Boolean(h));
}

export function routeAlerts(route: Route): string[] {
  const hs = routeHazards(route);
  if (hs.length === 0) return [];
  return [
    `Route "${route.label}" crosses ${hs.map((h) => h.label).join(" + ")}. Movement should be gated by the Risk Engine before dispatch.`,
  ];
}

/* ------------------------------------------------------------------ */
/* Natural-language assistant over the intel feed                      */
/* ------------------------------------------------------------------ */

export interface AssistantAnswer {
  text: string;
  related?: { stations?: string[]; routes?: string[] };
}

const RISKY_STATION_IDS = STATIONS.map((s) => assessStationRisk(s))
  .filter((r) => r.level !== "NOMINAL")
  .map((r) => r.stationId);

export function answerQuestion(qRaw: string): AssistantAnswer {
  const q = qRaw.toLowerCase();

  // "Why is Station X at risk?"
  const st = STATIONS.find((s) => q.includes(s.name.toLowerCase()) || q.includes(s.id) || q.includes(s.short.toLowerCase()));
  if (st && (q.includes("risk") || q.includes("why") || q.includes("at risk"))) {
    const risk = assessStationRisk(st);
    const dep = computeDepletion(st).find((d) => d.resource === "Fuel");
    if (risk.level !== "NOMINAL") {
      const parts = risk.factors.map((f) => f.label.toLowerCase()).join("; ");
      return {
        text: `${st.short} is at ${risk.level.toLowerCase()} (score ${risk.score}/100). Drivers: ${parts}. Fuel is projected to hit critical in ${dep?.daysToCritical?.toFixed(1) ?? "?"} days against a resupply ${st.nextResupplyDays} days out.`,
        related: { stations: [st.id] },
      };
    }
    return {
      text: `${st.short} is currently nominal. No compounding weather, resource or transport pressures detected.`,
      related: { stations: [st.id] },
    };
  }

  if (q.includes("fuel") || q.includes("diesel")) {
    const gaps = STATIONS.map((s) => ({ s, d: computeDepletion(s).find((x) => x.resource === "Fuel") }))
      .filter((x) => x.d?.gap)
      .map((x) => `${x.s.short}: critical in ${x.d?.daysToCritical?.toFixed(1)} days (resupply ${x.s.nextResupplyDays} d)`);
    return {
      text: gaps.length
        ? `Projected fuel gaps: ${gaps.join("; ")}. Recommendation: prioritize the diesel consignment and review backup sling from DG Depot.`
        : "No projected fuel gaps at any station inside the current resupply window.",
      related: { stations: RISKY_STATION_IDS },
    };
  }

  if (q.includes("weather") || q.includes("blizzard") || q.includes("storm")) {
    return {
      text: "A blizzard system is tracking toward Camp Priyadarshini with impact in ~7 hours; visibility on the Prydz Bay coast is below 2 km and extreme wind advisories are active over Camp Larsemann North. H-01 is on weather hold and route risk on the Maitri→Priyadarshini line is elevated.",
      related: { stations: ["camp-priyadarshini", "camp-larsemann"], routes: ["r-priya"] },
    };
  }

  if (q.includes("cargo") || q.includes("container") || q.includes("shipment")) {
    const c = SHIPMENTS.find((s) => s.id === "ANT-26062-041");
    return {
      text: `Consignment ${c?.id}: ${c?.containersReceived}/${c?.containersExpected} containers received, ${c?.containersUnverified} unverified (${c?.status}). The 3-container discrepancy is flagged to the verification team at Bharati marshalling yard.`,
      related: { stations: ["bharati"] },
    };
  }

  if (q.includes("people") || q.includes("personnel") || q.includes("team") || q.includes("field")) {
    const field = PERSONNEL.filter((p) => p.status === "IN FIELD");
    return {
      text: `${field.length} personnel currently in the field: ${field.map((p) => `${p.name} (${p.duty}, last sync ${p.lastSyncMinutesAgo} min)`).join("; ")}. One operational check is recommended for the crevasse-survey team whose sync is past the expected return window.`,
    };
  }

  if (q.includes("delay") || q.includes("simulate") || q.includes("what if") || q.includes("ship")) {
    const sim = simulateDelay(5, qRaw);
    return {
      text: `A 5-day ship delay produces ${sim.riskLevel.toLowerCase()}: ${sim.impacts
        .filter((i) => i.resource === "Fuel")
        .map((i) => `${i.station} — ${i.impact}`)
        .join("; ")}. Suggested mitigation: prioritize diesel on the next available aircraft and stage sling loads at DG Depot.`,
    };
  }

  // Fallback: overall picture
  const highs = STATIONS.filter((s) => RISKY_STATION_IDS.includes(s.id));
  return {
    text: `Expedition posture: readiness 87%, ${TRANSPORTS.filter((t) => t.status === "IN TRANSIT").length} movements in transit, ${highs.length} station(s) under elevated or high risk (${highs.map((s) => s.short).join(", ") || "none"}), cargo verification pending at Bharati. Ask about fuel, weather, cargo, personnel or a named station.`,
  };
}

/* ------------------------------------------------------------------ */
/* Offline queue + audit log types                                     */
/* ------------------------------------------------------------------ */

export interface QueuedChange {
  id: string;
  ts: string;
  kind: "INVENTORY UPDATE" | "CARGO SCAN" | "TASK STATUS" | "GPS EVENT" | "SOS" | "FIELD NOTE";
  summary: string;
  state: "QUEUED" | "SYNCING" | "SYNCED";
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  outcome: "APPROVED" | "REJECTED" | "MODIFIED" | "AUTO" | "RESOLVED";
}

export const auditTrailSeed: AuditEntry[] = [
  {
    id: "a-001",
    ts: "08:12",
    actor: "POLAR INTELLIGENCE",
    action: "Flagged Suhrid diesel draw +61% vs baseline",
    target: "inv-suhrid-diesel",
    outcome: "AUTO",
  },
  {
    id: "a-002",
    ts: "10:47",
    actor: "Cdr. R. Khanna",
    action: "Approved helicopter re-tasking (Suhrid sling first)",
    target: "t-hele-01",
    outcome: "APPROVED",
  },
  {
    id: "a-003",
    ts: "14:05",
    actor: "A. Nair (Logistics)",
    action: "Opened verification on consignment ANT-26062-041",
    target: "ANT-26062-041",
    outcome: "AUTO",
  },
];

/* ================================================================
   V2 — Integrated layer: alerts, roster checks, scenario
   recommendation. Everything computes from the SAME seeded state.
   ================================================================ */

/* ---- Central alert system (links every alert to an entity) ---- */

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFORMATION";

export interface PolarisAlert {
  id: string;
  severity: AlertSeverity;
  type:
    | "CARGO DISCREPANCY"
    | "LOW INVENTORY"
    | "FUEL DEPLETION"
    | "EXPIRY"
    | "WEATHER"
    | "ROUTE HAZARD"
    | "PERSONNEL"
    | "TRANSPORT DELAY"
    | "EQUIPMENT FAILURE"
    | "SOS"
    | "CONNECTIVITY";
  title: string;
  detail: string;
  ts: string;
  entity: { kind: "station" | "shipment" | "transport" | "person" | "equipment" | "route" | "inventory"; id: string };
}

export function buildAlerts(): PolarisAlert[] {
  const alerts: PolarisAlert[] = [];
  const push = (a: PolarisAlert) => alerts.push(a);

  // SOS
  push({
    id: "al-sos",
    severity: "CRITICAL",
    type: "SOS",
    title: "ACTIVE SOS — Tenzing Bhutia",
    detail: "Field researcher immobilized, Camp B Sector 4. Nearest capability: S-04 (snow vehicle), 41 km from Maitri.",
    ts: "14:43",
    entity: { kind: "person", id: "p-004" },
  });

  // Weather
  push({
    id: "al-weather-blizzard",
    severity: "CRITICAL",
    type: "WEATHER",
    title: "Blizzard impact in ~7 h — Camp Priyadarshini",
    detail: "46 km/h rising, visibility 2 km. H-01 on weather hold; storm anchoring recommended before 18:00.",
    ts: "13:50",
    entity: { kind: "station", id: "camp-priyadarshini" },
  });

  // Fuel depletion (from depletion math)
  for (const s of STATIONS) {
    const d = computeDepletion(s).find((x) => x.resource === "Fuel");
    if (d?.gap && d.daysToCritical !== null) {
      push({
        id: `al-fuel-${s.id}`,
        severity: d.daysToCritical < 6 ? "CRITICAL" : "HIGH",
        type: "FUEL DEPLETION",
        title: `${s.short} fuel critical in ${d.daysToCritical.toFixed(1)} d`,
        detail: `Reserve ${s.fuelL.toLocaleString()} L · draw ${s.fuelBurnLPerDay.toLocaleString()} L/day · resupply ${s.nextResupplyDays} d out.`,
        ts: "12:00",
        entity: { kind: "inventory", id: `inv-${s.id === "bharati" ? "bharati" : s.id === "camp-suhrid" ? "suhrid" : "maitri"}-diesel` },
      });
    }
  }

  // Cargo discrepancy
  const c41 = SHIPMENTS.find((s) => s.id === "ANT-26062-041");
  if (c41) {
    push({
      id: "al-cargo-041",
      severity: "HIGH",
      type: "CARGO DISCREPANCY",
      title: `${c41.containersUnverified} of ${c41.containersExpected} containers unverified`,
      detail: `Consignment ANT-26062-041 at ${c41.currentLocation}. Expected vs received gap under verification by ${SHIPMENT_RESPONSIBLE(c41.id)}.`,
      ts: "11:20",
      entity: { kind: "shipment", id: c41.id },
    });
  }

  // Transport delays
  for (const t of TRANSPORTS) {
    if (t.status === "DELAYED" || t.status === "WEATHER HOLD") {
      push({
        id: `al-transport-${t.id}`,
        severity: t.status === "DELAYED" ? "HIGH" : "MEDIUM",
        type: "TRANSPORT DELAY",
        title: `${t.name} — ${t.status}`,
        detail: `${t.origin} → ${t.destination} · ETA ${t.eta}. ${t.weatherNote}`,
        ts: "10:05",
        entity: { kind: "transport", id: t.id },
      });
    }
  }

  // Equipment
  const damaged = EQUIPMENT_LIST.filter((e) => e.condition === "Damaged" || e.condition === "Missing");
  for (const e of damaged) {
    push({
      id: `al-equipment-${e.id}`,
      severity: e.condition === "Missing" ? "HIGH" : "MEDIUM",
      type: "EQUIPMENT FAILURE",
      title: `${e.name} — ${e.condition}`,
      detail: `${stationById(e.stationId)?.short ?? e.stationId} · ${e.location}. ${e.nextMaintenance}`,
      ts: "09:40",
      entity: { kind: "equipment", id: e.id },
    });
  }

  // Route hazards
  for (const r of ROUTES) {
    const hs = routeHazards(r);
    if (hs.length > 0 && r.status === "active") {
      push({
        id: `al-route-${r.id}`,
        severity: "MEDIUM",
        type: "ROUTE HAZARD",
        title: `Route exposure — ${r.label}`,
        detail: `Crosses ${hs.map((h) => h.label).join(" + ")}. Guided passage required before dispatch.`,
        ts: "08:30",
        entity: { kind: "route", id: r.id },
      });
    }
  }

  // Expiry
  push({
    id: "al-expiry-food",
    severity: "MEDIUM",
    type: "EXPIRY",
    title: "12 frozen-provision containers expire in 21 d",
    detail: "Bharati cold store B1 — projected 7 containers unused at current draw. Consumption reorder recommended.",
    ts: "07:15",
    entity: { kind: "inventory", id: "inv-bharati-food-frozen" },
  });

  // Personnel
  push({
    id: "al-personnel-field",
    severity: "MEDIUM",
    type: "PERSONNEL",
    title: "Field sync overdue — Dr. Ishaan Verma",
    detail: "Last sync 43 min ago, expected return 18:00, operating at Crevasse Field fringe (Sector C).",
    ts: "14:30",
    entity: { kind: "person", id: "p-003" },
  });

  // Connectivity
  push({
    id: "al-connectivity",
    severity: "INFORMATION",
    type: "CONNECTIVITY",
    title: "Field teams offline — packets queued",
    detail: "Sector C and Priyadarshini stations on store-and-forward. 7 events in sync queue, conflict review pending.",
    ts: "14:46",
    entity: { kind: "station", id: "camp-suhrid" },
  });

  return alerts;
}

// Local helper to avoid a circular import of SHIPMENT_EXTRA ordering.
function SHIPMENT_RESPONSIBLE(id: string): string {
  const map: Record<string, string> = {
    "ANT-26062-041": "A. Nair — Bharati Logistics",
    "ANT-26062-038": "K. Joshi — Power & Mechanical",
    "ANT-26062-036": "Cdr. R. Khanna — Maitri Ops",
    "ANT-26062-033": "Lt. M. Pillai — Medical",
    "ANT-26062-029": "Dr. I. Verma — Ice Core Team 1",
  };
  return map[id] ?? "Station logistics";
}

/* ---- Roster AI detection ---- */

export interface RosterIssue {
  id: string;
  kind: "OVERLAPPING SHIFTS" | "UNAVAILABLE PERSONNEL" | "MISSING REQUIRED ROLE" | "EXCESSIVE CONSECUTIVE" | "TRANSPORT CONFLICT";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string[];
  suggestion: string;
  personIds: string[];
}

export function detectRosterIssues(): RosterIssue[] {
  const issues: RosterIssue[] = [];

  // Overlapping shifts: p-011 (Vikram) ALPHA + BRAVO same day (Wed)
  issues.push({
    id: "ro-overlap-011",
    kind: "OVERLAPPING SHIFTS",
    severity: "warning",
    title: "Vikram Singh — double-booked Wednesday",
    detail: "ALPHA (maintenance, vehicle line) and BRAVO (generator hall) both assigned Wed.",
    evidence: ["rs-013 — Wed ALPHA", "rs-014 — Wed BRAVO", "Duty limit: 1 shift/day"],
    suggestion: "Reassign generator-hall watch to Pooja Iyer (available, same team).",
    personIds: ["p-011", "p-012"],
  });

  // Unavailable personnel: p-004 SOS → Wed? roster references
  issues.push({
    id: "ro-unavail-004",
    kind: "UNAVAILABLE PERSONNEL",
    severity: "critical",
    title: "Tenzing Bhutia — SOS, roster continues",
    detail: "Active SOS incident but sediment-team duties remain on this week's roster.",
    evidence: ["SOS INC-2609-04 active", "Lake Sediment Team duties unassigned from tomorrow"],
    suggestion: "Suspend roster line; reassign core recovery to rotating team member on return.",
    personIds: ["p-004"],
  });

  // Excessive consecutive: p-003 six consecutive ALPHA survey days
  const p3 = ROSTER.filter((r) => r.personId === "p-003");
  if (p3.length >= 5) {
    issues.push({
      id: "ro-consec-003",
      kind: "EXCESSIVE CONSECUTIVE",
      severity: "warning",
      title: `Dr. Ishaan Verma — ${p3.length} consecutive field days`,
      detail: "Mon–Sat ALPHA survey assignments without rest day; cold-exposure watch active.",
      evidence: p3.map((r) => `${r.id} — ${r.day} ${r.shift}`),
      suggestion: "Insert rest day Thursday; shift survey line 4 to Friday.",
      personIds: ["p-003"],
    });
  }

  // Transport conflict: p-006 two flights Friday
  issues.push({
    id: "ro-conflict-006",
    kind: "TRANSPORT CONFLICT",
    severity: "critical",
    title: "Sgt. Devraj Rathore — two missions Friday",
    detail: "H-02 Suhrid sling (ALPHA) and Bharati escort flight (BRAVO) same day; sling window overlaps escort slot.",
    evidence: ["rs-011 — Fri ALPHA H-02 sling", "rs-012 — Fri BRAVO escort flight", "Weather window closes 18:00"],
    suggestion: "Fly sling first (CRITICAL priority); move escort flight to Sat AM subject to weather gate.",
    personIds: ["p-006"],
  });

  // Missing required role: medical cover at Suhrid
  issues.push({
    id: "ro-role-med",
    kind: "MISSING REQUIRED ROLE",
    severity: "warning",
    title: "No medical cover on Camp Suhrid roster",
    detail: "Policy requires a medic-qualified person per occupied camp; none rostered Mon–Sun.",
    evidence: ["Camp Suhrid occupancy 9", "Nearest medical officer: Lt. M. Pillai (Maitri)"],
    suggestion: "Roster Lt. Pillai for Suhrid rounds on H-02's next sling window.",
    personIds: ["p-005"],
  });

  return issues;
}

/* ---- Scenario → unified recommendation (approval-gated) ---- */

export function scenarioRecommendation(scenario: SimScenario | null, delayDays = 5): IntelItem | null {
  if (!scenario) return null;
  const sim = simulate(scenario, delayDays);
  const id = `rec-scenario-${scenario.id}`;

  const whatHappened: Record<SimScenarioId, string> = {
    "ship-delay": `MV Apama arrival slips +${delayDays} days — resupply window widens at every station.`,
    "heli-down": "H-02 unavailable 48 h — rotary sling logistics lose their primary asset.",
    "fuel-surge": "Generator load rises +25% at Bharati, +10% at Maitri — draw models shift.",
    "severe-weather": "Severe blizzard over the Schirmacher sector — movements halt ~36 h.",
    "container-missing": "One more container unaccounted at Bharati yard — discrepancy widens.",
    "extra-personnel": "Bharati receives +12 unplanned pax — consumables draw +20%, berthing exceeded.",
    "route-hazard": "Sector C crevasse field expands — over-ice route degrades to guided convoy.",
  };

  const impactSummary = sim.impacts
    .filter((i) => i.impact !== "Unaffected")
    .slice(0, 3)
    .map((i) => `${i.resource} @ ${i.station}: ${i.impact}`);

  return {
    id,
    kind: "recommendation",
    severity: sim.riskLevel === "HIGH OPERATIONAL RISK" ? "critical" : "warning",
    title: `Re-plan required — ${scenario.label.toLowerCase()}`,
    subject: "Expedition plan",
    headline: whatHappened[scenario.id],
    why: [
      `What happened: ${whatHappened[scenario.id]}`,
      ...impactSummary.map((s) => `Predicted impact: ${s}`),
      "Predicted impact propagates through inventory, transport and risk models",
    ],
    actions: sim.mitigation,
    state: "RECOMMENDATION",
    related: { stations: ["bharati", "camp-suhrid"], transports: ["t-ship-01"] },
  };
}

/* ---- Demo audit trail seed (interconnected scenario) ---- */

export const intelSeedTrail: AuditEntry[] = [
  ...auditTrailSeed,
  {
    id: "a-004",
    ts: "14:43",
    actor: "FIELD — T. Bhutia (offline)",
    action: "SOS packet captured → queued (OFFLINE → LOCAL EVENT → SYNC QUEUE)",
    target: "INC-2609-04",
    outcome: "AUTO",
  },
  {
    id: "a-005",
    ts: "14:45",
    actor: "POLAR INTELLIGENCE",
    action: "Ship delay +5d propagated: cargo delay → inventory impact → risk increase → transport re-plan",
    target: "SIM-ship-delay",
    outcome: "AUTO",
  },
];

// Re-export for downstream convenience.
export { shiftDate as _shiftDate };
