/**
 * POLARIS offline field queue.
 *
 * A real IndexedDB store, not a React state array. Field actions taken with no
 * connectivity are written to disk here and survive a reload, a crash, or a
 * closed tab. When a link returns the queue uploads in strict P0→P5 order and
 * the server's acknowledgement replaces the local row.
 *
 * Nothing here fabricates success: an event is only removed from the queue once
 * the backend has actually accepted it.
 */

import {
  priorityFor as sharedPriorityFor,
  type FieldEventType,
  type SyncPriority,
} from "./polar-db";

export type { FieldEventType, SyncPriority };

export interface QueuedEvent {
  eventId: string;
  deviceId: string;
  type: FieldEventType;
  priority: SyncPriority;
  recordedAt: number;
  payload: Record<string, unknown>;
  status: "QUEUED" | "SYNCING" | "APPLIED" | "CONFLICT" | "REJECTED";
  attempts: number;
  lastAttemptTs?: number;
  /** Populated from the server acknowledgement. */
  reason?: string;
  serverVersion?: number;
  conflictId?: string;
}

export interface SyncStats {
  queued: number;
  syncing: number;
  applied: number;
  conflicts: number;
  rejected: number;
  topPriority: SyncPriority | null;
  byPriority: Record<string, number>;
  lastSyncTs: number | null;
  lastResult: string | null;
}

export type ConnectivityMode = "CONNECTED" | "LOW_BANDWIDTH" | "VERY_LOW_BANDWIDTH" | "OFFLINE";

/** What each band may actually carry. The engine refuses to send the rest. */
export const BANDWIDTH_ALLOWLIST: Record<ConnectivityMode, SyncPriority[]> = {
  CONNECTED: [0, 1, 2, 3, 4, 5],
  LOW_BANDWIDTH: [0, 1, 2, 3],
  VERY_LOW_BANDWIDTH: [0, 1, 2],
  OFFLINE: [],
};

export const BANDWIDTH_LABEL: Record<ConnectivityMode, string> = {
  CONNECTED: "Full link — all priorities transmit",
  LOW_BANDWIDTH: "Low bandwidth — P0–P3 safety and logistics only",
  VERY_LOW_BANDWIDTH: "Very low bandwidth — P0–P2 emergency and location only",
  OFFLINE: "Offline — field device queues locally, nothing transmits",
};

const DB_NAME = "polaris-field";
const DB_VERSION = 1;
const STORE_EVENTS = "events";
const STORE_META = "meta";

/* ------------------------------------------------------------------ */
/* Priority ladder                                                     */
/* ------------------------------------------------------------------ */

/**
 * The event vocabulary and the priority ladder are owned by `polar-db.ts`,
 * which is shared with the server. They used to be duplicated here, which let
 * the client and the server disagree about an event's priority; now the
 * browser and `syncBatch` provably use the same table.
 */

export const PRIORITY_NAME: Record<SyncPriority, string> = {
  0: "P0 · SOS / critical emergency",
  1: "P1 · personnel safety / active mission",
  2: "P2 · GPS / hazard / convoy",
  3: "P3 · cargo / inventory / transport",
  4: "P4 · family message",
  5: "P5 · report / analytics / large media",
};

export function priorityFor(type: FieldEventType): SyncPriority {
  return sharedPriorityFor(type);
}

/* ------------------------------------------------------------------ */
/* IndexedDB plumbing                                                  */
/* ------------------------------------------------------------------ */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const store = db.createObjectStore(STORE_EVENTS, { keyPath: "eventId" });
        store.createIndex("byPriority", "priority");
        store.createIndex("byRecordedAt", "recordedAt");
        store.createIndex("byStatus", "status");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        t.oncomplete = () => db.close();
      }),
  );
}

/* ------------------------------------------------------------------ */
/* Public queue API                                                    */
/* ------------------------------------------------------------------ */

let deviceIdCache: string | null = null;

/** Stable per-browser device identity, so the server can attribute events. */
export function deviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  const KEY = "polaris.deviceId";
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    id = null;
  }
  if (!id) {
    const rand =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8).toUpperCase()
        : Math.random().toString(36).slice(2, 10).toUpperCase();
    id = `FIELD-${rand}`;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* storage disabled — an in-memory id still works for this session */
    }
  }
  deviceIdCache = id;
  return id;
}

function newEventId(): string {
  return `EVT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Enqueue a field action. Persists to disk immediately. */
export async function enqueue(
  type: FieldEventType,
  payload: Record<string, unknown>,
  opts: { recordedAt?: number; eventId?: string; deviceId?: string } = {},
): Promise<QueuedEvent> {
  const event: QueuedEvent = {
    eventId: opts.eventId ?? newEventId(),
    deviceId: opts.deviceId ?? deviceId(),
    type,
    priority: priorityFor(type),
    recordedAt: opts.recordedAt ?? Date.now(),
    payload,
    status: "QUEUED",
    attempts: 0,
  };
  await tx(STORE_EVENTS, "readwrite", (s) => s.put(event));
  return event;
}

export async function allEvents(): Promise<QueuedEvent[]> {
  const rows = (await tx<QueuedEvent[]>(STORE_EVENTS, "readonly", (s) => s.getAll() as IDBRequest<QueuedEvent[]>)) ?? [];
  return rows.sort((a, b) => a.priority - b.priority || a.recordedAt - b.recordedAt);
}

/**
 * Strict upload order: priority first, then device timestamp.
 *
 * `allowed` is the bandwidth allowlist. An event outside the allowlist is left
 * in the queue untouched rather than dropped or faked as sent.
 */
export async function nextBatch(mode: ConnectivityMode, limit = 50): Promise<QueuedEvent[]> {
  const allowed = BANDWIDTH_ALLOWLIST[mode];
  const rows = await allEvents();
  return rows.filter((e) => e.status === "QUEUED" && allowed.includes(e.priority)).slice(0, limit);
}

export async function markSyncing(ids: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE_EVENTS, "readwrite");
    const store = t.objectStore(STORE_EVENTS);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        const ev = req.result as QueuedEvent | undefined;
        if (!ev) return;
        ev.status = "SYNCING";
        ev.attempts += 1;
        ev.lastAttemptTs = Date.now();
        store.put(ev);
      };
    }
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => {
      db.close();
      reject(t.error ?? new Error("markSyncing failed"));
    };
  });
}

export async function applyAck(ack: {
  eventId: string;
  status: "APPLIED" | "CONFLICT" | "REJECTED";
  reason?: string;
  serverVersion?: number;
  conflictId?: string;
}): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE_EVENTS, "readwrite");
    const store = t.objectStore(STORE_EVENTS);
    const req = store.get(ack.eventId);
    req.onsuccess = () => {
      const ev = req.result as QueuedEvent | undefined;
      if (!ev) return;
      if (ack.status === "APPLIED") {
        // Only now is the event genuinely done — remove it from disk.
        store.delete(ack.eventId);
      } else {
        ev.status = ack.status;
        ev.reason = ack.reason;
        ev.serverVersion = ack.serverVersion;
        ev.conflictId = ack.conflictId;
        store.put(ev);
      }
    };
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => {
      db.close();
      reject(t.error ?? new Error("applyAck failed"));
    };
  });
}

/** Return un-acknowledged events to QUEUED so a failed attempt can retry. */
export async function requeueStuck(): Promise<void> {
  const rows = await allEvents();
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const t = db.transaction(STORE_EVENTS, "readwrite");
    const store = t.objectStore(STORE_EVENTS);
    for (const ev of rows) {
      if (ev.status === "SYNCING") {
        ev.status = "QUEUED";
        store.put(ev);
      }
    }
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function stats(): Promise<SyncStats> {
  const rows = await allEvents();
  const byPriority: Record<string, number> = {};
  for (const e of rows) {
    if (e.status === "APPLIED") continue;
    byPriority[String(e.priority)] = (byPriority[String(e.priority)] ?? 0) + 1;
  }
  let lastSyncTs: number | null = null;
  let lastResult: string | null = null;
  try {
    const meta = (await tx<{ key: string; value: number } | undefined>(STORE_META, "readonly", (s) => s.get("lastSync"))) ?? null;
    if (meta) {
      lastSyncTs = meta.value;
      lastResult = new Date(meta.value).toISOString().slice(11, 19) + " UTC";
    }
  } catch {
    lastSyncTs = null;
  }
  const pending = rows.filter((e) => e.status !== "APPLIED");
  return {
    queued: pending.filter((e) => e.status === "QUEUED").length,
    syncing: pending.filter((e) => e.status === "SYNCING").length,
    applied: 0,
    conflicts: pending.filter((e) => e.status === "CONFLICT").length,
    rejected: pending.filter((e) => e.status === "REJECTED").length,
    topPriority: pending.length ? (Math.min(...pending.map((e) => e.priority)) as SyncPriority) : null,
    byPriority,
    lastSyncTs,
    lastResult,
  };
}

export async function recordSyncResult(ts: number): Promise<void> {
  await tx(STORE_META, "readwrite", (s) => s.put({ key: "lastSync", value: ts }));
}

/** Cached operational context so the field app still works with no link. */
const CACHE_KEY = "polaris.fieldCache";

export interface FieldCache {
  stations: unknown[];
  routes: unknown[];
  hazards: unknown[];
  tasks: unknown[];
  personnel: unknown[];
  emergencyContacts: unknown[];
  cachedAt: number;
}

export function writeFieldCache(payload: Omit<FieldCache, "cachedAt">): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, cachedAt: Date.now() }));
  } catch {
    /* storage unavailable — the app stays online-only rather than lying */
  }
}

export function readFieldCache(): FieldCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FieldCache;
  } catch {
    return null;
  }
}
