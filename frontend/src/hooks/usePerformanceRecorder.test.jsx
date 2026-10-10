import "core-js/actual/structured-clone";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createLocalPerformanceStore } from "@/lib/localPerformanceStore";
import { usePerformanceRecorder, RECORDING_ERROR_MESSAGES } from "./usePerformanceRecorder";

global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, controller, store, props, serial;
const definition = (count = 8) => ({ schemaVersion: 1, unit: "m", poolLength: 25, segment: { task: "swim", stroke: "freestyle", repeatCount: count, repeatDistance: 100, startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } });
const source = () => ({ sessionId: "session-a", blockId: "main_set", draftRevision: 2, changeSequence: 4, plannedTextSnapshot: ["Reference only"] });
const args = count => ({ athleteId: "a", performedDate: "2026-10-04", timezone: "Australia/Brisbane", plannedDefinition: definition(count) });
function Owner(p) { controller = usePerformanceRecorder(p); return null; }
const render = async () => { await act(async () => root.render(<Owner {...props} />)); };
const call = async (method, ...values) => { let result; await act(async () => { result = await controller[method](...values); }); return result; };
const start = async count => { await call("open", source(), { unit: "m", poolLength: 25 }); await call("start", args(count)); expect(controller.state.phase).toBe("record"); };
const save = () => call("saveRep", "completed", { hundredths: 6720, precision: 1 });
const read = () => store.getRecording({ scopeKey: controller.state.recording.performance.scopeKey, performanceId: controller.state.recording.performance.id });
beforeEach(async () => {
  serial = 0; store = createLocalPerformanceStore({ indexedDB: new IDBFactory(), IDBKeyRange });
  props = { scopeKey: "device:test", athleteStore: "local", athletes: [{ id: "a", name: "Same name" }, { id: "b", name: "Same name" }], enabled: true, repository: store, idProvider: () => `id-${++serial}` };
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); });

test("start snapshots source, explicit athlete and IDs; transaction failure stays on confirmation and retry reuses IDs", async () => {
  const original = store.startRecording, starts = jest.spyOn(store, "startRecording");
  starts.mockRejectedValueOnce({ code: "storage_failure" });
  const s = source(); await call("open", s, { unit: "yd", poolLength: 50, stroke: "backstroke", equipment: ["fins"] }); s.plannedTextSnapshot[0] = "Changed";
  expect(controller.state.context.equipment).toBeUndefined();
  expect(await call("start", { ...args(8), athleteId: "b" })).toBe(false);
  expect(controller.state.phase).toBe("confirm"); expect(controller.state.recording).toBeNull();
  starts.mockImplementation(original);
  await call("start", { ...args(8), athleteId: "b" });
  expect(starts.mock.calls[0][0]).toEqual(starts.mock.calls[1][0]);
  const pair = await read(); expect(pair.occurrence.plannedTextSnapshot).toEqual(["Reference only"]);
  expect(pair.performance.athleteRef).toEqual({ store: "local", id: "b" });
  expect(pair.occurrence.source).toEqual({ sessionId: "session-a", blockId: "main_set", draftRevision: 2, changeSequence: 4 });
});

test("start waits for transaction, immediate duplicate guard and account provenance", async () => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render();
  let release; const original = store.startRecording;
  const spy = jest.spyOn(store, "startRecording").mockImplementation(input => new Promise(resolve => { release = () => original(input).then(resolve); }));
  await call("open", source()); let pending;
  await act(async () => { pending = controller.start(args()); expect(await controller.start(args())).toBe(false); });
  expect(controller.state.phase).toBe("confirm"); expect(controller.state.busy).toBe(true); expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => { await release(); await pending; });
  expect((await read()).performance.athleteRef).toEqual({ store: "supabase", id: "a" });
});

test("unknown reps cannot Finish; timed and untimed completed reps can Finish", async () => {
  await start(2); expect(await call("finish")).toBe(false); expect(controller.state.issue).toContain("every planned rep");
  await save(); await call("saveRep", "completed"); await call("finish");
  expect(controller.state.phase).toBe("summary"); expect((await read()).performance.status).toBe("completed");
});

test("six completed then Stop preserves 8x100 and marks two not_attempted", async () => {
  await start(); for (let i = 0; i < 6; i++) await save(); await call("stop");
  const pair = await read(); expect(pair.occurrence.plannedDefinition.segment.repeatCount).toBe(8);
  expect(pair.performance.status).toBe("stopped"); expect(pair.performance.reps.map(r => r.outcome)).toEqual([...Array(6).fill("completed"), "not_attempted", "not_attempted"]);
});

test("final DNF supports Stop; skipped prevents false Finish", async () => {
  await start(2); await save(); await call("saveRep", "dnf"); await call("stop"); expect(controller.state.phase).toBe("summary");
  await call("requestClose"); await start(2); await call("saveRep", "skipped"); await save();
  expect(await call("finish")).toBe(false); expect(controller.state.phase).toBe("record");
});

test("save draft/close and getRecording resume; current form athlete cannot rebind; discard failure stays then successful explicit delete", async () => {
  await start(); await save(); await call("requestClose"); expect(controller.state.closeRequested).toBe(true);
  await call("closeDraft"); expect(controller.state.phase).toBe("closed");
  props = { ...props, athletes: [{ id: "b", name: "New roster athlete" }] }; await render();
  const get = jest.spyOn(store, "getRecording"); await call("resume"); expect(get).toHaveBeenCalledTimes(1);
  expect(controller.state.index).toBe(1); expect(controller.state.recording.performance.athleteRef.id).toBe("a");
  const identity = { scopeKey: props.scopeKey, performanceId: controller.state.recording.performance.id };
  const remove = jest.spyOn(store, "deleteRecording").mockRejectedValueOnce({ code: "storage_failure" });
  expect(await call("discard")).toBe(false); expect(controller.state.recording).not.toBeNull();
  remove.mockRestore(); await call("discard"); expect(controller.state.recording).toBeNull(); await expect(store.getRecording(identity)).rejects.toMatchObject({ code: "not_found" });
});

test.each(Object.keys(RECORDING_ERROR_MESSAGES))("%s maps to a safe error and does not advance", async code => {
  await start(); jest.spyOn(store, "saveProgress").mockRejectedValueOnce({ code, message: "PRIVATE raw DB detail" });
  expect(await save()).toBe(false); expect(controller.state.index).toBe(0); expect(controller.state.error).toEqual({ code, message: RECORDING_ERROR_MESSAGES[code] });
});

test("scope/entitlement change hides state and ignores late transaction completion", async () => {
  await start(); let release; const original = store.saveProgress;
  jest.spyOn(store, "saveProgress").mockImplementation(input => new Promise(resolve => { release = () => original(input).then(resolve); }));
  let pending; await act(async () => { pending = controller.saveRep("completed"); });
  props = { ...props, scopeKey: "account:other", athleteStore: "supabase", enabled: false }; await render();
  expect(controller.state.recording).toBeNull(); expect(controller.state.phase).toBe("closed");
  await act(async () => { await release(); await pending; }); expect(controller.state.recording).toBeNull();
});

test("no athlete, no entitlement and 20+ reps are handled without inventing identity", async () => {
  await call("open", source()); expect(await call("start", { ...args(), athleteId: "Same name" })).toBe(false);
  expect(controller.state.issue).toContain("roster athlete");
  await call("start", args(24)); for (let i = 0; i < 24; i++) await call("saveRep", "completed");
  expect(controller.state.index).toBe(24); await call("finish"); expect((await read()).performance.reps).toHaveLength(24);
  props = { ...props, enabled: false }; await render(); await call("open", source()); expect(controller.state.phase).toBe("closed");
});

test("ambiguous start response retry recovers the same committed pair, never creates a second recording", async () => {
  const original = store.startRecording;
  jest.spyOn(store, "startRecording").mockImplementationOnce(async input => { await original(input); throw { code: "storage_failure" }; });
  await call("open", source()); await call("start", args()); expect(controller.state.phase).toBe("confirm");
  await call("start", args()); expect(controller.state.phase).toBe("record");
  expect(serial).toBe(3); expect(store.startRecording.mock.calls[0][0]).toEqual(store.startRecording.mock.calls[1][0]);
});

test("actual conflict reload uses repository version and does not replace another writer's result", async () => {
  await start(2); const pair = controller.state.recording;
  await store.saveProgress({ scopeKey: props.scopeKey, performanceId: pair.performance.id, expectedVersion: 1, progress: { status: "draft", interrupted: false, materiallyModified: false, reps: [{ repIndex: 0, plannedRepIndex: 0, roundIndex: 0, outcome: "completed", time: { hundredths: 6800, precision: 0 } }] } });
  expect(await save()).toBe(false); expect(controller.state.error.code).toBe("conflict"); expect(controller.state.index).toBe(0);
  await call("resume"); expect(controller.state.index).toBe(1); expect(controller.state.recording.performance.recordVersion).toBe(2);
  expect(controller.state.recording.performance.reps[0].time.hundredths).toBe(6800);
});

test("Stop without attempted work cannot invent outcomes; modified/interrupted flags checkpoint deliberately", async () => {
  await start(); expect(await call("stop")).toBe(false); expect(controller.state.recording.performance.reps).toEqual([]);
  await call("setConditions", { interrupted: true }); await call("setConditions", { materiallyModified: true });
  const pair = await read(); expect(pair.performance.interrupted).toBe(true); expect(pair.performance.materiallyModified).toBe(true); expect(pair.performance.recordVersion).toBe(3);
});

test("hotfix: same-account checking preserves confirmation and suspends commands even if enabled is temporarily false", async () => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render(); await call("open", source());
  const before = controller.state.source;
  props = { ...props, enabled: false, checkingAccess: true }; await render();
  expect(controller.state.phase).toBe("confirm"); expect(controller.state.source).toEqual(before); expect(controller.state.checkingAccess).toBe(true);
  expect(await call("start", args())).toBe(false); await call("requestClose"); expect(controller.state.phase).toBe("confirm");
  props = { ...props, enabled: true, checkingAccess: false }; await render();
  expect(controller.state.phase).toBe("confirm"); expect(controller.state.source).toEqual(before);
});

test("hotfix: active record and closed resume pointer survive same-account checking; explicit close remains explicit", async () => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render(); await start(); await save();
  const pair = controller.state.recording;
  props = { ...props, checkingAccess: true }; await render();
  expect(controller.state.recording).toEqual(pair); expect(controller.state.index).toBe(1);
  await call("previous"); await call("requestClose"); expect(await save()).toBe(false); expect(await call("discard")).toBe(false);
  expect(controller.state.index).toBe(1); expect(controller.state.closeRequested).toBe(false);
  props = { ...props, checkingAccess: false }; await render(); await call("closeDraft");
  const closed = controller.state.recording;
  props = { ...props, checkingAccess: true }; await render(); expect(controller.state.phase).toBe("closed"); expect(controller.state.recording).toEqual(closed);
  expect(await call("resume")).toBe(false);
  props = { ...props, checkingAccess: false }; await render(); await call("resume"); expect(controller.state.recording).toEqual(closed); expect(controller.state.index).toBe(1);
});

test.each(["confirm", "record"])("hotfix: account B never receives account A %s state, even during loading", async phase => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render();
  await call("open", source()); if (phase === "record") await call("start", args());
  const pair = controller.state.recording;
  props = { ...props, scopeKey: "account:user-b", checkingAccess: true }; await render();
  expect(controller.state.phase).toBe("closed"); expect(controller.state.recording).toBeNull(); expect(controller.state.source).toBeNull();
  props = { ...props, checkingAccess: false }; await render(); expect(controller.state.phase).toBe("closed");
  if (pair) expect(await store.getRecording({ scopeKey: "account:user-a", performanceId: pair.performance.id })).toEqual(pair);
});

test("hotfix: confirmed same-account loss clears UI without deleting persisted checkpoints or resurfacing them on regain", async () => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render(); await start(); await save();
  const pair = controller.state.recording;
  props = { ...props, enabled: false, checkingAccess: true }; await render(); expect(controller.state.recording).toEqual(pair);
  props = { ...props, checkingAccess: false }; await render(); expect(controller.state.phase).toBe("closed"); expect(controller.state.recording).toBeNull();
  expect(await store.getRecording({ scopeKey: "account:user-a", performanceId: pair.performance.id })).toEqual(pair);
  props = { ...props, enabled: true }; await render(); expect(controller.state.recording).toBeNull();
});

test.each(["start", "save"])("hotfix: an in-flight %s settling during access checking retains its authoritative result/version", async action => {
  props = { ...props, scopeKey: "account:user-a", athleteStore: "supabase" }; await render(); await call("open", source());
  if (action === "save") await call("start", args());
  const method = action === "start" ? "startRecording" : "saveProgress", original = store[method]; let release;
  jest.spyOn(store, method).mockImplementation(input => new Promise(resolve => { release = () => original(input).then(resolve); }));
  let pending; await act(async () => { pending = action === "start" ? controller.start(args()) : controller.saveRep("completed"); });
  props = { ...props, checkingAccess: true, enabled: false }; await render();
  await act(async () => { await release(); await pending; });
  expect(controller.state.phase).toBe("record"); expect(controller.state.recording.performance.recordVersion).toBe(action === "save" ? 2 : 1);
  props = { ...props, checkingAccess: false, enabled: true }; await render(); expect(controller.state.recording).toEqual(await read());
});

test.each([
  ["device:test", "local"], ["account:user-a", "supabase"],
])("verified %s identity suggests only its stable ID", async (scopeKey, athleteStore) => {
  props = { ...props, scopeKey, athleteStore }; await render();
  await call("open", source(), { recordingAthleteRef: { scopeKey, store: athleteStore, id: "b" } });
  expect(controller.state.context.suggestedAthleteId).toBe("b");
  props = { ...props, athletes: [{ id: "a", name: "Same name" }] }; await render();
  expect(await call("start", { ...args(), athleteId: "b" })).toBe(false);
  expect(controller.state.recording).toBeNull();
});

test.each([
  null,
  { scopeKey: "device:other", store: "local", id: "a" },
  { scopeKey: "device:test", store: "supabase", id: "a" },
  { scopeKey: "device:test", store: "local", id: "deleted" },
])("unverified identity never suggests a roster athlete: %j", async recordingAthleteRef => {
  await call("open", source(), { athleteId: "a", athleteName: "Same name", recordingAthleteRef });
  expect(controller.state.context.suggestedAthleteId).toBe("");
});

test("duplicate roster IDs cannot provide an unambiguous suggestion", async () => {
  props.athletes = [{ id: "a" }, { id: "a" }]; await render();
  await call("open", source(), { recordingAthleteRef: { scopeKey: "device:test", store: "local", id: "a" } });
  expect(controller.state.context.suggestedAthleteId).toBe("");
});

const historyArgs = () => ({ athleteId: "b", plannedDefinition: definition(), confirmed: true });
test.each([["device:test", "local"], ["account:user-a", "supabase"]])("history reads verified identity in %s without recording mutations", async (scopeKey, athleteStore) => {
  props = { ...props, scopeKey, athleteStore }; await render();
  const spy = jest.spyOn(store, "findLatestExact").mockResolvedValue({ recording: null, warnings: [] });
  await call("open", source()); expect(spy).not.toHaveBeenCalled();
  await call("findPreviousExact", historyArgs());
  expect(spy).toHaveBeenCalledWith({ scopeKey, athleteRef: { store: athleteStore, id: "b" }, plannedDefinition: definition(), excludeOccurrenceId: null });
  expect(serial).toBe(0); expect(controller.state.busy).toBe(false); expect(controller.state.error).toBeNull();
});
test.each(["checking", "loss", "account", "store", "deleted", "reopen", "start"])("late history is rejected after %s", async boundary => {
  let resolve; jest.spyOn(store, "findLatestExact").mockImplementation(() => new Promise(r => { resolve = r; }));
  await call("open", source()); let pending;
  await act(async () => { pending = controller.findPreviousExact(historyArgs()); });
  if (boundary === "checking") { props.checkingAccess = true; await render(); props.checkingAccess = false; await render(); }
  if (boundary === "loss") { props.enabled = false; await render(); props.enabled = true; await render(); }
  if (boundary === "account") { props.scopeKey = "account:b"; props.athleteStore = "supabase"; await render(); props.scopeKey = "device:test"; props.athleteStore = "local"; await render(); }
  if (boundary === "store") { props.athleteStore = "supabase"; await render(); props.athleteStore = "local"; await render(); }
  if (boundary === "deleted") { props.athletes = [{ id: "a", name: "Same name" }]; await render(); }
  if (boundary === "reopen") { await call("requestClose"); await call("open", source()); }
  if (boundary === "start") { await call("start", args()); expect(controller.state.phase).toBe("record"); await save(); }
  let result; await act(async () => { resolve({ recording: null, warnings: [] }); result = await pending; });
  expect(result).toBeNull(); expect(controller.state.error).toBeNull();
});
test("history failure remains separate and pending Start occurrence is excluded", async () => {
  jest.spyOn(store, "startRecording").mockRejectedValue({ code: "storage_failure" });
  const spy = jest.spyOn(store, "findLatestExact").mockRejectedValue(new Error("read failed"));
  await call("open", source()); await call("start", args());
  const error = controller.state.error;
  await expect(controller.findPreviousExact(historyArgs())).rejects.toThrow("read failed");
  expect(spy.mock.calls[0][0].excludeOccurrenceId).toBe("id-1");
  expect(spy.mock.calls[0][0].excludeOccurrenceId).not.toBe(source().sessionId);
  expect(controller.state.error).toBe(error); expect(controller.state.busy).toBe(false);
});
test("history gates unknown protocols, missing confirmation, and ambiguous athletes", async () => {
  const spy = jest.spyOn(store, "findLatestExact"); await call("open", source());
  await call("findPreviousExact", { ...historyArgs(), confirmed: false });
  const unknown = definition(); unknown.segment.equipment = null;
  await call("findPreviousExact", { ...historyArgs(), plannedDefinition: unknown });
  props.athletes = [{ id: "b" }, { id: "b" }]; await render();
  await call("findPreviousExact", historyArgs()); expect(spy).not.toHaveBeenCalled();
});

const finishOne = async () => { await start(1); await save(); await call("finish"); };
const earlier = pair => ({ occurrence: { ...pair.occurrence, id: "earlier-occ", performedDate: "2026-10-01" }, performance: { ...pair.performance, id: "earlier-perf", occurrenceId: "earlier-occ" } });
test("saved comparison uses authoritative identity, strict cutoff and self exclusion without writes", async () => {
  await finishOne(); const pair = controller.state.recording;
  const spy = jest.spyOn(store, "findLatestExact").mockResolvedValue({ recording: earlier(pair), warnings: [] });
  expect((await call("compareSavedPerformance")).status).toBe("ready");
  expect(spy).toHaveBeenCalledWith({ scopeKey: pair.occurrence.scopeKey, athleteRef: pair.performance.athleteRef, plannedDefinition: pair.occurrence.plannedDefinition,
    excludeOccurrenceId: pair.occurrence.id, beforePerformedDate: pair.occurrence.performedDate });
  expect(controller.state.busy).toBe(false); expect(await read()).toEqual(pair);
});
test.each(["self", "future", "same-day", "athlete", "scope", "store", "protocol", "untimed"])("saved comparison rejects invalid returned %s", async variant => {
  await finishOne(); const pair = controller.state.recording; let candidate = earlier(pair);
  if (variant === "self") candidate = pair;
  if (variant === "future") candidate.occurrence.performedDate = "2026-10-05";
  if (variant === "same-day") candidate.occurrence.performedDate = pair.occurrence.performedDate;
  if (variant === "athlete") candidate.performance.athleteRef = { store: "local", id: "b" };
  if (variant === "scope") candidate.occurrence.scopeKey = "device:other";
  if (variant === "store") candidate.performance.athleteRef = { store: "supabase", id: "a" };
  if (variant === "protocol") candidate.occurrence.plannedDefinition = definition(2);
  if (variant === "untimed") candidate.performance.reps = [{ ...candidate.performance.reps[0], time: null }];
  jest.spyOn(store, "findLatestExact").mockResolvedValue({ recording: candidate, warnings: [] });
  await expect(controller.compareSavedPerformance()).rejects.toThrow(); expect(controller.state.error).toBeNull();
});
test.each(["version", "date", "deleted"])("changed current %s prevents lookup", async variant => {
  await finishOne(); const pair = controller.state.recording;
  if (variant === "version") await store.saveProgress({ scopeKey: props.scopeKey, performanceId: pair.performance.id, expectedVersion: pair.performance.recordVersion,
    progress: { status: "completed", interrupted: true, materiallyModified: false, reps: pair.performance.reps } });
  if (variant === "date") await store.correctPerformedDate({ scopeKey: props.scopeKey, performanceId: pair.performance.id, expectedOccurrenceVersion: pair.occurrence.recordVersion, performedDate: "2026-10-03" });
  if (variant === "deleted") await store.deleteRecording({ scopeKey: props.scopeKey, performanceId: pair.performance.id, expectedVersion: pair.performance.recordVersion, expectedOccurrenceVersion: pair.occurrence.recordVersion });
  const spy = jest.spyOn(store, "findLatestExact"); expect((await call("compareSavedPerformance")).status).toBe("changed"); expect(spy).not.toHaveBeenCalled();
});
test.each(["close", "resume", "checking", "loss", "account", "deleted", "duplicate"])("pending saved comparison is rejected after %s", async boundary => {
  await finishOne(); let resolve; jest.spyOn(store, "findLatestExact").mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = controller.compareSavedPerformance();
  while (!resolve) await new Promise(r => setTimeout(r, 1));
  if (boundary === "close") await call("requestClose");
  if (boundary === "resume") { await call("requestClose"); await call("resume"); }
  if (boundary === "checking") { props.checkingAccess = true; await render(); props.checkingAccess = false; await render(); }
  if (boundary === "loss") { props.enabled = false; await render(); props.enabled = true; await render(); }
  if (boundary === "account") { props.scopeKey = "account:other"; props.athleteStore = "supabase"; await render(); props.scopeKey = "device:test"; props.athleteStore = "local"; await render(); }
  if (boundary === "deleted") { props.athletes = [{ id: "b" }]; await render(); }
  if (boundary === "duplicate") { props.athletes = [{ id: "a" }, { id: "a" }]; await render(); }
  resolve({ recording: null, warnings: [] }); expect(await pending).toBeNull();
});
test.each(["untimed", "modified", "interrupted", "stopped"])("current %s summary cannot initiate comparison", async variant => {
  await start(2);
  await call("saveRep", "completed", variant === "untimed" ? null : { hundredths: 6700, precision: 0 });
  if (variant === "stopped") await call("stop");
  else { await save(); if (variant !== "untimed") await call("setConditions", variant === "modified" ? { materiallyModified: true } : { interrupted: true }); await call("finish"); }
  const spy = jest.spyOn(store, "findLatestExact"); expect((await call("compareSavedPerformance")).status).toBe("ineligible"); expect(spy).not.toHaveBeenCalled();
});
