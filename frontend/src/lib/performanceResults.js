import { normalizePerformanceDefinition } from "./performanceDefinition";
import { validatePerformanceTime } from "./performanceTime";

export const PERFORMANCE_STATUSES = Object.freeze(["draft", "completed", "stopped", "abandoned"]);
export const REP_OUTCOMES = Object.freeze(["completed", "dnf", "skipped", "not_attempted", "unknown"]);
// Accept plain data records, not inherited protocols or executable accessors.
const object = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => typeof key === "string"
    && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value"));
const index = x => Number.isSafeInteger(x) && x >= 0;

// Indices are zero-based. plannedRepIndex:null explicitly identifies an added
// rep; omission is invalid. repIndex is actual sequence, not protocol identity.
// V1 contains no rounds (roundIndex=0). A future whole-set occurrence can own
// multiple segment performances; athlete/occurrence IDs live outside definition.
export function normalizeRepResult(input) {
  const errors = [];
  const fail = code => errors.push(code);
  if (!object(input)) return { ok: false, rep: null, errors: ["invalid_rep"] };
  const allowed = ["repIndex", "plannedRepIndex", "roundIndex", "outcome", "time"];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail("unsupported_rep_field");
  if (!index(input.repIndex)) fail("invalid_rep_index");
  if (!(input.plannedRepIndex === null || index(input.plannedRepIndex))) fail("invalid_planned_index");
  if (input.roundIndex !== 0) fail("unsupported_round");
  if (!REP_OUTCOMES.includes(input.outcome)) fail("invalid_outcome");
  const time = input.time ?? null;
  if (time !== null && (!validatePerformanceTime(time) || input.outcome !== "completed")) fail("invalid_time_for_outcome");
  return { ok: !errors.length, errors, rep: errors.length ? null : {
    repIndex: input.repIndex, plannedRepIndex: input.plannedRepIndex, roundIndex: 0,
    outcome: input.outcome, time: time === null ? null : { hundredths: time.hundredths, precision: time.precision },
  } };
}

// completed means ALL PLANNED swimming completed, not all times recorded.
// stopped means attempted work followed by an explicitly unattempted tail,
// or a DNF on the final planned rep (there is then no remaining tail).
// abandoned means the attempt was discarded before completing the plan; no
// inference about missing reps. draft is unfinalized, including missing records.
// Missing rows and outcome unknown are unrecorded, never silently skipped.
// interrupted/materiallyModified must be explicit coach-supplied booleans.
// Materially modified work may be retained, but its timing aggregates are not
// compared to the uniform plan. Per-rep protocol overrides are not supported.
export function normalizePerformance(input) {
  if (!object(input)) return { ok: false, performance: null, errors: [{ path: "performance", code: "invalid_object" }] };
  const errors = [];
  const fail = (path, code) => errors.push({ path, code });
  const definitionResult = normalizePerformanceDefinition(input.definition);
  errors.push(...definitionResult.errors.map(e => ({ ...e, path: `definition.${e.path}` })));
  const allowed = ["definition", "segmentId", "status", "interrupted", "materiallyModified", "reps", "metadata"];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(key, "unsupported_field");
  if (typeof input.segmentId !== "string" || !input.segmentId.trim()) fail("segmentId", "invalid_segment_id");
  if (!PERFORMANCE_STATUSES.includes(input.status)) fail("status", "invalid_status");
  for (const key of ["interrupted", "materiallyModified"]) if (typeof input[key] !== "boolean") fail(key, "confirmation_required");
  // Bound array traversal and reject holes rather than dropping missing rows.
  const validRepsArray = Array.isArray(input.reps) && input.reps.length <= 10000
    && Array.from({ length: input.reps.length }, (_, i) => Object.prototype.hasOwnProperty.call(input.reps, i)).every(Boolean);
  if (!validRepsArray) fail("reps", "invalid_reps");
  const reps = [], planned = new Map();
  const count = definitionResult.definition?.segment.repeatCount;
  let lastPlanned = -1, totalHundredths = 0;
  (validRepsArray ? input.reps : []).forEach((source, position) => {
    const result = normalizeRepResult(source);
    for (const code of result.errors) fail(`reps.${position}`, code);
    if (!result.ok) return;
    const rep = result.rep;
    if (rep.repIndex !== position) fail(`reps.${position}.repIndex`, "nonsequential_rep_index");
    if (rep.plannedRepIndex !== null) {
      if (planned.has(rep.plannedRepIndex)) fail(`reps.${position}.plannedRepIndex`, "duplicate_planned_index");
      if (rep.plannedRepIndex <= lastPlanned) fail(`reps.${position}.plannedRepIndex`, "out_of_order_planned_index");
      if (count !== undefined && rep.plannedRepIndex >= count) fail(`reps.${position}.plannedRepIndex`, "outside_plan");
      lastPlanned = rep.plannedRepIndex;
      planned.set(rep.plannedRepIndex, rep);
    }
    totalHundredths += rep.time?.hundredths || 0;
    reps.push(rep);
  });
  if (!Number.isSafeInteger(totalHundredths)) fail("reps", "unsafe_time_total");
  const allCompleted = planned.size === count && [...planned.values()].every(r => r.outcome === "completed");
  if (input.status === "completed" && !allCompleted) fail("status", "planned_work_incomplete");
  if (input.status === "abandoned" && allCompleted) fail("status", "planned_work_already_complete");
  if (input.status === "stopped") {
    const rows = [...planned.values()];
    const tailIndex = rows.findIndex(r => r.outcome === "not_attempted");
    const stopIndex = tailIndex < 0 ? rows.length : tailIndex;
    if (planned.size !== count || stopIndex < 1
      || (tailIndex < 0 && rows[rows.length - 1]?.outcome !== "dnf")
      || !rows.slice(0, stopIndex).some(r => ["completed", "dnf"].includes(r.outcome))
      || rows.slice(0, stopIndex).some(r => r.outcome === "unknown")
      || rows.slice(stopIndex).some(r => r.outcome !== "not_attempted")
      || reps.some(r => r.plannedRepIndex === null)) fail("status", "invalid_stopped_tail");
  }
  return { ok: !errors.length, errors, performance: errors.length ? null : {
    definition: definitionResult.definition, segmentId: input.segmentId, status: input.status,
    interrupted: input.interrupted, materiallyModified: input.materiallyModified, reps,
  } };
}
