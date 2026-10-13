/**
 * Offline sync engine tests.
 *
 * These pin the safety guarantees the whole system rests on:
 *   1. an SOS is never blocked, delayed, or reordered behind anything else
 *   2. offline edits are never silently overwritten
 *   3. stale telemetry is never presented as live
 *
 * A regression in any of these is a mission-safety defect, not a cosmetic bug.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";

import {
  BANDWIDTH_ALLOWLIST,
  PRIORITY_NAME,
  allEvents,
  enqueue,
  nextBatch,
  priorityFor,
  type ConnectivityMode,
  type FieldEventType,
} from "../offline-queue";
import {
  FRESH_LIVE_MS,
  FRESH_STALE_MS,
  freshnessLabel,
  freshnessOf,
  type FieldEventEnvelope,
} from "../polar-db";
import {
  detectVersionConflict,
  orderEventsForSync,
} from "../../convex/polaris/lib";

/* ------------------------------------------------------------------ */
/* Priority ladder                                                     */
/* ------------------------------------------------------------------ */

describe("priority ladder", () => {
  it("places SOS alone at P0", () => {
    expect(priorityFor("SOS")).toBe(0);
    const others: FieldEventType[] = [
      "PERSONNEL_SAFETY",
      "CHECK_IN",
      "TASK_COMPLETE",
      "LOCATION_UPDATE",
      "HAZARD_ACKNOWLEDGED",
      "WEATHER_OBSERVATION",
      "CARGO_SCAN",
      "INVENTORY_UPDATE",
      "TRANSPORT_UPDATE",
      "FAMILY_REPLY",
      "FIELD_NOTE",
      "FIELD_REPORT",
    ];
    for (const type of others) {
      expect(priorityFor(type)).not.toBe(0);
    }
  });

  it("orders family media below all operational and safety traffic", () => {
    expect(priorityFor("FAMILY_REPLY")).toBe(4);
    for (const type of [
      "SOS",
      "PERSONNEL_SAFETY",
      "LOCATION_UPDATE",
      "CARGO_SCAN",
    ] as FieldEventType[]) {
      expect(priorityFor(type)).toBeLessThan(priorityFor("FAMILY_REPLY"));
    }
  });

  it("has a human-readable label for every priority level", () => {
    for (const p of [0, 1, 2, 3, 4, 5] as const) {
      expect(PRIORITY_NAME[p]).toBeTruthy();
    }
  });

  it("keeps personnel-safety events at P1 on the server, not P5", () => {
    // Regression guard. The browser queue and the server each used to own a
    // separate FieldEventType union. `PERSONNEL_SAFETY` existed only in the
    // browser (as P1) and fell through the server's `default: return 5`
    // branch, so `syncBatch` re-sorted a personnel-safety event to the very
    // bottom of the queue -- behind family video. The ladder now lives in one
    // place, so both sides must agree.
    expect(priorityFor("PERSONNEL_SAFETY")).toBe(1);
    expect(priorityFor("TASK_COMPLETE")).toBe(1);
    expect(priorityFor("WEATHER_OBSERVATION")).toBe(2);
    expect(priorityFor("TRANSPORT_UPDATE")).toBe(3);
    expect(priorityFor("FIELD_REPORT")).toBe(5);
    expect(priorityFor("FIELD_NOTE")).toBe(5);
  });

  it("throws on an unmapped event type instead of quietly returning P5", () => {
    // Silently defaulting is precisely how safety traffic gets demoted, so an
    // unknown type must be loud.
    const bogus = "TOTALLY_MADE_UP" as Parameters<typeof priorityFor>[0];
    expect(() => priorityFor(bogus)).toThrow(/UNMAPPED FIELD EVENT TYPE/);
  });

  it("orders a P1 event ahead of a P4 family message on the server too", () => {
    const ordered = orderEventsForSync([
      event("FAMILY_REPLY", 1_000),
      event("PERSONNEL_SAFETY", 2_000),
    ]);
    expect(ordered.map((e) => e.type)).toEqual(["PERSONNEL_SAFETY", "FAMILY_REPLY"]);
  });
});

const event = (
  type: FieldEventEnvelope["type"],
  recordedAt: number,
): FieldEventEnvelope =>
  ({
    eventId: `${type}-${recordedAt}`,
    deviceId: "DEV-TEST",
    type,
    recordedAt,
  }) as FieldEventEnvelope;

describe("orderEventsForSync", () => {
  it("sends a late-recorded SOS ahead of everything, including newer events", () => {
    // The SOS was recorded last in wall-clock time but must still go first.
    const ordered = orderEventsForSync([
      event("FIELD_REPORT", 1_000),
      event("FAMILY_REPLY", 2_000),
      event("LOCATION_UPDATE", 3_000),
      event("SOS", 9_000),
    ]);
    expect(ordered[0].type).toBe("SOS");
  });

  it("emits a strictly non-decreasing priority sequence", () => {
    const ordered = orderEventsForSync([
      event("FIELD_REPORT", 1_000),
      event("FAMILY_REPLY", 2_000),
      event("CARGO_SCAN", 3_000),
      event("CHECK_IN", 4_000),
      event("SOS", 5_000),
      event("LOCATION_UPDATE", 6_000),
    ]);
    const priorities = ordered.map((e) => priorityFor(e.type));
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it("breaks priority ties by device timestamp, not by arrival order", () => {
    const ordered = orderEventsForSync([
      event("LOCATION_UPDATE", 3_000),
      event("LOCATION_UPDATE", 1_000),
      event("LOCATION_UPDATE", 2_000),
    ]);
    expect(ordered.map((e) => e.recordedAt)).toEqual([1_000, 2_000, 3_000]);
  });

  it("does not mutate the caller's array", () => {
    const input = [event("FAMILY_REPLY", 1), event("SOS", 2)];
    const copy = [...input];
    orderEventsForSync(input);
    expect(input).toEqual(copy);
  });
});

/* ------------------------------------------------------------------ */
/* Bandwidth gating                                                    */
/* ------------------------------------------------------------------ */

describe("bandwidth allowlist", () => {
  it("permits SOS on every link that can transmit at all", () => {
    for (const mode of ["CONNECTED", "LOW_BANDWIDTH", "VERY_LOW_BANDWIDTH"] as ConnectivityMode[]) {
      expect(BANDWIDTH_ALLOWLIST[mode]).toContain(0);
    }
  });

  it("transmits nothing while offline", () => {
    expect(BANDWIDTH_ALLOWLIST.OFFLINE).toEqual([]);
  });

  it("holds family media back on any degraded link", () => {
    expect(BANDWIDTH_ALLOWLIST.LOW_BANDWIDTH).not.toContain(4);
    expect(BANDWIDTH_ALLOWLIST.VERY_LOW_BANDWIDTH).not.toContain(4);
  });

  it("narrows monotonically as the link degrades", () => {
    const full = BANDWIDTH_ALLOWLIST.CONNECTED.length;
    const low = BANDWIDTH_ALLOWLIST.LOW_BANDWIDTH.length;
    const veryLow = BANDWIDTH_ALLOWLIST.VERY_LOW_BANDWIDTH.length;
    expect(full).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(veryLow);
    expect(veryLow).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* The real IndexedDB queue                                            */
/* ------------------------------------------------------------------ */

describe("offline queue", () => {
  beforeEach(async () => {
    // fake-indexeddb keeps state for the life of the file, so wipe the store
    // between cases. deleteDatabase is async and only fires once no
    // connection is open, hence the promise wrapper.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("polaris-field");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("dequeues SOS first even when it was enqueued last", async () => {
    await enqueue("FAMILY_REPLY", {});
    await enqueue("FIELD_REPORT", {});
    await enqueue("CARGO_SCAN", {});
    await enqueue("SOS", {});

    const batch = await nextBatch("CONNECTED");
    expect(batch[0].type).toBe("SOS");

    const priorities = batch.map((e) => e.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("refuses to dequeue a family message on a low-bandwidth link", async () => {
    await enqueue("FAMILY_REPLY", {});
    await enqueue("SOS", {});

    const batch = await nextBatch("LOW_BANDWIDTH");
    expect(batch.map((e) => e.type)).toEqual(["SOS"]);
  });

  it("dequeues nothing at all while offline", async () => {
    await enqueue("SOS", {});
    await enqueue("LOCATION_UPDATE", {});
    expect(await nextBatch("OFFLINE")).toEqual([]);
  });

  it("leaves blocked events in the queue rather than dropping them", async () => {
    await enqueue("FAMILY_REPLY", {});
    expect(await nextBatch("OFFLINE")).toEqual([]);

    // Still there once the link returns -- offline does not discard data.
    const rows = await allEvents();
    expect(rows.some((e) => e.type === "FAMILY_REPLY")).toBe(true);
  });

  it("stores the event type as a plain string, not the argument object", async () => {
    // Regression guard: a positional-argument mistake here silently stores
    // {type: "SOS"} as the type, which makes every later priority lookup
    // return undefined and the event unorderable.
    const e = await enqueue("SOS", { lat: -70.7, lon: 11.7 });
    expect(typeof e.type).toBe("string");
    expect(e.type).toBe("SOS");
    expect(e.priority).toBe(0);

    const [row] = await allEvents();
    expect(typeof row.type).toBe("string");
  });
});

/* ------------------------------------------------------------------ */
/* Conflict detection                                                  */
/* ------------------------------------------------------------------ */

describe("detectVersionConflict", () => {
  it("flags an edit based on a version older than central", () => {
    const r = detectVersionConflict(3, 2);
    expect(r.conflict).toBe(true);
    expect(r.reason).toContain("2");
    expect(r.reason).toContain("3");
  });

  it("accepts an edit based on the current version", () => {
    expect(detectVersionConflict(3, 3).conflict).toBe(false);
  });

  it("treats a missing base version as unconflicted", () => {
    // A brand-new record has nothing to collide with.
    expect(detectVersionConflict(5, undefined).conflict).toBe(false);
  });

  it("never reports a conflict when the field device is ahead of central", () => {
    // baseVersion > centralVersion is not a collision; central is simply behind.
    expect(detectVersionConflict(1, 4).conflict).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Freshness labelling                                                 */
/* ------------------------------------------------------------------ */

describe("freshness", () => {
  const now = 1_700_000_000_000;

  it("marks a recent packet live", () => {
    const f = freshnessOf(now - 30_000, now, "ONLINE");
    expect(f.kind).toBe("LIVE");
    expect(freshnessLabel(f)).toContain("LIVE");
  });

  it("stops claiming live once the packet ages past the live window", () => {
    const f = freshnessOf(now - (FRESH_LIVE_MS + 1), now, "ONLINE");
    expect(f.kind).toBe("STALE");
    expect(freshnessLabel(f)).toContain("STALE");
  });

  it("never labels a stale packet as live, at any age", () => {
    for (const age of [FRESH_LIVE_MS + 1, FRESH_STALE_MS, 47 * 60_000, 6 * 60 * 60_000]) {
      const label = freshnessLabel(freshnessOf(now - age, now, "ONLINE"));
      expect(label).not.toContain("LIVE ·");
    }
  });

  it("reports last-known position while offline even for a recent packet", () => {
    const f = freshnessOf(now - 1_000, now, "OFFLINE");
    expect(f.kind).toBe("OFFLINE");
    const label = freshnessLabel(f);
    expect(label).toContain("OFFLINE");
    expect(label).toContain("LAST KNOWN POSITION");
  });

  it("renders the age in minutes and hours", () => {
    expect(freshnessLabel({ kind: "STALE", msAgo: 30 * 60_000 })).toContain("30 MIN AGO");
    expect(freshnessLabel({ kind: "STALE", msAgo: 3 * 60 * 60_000 })).toContain("3 H AGO");
    expect(freshnessLabel({ kind: "LIVE", msAgo: 5_000 })).toContain("JUST NOW");
  });

  it("clamps a future-dated packet rather than reporting negative age", () => {
    const f = freshnessOf(now + 60_000, now, "ONLINE");
    expect(f.msAgo).toBe(0);
  });
});
