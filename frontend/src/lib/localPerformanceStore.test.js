import "core-js/actual/structured-clone";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { createLocalPerformanceStore, PERFORMANCE_DATABASE_NAME } from "./localPerformanceStore";
import { normalizeAthletePerformance } from "./performanceRecording";

const at = "2026-10-04T01:00:00.000Z";
let factory, store, clock;
const input = (suffix = "1", scopeKey = "device:a") => ({ scopeKey, occurrenceId: `occ-${suffix}`, performanceId: `perf-${suffix}`, segmentId: `seg-${suffix}`,
  performedDate: "2026-10-04", timezone: "Australia/Brisbane", source: { sessionId: null, blockId: "main_set", draftRevision: 0, changeSequence: 0 },
  plannedTextSnapshot: ["4x100"], athleteRef: { store: scopeKey.startsWith("device:") ? "local" : "supabase", id: "athlete-a" },
  plannedDefinition: { schemaVersion: 1, unit: "m", poolLength: 25, segment: { task: "swim", stroke: "freestyle", repeatCount: 4, repeatDistance: 100,
    startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } } });
const identity = (suffix = "1", scopeKey = "device:a") => ({ scopeKey, performanceId: `perf-${suffix}` });
const progress = (status = "completed") => ({ status, interrupted: false, materiallyModified: false, coachNote: "",
  reps: Array.from({ length: 4 }, (_, i) => ({ repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome: "completed", time: { hundredths: 6700 + i * 10, precision: 1 } })) });
const query = () => ({ scopeKey: "device:a", athleteRef: input().athleteRef, plannedDefinition: input().plannedDefinition });
const fail = (promise, code) => expect(promise).rejects.toMatchObject({ code });
beforeEach(() => { factory = new IDBFactory(); clock = at; store = createLocalPerformanceStore({ indexedDB: factory, IDBKeyRange, now: () => clock }); });
afterEach(() => jest.restoreAllMocks());

async function raw(action, mode = "readwrite") {
  const db = await new Promise((resolve, reject) => { const r = factory.open(PERFORMANCE_DATABASE_NAME, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["occurrences", "performances"], mode);
      let value; tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error);
      const req = action(tx); if (req) req.onsuccess = () => { value = req.result; };
    });
  } finally { db.close(); }
}
const rows = name => raw(tx => tx.objectStore(name).getAll(), "readonly");
async function complete(suffix, changeInput = x => x, changeProgress = x => x) {
  await store.startRecording(changeInput(input(suffix)));
  return store.saveProgress({ ...identity(suffix), expectedVersion: 1, progress: changeProgress(progress()) });
}

test("factory creation never opens a database or touches localStorage", () => {
  const open = jest.spyOn(factory, "open"), write = jest.spyOn(Storage.prototype, "setItem"), read = jest.spyOn(Storage.prototype, "getItem");
  createLocalPerformanceStore({ indexedDB: factory, IDBKeyRange });
  expect(open).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});
test("atomic start, idempotent retry, conflict, and caller snapshot isolation", async () => {
  const data = input(), promise = store.startRecording(data);
  data.plannedTextSnapshot[0] = "mutated"; data.occurrenceId = "different"; data.athleteRef.id = "other";
  const result = await promise;
  expect(result.occurrence.plannedTextSnapshot).toEqual(["4x100"]);
  expect((await rows("occurrences"))).toHaveLength(1); expect((await rows("performances"))).toHaveLength(1);
  expect(await store.startRecording(input())).toEqual(result);
  await fail(store.startRecording({ ...input(), plannedTextSnapshot: ["conflicting"] }), "conflict");
  expect(await store.getRecording(identity())).toEqual(result);
  await store.saveProgress({ ...identity(), expectedVersion: 1, progress: progress() });
  expect((await store.startRecording(input())).performance.recordVersion).toBe(2);
});
test("success waits for transaction completion; abort after last request rolls back both", async () => {
  const original = IDBObjectStore.prototype.add;
  jest.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (...args) {
    const r = original.apply(this, args);
    if (this.name === "performances") r.addEventListener("success", () => this.transaction.abort());
    return r;
  });
  await fail(store.startRecording(input()), "storage_failure");
  expect(await rows("occurrences")).toEqual([]); expect(await rows("performances")).toEqual([]);
});
test("failure on second insertion rolls back occurrence", async () => {
  const original = IDBObjectStore.prototype.add;
  jest.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (...args) {
    if (this.name === "performances") throw new DOMException("full", "QuotaExceededError");
    return original.apply(this, args);
  });
  await fail(store.startRecording(input()), "storage_failure");
  expect(await rows("occurrences")).toEqual([]);
});
test("checkpoints preserve occurrence, capture input before await, and increment versions", async () => {
  const initial = await store.startRecording(input()), p = progress("draft");
  p.reps = p.reps.slice(0, 1); p.coachNote = "First rep";
  const save = store.saveProgress({ ...identity(), expectedVersion: 1, progress: p });
  p.reps[0].time.hundredths = 9999; p.coachNote = "changed";
  const result = await save;
  expect(result.performance.recordVersion).toBe(2); expect(result.performance.coachNote).toBe("First rep");
  expect(result.performance.reps[0].time.hundredths).toBe(6700);
  expect(result.occurrence).toEqual(initial.occurrence);
  expect(await store.getRecording(identity())).toEqual(result);
  const note = { ...progress("draft"), reps: result.performance.reps, coachNote: "Corrected note" };
  expect((await store.saveProgress({ ...identity(), expectedVersion: 2, progress: note })).performance.coachNote).toBe("Corrected note");
});
test("two writers with same expected version cannot both succeed", async () => {
  await store.startRecording(input());
  const otherTab = createLocalPerformanceStore({ indexedDB: factory, IDBKeyRange, now: () => clock });
  const results = await Promise.allSettled([store, otherTab].map(s => s.saveProgress({ ...identity(), expectedVersion: 1, progress: progress() })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected").reason.code).toBe("conflict");
  expect((await store.getRecording(identity())).performance.recordVersion).toBe(2);
});
test("invalid checkpoint cannot overwrite stored data or mutate plan", async () => {
  const initial = await store.startRecording(input());
  for (const p of [{ ...progress(), reps: [] }, { ...progress(), plannedDefinition: input().plannedDefinition }, { ...progress(), coachNote: "x".repeat(2001) }]) {
    await fail(store.saveProgress({ ...identity(), expectedVersion: 1, progress: p }), "invalid_data");
    expect(await store.getRecording(identity())).toEqual(initial);
  }
});
test("checkpoint transaction abort preserves previous result", async () => {
  const initial = await store.startRecording(input()), original = IDBObjectStore.prototype.put;
  jest.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (...args) {
    const r = original.apply(this, args); r.addEventListener("success", () => this.transaction.abort()); return r;
  });
  await fail(store.saveProgress({ ...identity(), expectedVersion: 1, progress: progress() }), "storage_failure");
  expect(await store.getRecording(identity())).toEqual(initial);
});
test.each(["not_attempted", "dnf"])("stopped checkpoint supports %s through P1", async outcome => {
  await store.startRecording(input()); const p = progress("stopped"); p.reps[3] = { ...p.reps[3], outcome, time: null };
  expect((await store.saveProgress({ ...identity(), expectedVersion: 1, progress: p })).performance.status).toBe("stopped");
});
test("scope is enforced for get/write/date/delete, including identical IDs in another scope", async () => {
  const initial = await store.startRecording(input());
  await fail(store.getRecording(identity("1", "device:b")), "not_found");
  await fail(store.saveProgress({ ...identity("1", "device:b"), expectedVersion: 1, progress: progress() }), "not_found");
  await fail(store.correctPerformedDate({ ...identity("1", "device:b"), expectedOccurrenceVersion: 1, performedDate: "2026-10-01" }), "not_found");
  await fail(store.deleteRecording({ ...identity("1", "device:b"), expectedVersion: 1, expectedOccurrenceVersion: 1 }), "not_found");
  await store.startRecording(input("1", "device:b"));
  await store.deleteRecording({ ...identity("1", "device:b"), expectedVersion: 1, expectedOccurrenceVersion: 1 });
  expect(await store.getRecording(identity())).toEqual(initial);
});
test.each([
  ["occurrences", o => ({ ...o, schemaVersion: 99 })], ["occurrences", o => ({ ...o, recordVersion: 0 })],
  ["occurrences", o => ({ ...o, plannedDefinition: {} })], ["occurrences", o => ({ ...o, source: null })],
  ["performances", p => ({ ...p, schemaVersion: 99 })], ["performances", p => ({ ...p, recordVersion: -1 })],
  ["performances", p => ({ ...p, reps: [null] })], ["performances", p => ({ ...p, occurrenceId: "missing" })],
])("malformed %s gives explicit error, never manufactured defaults", async (name, corrupt) => {
  const initial = await store.startRecording(input()), record = name === "occurrences" ? initial.occurrence : initial.performance;
  await raw(tx => tx.objectStore(name).put(corrupt(record)));
  await fail(store.getRecording(identity()), "invalid_data");
  await fail(store.saveProgress({ ...identity(), expectedVersion: 1, progress: progress() }), "invalid_data");
});
test("missing parent/child fail safely; partial creation is not silently repaired", async () => {
  await store.startRecording(input());
  await raw(tx => tx.objectStore("occurrences").delete(["device:a", "occ-1"]));
  await fail(store.getRecording(identity()), "invalid_data");
  await fail(store.startRecording(input()), "conflict");
  await raw(tx => tx.objectStore("performances").delete(["device:a", "perf-1"]));
  await fail(store.getRecording(identity()), "not_found");
});
test("bounded drafts are scoped, ID ordered, paginated and report malformed candidates", async () => {
  for (const suffix of ["c", "b", "a"]) await store.startRecording(input(suffix));
  await complete("done"); await store.startRecording(input("elsewhere", "device:b"));
  const malformed = (await store.getRecording(identity("b"))).performance;
  await raw(tx => tx.objectStore("performances").put({ ...malformed, schemaVersion: 9 }));
  const page = await store.listDrafts({ scopeKey: "device:a", limit: 1 });
  expect(page.items.map(p => p.performance.id)).toEqual(["perf-a"]); expect(page.nextAfterId).toBe("perf-a");
  const second = await store.listDrafts({ scopeKey: "device:a", limit: 1, afterId: page.nextAfterId });
  expect(second.items.map(p => p.performance.id)).toEqual(["perf-c"]);
  expect(second.warnings).toEqual([{ performanceId: "perf-b", code: "invalid_data" }]);
  expect(second.nextAfterId).toBeNull();
  await fail(store.listDrafts({ scopeKey: "device:a", limit: 101 }), "invalid_data");
});
test("date correction versions occurrence independently and preserves result/snapshot", async () => {
  const initial = await store.startRecording(input());
  const corrected = await store.correctPerformedDate({ ...identity(), expectedOccurrenceVersion: 1, performedDate: "2026-10-02" });
  expect(corrected.occurrence.recordVersion).toBe(2); expect(corrected.performance).toEqual(initial.performance);
  expect(corrected.occurrence.plannedDefinition).toEqual(initial.occurrence.plannedDefinition);
  await fail(store.correctPerformedDate({ ...identity(), expectedOccurrenceVersion: 1, performedDate: "2026-10-01" }), "conflict");
  await fail(store.correctPerformedDate({ ...identity(), expectedOccurrenceVersion: 2, performedDate: "2026-02-30" }), "invalid_data");
  await fail(store.deleteRecording({ ...identity(), expectedVersion: 1, expectedOccurrenceVersion: 1 }), "conflict");
});
test("delete checks versions and atomically removes the pair", async () => {
  await complete("1");
  await fail(store.deleteRecording({ ...identity(), expectedVersion: 1, expectedOccurrenceVersion: 1 }), "conflict");
  expect(await store.deleteRecording({ ...identity(), expectedVersion: 2, expectedOccurrenceVersion: 1 })).toEqual({ deleted: true, occurrenceDeleted: true });
  expect(await rows("occurrences")).toEqual([]); expect(await rows("performances")).toEqual([]);
});
test("delete failure cannot leave an orphan or silently remove a result", async () => {
  const initial = await store.startRecording(input()), original = IDBObjectStore.prototype.delete;
  jest.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (...args) {
    if (this.name === "occurrences") throw new DOMException("failed", "UnknownError");
    return original.apply(this, args);
  });
  await fail(store.deleteRecording({ ...identity(), expectedVersion: 1, expectedOccurrenceVersion: 1 }), "storage_failure");
  expect(await store.getRecording(identity())).toEqual(initial);
});
test("future second athlete keeps shared occurrence alive", async () => {
  const first = await store.startRecording(input());
  const second = normalizeAthletePerformance({ ...first.performance, id: "perf-second", athleteRef: { store: "local", id: "athlete-b" } }, first.occurrence);
  await raw(tx => tx.objectStore("performances").add(second));
  expect((await store.deleteRecording({ ...identity(), expectedVersion: 1, expectedOccurrenceVersion: 1 })).occurrenceDeleted).toBe(false);
  expect((await store.getRecording(identity("second"))).occurrence).toEqual(first.occurrence);
  expect((await store.deleteRecording({ ...identity("second"), expectedVersion: 1, expectedOccurrenceVersion: 1 })).occurrenceDeleted).toBe(true);
});
test("history uses performed date, then creation time and stable IDs, never updatedAt", async () => {
  await complete("a", x => ({ ...x, performedDate: "2026-10-01" }));
  clock = "2026-10-04T02:00:00.000Z";
  await complete("b", x => ({ ...x, performedDate: "2026-10-03" }));
  await complete("c", x => ({ ...x, performedDate: "2026-10-03", plannedTextSnapshot: ["Different wording"] }));
  clock = "2026-10-05T01:00:00.000Z";
  await store.saveProgress({ ...identity("a"), expectedVersion: 2, progress: { ...progress(), coachNote: "Correction today" } });
  expect((await store.findLatestExact(query())).recording.performance.id).toBe("perf-c");
  expect((await store.findLatestExact({ ...query(), excludeOccurrenceId: "occ-c" })).recording.performance.id).toBe("perf-b");
  await store.correctPerformedDate({ ...identity("a"), expectedOccurrenceVersion: 1, performedDate: "2026-10-04" });
  expect((await store.findLatestExact(query())).recording.performance.id).toBe("perf-a");
});
test("history isolates athlete, provenance and scope", async () => {
  await complete("a");
  expect((await store.findLatestExact({ ...query(), athleteRef: { store: "local", id: "other" } })).recording).toBeNull();
  expect((await store.findLatestExact({ ...query(), scopeKey: "device:b" })).recording).toBeNull();
  expect((await store.findLatestExact({ ...query(), scopeKey: "account:a", athleteRef: { store: "supabase", id: "athlete-a" } })).recording).toBeNull();
  await fail(store.findLatestExact({ ...query(), athleteRef: { store: "supabase", id: "athlete-a" } }), "invalid_data");
});
test.each(["draft", "stopped", "abandoned", "interrupted", "modified", "incomplete", "added"])("history excludes %s", async variant => {
  await complete(variant, x => x, p => {
    if (variant === "draft") p.status = "draft";
    if (variant === "stopped") { p.status = "stopped"; p.reps[3] = { ...p.reps[3], outcome: "not_attempted", time: null }; }
    if (variant === "abandoned") { p.status = "abandoned"; p.reps = p.reps.slice(0, 2); }
    if (variant === "interrupted") p.interrupted = true;
    if (variant === "modified") p.materiallyModified = true;
    if (variant === "incomplete") p.reps[1].time = null;
    if (variant === "added") p.reps.push({ ...p.reps[0], repIndex: 4, plannedRepIndex: null });
    return p;
  });
  expect((await store.findLatestExact(query())).recording).toBeNull();
});
test.each(["unknown", "similar", "related"])("history does not return %s protocols", async variant => {
  const data = input(variant);
  if (variant === "unknown") data.plannedDefinition.segment.equipment = null;
  if (variant === "similar") data.plannedDefinition.segment.recovery.seconds = 85;
  if (variant === "related") data.plannedDefinition.poolLength = 50;
  await store.startRecording(data); await store.saveProgress({ ...identity(variant), expectedVersion: 1, progress: progress() });
  expect((await store.findLatestExact(query())).recording).toBeNull();
  if (variant === "unknown") expect((await store.findLatestExact({ ...query(), plannedDefinition: data.plannedDefinition })).recording).toBeNull();
});
test("malformed history is excluded and reported, valid older record survives", async () => {
  await complete("good"); const bad = await complete("bad");
  await raw(tx => tx.objectStore("performances").put({ ...bad.performance, recordVersion: 0 }));
  const result = await store.findLatestExact(query());
  expect(result.recording.performance.id).toBe("perf-good"); expect(result.warnings).toEqual([{ performanceId: "perf-bad", code: "invalid_data" }]);
});
test("unavailable/open/read errors are explicit; no localStorage fallback", async () => {
  const read = jest.spyOn(Storage.prototype, "getItem"), write = jest.spyOn(Storage.prototype, "setItem");
  const absent = createLocalPerformanceStore({ indexedDB: null }); await fail(absent.getRecording(identity()), "unavailable");
  const broken = createLocalPerformanceStore({ indexedDB: { open() { throw new DOMException("denied", "SecurityError"); } } });
  await fail(broken.getRecording(identity()), "storage_failure");
  await store.startRecording(input());
  jest.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => { throw new DOMException("bad read", "UnknownError"); });
  await fail(store.getRecording(identity()), "storage_failure");
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});
test("backup/export boundary: existing backup does not enumerate performance storage", async () => {
  const { exportCoachData } = require("./localStore");
  const before = exportCoachData(); await complete("1"); const after = exportCoachData();
  expect(Object.keys(after)).toEqual(Object.keys(before));
  expect(after).not.toHaveProperty("performances"); expect(after).not.toHaveProperty("occurrences");
  for (const key of ["athletes", "sessions", "favourites", "test_sets", "journal"]) expect(after[key]).toEqual(before[key]);
});

test("import has no storage/network/analytics side effects", () => {
  const open = jest.spyOn(factory, "open"), read = jest.spyOn(Storage.prototype, "getItem"), write = jest.spyOn(Storage.prototype, "setItem");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
  try {
    jest.isolateModules(() => { require("./localPerformanceStore"); });
    expect(open).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  } finally { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; }
});
test.each(["getRecording", "saveProgress", "correctPerformedDate", "deleteRecording", "listDrafts", "findLatestExact"])("%s rejects malformed operation arguments explicitly", async method => {
  for (const value of [undefined, null, [], "bad", { scopeKey: "device:a", unexpected: true }]) await fail(store[method](value), "invalid_data");
});
test("immutable fields cannot be smuggled into top-level progress arguments", async () => {
  await store.startRecording(input());
  await fail(store.saveProgress({ ...identity(), expectedVersion: 1, progress: progress(), source: { sessionId: "other" } }), "invalid_data");
});
test("new repository instance resumes the committed checkpoint", async () => {
  await store.startRecording(input());
  const p = progress("draft"); p.reps = p.reps.slice(0, 2);
  await store.saveProgress({ ...identity(), expectedVersion: 1, progress: p });
  const reopened = createLocalPerformanceStore({ indexedDB: factory, IDBKeyRange, now: () => at });
  const resumed = await reopened.getRecording(identity());
  expect(resumed.performance.reps).toHaveLength(2); expect(resumed.performance.status).toBe("draft");
});
test("future database version is an explicit asynchronous open failure", async () => {
  await store.startRecording(input());
  await new Promise((resolve, reject) => {
    const r = factory.open(PERFORMANCE_DATABASE_NAME, 2);
    r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error);
  });
  await fail(store.getRecording(identity()), "storage_failure");
});
test("malformed history parents and orphan relationships are reported", async () => {
  for (const suffix of ["broken", "orphan"]) await complete(suffix);
  const broken = (await store.getRecording(identity("broken"))).occurrence;
  await raw(tx => tx.objectStore("occurrences").put({ ...broken, matchingVersion: 999 }));
  await raw(tx => tx.objectStore("occurrences").delete(["device:a", "occ-orphan"]));
  const result = await store.findLatestExact(query());
  expect(result.recording).toBeNull(); expect(result.warnings).toHaveLength(2);
});
test("corrupt draft scan is bounded and pagination can pass malformed IDs", async () => {
  const base = await store.startRecording(input("zz"));
  for (let i = 0; i < 6; i += 1) await raw(tx => tx.objectStore("performances").put({ ...base.performance, id: `bad ${i}`, schemaVersion: 9 }));
  const first = await store.listDrafts({ scopeKey: "device:a", limit: 1 });
  expect(first.items).toEqual([]); expect(first.warnings).toHaveLength(5); expect(first.nextAfterId).toBe("bad 4");
  const second = await store.listDrafts({ scopeKey: "device:a", limit: 1, afterId: first.nextAfterId });
  expect(second.items[0].performance.id).toBe("perf-zz"); expect(second.warnings).toHaveLength(1);
});
test("same-day creation chronology outranks lexicographic IDs", async () => {
  await complete("z"); clock = "2026-10-04T03:00:00.000Z"; await complete("a");
  expect((await store.findLatestExact(query())).recording.performance.id).toBe("perf-a");
});
test("source workout is an optional snapshot reference, not a live dependency", async () => {
  const source = input(); source.source.sessionId = "never-saved-workout";
  await store.startRecording(source);
  source.source.sessionId = "deleted-workout"; source.plannedTextSnapshot[0] = "Edited later";
  const resumed = await store.getRecording(identity());
  expect(resumed.occurrence.source.sessionId).toBe("never-saved-workout"); expect(resumed.occurrence.plannedTextSnapshot).toEqual(["4x100"]);
});
test("same IDs and changed athlete or definition cannot be retried as same creation", async () => {
  await store.startRecording(input());
  const changedAthlete = input(); changedAthlete.athleteRef.id = "other";
  await fail(store.startRecording(changedAthlete), "conflict");
  const changedDefinition = input(); changedDefinition.plannedDefinition.segment.equipment = ["fins"];
  await fail(store.startRecording(changedDefinition), "conflict");
});
