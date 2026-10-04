import { calculatePerformanceMetrics } from "@/lib/performanceMetrics";
import { composePerformance } from "@/lib/performanceRecording";
import { formatPerformanceTime } from "@/lib/performanceTime";

export default function PerformanceSummary({ recording, athleteLabel, onClose }) {
  const result = calculatePerformanceMetrics(composePerformance(recording.occurrence, recording.performance));
  const metrics = result.metrics;
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
    <button className="min-h-12 w-full border rounded" onClick={onClose}>Close summary</button>
  </div>;
}
