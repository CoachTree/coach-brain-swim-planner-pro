import { parsePerformanceTime } from "./performanceTime";

export const DEFINITION_SCHEMA_VERSION = 1;
export const MATCHING_VERSION = 1;

// Accept plain data records, not inherited protocols or executable accessors.
const isObject = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => typeof key === "string"
    && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value"));
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const tasks = ["swim", "drill", "kick", "pull", "skill"];
const strokes = ["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "choice"];
const starts = ["push", "dive", "in_water"];
const efforts = ["recovery", "easy", "controlled", "moderate", "strong", "hard", "max", "race_pace"];
const equipmentNames = ["fins", "paddles", "pull_buoy", "kickboard", "snorkel", "ankle_band"];
const segmentKeys = ["task", "stroke", "repeatCount", "repeatDistance", "startType", "recovery", "equipment", "effort", "target"];
// These fields are explicitly context, never protocol identity. Arbitrary
// extensions belong under metadata/context, not among material fields.
const contextKeys = ["context", "metadata", "label", "wording", "athleteId", "athleteName", "date", "sessionId", "results", "comments"];
const topKeys = ["schemaVersion", "unit", "poolLength", "segment", ...contextKeys];

// V1 is ONE uninterrupted uniform segment, not a whole workout. Round/phase
// structures are deliberately unsupported: never flatten 2x(4x100) into 8x100.
// Unknown optional material fields normalize to null (target: state unknown).
// [] equipment, recovery mode none, and target state none require confirmation.
// Normalization whitelists material data; contextual labels/PII/results are
// neither retained nor used for matching. No source object is mutated.
export function normalizePerformanceDefinition(input) {
  const errors = [];
  const fail = (path, code) => errors.push({ path, code });
  if (!isObject(input)) return { ok: false, definition: null, errors: [{ path: "definition", code: "invalid_object" }] };
  for (const key of Object.keys(input)) if (!topKeys.includes(key)) fail(key, "unsupported_field");
  if (input.schemaVersion !== DEFINITION_SCHEMA_VERSION) fail("schemaVersion", "unsupported_version");
  if (!["m", "yd"].includes(input.unit)) fail("unit", "invalid_unit");
  if (![25, 50].includes(input.poolLength)) fail("poolLength", "unsupported_pool_length");
  const s = isObject(input.segment) ? input.segment : {};
  if (!isObject(input.segment)) fail("segment", "invalid_object");
  for (const key of Object.keys(s)) if (![...segmentKeys, ...contextKeys].includes(key)) fail(`segment.${key}`, "unsupported_field");
  if (!tasks.includes(s.task)) fail("segment.task", "invalid_task");
  if (!strokes.includes(s.stroke)) fail("segment.stroke", "invalid_stroke");
  if (!positiveInteger(s.repeatCount)) fail("segment.repeatCount", "invalid_count");
  if (!positiveInteger(s.repeatDistance) || ![25, 50].includes(input.poolLength) || s.repeatDistance % input.poolLength !== 0) fail("segment.repeatDistance", "invalid_wall_distance");
  if (!positiveInteger(s.repeatCount) || !positiveInteger(s.repeatDistance) || !Number.isSafeInteger(s.repeatCount * s.repeatDistance)) fail("segment", "unsafe_total_distance");
  const startType = s.startType ?? null;
  const effort = s.effort ?? null;
  if (startType !== null && !starts.includes(startType)) fail("segment.startType", "invalid_start");
  if (effort !== null && !efforts.includes(effort)) fail("segment.effort", "invalid_effort");
  let recovery = null;
  if (s.recovery != null) {
    const r = s.recovery;
    if (!isObject(r) || !["none", "rest", "send_off"].includes(r.mode)) fail("segment.recovery", "invalid_recovery");
    else if (r.mode === "none") {
      if (Object.keys(r).some(k => k !== "mode")) fail("segment.recovery", "unexpected_recovery_fields");
      recovery = { mode: "none" };
    } else {
      const parsed = typeof r.seconds === "number" ? parsePerformanceTime(r.seconds) : { ok: false };
      if (!parsed.ok) fail("segment.recovery.seconds", "invalid_duration");
      if (Object.keys(r).some(k => !["mode", "seconds"].includes(k))) fail("segment.recovery", "unsupported_field");
      recovery = { mode: r.mode, seconds: r.seconds };
    }
  }
  let equipment = null;
  if (s.equipment != null) {
    if (!Array.isArray(s.equipment) || s.equipment.length > 64 || Array.from(s.equipment).some(e => !equipmentNames.includes(e))) fail("segment.equipment", "invalid_equipment");
    else equipment = [...new Set(s.equipment)].sort();
  }
  let target = { state: "unknown" };
  if (s.target != null) {
    const t = s.target;
    if (!isObject(t) || !["unknown", "none", "range"].includes(t.state)) fail("segment.target", "invalid_target");
    else if (t.state === "range") {
      const min = typeof t.minSeconds === "number" ? parsePerformanceTime(t.minSeconds) : { ok: false };
      const max = typeof t.maxSeconds === "number" ? parsePerformanceTime(t.maxSeconds) : { ok: false };
      if (!min.ok || !max.ok || t.minSeconds > t.maxSeconds) fail("segment.target", "invalid_range");
      if (Object.keys(t).some(k => !["state", "minSeconds", "maxSeconds"].includes(k))) fail("segment.target", "unsupported_field");
      target = { state: "range", minSeconds: t.minSeconds, maxSeconds: t.maxSeconds };
    } else {
      if (Object.keys(t).some(k => k !== "state")) fail("segment.target", "unexpected_target_fields");
      target = { state: t.state };
    }
  }
  errors.sort((a, b) => compareText(a.path, b.path) || compareText(a.code, b.code));
  return { ok: errors.length === 0, errors, definition: errors.length ? null : {
    schemaVersion: DEFINITION_SCHEMA_VERSION, unit: input.unit, poolLength: input.poolLength,
    segment: { task: s.task, stroke: s.stroke, repeatCount: s.repeatCount, repeatDistance: s.repeatDistance,
      startType, recovery, equipment, effort, target },
  } };
}

// An unhashed, versioned canonical key avoids hash collisions/dependencies.
// Same key is NOT proof of comparability: two equally unknown protocols have
// the same key but must not be treated as an EXACT confirmed protocol.
export function canonicalizePerformanceDefinition(input, matchingVersion = MATCHING_VERSION) {
  const result = normalizePerformanceDefinition(input);
  if (!result.ok || matchingVersion !== MATCHING_VERSION) return null;
  return JSON.stringify({ matchingVersion, definition: result.definition });
}

const unknown = (key, value) => value === null || (key === "target" && value.state === "unknown");

// Identity fields differ -> RELATED; dosage/recovery/effort/target -> SIMILAR.
// Units differ, invalid/unsupported data, or any unknown material condition ->
// NOT_COMPARABLE. Conservative by design: no exact trend claim from missing data.
export function comparePerformanceDefinitions(left, right) {
  const a = normalizePerformanceDefinition(left), b = normalizePerformanceDefinition(right);
  if (!a.ok || !b.ok) {
    const reasons = [...new Map([...a.errors, ...b.errors].map(e => [`${e.path}:${e.code}`, { path: e.path, code: e.code }])).values()]
      .sort((x, y) => compareText(x.path, y.path) || compareText(x.code, y.code));
    return { classification: "NOT_COMPARABLE", matchingVersion: MATCHING_VERSION, reasons };
  }
  const reasons = [];
  let rank = 0;
  // Choice stroke and unnamed drill/skill do not establish physical identity.
  // Preserve the draft definition, but require future coach confirmation with
  // a richer schema before making exact comparisons or uniform-time claims.
  for (const key of ["task", "stroke"]) {
    if ([a, b].some(r => key === "task" ? ["drill", "skill"].includes(r.definition.segment.task) : r.definition.segment.stroke === "choice")) {
      reasons.push({ path: `segment.${key}`, code: "underspecified_work" }); rank = 3;
    }
  }
  const check = (path, x, y, differenceRank, key = "") => {
    if (unknown(key, x) || unknown(key, y)) {
      reasons.push({ path, code: "unknown_condition" }); rank = 3;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      reasons.push({ path, code: "different_condition" }); rank = Math.max(rank, differenceRank);
    }
  };
  check("unit", a.definition.unit, b.definition.unit, 3);
  check("poolLength", a.definition.poolLength, b.definition.poolLength, 2);
  for (const key of segmentKeys) check(`segment.${key}`, a.definition.segment[key], b.definition.segment[key],
    ["task", "stroke", "repeatDistance", "startType", "equipment"].includes(key) ? 2 : 1, key);
  return { classification: ["EXACT", "SIMILAR", "RELATED", "NOT_COMPARABLE"][rank], matchingVersion: MATCHING_VERSION,
    reasons: reasons.sort((x, y) => compareText(x.path, y.path)) };
}
