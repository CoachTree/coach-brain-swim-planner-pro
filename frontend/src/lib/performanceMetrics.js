import { comparePerformanceDefinitions } from "./performanceDefinition";
import { normalizePerformance } from "./performanceResults";

// All counts/aggregates below refer to PLANNED reps. Added reps are reported
// separately, excluded from completion and timing aggregates, and prevent an
// ordinary trend claim. No outlier filtering. No heterogeneous averaging.
// Aggregate seconds can contain fractional hundredths; do not round stored
// metrics. Formatting aggregate precision is a future presentation decision.
export function calculatePerformanceMetrics(input) {
  const result = normalizePerformance(input);
  if (!result.ok) return { ok: false, errors: result.errors, metrics: null };
  const p = result.performance;
  const planned = p.reps.filter(r => r.plannedRepIndex !== null);
  const completed = planned.filter(r => r.outcome === "completed");
  const timed = completed.filter(r => r.time !== null);
  const plannedRepCount = p.definition.segment.repeatCount;
  const addedRepCount = p.reps.length - planned.length;
  const reasons = [];
  if (p.status !== "completed") reasons.push("not_completed");
  if (p.interrupted) reasons.push("interrupted");
  if (p.materiallyModified) reasons.push("materially_modified");
  if (addedRepCount) reasons.push("added_reps");
  if (timed.length !== plannedRepCount) reasons.push("incomplete_timing");
  const comparison = comparePerformanceDefinitions(p.definition, p.definition);
  const definitionConfirmed = comparison.classification === "EXACT";
  const uniformWorkKnown = !comparison.reasons.some(r => r.code === "underspecified_work");
  if (!definitionConfirmed) reasons.push("unconfirmed_protocol");
  const trendEligible = reasons.length === 0;
  const driftReasons = [...reasons];
  if (timed.length < 4) driftReasons.push("fewer_than_four_timed_reps");
  const driftEligible = driftReasons.length === 0;
  const mean = rows => rows.reduce((sum, row) => sum + row.time.hundredths, 0) / rows.length / 100;
  const half = Math.floor(timed.length / 2);
  const firstHalfAverageSeconds = driftEligible ? mean(timed.slice(0, half)) : null;
  const secondHalfAverageSeconds = driftEligible ? mean(timed.slice(-half)) : null;
  const sum = rows => rows.reduce((n, row) => n + row.time.hundredths, 0);
  return { ok: true, errors: [], metrics: {
    plannedRepCount, recordedPlannedRepCount: planned.length, addedRepCount,
    timedRepCount: timed.length, completionCount: completed.length,
    completionPercentage: completed.length / plannedRepCount * 100,
    timingCoveragePercentage: timed.length / plannedRepCount * 100,
    averageSeconds: timed.length && !p.materiallyModified && uniformWorkKnown ? mean(timed) : null,
    bestSeconds: timed.length && !p.materiallyModified && uniformWorkKnown ? timed.reduce((best, r) => Math.min(best, r.time.hundredths), Infinity) / 100 : null,
    firstHalfAverageSeconds, secondHalfAverageSeconds,
    secondHalfDriftSeconds: driftEligible ? (sum(timed.slice(-half)) - sum(timed.slice(0, half))) / half / 100 : null,
    driftEligible, driftIneligibilityReasons: driftReasons,
    trendEligible, trendIneligibilityReasons: reasons,
  } };
}
