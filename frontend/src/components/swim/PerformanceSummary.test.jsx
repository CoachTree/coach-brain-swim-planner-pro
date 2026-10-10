import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PerformanceSummary from "./PerformanceSummary";
import * as metrics from "@/lib/performanceMetrics";

global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const pair = (task = "swim", timed = true) => ({ occurrence: { segmentId: "s", performedDate: "2026-10-04", plannedDefinition: { schemaVersion: 1, unit: "m", poolLength: 25, segment: { task, stroke: "freestyle", repeatCount: 4, repeatDistance: 100, startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } } }, performance: { status: "completed", interrupted: false, materiallyModified: false, reps: Array.from({ length: 4 }, (_, i) => ({ repIndex: i, plannedRepIndex: i, roundIndex: 0, outcome: "completed", time: timed ? { hundredths: 6700 + i * 100, precision: 1 } : null })) } });
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); });
test("summary delegates metrics to P1 and displays eligible halves/drift", async () => {
  const spy = jest.spyOn(metrics, "calculatePerformanceMetrics"); const data = pair();
  await act(async () => root.render(<PerformanceSummary recording={data} athleteLabel="Athlete" onClose={() => {}} />));
  expect(spy).toHaveBeenCalledWith({ definition: data.occurrence.plannedDefinition, segmentId: "s", ...data.performance });
  expect(container.textContent).toContain("Completed 4/4"); expect(container.textContent).toContain("Average: 1:08.5"); expect(container.textContent).toContain("Best: 1:07.0");
  expect(container.textContent).toContain("First half: 1:07.5"); expect(container.textContent).toContain("Second half: 1:09.5"); expect(container.textContent).toContain("Second-half drift: 2.0 seconds");
});
test.each([["swim", false], ["drill", true], ["skill", true]])("unavailable %s/timed=%s metrics use em dash, not zero", async (task, timed) => {
  await act(async () => root.render(<PerformanceSummary recording={pair(task, timed)} athleteLabel="Athlete" onClose={() => {}} />));
  expect(container.textContent).toContain("Average: —"); expect(container.textContent).toContain("Best: —"); expect(container.textContent).not.toContain("Second-half drift:");
});

const renderComparison = async (recording, onCompare, extra = {}) => { await act(async () => root.render(<PerformanceSummary recording={recording} athleteLabel="Athlete" onClose={() => {}} onCompare={onCompare} comparisonEnabled comparisonVersion={1} {...extra} />)); };
test("comparison shows explicit dates, signed neutral deltas and does not repeat on ordinary rerender", async () => {
  const current = pair(), previous = pair(); previous.occurrence.performedDate = "2026-10-01";
  previous.performance.reps = previous.performance.reps.map((r, i) => ({ ...r, time: { hundredths: i === 0 ? 6600 : 7000, precision: 1 } }));
  const lookup = jest.fn().mockResolvedValue({ status: "ready", recording: previous, warnings: [{ code: "invalid_data" }] });
  await renderComparison(current, lookup);
  expect(container.textContent).toContain("This performance · 2026-10-04"); expect(container.textContent).toContain("Previous Exact · 2026-10-01");
  expect(container.textContent).toContain("−0.5 s — less time"); expect(container.textContent).toContain("+1.0 s — more time");
  expect(container.textContent).toContain("Some stored records");
  await renderComparison(current, lookup); expect(lookup).toHaveBeenCalledTimes(1);
});
test("comparison failure retries without losing current metrics or Close", async () => {
  const current = pair(); const lookup = jest.fn().mockRejectedValueOnce(new Error()).mockResolvedValue({ status: "ready", recording: null, warnings: [] });
  await renderComparison(current, lookup); expect(container.textContent).toContain("This performance is saved"); expect(container.textContent).toContain("Average: 1:08.5");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Retry comparison").click());
  expect(container.textContent).toContain("No eligible Exact result before 2026-10-04");
});
test("ineligible summary preserves metrics without looking up history", async () => {
  const lookup = jest.fn(); await renderComparison(pair("swim", false), lookup);
  expect(container.textContent).toContain("Comparison unavailable"); expect(lookup).not.toHaveBeenCalled();
});
test("access boundary hides and invalidates pending comparison", async () => {
  let resolve; const lookup = jest.fn().mockImplementation(() => new Promise(r => { resolve = r; })); const current = pair();
  await renderComparison(current, lookup); expect(container.textContent).toContain("Looking for an earlier");
  await renderComparison(current, lookup, { comparisonEnabled: false, comparisonVersion: 2 });
  await act(async () => resolve({ status: "ready", recording: pair(), warnings: [] }));
  expect(container.querySelector('[data-testid="performance-comparison-result"]')).toBeNull();
});

test("mixed precision rounds only display and avoids negative zero", async () => {
  const current = pair(), previous = pair();
  current.performance.reps = current.performance.reps.map(r => ({ ...r, time: { hundredths: 6700, precision: 2 } }));
  previous.performance.reps = previous.performance.reps.map((r, i) => ({ ...r, time: { hundredths: i === 0 ? 6710 : 6700, precision: 1 } }));
  previous.occurrence.performedDate = "2026-10-01";
  await renderComparison(current, jest.fn().mockResolvedValue({ status: "ready", recording: previous, warnings: [] }));
  expect(container.textContent).toContain("0.0 s — no difference at displayed precision"); expect(container.textContent).not.toContain("−0.0");
});
