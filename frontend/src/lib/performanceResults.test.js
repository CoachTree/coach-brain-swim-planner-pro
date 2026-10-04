import { normalizeRepResult, normalizePerformance } from "./performanceResults";

const definition = { schemaVersion: 1, unit: "m", poolLength: 25,
  segment: { task: "swim", stroke: "freestyle", repeatCount: 8, repeatDistance: 100,
    startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } };
const rep = (i, outcome = "completed", time = { hundredths: 6720, precision: 1 }) => ({ repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome, time });
const performance = (changes = {}) => ({ definition, segmentId: "segment-a", status: "completed", interrupted: false,
  materiallyModified: false, reps: Array.from({ length: 8 }, (_, i) => rep(i)), ...changes });

test.each(["completed", "dnf", "skipped", "not_attempted", "unknown"])("explicit outcome %s", outcome => {
  expect(normalizeRepResult(rep(0, outcome, null)).ok).toBe(true);
});
test("completed may be timed or untimed; blank outcome is never inferred", () => {
  expect(normalizeRepResult(rep(0)).ok).toBe(true);
  expect(normalizeRepResult(rep(0, "completed", null)).ok).toBe(true);
  expect(normalizeRepResult(rep(0, "", null)).ok).toBe(false);
  expect(normalizeRepResult({ ...rep(0), outcome: undefined }).ok).toBe(false);
  expect(normalizeRepResult(null).ok).toBe(false);
});
test.each([
  { time: { hundredths: 0, precision: 0 } }, { time: { hundredths: -1, precision: 2 } },
  { time: { hundredths: Infinity, precision: 2 } }, { time: { hundredths: NaN, precision: 2 } },
  { time: 67 }, { time: "" }, { outcome: "dnf" }, { roundIndex: 1 }, { plannedRepIndex: undefined },
  { plannedRepIndex: -1 }, { plannedRepIndex: 0.5 }, { repIndex: -1 }, { task: "kick" },
])("invalid rep is not repaired %p", change => expect(normalizeRepResult({ ...rep(0), ...change }).ok).toBe(false));

test("added rep explicitly has no planned index and cannot replace a missing planned rep", () => {
  const added = { ...rep(8), plannedRepIndex: null };
  expect(normalizePerformance(performance({ reps: [...performance().reps, added] })).ok).toBe(true);
  const replacement = { ...rep(7), plannedRepIndex: null };
  expect(normalizePerformance(performance({ reps: [...performance().reps.slice(0, 7), replacement] })).ok).toBe(false);
});

test("duplicate, out-of-order, out-of-plan and nonsequential indices rejected", () => {
  for (const change of [{ plannedRepIndex: 0 }, { plannedRepIndex: 8 }, { repIndex: 12 }]) {
    const p = performance(); p.reps[1] = { ...p.reps[1], ...change };
    expect(normalizePerformance(p).ok).toBe(false);
  }
  const p = performance(); p.reps[0].plannedRepIndex = 1; p.reps[1].plannedRepIndex = 0;
  expect(normalizePerformance(p).ok).toBe(false);
});

test("eight swims and six times is completed, not stopped", () => {
  const p = performance(); p.reps[6].time = null; p.reps[7].time = null;
  expect(normalizePerformance(p).ok).toBe(true);
  expect(normalizePerformance({ ...p, status: "stopped" }).ok).toBe(false);
});

test("six completed and two explicitly unattempted preserves the eight-rep plan", () => {
  const p = performance({ status: "stopped" });
  p.reps[6] = rep(6, "not_attempted", null); p.reps[7] = rep(7, "not_attempted", null);
  const before = JSON.stringify(p), result = normalizePerformance(p);
  expect(result.ok).toBe(true);
  expect(result.performance.definition.segment.repeatCount).toBe(8);
  expect(normalizePerformance({ ...p, status: "completed" }).ok).toBe(false);
  result.performance.reps[0].time.hundredths = 9999;
  expect(JSON.stringify(p)).toBe(before);
});

test("stopped requires a known attempted prefix and explicit unattempted tail", () => {
  const p = performance({ status: "stopped" });
  p.reps[6] = rep(6, "not_attempted", null); p.reps[7] = rep(7, "not_attempted", null);
  for (const change of [
    { reps: p.reps.slice(0, 6) },
    { reps: p.reps.map((r, i) => i === 7 ? rep(7) : r) },
    { reps: p.reps.map((r, i) => i === 0 ? rep(0, "unknown", null) : r) },
    { reps: p.reps.map((r, i) => rep(i, "not_attempted", null)) },
    { reps: [...p.reps, { ...rep(8), plannedRepIndex: null }] },
  ]) expect(normalizePerformance({ ...p, ...change }).ok).toBe(false);
  p.reps[5] = rep(5, "dnf", null);
  expect(normalizePerformance(p).ok).toBe(true);
});

test("draft/abandoned retain unknown rows; completed cannot hide missing/skipped reps", () => {
  for (const status of ["draft", "abandoned"]) {
    expect(normalizePerformance(performance({ status, reps: [] })).ok).toBe(true);
    expect(normalizePerformance(performance({ status, reps: [rep(0, "unknown", null)] })).ok).toBe(true);
  }
  expect(normalizePerformance(performance({ status: "abandoned" })).ok).toBe(false);
  expect(normalizePerformance(performance({ reps: [] })).ok).toBe(false);
  const p = performance(); p.reps[0] = rep(0, "skipped", null);
  expect(normalizePerformance(p).ok).toBe(false);
});

test.each([{ interrupted: undefined }, { materiallyModified: undefined }, { status: "finished" }, { reps: null }, { segmentId: "" }, { rounds: 2 }])("invalid performance %p", change => {
  expect(normalizePerformance(performance(change)).ok).toBe(false);
});

test("unsafe sum cannot silently lose integer precision", () => {
  const p = performance(); p.reps.forEach(r => { r.time = { hundredths: Number.MAX_SAFE_INTEGER, precision: 2 }; });
  expect(normalizePerformance(p).errors).toContainEqual({ path: "reps", code: "unsafe_time_total" });
});


test("sparse results and inherited records cannot silently normalize", () => {
  const p = performance(); p.reps.length = 10;
  expect(normalizePerformance(p).ok).toBe(false);
  expect(normalizePerformance(Object.create(performance())).ok).toBe(false);
  expect(normalizeRepResult(Object.create(rep(0))).ok).toBe(false);
});


test("stopping during final rep is valid without an unattempted tail", () => {
  const p = performance({ status: "stopped" }); p.reps[7] = rep(7, "dnf", null);
  expect(normalizePerformance(p).ok).toBe(true);
});
test("oversized arrays, accessors and malformed nested records are rejected", () => {
  expect(normalizePerformance(performance({ reps: new Array(10001) })).ok).toBe(false);
  const r = rep(0); Object.defineProperty(r, "time", { get() { throw new Error("must not execute"); } });
  expect(normalizeRepResult(r).ok).toBe(false);
});
