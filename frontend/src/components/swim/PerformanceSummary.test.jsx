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
