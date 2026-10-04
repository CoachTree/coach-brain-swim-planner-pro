import { comparePerformanceDefinitions } from "./performanceDefinition";
import { calculatePerformanceMetrics } from "./performanceMetrics";
import {
  PerformanceRecordingError, validateRecordingScope, normalizeOccurrence,
  normalizeAthletePerformance, createRecording, applyRecordingProgress,
  correctRecordingDate, composePerformance, snapshotRecordingProgress, normalizeRecordingQuery,
} from "./performanceRecording";

// Local-only, intentionally absent from localStore/exportCoachData, sessions,
// Journal, share links and analytics. No open/write occurs on import or factory
// construction. Native IndexedDB is used in production; injection is for tests.
export const PERFORMANCE_DATABASE_NAME = "coach-brain-performance";
export const PERFORMANCE_DATABASE_VERSION = 1;
const error = (code, message) => new PerformanceRecordingError(code, message);
const storageError = e => e instanceof PerformanceRecordingError ? e : error("storage_failure", `IndexedDB operation failed${e?.name ? ` (${e.name})` : ""}`);
const id = value => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw error("invalid_data", "Invalid ID");
  return value;
};
function argumentsFor(value, keys) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key)
      || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value"))) throw error("invalid_data", "Invalid operation arguments");
  return value;
}
function expected(value, actual) {
  if (!Number.isSafeInteger(value) || value < 1) throw error("invalid_data", "Invalid expected version");
  if (value !== actual) throw error("conflict", "Recording changed; reload before saving");
}
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(storageError(req.error)); });
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function openDatabase(factory, name) {
  if (!factory || typeof factory.open !== "function") return Promise.reject(error("unavailable", "IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    let settled = false, req;
    try { req = factory.open(name, PERFORMANCE_DATABASE_VERSION); } catch (e) { reject(storageError(e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      const occurrences = db.createObjectStore("occurrences", { keyPath: ["scopeKey", "id"] });
      occurrences.createIndex("scope", "scopeKey");
      const performances = db.createObjectStore("performances", { keyPath: ["scopeKey", "id"] });
      performances.createIndex("scopeStatus", ["scopeKey", "status", "id"]);
      performances.createIndex("scopeAthlete", ["scopeKey", "athleteRef.store", "athleteRef.id"]);
      performances.createIndex("scopeOccurrence", ["scopeKey", "occurrenceId"]);
    };
    req.onblocked = () => { settled = true; reject(error("storage_failure", "Database open blocked by another connection")); };
    req.onerror = () => { settled = true; reject(storageError(req.error)); };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) { db.close(); return; }
      settled = true; db.onversionchange = () => db.close(); resolve(db);
    };
  });
}

async function pair(tx, scopeKey, performanceId, existing) {
  const raw = existing || await request(tx.objectStore("performances").get([scopeKey, performanceId]));
  if (!raw) throw error("not_found", "Recording not found in this scope");
  if (raw.scopeKey !== scopeKey || raw.id !== performanceId) throw error("invalid_data", "Invalid performance identity");
  id(raw.occurrenceId);
  const source = await request(tx.objectStore("occurrences").get([scopeKey, raw.occurrenceId]));
  if (!source) throw error("invalid_data", "Recording occurrence is missing");
  const occurrence = normalizeOccurrence(source);
  const performance = normalizeAthletePerformance(raw, occurrence);
  return Object.freeze({ occurrence, performance });
}
function startIdentity(recording) {
  const { recordVersion, createdAt, updatedAt, ...occurrence } = recording.occurrence;
  return JSON.stringify({ occurrence, id: recording.performance.id, occurrenceId: recording.performance.occurrenceId, athleteRef: recording.performance.athleteRef });
}

export function createLocalPerformanceStore(options = {}) {
  const name = options.databaseName || PERFORMANCE_DATABASE_NAME;
  // Resolve browser APIs lazily. Tests supply a fresh factory per test.
  const now = options.now || (() => new Date().toISOString());
  const factory = () => Object.prototype.hasOwnProperty.call(options, "indexedDB") ? options.indexedDB : globalThis.indexedDB;
  const ranges = () => options.IDBKeyRange || globalThis.IDBKeyRange;
  async function run(mode, action) {
    let db;
    try { db = await openDatabase(factory(), name); } catch (e) { throw storageError(e); }
    try {
      return await new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(["occurrences", "performances"], mode); } catch (e) { reject(storageError(e)); return; }
        let value, finished = false, failure;
        tx.oncomplete = () => finished ? resolve(value) : reject(error("storage_failure", "Transaction completed before operation"));
        tx.onabort = () => reject(failure || storageError(tx.error));
        // Request errors reject their promises and abort the transaction. Success
        // is never exposed on request.onsuccess, only on transaction completion.
        Promise.resolve().then(() => action(tx)).then(result => { value = result; finished = true; }).catch(e => {
          failure = storageError(e);
          try { tx.abort(); } catch { reject(failure); }
        });
      });
    } finally { db.close(); }
  }
  function scopeAndId(scopeKey, recordId) { validateRecordingScope(scopeKey); id(recordId); }

  return {
    async startRecording(input) {
      const proposed = createRecording(input, now());
      const { scopeKey, id: occurrenceId } = proposed.occurrence;
      const performanceId = proposed.performance.id;
      return run("readwrite", async tx => {
        const occurrences = tx.objectStore("occurrences"), performances = tx.objectStore("performances");
        const o = await request(occurrences.get([scopeKey, occurrenceId]));
        const p = await request(performances.get([scopeKey, performanceId]));
        if (o || p) {
          if (!o || !p) throw error("conflict", "Creation IDs already partially used; no records overwritten");
          const current = await pair(tx, scopeKey, performanceId, p);
          if (current.occurrence.id !== occurrenceId || startIdentity(current) !== startIdentity(proposed)) throw error("conflict", "Creation IDs belong to a different recording");
          // Idempotent creation retry also preserves any already-saved progress.
          return current;
        }
        await request(occurrences.add(proposed.occurrence));
        await request(performances.add(proposed.performance));
        return proposed;
      });
    },
    async getRecording(args) {
      const { scopeKey, performanceId } = argumentsFor(args, ["scopeKey","performanceId"]);
      scopeAndId(scopeKey, performanceId);
      return run("readonly", tx => pair(tx, scopeKey, performanceId));
    },
    async saveProgress(args) {
      const { scopeKey, performanceId, expectedVersion, progress } = argumentsFor(args, ["scopeKey","performanceId","expectedVersion","progress"]);
      scopeAndId(scopeKey, performanceId);
      const snapshot = snapshotRecordingProgress(progress);
      return run("readwrite", async tx => {
        const current = await pair(tx, scopeKey, performanceId);
        expected(expectedVersion, current.performance.recordVersion);
        const performance = applyRecordingProgress(current.occurrence, current.performance, snapshot, now());
        await request(tx.objectStore("performances").put(performance));
        return Object.freeze({ occurrence: current.occurrence, performance });
      });
    },
    async correctPerformedDate(args) {
      const { scopeKey, performanceId, expectedOccurrenceVersion, performedDate } = argumentsFor(args, ["scopeKey","performanceId","expectedOccurrenceVersion","performedDate"]);
      scopeAndId(scopeKey, performanceId);
      return run("readwrite", async tx => {
        const current = await pair(tx, scopeKey, performanceId);
        expected(expectedOccurrenceVersion, current.occurrence.recordVersion);
        const occurrence = correctRecordingDate(current.occurrence, performedDate, now());
        await request(tx.objectStore("occurrences").put(occurrence));
        return Object.freeze({ occurrence, performance: current.performance });
      });
    },
    async deleteRecording(args) {
      const { scopeKey, performanceId, expectedVersion, expectedOccurrenceVersion } = argumentsFor(args, ["scopeKey","performanceId","expectedVersion","expectedOccurrenceVersion"]);
      scopeAndId(scopeKey, performanceId);
      return run("readwrite", async tx => {
        const current = await pair(tx, scopeKey, performanceId);
        expected(expectedVersion, current.performance.recordVersion);
        expected(expectedOccurrenceVersion, current.occurrence.recordVersion);
        const performances = tx.objectStore("performances");
        await request(performances.delete([scopeKey, performanceId]));
        const remaining = await request(performances.index("scopeOccurrence").count([scopeKey, current.occurrence.id]));
        if (remaining === 0) await request(tx.objectStore("occurrences").delete([scopeKey, current.occurrence.id]));
        return { deleted: true, occurrenceDeleted: remaining === 0 };
      });
    },
    // ID-ascending pages, not training chronology. Scan at most limit*5 rows so
    // corrupted drafts cannot cause an unbounded resume-list read. Continuation
    // is the last scanned ID; warnings are separate from valid recordings.
    async listDrafts(args) {
      const { scopeKey, limit = 20, afterId = null } = argumentsFor(args, ["scopeKey","limit","afterId"]);
      validateRecordingScope(scopeKey);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw error("invalid_data", "Limit must be 1..100");
      // Continuation comes from an index key, which may belong to a malformed
      // record. It is not an application ID; accepting a bounded raw key allows
      // callers to page past bad IDs without repeatedly scanning the same rows.
      if (afterId !== null && (typeof afterId !== "string" || afterId.length > 4096)) throw error("invalid_data", "Invalid draft continuation");
      const keyRange = ranges();
      if (!keyRange) throw error("unavailable", "IndexedDB key ranges unavailable");
      return run("readonly", tx => new Promise((resolve, reject) => {
        const items = [], warnings = [];
        let scanned = 0, lastId = null;
        const req = tx.objectStore("performances").index("scopeStatus").openCursor(
          keyRange.bound([scopeKey, "draft", afterId || ""], [scopeKey, "draft", "\uffff"], true, false));
        req.onerror = () => reject(storageError(req.error));
        req.onsuccess = async () => {
          const cursor = req.result;
          if (!cursor) { resolve({ items, warnings, nextAfterId: null }); return; }
          if (items.length >= limit || scanned >= limit * 5) {
            if (typeof lastId !== "string" || lastId.length > 4096) { reject(error("invalid_data", "Malformed draft continuation key")); return; }
            resolve({ items, warnings, nextAfterId: lastId }); return;
          }
          scanned += 1; lastId = cursor.value.id;
          try { items.push(await pair(tx, scopeKey, cursor.value.id, cursor.value)); }
          catch (e) { if (e.code !== "invalid_data") { reject(e); return; } warnings.push({ performanceId: cursor.value.id, code: "invalid_data" }); }
          try { cursor.continue(); } catch (e) { reject(storageError(e)); }
        };
      }));
    },
    // Stream candidates for this exact scope + athlete. Do not load the entire
    // history into memory or trust text/canonical keys instead of P1 comparison.
    async findLatestExact(args) {
      const { scopeKey, athleteRef, plannedDefinition, excludeOccurrenceId = null } = argumentsFor(args, ["scopeKey","athleteRef","plannedDefinition","excludeOccurrenceId"]);
      validateRecordingScope(scopeKey);
      const query = normalizeRecordingQuery({ scopeKey, athleteRef, plannedDefinition });
      if (excludeOccurrenceId !== null) id(excludeOccurrenceId);
      return run("readonly", tx => new Promise((resolve, reject) => {
        let recording = null;
        const warnings = [];
        const req = tx.objectStore("performances").index("scopeAthlete").openCursor([scopeKey, query.athleteRef.store, query.athleteRef.id]);
        req.onerror = () => reject(storageError(req.error));
        req.onsuccess = async () => {
          const cursor = req.result;
          if (!cursor) { resolve({ recording, warnings }); return; }
          try {
            const candidate = await pair(tx, scopeKey, cursor.value.id, cursor.value);
            const { occurrence, performance } = candidate;
            if (occurrence.id !== excludeOccurrenceId
              && comparePerformanceDefinitions(query.plannedDefinition, occurrence.plannedDefinition).classification === "EXACT"
              && calculatePerformanceMetrics(composePerformance(occurrence, performance)).metrics?.trendEligible) {
              const newer = !recording || lexical(occurrence.performedDate, recording.occurrence.performedDate)
                || lexical(occurrence.createdAt, recording.occurrence.createdAt)
                || lexical(occurrence.id, recording.occurrence.id)
                || lexical(performance.id, recording.performance.id);
              if (newer === true || newer > 0) recording = candidate;
            }
          } catch (e) { if (e.code !== "invalid_data") { reject(e); return; } warnings.push({ performanceId: cursor.value.id, code: "invalid_data" }); }
          try { cursor.continue(); } catch (e) { reject(storageError(e)); }
        };
      }));
    },
  };
}
