import { useState } from "react";
import { normalizePerformanceDefinition } from "@/lib/performanceDefinition";
import { parsePerformanceTime } from "@/lib/performanceTime";

const equipmentOptions = ["fins", "paddles", "pull_buoy", "kickboard", "snorkel", "ankle_band"];
const control = "block w-full min-h-12 border rounded p-2 bg-white";
const readable = value => value.replaceAll("_", " ");
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PerformanceConfirmation({ athletes, state, onStart }) {
  const [form, setForm] = useState(() => ({ athleteId: "", date: localDate(),
    unit: ["m", "yd"].includes(state.context.unit) ? state.context.unit : "",
    pool: [25, 50].includes(state.context.poolLength) ? String(state.context.poolLength) : "",
    stroke: state.context.stroke === "IM" ? "individual_medley" : state.context.stroke || "",
    task: "", count: "", distance: "", startType: "", recovery: "unknown", recoveryTime: "",
    equipment: "unknown", selectedEquipment: [], effort: "", target: "unknown", min: "", max: "", structure: "uniform", confirmed: false }));
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [issue, setIssue] = useState("");
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const select = (key, label, values) => <label className="block text-sm font-medium">{label}
    <select className={control} data-testid={`performance-${key}`} value={form[key]} onChange={e => update(key, e.target.value)}>
      {values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>;
  const input = (key, label, type = "text") => <label className="block text-sm font-medium">{label}
    <input className={control} data-testid={`performance-${key}`} type={type} value={form[key]} onChange={e => update(key, e.target.value)} /></label>;
  const options = values => values.map(v => [v, readable(v)]);
  const unsupported = form.structure !== "uniform" || [form.equipment, form.recovery, form.target, form.startType, form.effort].includes("unsupported");
  async function submit(e) {
    e.preventDefault(); setIssue("");
    if (unsupported) return setIssue("This pilot supports one uniform segment with supported conditions. Mixed rounds or other conditions cannot be recorded as this definition.");
    if (!form.confirmed || !athletes.some(a => String(a.id) === form.athleteId)) return setIssue("Select a roster athlete and confirm the actual uniform segment.");
    if (form.equipment === "selected" && !form.selectedEquipment.length) return setIssue("Select the equipment used, or explicitly choose None or Unknown.");
    const seconds = text => { const p = parsePerformanceTime(text); return p.ok ? p.value.hundredths / 100 : NaN; };
    const result = normalizePerformanceDefinition({ schemaVersion: 1, unit: form.unit, poolLength: Number(form.pool), segment: {
      task: form.task, stroke: form.stroke, repeatCount: Number(form.count), repeatDistance: Number(form.distance),
      startType: form.startType || null, effort: form.effort || null,
      recovery: form.recovery === "unknown" ? null : form.recovery === "none" ? { mode: "none" } : { mode: form.recovery, seconds: seconds(form.recoveryTime) },
      equipment: form.equipment === "unknown" ? null : form.equipment === "none" ? [] : form.selectedEquipment,
      target: form.target === "range" ? { state: "range", minSeconds: seconds(form.min), maxSeconds: seconds(form.max) } : { state: form.target },
    } });
    if (!result.ok) return setIssue("Check the protocol: select task, stroke, unit and pool, enter positive whole repetitions and a wall-compatible distance, and valid recovery/target times.");
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
    <fieldset disabled={state.busy} className="space-y-4">
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
      <label className="flex items-center gap-3 min-h-12"><input data-testid="performance-confirmed" type="checkbox" checked={form.confirmed} onChange={e => update("confirmed", e.target.checked)} />I confirm this is the actual uniform segment, not a flattened set of rounds.</label>
      <button data-testid="performance-start" className="w-full min-h-12 bg-[#003366] text-white rounded px-4 disabled:opacity-50" disabled={!athletes.length || unsupported || !form.confirmed || !form.athleteId} type="submit">{state.busy ? "Starting…" : "Start Recording"}</button>
    </fieldset>
    {(issue || state.issue || state.error) && <p role="alert">{issue || state.issue || state.error.message}</p>}
  </form>;
}
