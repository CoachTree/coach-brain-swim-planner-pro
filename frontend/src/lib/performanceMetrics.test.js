import { calculatePerformanceMetrics as calculate } from "./performanceMetrics";
import { parsePerformanceTime } from "./performanceTime";

const times = [67.2, 66.8, 67.5, 68.1, 67.9, 68.5, 69.2, 68.8];
const performance = (values = times) => ({
  definition: { schemaVersion: 1, unit: "m", poolLength: 25, segment: {
    task: "swim", stroke: "freestyle", repeatCount: values.length, repeatDistance: 100,
    startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" },
  } }, segmentId: "any-block-segment", status: "completed", interrupted: false, materiallyModified: false,
  reps: values.map((v, i) => ({ repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome: "completed", time: v === null ? null : parsePerformanceTime(v).value })),
});
const metrics = p => { const result = calculate(p); expect(result.ok).toBe(true); return result.metrics; };

test("known eight-rep example", () => {
  const p = performance(), before = JSON.stringify(p), m = metrics(p);
  expect(m).toMatchObject({ plannedRepCount: 8, timedRepCount: 8, completionCount: 8, completionPercentage: 100, timingCoveragePercentage: 100,
    averageSeconds: 68, bestSeconds: 66.8, firstHalfAverageSeconds: 67.4, secondHalfAverageSeconds: 68.6, secondHalfDriftSeconds: 1.2,
    driftEligible: true, trendEligible: true, driftIneligibilityReasons: [] });
  expect(JSON.stringify(p)).toBe(before);
});
test("odd count excludes middle from halves, retains it in average and outliers", () => {
  const m = metrics(performance([60, 62, 600, 64, 66]));
  expect(m.firstHalfAverageSeconds).toBe(61); expect(m.secondHalfAverageSeconds).toBe(65);
  expect(m.secondHalfDriftSeconds).toBe(4); expect(m.averageSeconds).toBe(170.4);
});
test("negative drift means faster later", () => expect(metrics(performance([70, 70, 60, 60])).secondHalfDriftSeconds).toBe(-10));
test.each([[60], [60, 62], [60, 62, 64]])("fewer than four reps has no headline halves or drift: %p", (...values) => {
  const m = metrics(performance(values));
  expect(m.driftEligible).toBe(false); expect(m.secondHalfDriftSeconds).toBeNull();
  expect(m.firstHalfAverageSeconds).toBeNull(); expect(m.secondHalfAverageSeconds).toBeNull();
});
test("completion and timing coverage are distinct; missing time never becomes zero", () => {
  const m = metrics(performance([60, 60, 60, 60, 60, 60, null, null]));
  expect(m).toMatchObject({ completionCount: 8, timedRepCount: 6, completionPercentage: 100, timingCoveragePercentage: 75, averageSeconds: 60, bestSeconds: 60,
    secondHalfDriftSeconds: null, trendEligible: false });
  expect(m.driftIneligibilityReasons).toContain("incomplete_timing");
  const untimed = metrics(performance([null, null, null, null]));
  expect(untimed.averageSeconds).toBeNull(); expect(untimed.bestSeconds).toBeNull();
});
test("stopped six of eight is 75%, not a completed six-rep trend", () => {
  const p = performance(); p.status = "stopped";
  p.reps.slice(6).forEach(r => { r.outcome = "not_attempted"; r.time = null; });
  const m = metrics(p);
  expect(m).toMatchObject({ plannedRepCount: 8, completionCount: 6, completionPercentage: 75, timingCoveragePercentage: 75, trendEligible: false, secondHalfDriftSeconds: null });
});
test.each(["skipped", "unknown", "dnf", "not_attempted"])("%s is not completed or a zero time", outcome => {
  const p = performance(); p.status = "draft"; p.reps[1].outcome = outcome; p.reps[1].time = null;
  expect(metrics(p)).toMatchObject({ completionCount: 7, timedRepCount: 7, completionPercentage: 87.5, secondHalfDriftSeconds: null });
});
test("missing row is unrecorded, not skipped or planned-count reduction", () => {
  const p = performance(); p.status = "draft"; p.reps = p.reps.slice(0, 6);
  expect(metrics(p)).toMatchObject({ plannedRepCount: 8, recordedPlannedRepCount: 6, completionCount: 6, completionPercentage: 75 });
});
test.each(["interrupted", "materiallyModified"])("%s prevents headline drift and exact trend", flag => {
  const p = performance(); p[flag] = true;
  const m = metrics(p);
  expect(m.driftEligible).toBe(false); expect(m.trendEligible).toBe(false);
  if (flag === "materiallyModified") { expect(m.averageSeconds).toBeNull(); expect(m.bestSeconds).toBeNull(); }
});
test("unknown protocol conditions prevent confirmed trend and drift", () => {
  const p = performance(); delete p.definition.segment.equipment;
  expect(metrics(p).driftIneligibilityReasons).toContain("unconfirmed_protocol");
});
test("added reps cannot inflate completion or pollute planned averages", () => {
  const p = performance(); p.reps.push({ ...p.reps[0], repIndex: 8, plannedRepIndex: null, time: parsePerformanceTime(10).value });
  expect(metrics(p)).toMatchObject({ addedRepCount: 1, completionCount: 8, completionPercentage: 100, averageSeconds: 68, bestSeconds: 66.8, trendEligible: false, secondHalfDriftSeconds: null });
});
test("invalid/heterogeneous input returns validation errors, never misleading metrics", () => {
  const p = performance(); p.reps[1].repeatDistance = 50;
  expect(calculate(p)).toMatchObject({ ok: false, metrics: null });
  expect(calculate(null)).toMatchObject({ ok: false, metrics: null });
});
test("fractional hundredth averages are not prematurely rounded", () => {
  const m = metrics(performance([60, 60, 60.01]));
  expect(m.averageSeconds).toBeCloseTo(60 + 0.01 / 3, 10);
});


test.each([{ stroke: "choice" }, { task: "drill" }, { task: "skill" }])("underspecified work cannot yield homogeneous timing metrics: %p", fields => {
  const p = performance(); Object.assign(p.definition.segment, fields);
  const m = metrics(p);
  expect(m.averageSeconds).toBeNull(); expect(m.bestSeconds).toBeNull();
  expect(m.driftEligible).toBe(false); expect(m.trendEligible).toBe(false);
});
test.each(["repeatDistance", "stroke", "task", "unit"])("per-rep %s cannot override uniform protocol", field => {
  const p = performance(); p.reps[0][field] = "mixed";
  expect(calculate(p).ok).toBe(false);
});


test("all equal times have zero drift and one missing time suppresses it", () => {
  const p = performance([60, 60, 60, 60]);
  expect(metrics(p)).toMatchObject({ averageSeconds: 60, secondHalfDriftSeconds: 0 });
  p.reps[3].time = null;
  expect(metrics(p)).toMatchObject({ completionPercentage: 100, timingCoveragePercentage: 75, secondHalfDriftSeconds: null });
});
test("abandoned recorded times are descriptive, not an ordinary trend", () => {
  const p = performance(); p.status = "abandoned"; p.reps = p.reps.slice(0, 4);
  expect(metrics(p)).toMatchObject({ completionCount: 4, averageSeconds: 67.4, trendEligible: false, secondHalfDriftSeconds: null });
});
