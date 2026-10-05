import { useEffect, useRef, useState } from "react";
import { createLocalPerformanceStore } from "@/lib/localPerformanceStore";
import { normalizePerformance } from "@/lib/performanceResults";
import { composePerformance } from "@/lib/performanceRecording";

export const RECORDING_ERROR_MESSAGES = Object.freeze({
  unavailable: "Recording storage isn't available on this device.",
  conflict: "This recording changed elsewhere. Reload the saved recording.",
  invalid_data: "This recording couldn't be read safely.",
  not_found: "This recording is no longer available.",
  storage_failure: "Results couldn't be saved. Your current entry has not been advanced.",
});
const empty = () => ({ phase: "closed", recording: null, source: null, context: {}, athleteLabel: "", index: 0, busy: false, error: null, issue: "", closeRequested: false, viewKey: 0 });
const nextRep = pair => {
  const n = pair.occurrence.plannedDefinition.segment.repeatCount;
  const resolved = new Set(pair.performance.reps.filter(r => r.outcome !== "unknown").map(r => r.plannedRepIndex));
  for (let i = 0; i < n; i += 1) if (!resolved.has(i)) return i;
  return n;
};
const fullReps = pair => {
  const byIndex = new Map(pair.performance.reps.map(r => [r.plannedRepIndex, r]));
  return Array.from({ length: pair.occurrence.plannedDefinition.segment.repeatCount }, (_, i) =>
    byIndex.get(i) || { repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome: "unknown", time: null });
};
function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw Object.assign(new Error(), { code: "unavailable" });
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}

// All performance state stays here, never in the session/profile. Repository
// construction is lazy/no-I/O; IDs are allocated only for an explicit start.
export function usePerformanceRecorder({ scopeKey, athleteStore, athletes, enabled, checkingAccess = false, repository, idProvider = newId }) {
  const repo = useRef(null);
  if (!repo.current) repo.current = repository || createLocalPerformanceStore();
  const [state, setState] = useState(empty);
  const current = useRef(state), pendingStart = useRef(null), flight = useRef(false), epoch = useRef(0);
  const access = useRef(null);
  access.current = { scopeKey, athleteStore, athletes, enabled, checkingAccess };
  const boundScope = useRef(scopeKey), boundEnabled = useRef(enabled);
  const publish = patch => { current.current = { ...current.current, ...patch }; setState(current.current); };
  useEffect(() => {
    // A same-account check suspends commands, not the current lifecycle. A
    // different scope is always isolated, even while its access is loading.
    if (boundScope.current === scopeKey && (checkingAccess || boundEnabled.current === enabled)) return;
    boundScope.current = scopeKey; boundEnabled.current = enabled; epoch.current += 1;
    pendingStart.current = null; current.current = empty(); setState(current.current);
  }, [scopeKey, enabled, checkingAccess]);
  useEffect(() => () => { epoch.current += 1; }, []);
  const visible = () => boundScope.current === access.current.scopeKey && boundEnabled.current
    && (access.current.enabled || access.current.checkingAccess);
  const permitted = () => visible() && access.current.enabled && !access.current.checkingAccess;
  async function run(work) {
    if (flight.current || !permitted()) return false;
    const token = epoch.current, scope = access.current.scopeKey;
    flight.current = true; publish({ busy: true, error: null, issue: "" });
    try {
      const patch = await work();
      // An already-started transaction may settle during a same-account check.
      // Keep its authoritative version/result; never apply it across a boundary.
      if (token !== epoch.current || scope !== access.current.scopeKey || !visible()) return false;
      publish(patch); return true;
    } catch (e) {
      if (token === epoch.current && scope === access.current.scopeKey && visible()) publish({ error: { code: e.code || "storage_failure", message: RECORDING_ERROR_MESSAGES[e.code] || RECORDING_ERROR_MESSAGES.storage_failure } });
      return false;
    } finally {
      flight.current = false;
      if (token === epoch.current) publish({ busy: false });
    }
  }
  async function checkpoint(progress, patch = {}) {
    const pair = current.current.recording;
    if (!pair || !permitted()) return false;
    const check = normalizePerformance(composePerformance(pair.occurrence, progress));
    if (!check.ok) {
      publish({ issue: progress.status === "completed"
        ? "Finish requires every planned rep to be completed. Correct skipped or unfinished reps, or save this draft and close."
        : "Stop requires an attempted rep followed by unattempted work, or a final rep that did not finish. Review the results; use Finish if all reps are complete." });
      return false;
    }
    return run(async () => ({ recording: await repo.current.saveProgress({ scopeKey: pair.performance.scopeKey, performanceId: pair.performance.id,
      expectedVersion: pair.performance.recordVersion, progress }), ...patch }));
  }
  function progressFor(pair, overrides = {}) {
    const p = pair.performance;
    return { status: p.status, interrupted: p.interrupted, materiallyModified: p.materiallyModified, reps: p.reps, coachNote: p.coachNote, ...overrides };
  }
  return {
    state: { ...(visible() ? state : empty()), checkingAccess },
    open(source, context = {}) {
      if (!permitted() || flight.current || current.current.recording?.performance.status === "draft") return;
      pendingStart.current = null;
      publish({ ...empty(), phase: "confirm", source: { ...source, plannedTextSnapshot: [...source.plannedTextSnapshot] },
        context: { unit: context.unit, poolLength: context.poolLength, stroke: context.stroke } });
    },
    start({ athleteId, plannedDefinition, performedDate, timezone }) {
      if (flight.current || current.current.phase !== "confirm" || !permitted()) return Promise.resolve(false);
      const athlete = access.current.athletes.find(a => String(a.id) === athleteId);
      if (!athlete) { publish({ issue: "Select a current roster athlete before starting." }); return Promise.resolve(false); }
      return run(async () => {
        const s = current.current.source;
        const input = { scopeKey: access.current.scopeKey, athleteRef: { store: access.current.athleteStore, id: athleteId },
          performedDate, timezone, plannedDefinition, plannedTextSnapshot: s.plannedTextSnapshot,
          source: { sessionId: s.sessionId, blockId: s.blockId, draftRevision: s.draftRevision, changeSequence: s.changeSequence } };
        const signature = JSON.stringify(input);
        if (pendingStart.current?.signature !== signature) pendingStart.current = { signature,
          input: { ...input, occurrenceId: idProvider(), performanceId: idProvider(), segmentId: idProvider() } };
        const recording = await repo.current.startRecording(pendingStart.current.input);
        return { recording, athleteLabel: athlete.name || athleteId, phase: "record", index: nextRep(recording), viewKey: current.current.viewKey + 1 };
      });
    },
    saveRep(outcome, time = null) {
      if (flight.current || current.current.phase !== "record") return Promise.resolve(false);
      const pair = current.current.recording, index = current.current.index;
      if (index >= pair.occurrence.plannedDefinition.segment.repeatCount) return Promise.resolve(false);
      const reps = fullReps(pair), correction = reps[index].outcome !== "unknown";
      reps[index] = { repIndex: index, plannedRepIndex: index, roundIndex: 0, outcome, time };
      const updated = { ...pair, performance: { ...pair.performance, reps } };
      return checkpoint(progressFor(pair, { status: "draft", reps }), { index: correction ? nextRep(updated) : index + 1 });
    },
    previous() {
      if (permitted() && !flight.current) publish({ index: Math.max(0, current.current.index - 1), issue: "" });
    },
    setConditions(flags) {
      if (flight.current || !current.current.recording) return Promise.resolve(false);
      return checkpoint(progressFor(current.current.recording, flags));
    },
    finish() {
      if (flight.current || !current.current.recording) return Promise.resolve(false);
      return checkpoint(progressFor(current.current.recording, { status: "completed" }), { phase: "summary", closeRequested: false });
    },
    stop() {
      if (flight.current || !current.current.recording) return Promise.resolve(false);
      const pair = current.current.recording;
      const reps = fullReps(pair).map(r => r.outcome === "unknown" ? { ...r, outcome: "not_attempted", time: null } : r);
      return checkpoint(progressFor(pair, { status: "stopped", reps }), { phase: "summary", closeRequested: false });
    },
    requestClose() {
      if (!permitted() || flight.current) return;
      if (current.current.phase === "record") publish({ closeRequested: true });
      else publish({ phase: "closed", closeRequested: false, error: null });
    },
    cancelClose() { if (permitted() && !flight.current) publish({ closeRequested: false }); },
    closeDraft() {
      if (flight.current || !current.current.recording) return Promise.resolve(false);
      return checkpoint(progressFor(current.current.recording, { status: "draft" }), { phase: "closed", closeRequested: false });
    },
    discard() {
      if (!current.current.recording) return Promise.resolve(false);
      const pair = current.current.recording;
      return run(async () => {
        await repo.current.deleteRecording({ scopeKey: pair.performance.scopeKey, performanceId: pair.performance.id,
          expectedVersion: pair.performance.recordVersion, expectedOccurrenceVersion: pair.occurrence.recordVersion });
        return empty();
      });
    },
    resume() {
      if (!current.current.recording) return Promise.resolve(false);
      const pair = current.current.recording;
      return run(async () => {
        const recording = await repo.current.getRecording({ scopeKey: pair.performance.scopeKey, performanceId: pair.performance.id });
        return { recording, phase: recording.performance.status === "draft" ? "record" : "summary", index: nextRep(recording),
          viewKey: current.current.viewKey + 1, closeRequested: false };
      });
    },
  };
}
