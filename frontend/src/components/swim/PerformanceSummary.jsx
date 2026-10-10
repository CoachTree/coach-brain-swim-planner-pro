import { useEffect, useRef, useState } from "react";
import { calculatePerformanceMetrics } from "@/lib/performanceMetrics";
import { composePerformance } from "@/lib/performanceRecording";
import { formatPerformanceTime } from "@/lib/performanceTime";

export default function PerformanceSummary({ recording, athleteLabel, onClose, onCompare, comparisonEnabled = false, comparisonVersion }) {
  const result = calculatePerformanceMetrics(composePerformance(recording.occurrence, recording.performance));
  const metrics = result.metrics;
  const [comparison, setComparison] = useState(null);
  const [retry, setRetry] = useState(0);
  const compareRef = useRef(onCompare);
  compareRef.current = onCompare;
  useEffect(() => {
    let active = true;
    setComparison(null);
    if (comparisonEnabled && metrics?.trendEligible && compareRef.current) {
      setComparison({ status: "loading", recordingKey: recording, version: comparisonVersion });
      Promise.resolve().then(() => active ? compareRef.current() : null).then(value => {
        if (active) setComparison(value ? { ...value, recordingKey: recording, version: comparisonVersion } : null);
      }).catch(() => {
        if (active) setComparison({ status: "error", recordingKey: recording, version: comparisonVersion });
      });
    }
    return () => { active = false; };
  }, [recording, comparisonEnabled, comparisonVersion, metrics?.trendEligible, retry]);
  const shown = comparisonEnabled && comparison?.recordingKey === recording && comparison.version === comparisonVersion ? comparison : null;
  // Presentation only: aggregates are rounded to the least precise entered time;
  // canonical P1 values and recorded precision remain unchanged.
  const times = recording.performance.reps.filter(r => r.time).map(r => r.time);
  const precision = times.length ? Math.min(...times.map(t => t.precision)) : 0;
  const display = seconds => {
    if (seconds == null) return "—";
    const quantum = 10 ** (2 - precision);
    return formatPerformanceTime({ hundredths: Math.round(seconds * 100 / quantum) * quantum, precision }) || "—";
  };
  return <div className="space-y-4" data-testid="performance-summary">
    <p className="font-bold">{athleteLabel}</p><p>Stored on this device</p>
    <p>{recording.occurrence.performedDate} · {recording.performance.status}</p>
    {metrics ? <>
      <p>Completed {metrics.completionCount}/{metrics.plannedRepCount}</p>
      <p>Timed {metrics.timedRepCount}/{metrics.plannedRepCount}</p>
      <p>Average: {display(metrics.averageSeconds)}</p><p>Best: {display(metrics.bestSeconds)}</p>
      {metrics.driftEligible ? <><p>First half: {display(metrics.firstHalfAverageSeconds)}</p><p>Second half: {display(metrics.secondHalfAverageSeconds)}</p>
        <p>Second-half drift: {metrics.secondHalfDriftSeconds.toFixed(precision)} seconds</p></>
        : <p className="text-sm">Half averages and drift unavailable: a completed, fully timed, confirmed and unchanged protocol is required (at least four reps).</p>}
    </> : <p role="alert">This recording couldn't be read safely.</p>}
    {onCompare && <section aria-label="Saved performance comparison" data-testid="performance-comparison" className="space-y-2">
      {!metrics?.trendEligible ? <p>Comparison unavailable: a completed, fully timed, uninterrupted, unchanged Exact-comparable segment is required.</p>
        : !comparisonEnabled ? <p>Comparison is paused while access or the saved recording is being checked.</p>
        : shown?.status === "loading" ? <p role="status">Looking for an earlier eligible Exact result on this device…</p>
        : shown?.status === "error" ? <p role="alert">Previous results couldn’t be loaded. This performance is saved.</p>
        : shown?.status === "changed" ? <p role="status">This saved recording changed or was deleted. Close and reopen the saved summary before comparing.</p>
        : shown?.status === "unavailable" ? <p role="status">Comparison unavailable: this athlete must have an unambiguous identity in the current roster.</p>
        : shown?.status === "ready" && (shown.recording
          ? <Comparison current={recording} previous={shown.recording} />
          : <p role="status">No eligible Exact result before {recording.occurrence.performedDate} was found on this device.</p>)}
      {!!shown?.warnings?.length && <p role="status">Some stored records could not be read and were excluded.</p>}
      {shown?.status === "error" && <button type="button" className="min-h-12 border rounded px-4" onClick={() => setRetry(n => n + 1)}>Retry comparison</button>}
    </section>}
    <button className="min-h-12 w-full border rounded" onClick={onClose}>Close summary</button>
  </div>;
}

function Comparison({ current, previous }) {
  const now = calculatePerformanceMetrics(composePerformance(current.occurrence, current.performance)).metrics;
  const prior = calculatePerformanceMetrics(composePerformance(previous.occurrence, previous.performance)).metrics;
  const precision = Math.min(...[current, previous].flatMap(pair => pair.performance.reps.filter(r => r.time).map(r => r.time.precision)));
  const difference = (a, b) => {
    const rounded = Number((a - b).toFixed(precision));
    if (rounded === 0) return `${(0).toFixed(precision)} s — no difference at displayed precision`;
    return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(precision)} s — ${rounded > 0 ? "more" : "less"} time`;
  };
  return <div data-testid="performance-comparison-result">
    <p>Earlier eligible Exact result · Stored on this device</p>
    <table className="w-full text-sm"><thead><tr><th>Metric</th><th>This performance · {current.occurrence.performedDate}</th><th>Previous Exact · {previous.occurrence.performedDate}</th><th>Difference</th></tr></thead>
      <tbody>{[["Average", "averageSeconds"], ["Best", "bestSeconds"]].map(([label, key]) => <tr key={key}>
        <th>{label}</th><td>{now[key].toFixed(precision)} s</td><td>{prior[key].toFixed(precision)} s</td><td>{difference(now[key], prior[key])}</td>
      </tr>)}</tbody></table>
    <p>Difference = this performance − previous Exact result.</p>
  </div>;
}
