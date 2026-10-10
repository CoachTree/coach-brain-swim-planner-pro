import { useEffect, useRef, useState } from "react";
import { comparePerformanceDefinitions, normalizePerformanceDefinition } from "@/lib/performanceDefinition";
import { calculatePerformanceMetrics } from "@/lib/performanceMetrics";
import { composePerformance } from "@/lib/performanceRecording";
import { formatPerformanceTime, parsePerformanceTime } from "@/lib/performanceTime";

const equipmentOptions = ["fins", "paddles", "pull_buoy", "kickboard", "snorkel", "ankle_band"];
const control = "block w-full min-h-12 border rounded p-2 bg-white";
const readable = value => value.replaceAll("_", " ");
// Presentation of P1 errors only; P1 remains the source of validation rules.
const validationMessages = {
  unit: ["unit", "Select Metres or Yards."],
  poolLength: ["pool", "Select a 25 or 50 pool length."],
  "segment.task": ["task", "Select the task for this segment."],
  "segment.stroke": ["stroke", "Select the stroke for this segment."],
  "segment.repeatCount": ["count", "Enter a positive whole number of repetitions."],
  "segment.repeatDistance": ["distance", "Enter a positive whole, wall-compatible distance per repetition for this pool."],
  "segment.startType": ["startType", "Select a supported start type or Unknown."],
  "segment.recovery": ["recovery", "Select Unknown, None, Rest or Send-off for recovery."],
  "segment.recovery.seconds": ["recoveryTime", "Enter recovery time as 90 or 1:30, without words such as ‘seconds’."],
  "segment.equipment": ["equipment", "Select supported equipment, None or Unknown."],
  "segment.effort": ["effort", "Select a supported effort or Unknown."],
  "segment.target": ["target", "Enter valid target times; minimum must not exceed maximum."],
};
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PerformanceConfirmation({ athletes, state, onStart, onFindPreviousExact }) {
  const [form, setForm] = useState(() => ({ athleteId: athletes.filter(a => String(a.id) === state.context.suggestedAthleteId).length === 1
    ? state.context.suggestedAthleteId : "", date: localDate(),
    unit: ["m", "yd"].includes(state.context.unit) ? state.context.unit : "",
    pool: [25, 50].includes(state.context.poolLength) ? String(state.context.poolLength) : "",
    stroke: state.context.stroke === "IM" ? "individual_medley" : state.context.stroke || "",
    task: "", count: "", distance: "", startType: "", recovery: "unknown", recoveryTime: "",
    equipment: "unknown", selectedEquipment: [], effort: "", target: "unknown", min: "", max: "", structure: "uniform", confirmed: false }));
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [issue, setIssue] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const update = (key, value) => {
    invalidateHistory();
    setForm(f => ({ ...f, [key]: value })); setIssue("");
    setFieldErrors(errors => ({ ...errors, [key]: undefined, ...(key === "recovery" ? { recoveryTime: undefined } : {}) }));
  };
  const errorText = key => fieldErrors[key] && <span id={`performance-${key}-error`} className="block text-sm" role="alert">{fieldErrors[key]}</span>;
  const select = (key, label, values) => <label className="block text-sm font-medium">{label}
    <select className={control} data-testid={`performance-${key}`} value={form[key]} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `performance-${key}-error` : undefined} onChange={e => update(key, e.target.value)}>
      {values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>{errorText(key)}</label>;
  const input = (key, label, type = "text") => <label className="block text-sm font-medium">{label}
    <input className={control} data-testid={`performance-${key}`} type={type} value={form[key]} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `performance-${key}-error` : undefined} onChange={e => update(key, e.target.value)} />{errorText(key)}</label>;
  const options = values => values.map(v => [v, readable(v)]);
  const unsupported = form.structure !== "uniform" || [form.equipment, form.recovery, form.target, form.startType, form.effort].includes("unsupported");
  const currentAthlete = athletes.some(a => String(a.id) === form.athleteId);
  const blockingReason = state.checkingAccess ? "Checking Pro access… Your entries are preserved."
    : state.busy ? "Starting recording… Please wait."
    : !athletes.length ? "No roster athletes are available. Add an athlete in Athletes before recording."
    : !currentAthlete ? (form.athleteId ? "The selected athlete is no longer in the current roster. Select an athlete above in this confirmation."
      : "Select an athlete above in this confirmation to start recording.")
    : unsupported ? "Choose one uniform segment with supported conditions above."
    : !form.confirmed ? "Check the confirmation box above to start recording." : "";
  function normalizeForm() {
    const seconds = text => { const p = parsePerformanceTime(text); return p.ok ? p.value.hundredths / 100 : NaN; };
    return normalizePerformanceDefinition({ schemaVersion: 1, unit: form.unit, poolLength: Number(form.pool), segment: {
      task: form.task, stroke: form.stroke, repeatCount: Number(form.count), repeatDistance: Number(form.distance),
      startType: form.startType || null, effort: form.effort || null,
      recovery: form.recovery === "unknown" ? null : form.recovery === "none" ? { mode: "none" } : { mode: form.recovery, seconds: seconds(form.recoveryTime) },
      equipment: form.equipment === "unknown" ? null : form.equipment === "none" ? [] : form.selectedEquipment,
      target: form.target === "range" ? { state: "range", minSeconds: seconds(form.min), maxSeconds: seconds(form.max) } : { state: form.target },
    } });
  }
  const normalized = normalizeForm();
  const historyReason = blockingReason || (!state.historyEnabled || !onFindPreviousExact ? "Previous Exact memory requires confirmed Pro access."
    : athletes.filter(a => String(a.id) === form.athleteId).length !== 1 ? "Select an unambiguous current roster athlete."
    : (form.equipment === "selected" && !form.selectedEquipment.length) || !normalized.ok || normalized.definition.segment.repeatCount > 10000
      ? "Complete a valid uniform segment to look up Exact memory."
    : comparePerformanceDefinitions(normalized.definition, normalized.definition).classification !== "EXACT"
      ? "Exact memory requires known conditions and fully specified work. You can still record this segment." : "");
  const [history, setHistory] = useState(null);
  const historyRequest = useRef(0);
  useEffect(() => { historyRequest.current += 1; setHistory(null); }, [state.historyVersion, historyReason]);
  useEffect(() => () => { historyRequest.current += 1; }, []);
  const invalidateHistory = () => { historyRequest.current += 1; setHistory(null); };
  const shownHistory = !historyReason && history?.form === form && history.version === state.historyVersion ? history : null;
  async function lookup() {
    if (historyReason) return;
    const request = ++historyRequest.current;
    const snapshot = { form, version: state.historyVersion };
    setHistory({ ...snapshot, status: "loading" });
    try {
      const result = await onFindPreviousExact({ athleteId: form.athleteId, plannedDefinition: normalized.definition, confirmed: form.confirmed });
      if (request === historyRequest.current) setHistory(result ? { ...snapshot, status: "ready", ...result } : null);
    } catch {
      if (request === historyRequest.current) setHistory({ ...snapshot, status: "error" });
    }
  }
  async function submit(e) {
    e.preventDefault();
    invalidateHistory();
    if (blockingReason) return;
    setIssue(""); setFieldErrors({});
    if (form.equipment === "selected" && !form.selectedEquipment.length) return setIssue("Select the equipment used, or explicitly choose None or Unknown.");
    const result = normalized;
    if (!result.ok) {
      const errors = Object.fromEntries(result.errors.map(error => validationMessages[error.path] || ["protocol", "Check the repetitions and distance for this uniform segment."]));
      setFieldErrors(errors); setIssue(Object.values(errors).join(" ")); return;
    }
    if (result.definition.segment.repeatCount > 10000) return setIssue("This pilot supports up to 10,000 repetitions.");
    await onStart({ athleteId: form.athleteId, plannedDefinition: result.definition, performedDate: form.date, timezone });
  }
  return <form onSubmit={submit} className="space-y-4">
    <p className="font-semibold">Stored on this device</p>
    <p className="text-sm">Performance results are not cloud synced or included in the existing backup.</p>
    <details><summary className="min-h-12 cursor-pointer py-3">Main Set — reference only</summary>
      <ul>{state.source.plannedTextSnapshot.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <p>Confirm one actual uniform segment below. Workout text is not converted into a protocol.</p>
    </details>
    {!athletes.length && <p role="alert">No usable roster athlete is available. Add an athlete in Athletes before recording.</p>}
    <fieldset disabled={state.busy || state.checkingAccess} className="space-y-4">
      {select("athleteId", "Athlete", [["", "Select a roster athlete"], ...athletes.map(a => [String(a.id), `${a.name || "Athlete"} (${a.id})`])])}
      {input("date", "Training date", "date")}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {select("unit", "Unit", [["", "Select"], ["m", "Metres"], ["yd", "Yards"]])}
        {select("pool", "Pool length", [["", "Select"], ["25", "25"], ["50", "50"]])}
        {select("structure", "Structure", [["uniform", "One uniform segment"], ["unsupported", "Rounds, mixed work or other structure"]])}
        {select("task", "Task", [["", "Select"], ...options(["swim", "drill", "kick", "pull", "skill"])])}
        {select("stroke", "Stroke", [["", "Select"], ...options(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "choice"])])}
        {input("count", "Repetitions", "number")}
        {input("distance", "Distance per repetition", "number")}
        {select("startType", "Start type", [["", "Unknown"], ...options(["push", "dive", "in_water"]), ["unsupported", "Other / unsupported"]])}
        {select("recovery", "Recovery", [["unknown", "Unknown"], ["none", "None"], ["rest", "Rest"], ["send_off", "Send-off"], ["unsupported", "Variable / other"]])}
        {["rest", "send_off"].includes(form.recovery) && input("recoveryTime", "Recovery time (seconds or m:ss)")}
        {select("equipment", "Equipment", [["unknown", "Unknown"], ["none", "None"], ["selected", "Select equipment"], ["unsupported", "Other equipment"]])}
        {select("effort", "Effort", [["", "Unknown"], ...options(["recovery", "easy", "controlled", "moderate", "strong", "hard", "max", "race_pace"]), ["unsupported", "Variable / other"]])}
        {select("target", "Target", [["unknown", "Unknown"], ["none", "None"], ["range", "Time range"], ["unsupported", "Other target"]])}
        {form.target === "range" && <>{input("min", "Minimum time (seconds or m:ss)")}{input("max", "Maximum time (seconds or m:ss)")}</>}
      </div>
      {form.equipment === "selected" && <div>{equipmentOptions.map(value => <label key={value} className="inline-flex items-center gap-2 min-h-12 mr-4">
        <input type="checkbox" checked={form.selectedEquipment.includes(value)} onChange={e => update("selectedEquipment", e.target.checked ? [...form.selectedEquipment, value] : form.selectedEquipment.filter(v => v !== value))} />{readable(value)}</label>)}</div>}
      {unsupported && <p role="alert">This pilot supports one uniform segment with supported conditions. These conditions cannot be represented safely.</p>}
      <p className="text-sm">Unknown conditions and generic drill, skill or choice work cannot establish Exact comparability. Some summary metrics will be unavailable.</p>
      <label className="flex items-center gap-3 min-h-12"><input data-testid="performance-confirmed" type="checkbox" checked={form.confirmed} onChange={e => update("confirmed", e.target.checked)} />I confirm the selected athlete and actual uniform segment; this is not a flattened set of rounds.</label>
      <section aria-label="Previous Exact memory" className="space-y-2" data-testid="performance-history">
        <p className="font-semibold">Previous Exact memory</p>
        {historyReason && <p id="performance-history-reason" className="text-sm">{historyReason}</p>}
        <button type="button" className="min-h-12 border rounded px-4 disabled:opacity-50" data-testid="performance-history-lookup"
          disabled={!!historyReason || shownHistory?.status === "loading"} aria-describedby={historyReason ? "performance-history-reason" : undefined} onClick={lookup}>
          {shownHistory?.status === "error" ? "Retry" : "Show previous Exact result"}
        </button>
        {shownHistory?.status === "loading" && <p role="status">Looking for an eligible Exact result on this device…</p>}
        {shownHistory?.status === "error" && <p role="alert">Previous results couldn’t be loaded. You can still start recording.</p>}
        {shownHistory?.status === "ready" && <>
          {shownHistory.recording ? <ExactMemory recording={shownHistory.recording} athlete={athletes.find(a => String(a.id) === form.athleteId)} />
            : <p role="status">No eligible Exact result found on this device for this athlete and confirmed segment.</p>}
          {!!shownHistory.warnings?.length && <p role="status">Some stored records could not be read and were excluded.</p>}
        </>}
      </section>
      <p id="performance-start-reason" data-testid="performance-start-reason" role="status">{blockingReason}</p>
      <button data-testid="performance-start" aria-describedby={blockingReason ? "performance-start-reason" : undefined} className="w-full min-h-12 bg-[#003366] text-white rounded px-4 disabled:opacity-50" disabled={!!blockingReason} type="submit">{state.checkingAccess ? "Checking access…" : state.busy ? "Starting…" : "Start Recording"}</button>
    </fieldset>
    {(issue || state.issue || state.error) && <p role="alert">{issue || state.issue || state.error.message}</p>}
  </form>;
}

// Display only: history never populates the confirmation or changes stored precision.
function ExactMemory({ recording, athlete }) {
  const { occurrence, performance } = recording;
  const metrics = calculatePerformanceMetrics(composePerformance(occurrence, performance)).metrics;
  if (!metrics?.trendEligible) return <p role="alert">This historical result is not fully comparable.</p>;
  const definition = occurrence.plannedDefinition, segment = definition.segment;
  const precision = Math.min(...performance.reps.filter(r => r.time).map(r => r.time.precision));
  const display = seconds => {
    const quantum = 10 ** (2 - precision);
    return formatPerformanceTime({ hundredths: Math.round(seconds * 100 / quantum) * quantum, precision });
  };
  return <div data-testid="performance-history-result" className="space-y-1">
    <p className="font-semibold">Latest eligible Exact result on this device</p>
    <p>{athlete?.name || "Athlete"} ({performance.athleteRef.id})</p>
    <p>Performed: {occurrence.performedDate}</p>
    <p>{segment.repeatCount} × {segment.repeatDistance}{definition.unit} · {readable(segment.task)} · {readable(segment.stroke)} · {definition.poolLength}{definition.unit} pool</p>
    <p>Start: {readable(segment.startType)} · Recovery: {readable(segment.recovery.mode)}{segment.recovery.mode !== "none" ? ` ${segment.recovery.seconds}s` : ""}</p>
    <p>Equipment: {segment.equipment.length ? segment.equipment.map(readable).join(", ") : "None"} · Effort: {readable(segment.effort)}</p>
    <p>Target: {segment.target.state === "range" ? `${segment.target.minSeconds}–${segment.target.maxSeconds}s` : "None"}</p>
    <p>Completed {metrics.completionCount}/{metrics.plannedRepCount} · Timed {metrics.timedRepCount}/{metrics.plannedRepCount}</p>
    <p>Average: {display(metrics.averageSeconds)} · Best: {display(metrics.bestSeconds)}</p>
  </div>;
}
