import { MATCHING_VERSION, normalizePerformanceDefinition } from "./performanceDefinition";
import { normalizePerformance, normalizeRepResult, PERFORMANCE_STATUSES } from "./performanceResults";

// Application records only. P1 remains pure and knows nothing about persistence.
// Scope is an explicit caller-selected partition, NOT authentication/security.
// device:<opaque-id> pairs with local athlete IDs; account:<opaque-id> with
// Supabase provenance. Both are stored locally; no reconciliation or cloud I/O.
export const RECORDING_SCHEMA_VERSION = 1;
export const RECORDING_LIMITS = Object.freeze({ id: 128, scope: 136, timezone: 64, textLines: 100, textLine: 2000, note: 2000, reps: 10000 });

export class PerformanceRecordingError extends Error {
  constructor(code, message) { super(message); this.name = "PerformanceRecordingError"; this.code = code; }
}
const invalid = message => { throw new PerformanceRecordingError("invalid_data", message); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function record(value, keys, label) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(k => typeof k !== "string" || !keys.includes(k) || !own(Object.getOwnPropertyDescriptor(value, k), "value"))) invalid(`Invalid ${label}`);
}
function text(value, max, label, empty = false) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) invalid(`Invalid ${label}`);
  return value;
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid("Invalid ID");
  return value;
}
export function validateRecordingScope(scopeKey) {
  if (typeof scopeKey !== "string" || !/^(device|account):[A-Za-z0-9_-]{1,128}$/.test(scopeKey)) invalid("Invalid scopeKey");
  return scopeKey;
}
function integer(value, min, label) {
  if (!Number.isSafeInteger(value) || value < min) invalid(`Invalid ${label}`);
  return value;
}
function date(value) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) invalid("Invalid performedDate");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("Invalid performedDate");
  return value;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid("Invalid timestamp");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid("Invalid timestamp");
  return value;
}
function meta(value) {
  if (value.schemaVersion !== RECORDING_SCHEMA_VERSION) invalid("Unsupported recording schema");
  id(value.id); validateRecordingScope(value.scopeKey); integer(value.recordVersion, 1, "recordVersion");
  timestamp(value.createdAt); timestamp(value.updatedAt);
  if (value.updatedAt < value.createdAt) invalid("updatedAt precedes creation");
}
function denseArray(value, max, label) {
  if (!Array.isArray(value) || value.length > max) invalid(`Invalid ${label}`);
  for (let i = 0; i < value.length; i += 1) if (!own(value, i)) invalid(`Sparse ${label}`);
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const occurrenceKeys = ["id", "schemaVersion", "scopeKey", "recordVersion", "performedDate", "timezone", "source", "segmentId", "plannedDefinition", "plannedTextSnapshot", "matchingVersion", "createdAt", "updatedAt"];
const performanceKeys = ["id", "schemaVersion", "scopeKey", "recordVersion", "occurrenceId", "athleteRef", "status", "interrupted", "materiallyModified", "reps", "coachNote", "createdAt", "updatedAt"];
const progressKeys = ["status", "interrupted", "materiallyModified", "reps", "coachNote"];

function definition(value) {
  const normalized = normalizePerformanceDefinition(value);
  if (!normalized.ok || normalized.definition.segment.repeatCount > RECORDING_LIMITS.reps) invalid("Invalid planned definition");
  return normalized.definition;
}
function athlete(scopeKey, value) {
  record(value, ["store", "id"], "athleteRef"); id(value.id);
  const expectedStore = scopeKey.startsWith("device:") ? "local" : "supabase";
  if (value.store !== expectedStore) invalid("Athlete store does not match scope");
  return { store: value.store, id: value.id };
}
export function normalizeRecordingQuery(value) {
  record(value, ["scopeKey", "athleteRef", "plannedDefinition"], "history query");
  const scopeKey = validateRecordingScope(value.scopeKey);
  return freeze({ scopeKey, athleteRef: athlete(scopeKey, value.athleteRef), plannedDefinition: definition(value.plannedDefinition) });
}

export function normalizeOccurrence(value) {
  record(value, occurrenceKeys, "occurrence"); meta(value); date(value.performedDate); id(value.segmentId);
  text(value.timezone, RECORDING_LIMITS.timezone, "timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(0); } catch { invalid("Invalid timezone"); }
  record(value.source, ["sessionId", "blockId", "draftRevision", "changeSequence"], "source");
  const source = {};
  for (const key of ["sessionId", "blockId"]) source[key] = value.source[key] === null ? null : id(value.source[key]);
  for (const key of ["draftRevision", "changeSequence"]) source[key] = value.source[key] === null ? null : integer(value.source[key], 0, key);
  if (value.id === source.sessionId) invalid("Occurrence ID must not be source session ID");
  if (value.matchingVersion !== MATCHING_VERSION) invalid("Unsupported matching version");
  const plannedDefinition = definition(value.plannedDefinition);
  denseArray(value.plannedTextSnapshot, RECORDING_LIMITS.textLines, "planned text");
  const plannedTextSnapshot = value.plannedTextSnapshot.map(line => text(line, RECORDING_LIMITS.textLine, "text line", true));
  return freeze({ id: value.id, schemaVersion: RECORDING_SCHEMA_VERSION, scopeKey: value.scopeKey, recordVersion: value.recordVersion,
    performedDate: value.performedDate, timezone: value.timezone, source, segmentId: value.segmentId,
    plannedDefinition, plannedTextSnapshot, matchingVersion: MATCHING_VERSION,
    createdAt: value.createdAt, updatedAt: value.updatedAt });
}

export function composePerformance(occurrence, performance) {
  return { definition: occurrence.plannedDefinition, segmentId: occurrence.segmentId,
    status: performance.status, interrupted: performance.interrupted, materiallyModified: performance.materiallyModified, reps: performance.reps };
}

export function normalizeAthletePerformance(value, occurrence) {
  const parent = normalizeOccurrence(occurrence);
  record(value, performanceKeys, "athlete performance"); meta(value); id(value.occurrenceId);
  if (value.scopeKey !== parent.scopeKey || value.occurrenceId !== parent.id) invalid("Mismatched occurrence relationship");
  const athleteRef = athlete(value.scopeKey, value.athleteRef);
  denseArray(value.reps, RECORDING_LIMITS.reps, "reps");
  const p1 = normalizePerformance(composePerformance(parent, value));
  if (!p1.ok) invalid(`Invalid performance: ${p1.errors.map(e => e.code).join(", ")}`);
  const coachNote = value.coachNote === undefined ? "" : text(value.coachNote, RECORDING_LIMITS.note, "coachNote", true);
  return freeze({ id: value.id, schemaVersion: RECORDING_SCHEMA_VERSION, scopeKey: value.scopeKey, recordVersion: value.recordVersion,
    occurrenceId: value.occurrenceId, athleteRef,
    status: p1.performance.status, interrupted: p1.performance.interrupted, materiallyModified: p1.performance.materiallyModified,
    reps: p1.performance.reps, coachNote, createdAt: value.createdAt, updatedAt: value.updatedAt });
}

// IDs and time are explicit: callers allocate IDs ONCE and retain them for retry.
// This pure constructor cannot open a database or generate identity/time itself.
export function createRecording(input, createdAt) {
  record(input, ["scopeKey", "occurrenceId", "performanceId", "segmentId", "performedDate", "timezone", "source", "plannedDefinition", "plannedTextSnapshot", "athleteRef"], "start request");
  const occurrence = normalizeOccurrence({ id: input.occurrenceId, schemaVersion: 1, scopeKey: input.scopeKey, recordVersion: 1,
    performedDate: input.performedDate, timezone: input.timezone, source: input.source, segmentId: input.segmentId,
    plannedDefinition: input.plannedDefinition, plannedTextSnapshot: input.plannedTextSnapshot, matchingVersion: MATCHING_VERSION, createdAt, updatedAt: createdAt });
  const performance = normalizeAthletePerformance({ id: input.performanceId, schemaVersion: 1, scopeKey: input.scopeKey, recordVersion: 1,
    occurrenceId: occurrence.id, athleteRef: input.athleteRef, status: "draft", interrupted: false, materiallyModified: false,
    reps: [], coachNote: "", createdAt, updatedAt: createdAt }, occurrence);
  return freeze({ occurrence, performance });
}

// Capture caller-owned progress synchronously, before repository awaits an open.
export function snapshotRecordingProgress(progress) {
  record(progress, progressKeys, "progress");
  for (const key of progressKeys.filter(k => k !== "coachNote")) if (!own(progress, key)) invalid(`Missing ${key}`);
  if (!PERFORMANCE_STATUSES.includes(progress.status) || typeof progress.interrupted !== "boolean" || typeof progress.materiallyModified !== "boolean") invalid("Invalid progress state");
  denseArray(progress.reps, RECORDING_LIMITS.reps, "reps");
  const reps = progress.reps.map(rep => {
    const result = normalizeRepResult(rep);
    if (!result.ok) invalid("Invalid rep result");
    return result.rep;
  });
  return freeze({ status: progress.status, interrupted: progress.interrupted, materiallyModified: progress.materiallyModified, reps,
    ...(own(progress, "coachNote") ? { coachNote: text(progress.coachNote, RECORDING_LIMITS.note, "coachNote", true) } : {}) });
}

export function applyRecordingProgress(occurrence, performance, progress, updatedAt) {
  const current = normalizeAthletePerformance(performance, occurrence);
  const snapshot = snapshotRecordingProgress(progress);
  // A checkpoint is the full deliberate result state; note may be omitted to
  // retain its current value. Identity/protocol fields are not patchable.
  return normalizeAthletePerformance({ ...current, ...snapshot, recordVersion: current.recordVersion + 1, updatedAt }, occurrence);
}

export function correctRecordingDate(occurrence, performedDate, updatedAt) {
  const current = normalizeOccurrence(occurrence);
  return normalizeOccurrence({ ...current, performedDate: date(performedDate), recordVersion: current.recordVersion + 1, updatedAt });
}
