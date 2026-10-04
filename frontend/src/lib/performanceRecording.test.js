import { createRecording, normalizeOccurrence, normalizeAthletePerformance, applyRecordingProgress, correctRecordingDate, composePerformance, RECORDING_LIMITS } from "./performanceRecording";
import { comparePerformanceDefinitions } from "./performanceDefinition";
import { calculatePerformanceMetrics } from "./performanceMetrics";

const at = "2026-10-04T01:00:00.000Z";
const input = () => ({ scopeKey: "device:coach-a", occurrenceId: "occ-1", performanceId: "perf-1", segmentId: "segment-1", performedDate: "2026-10-04", timezone: "Australia/Brisbane",
  source: { sessionId: "workout-1", blockId: "main_set", draftRevision: 2, changeSequence: 4 }, plannedTextSnapshot: ["Coach-confirmed 4x100"],
  athleteRef: { store: "local", id: "athlete-1" }, plannedDefinition: { schemaVersion: 1, unit: "m", poolLength: 25,
    segment: { task: "swim", stroke: "freestyle", repeatCount: 4, repeatDistance: 100, startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } } });
const progress = () => ({ status: "completed", interrupted: false, materiallyModified: false,
  reps: Array.from({ length: 4 }, (_, i) => ({ repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome: "completed", time: { hundredths: 6700 + i * 10, precision: 1 } })), coachNote: "Hold alignment" });
const invalid = fn => expect(fn).toThrow(expect.objectContaining({ code: "invalid_data" }));

test("valid pair is separate, normalized, deeply immutable and reusable through P1", () => {
  const source = input(), pair = createRecording(source, at);
  expect(pair.occurrence.recordVersion).toBe(1); expect(pair.performance.status).toBe("draft");
  expect(pair.occurrence.performance).toBeUndefined(); expect(pair.performance.plannedDefinition).toBeUndefined();
  source.plannedDefinition.segment.repeatCount = 99; source.plannedTextSnapshot.push("changed"); source.source.draftRevision = 999; source.athleteRef.id = "other";
  expect(pair.occurrence.plannedDefinition.segment.repeatCount).toBe(4);
  expect(pair.occurrence.plannedTextSnapshot).toEqual(["Coach-confirmed 4x100"]);
  expect(pair.occurrence.source.draftRevision).toBe(2); expect(pair.performance.athleteRef.id).toBe("athlete-1");
  expect(() => pair.occurrence.plannedDefinition.segment.equipment.push("fins")).toThrow();
  expect(normalizeOccurrence(pair.occurrence)).toEqual(pair.occurrence);
  expect(normalizeAthletePerformance(pair.performance, pair.occurrence)).toEqual(pair.performance);
});
test("unknown remains unknown, text never establishes exactness", () => {
  const a = input(); delete a.plannedDefinition.segment.equipment;
  const x = createRecording(a, at).occurrence;
  expect(x.plannedDefinition.segment.equipment).toBeNull();
  expect(comparePerformanceDefinitions(x.plannedDefinition, x.plannedDefinition).classification).toBe("NOT_COMPARABLE");
  const b = input(); b.plannedTextSnapshot = ["Entirely different prose"];
  expect(comparePerformanceDefinitions(createRecording(input(), at).occurrence.plannedDefinition, createRecording(b, at).occurrence.plannedDefinition).classification).toBe("EXACT");
});
test.each([null, undefined, [], "x", 1])("rejects malformed root %p", value => invalid(() => createRecording(value, at)));
test.each(["2026-02-29", "2026-04-31", "2026-1-01", "2026-01-01T00:00:00Z", "0000-01-01", "", null])("strict date %p", value => invalid(() => createRecording({ ...input(), performedDate: value }, at)));
test.each(["2024-02-29", "2000-02-29", "2026-12-31"])("valid calendar date %s", value => expect(createRecording({ ...input(), performedDate: value }, at).occurrence.performedDate).toBe(value));
test.each(["", "coach-a", "device:", "device:a b", "account:" + "x".repeat(129), null])("invalid scope %p", scopeKey => invalid(() => createRecording({ ...input(), scopeKey }, at)));
test("account provenance is supported locally without reconciling identities", () => {
  const data = { ...input(), scopeKey: "account:user-1", athleteRef: { store: "supabase", id: "athlete-1" } };
  expect(createRecording(data, at).performance.athleteRef.store).toBe("supabase");
  invalid(() => createRecording({ ...data, athleteRef: { store: "local", id: "athlete-1" } }, at));
  invalid(() => createRecording({ ...input(), athleteRef: { store: "supabase", id: "athlete-1" } }, at));
});
test.each([
  { schemaVersion: 2 }, { recordVersion: 0 }, { recordVersion: Infinity }, { matchingVersion: 2 },
  { timezone: "Moon/Base" }, { timezone: "x".repeat(65) }, { segmentId: "" }, { createdAt: "yesterday" },
  { updatedAt: "2020-01-01T00:00:00.000Z" }, { plannedTextSnapshot: new Array(2) },
  { plannedTextSnapshot: ["x".repeat(2001)] }, { plannedTextSnapshot: Array(101).fill("") }, { extra: true },
])("rejects malformed occurrence %p", patch => {
  const pair = createRecording(input(), at); invalid(() => normalizeOccurrence({ ...pair.occurrence, ...patch }));
});
test("invalid definition and source are never repaired", () => {
  const a = input(); a.plannedDefinition.segment.repeatCount = RECORDING_LIMITS.reps + 1;
  invalid(() => createRecording(a, at));
  a.plannedDefinition.segment.repeatCount = NaN; invalid(() => createRecording(a, at));
  invalid(() => createRecording({ ...input(), source: [] }, at));
  invalid(() => createRecording({ ...input(), occurrenceId: "workout-1" }, at));
});
test.each([{ schemaVersion: 2 }, { recordVersion: -1 }, { occurrenceId: "other" }, { scopeKey: "device:other" },
  { reps: new Array(1) }, { reps: Array(10001).fill(null) }, { athleteName: "Do not copy" }, { coachNote: "x".repeat(2001) },
  { athleteRef: { store: "local", id: "athlete-1", name: "Do not copy" } }])("rejects malformed result %p", patch => {
  const pair = createRecording(input(), at); invalid(() => normalizeAthletePerformance({ ...pair.performance, ...patch }, pair.occurrence));
});
test("checkpoint preserves protocol and validates composed P1 completion", () => {
  const pair = createRecording(input(), at), p = progress();
  const result = applyRecordingProgress(pair.occurrence, pair.performance, p, at);
  expect(result.recordVersion).toBe(2); expect(result.coachNote).toBe("Hold alignment");
  expect(calculatePerformanceMetrics(composePerformance(pair.occurrence, result)).metrics.trendEligible).toBe(true);
  p.reps[0].time.hundredths = 1; expect(result.reps[0].time.hundredths).toBe(6700);
  for (const key of ["plannedDefinition", "source", "segmentId", "matchingVersion", "athleteRef", "occurrenceId"]) invalid(() => applyRecordingProgress(pair.occurrence, pair.performance, { ...progress(), [key]: {} }, at));
  invalid(() => applyRecordingProgress(pair.occurrence, pair.performance, { ...progress(), reps: [] }, at));
});
test("stopped and final-rep DNF semantics delegate to P1", () => {
  const pair = createRecording(input(), at);
  for (const tail of [true, false]) {
    const p = progress(); p.status = "stopped";
    p.reps[3] = { ...p.reps[3], outcome: tail ? "not_attempted" : "dnf", time: null };
    expect(applyRecordingProgress(pair.occurrence, pair.performance, p, at).status).toBe("stopped");
  }
});
test("date correction has independent version and cannot rewrite plan", () => {
  const pair = createRecording(input(), at), corrected = correctRecordingDate(pair.occurrence, "2026-10-03", at);
  expect(corrected.recordVersion).toBe(2); expect(pair.performance.recordVersion).toBe(1);
  expect(corrected.plannedDefinition).toEqual(pair.occurrence.plannedDefinition);
  expect(corrected.source).toEqual(pair.occurrence.source);
  expect(corrected.plannedTextSnapshot).toEqual(pair.occurrence.plannedTextSnapshot);
});
