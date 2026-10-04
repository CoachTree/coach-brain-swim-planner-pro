import { useEffect, useRef, useState } from "react";
import { parsePerformanceTime, formatPerformanceTime } from "@/lib/performanceTime";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from "@/components/ui/alert-dialog";

const button = "min-h-12 rounded border px-3 disabled:opacity-50";
export default function PerformanceRecorder({ controller }) {
  const { state } = controller;
  const { recording, index, busy } = state;
  const segment = recording.occurrence.plannedDefinition.segment;
  const [text, setText] = useState("");
  const [issue, setIssue] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const input = useRef(null);
  const saved = recording.performance.reps.find(r => r.plannedRepIndex === index);
  const savedTime = saved?.time ? formatPerformanceTime(saved.time) : "";
  useEffect(() => { setText(savedTime); setIssue(""); input.current?.focus(); }, [index, state.viewKey, savedTime]);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy]);
  async function save(e) {
    e.preventDefault(); const parsed = parsePerformanceTime(text);
    if (!parsed.ok) return setIssue("Enter a positive time, for example 67.2 or 1:07.2 (up to two decimal places).");
    setIssue(""); await controller.saveRep("completed", parsed.value);
  }
  const modal = state.closeRequested ? "close" : confirmation;
  async function confirm() {
    const success = await (modal === "stop" ? controller.stop() : modal === "discard" ? controller.discard() : modal === "reload" ? controller.resume() : controller.closeDraft());
    if (success) setConfirmation(null);
  }
  return <div className="space-y-3" data-testid="performance-recorder">
    <p className="font-bold">{state.athleteLabel}</p>
    <p>{segment.repeatCount} × {segment.repeatDistance}{recording.occurrence.plannedDefinition.unit} {segment.stroke.replaceAll("_", " ")}</p>
    <p className="text-sm">Stored on this device · {recording.occurrence.performedDate}</p>
    {index < segment.repeatCount ? <form onSubmit={save} className="space-y-3">
      <h3 className="text-xl font-bold">Rep {index + 1} of {segment.repeatCount}</h3>
      {saved && saved.outcome !== "unknown" && <p>Saved outcome: {saved.outcome.replaceAll("_", " ")}{savedTime ? ` · ${savedTime}` : ""}</p>}
      <label className="block">Time in seconds
        <input ref={input} data-testid="performance-time" type="text" inputMode="decimal" autoComplete="off" aria-describedby="performance-time-help" className="block w-full min-h-14 border rounded p-3 text-2xl" value={text} disabled={busy} onChange={e => setText(e.target.value)} />
      </label><p id="performance-time-help" className="text-sm">Example: 67.2. You can also enter 1:07.2.</p>
      <button data-testid="performance-save" type="submit" disabled={busy} className={`${button} w-full bg-[#003366] text-white`}>Save &amp; Next</button>
    </form> : <h3 className="text-xl font-bold">All rep entries recorded — review and finish</h3>}
    <div role="status">{busy ? "Saving…" : "Saved on this device"}</div>
    {(issue || state.issue || state.error) && <p role="alert">{issue || state.issue || state.error.message}</p>}
    <button className={`${button} w-full`} disabled={busy || index === 0} onClick={controller.previous}>Previous</button>
    {index < segment.repeatCount && <div className="grid grid-cols-3 gap-2">{[["No time", "completed"], ["Skipped", "skipped"], ["Did not finish", "dnf"]].map(([label, outcome]) =>
      <button key={outcome} className={button} disabled={busy} onClick={() => { setIssue(""); controller.saveRep(outcome); }}>{label}</button>)}</div>}
    <div className="flex flex-wrap gap-3">{[["interrupted", "Extra interruption"], ["materiallyModified", "Actual protocol changed"]].map(([key, label]) => <label className="flex items-center gap-2 min-h-12" key={key}>
      <input type="checkbox" disabled={busy} checked={recording.performance[key]} onChange={e => controller.setConditions({ [key]: e.target.checked })} />{label}</label>)}</div>
    <div className="grid grid-cols-2 gap-2">
      <button className={button} disabled={busy} onClick={() => setConfirmation("stop")}>Stop Set</button>
      <button className={button} disabled={busy} onClick={controller.finish}>Finish</button>
      <button className={button} disabled={busy} onClick={controller.requestClose}>Save draft and close</button>
      <button className={button} disabled={busy} onClick={() => setConfirmation("discard")}>Discard recording</button>
    </div>
    {state.error?.code === "conflict" && <button className={`${button} w-full`} disabled={busy} onClick={() => setConfirmation("reload")}>Reload saved recording</button>}
    <AlertDialog open={!!modal} onOpenChange={open => { if (!open && !busy) { setConfirmation(null); controller.cancelClose(); } }}>
      <AlertDialogContent>
        <AlertDialogTitle>{modal === "stop" ? "Stop this set?" : modal === "discard" ? "Discard this recording?" : modal === "reload" ? "Reload saved recording?" : "Save draft and close?"}</AlertDialogTitle>
        <AlertDialogDescription>{modal === "stop" ? "Saved outcomes will remain. Remaining reps will be marked not attempted; the planned set will not change." : modal === "discard" ? "Delete only this recording from this device? This cannot be undone." : modal === "reload" ? "Replace the current entry with the saved recording from this device." : "Checkpointed results are retained. A typed time not saved with Save & Next is not included."}</AlertDialogDescription>
        {(state.error || state.issue) && <p role="alert">{state.issue || state.error.message}</p>}
        <AlertDialogCancel disabled={busy} className="min-h-12">Keep recording</AlertDialogCancel>
        <button data-testid="performance-confirm-action" className={`${button} bg-[#003366] text-white`} disabled={busy} onClick={confirm}>{busy ? "Saving…" : modal === "stop" ? "Confirm stop" : modal === "discard" ? "Confirm discard" : modal === "reload" ? "Reload" : "Save draft and close"}</button>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
