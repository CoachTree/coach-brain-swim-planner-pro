import "core-js/actual/structured-clone";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createLocalPerformanceStore } from "@/lib/localPerformanceStore";
import { usePerformanceRecorder } from "@/hooks/usePerformanceRecorder";
import PerformanceRecorder from "./PerformanceRecorder";
import PerformanceSummary from "./PerformanceSummary";
import { calculatePerformanceMetrics } from "@/lib/performanceMetrics";
import { composePerformance } from "@/lib/performanceRecording";

global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, controller, store;
const definition = { schemaVersion: 1, unit: "m", poolLength: 25, segment: { task: "swim", stroke: "freestyle", repeatCount: 8, repeatDistance: 100, startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } };
function Owner() {
  controller = usePerformanceRecorder({ scopeKey: "device:test", athleteStore: "local", athletes: [{ id: "a", name: "Pilot athlete" }], enabled: true, repository: store, idProvider: () => `id-${Math.random().toString(36).slice(2)}` });
  return controller.state.phase === "record" ? <PerformanceRecorder key={controller.state.viewKey} controller={controller} /> : controller.state.phase === "summary" ? <PerformanceSummary recording={controller.state.recording} athleteLabel={controller.state.athleteLabel} onClose={controller.requestClose} /> : null;
}
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const button = text => [...document.querySelectorAll("button")].find(b => b.textContent === text);
const click = async text => { expect(button(text)).toBeDefined(); await act(async () => button(text).click()); };
const enter = async value => { await act(async () => { const input = byId("performance-time"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };
const settle = async () => { // Drain real IndexedDB transactions without arbitrary sleeps.
  const pending = store.saveProgress.mock?.results.at(-1)?.value;
  if (pending) await act(async () => { try { await pending; } catch (_) {} });
};
const save = async value => { await enter(value); await click("Save & Next"); await settle(); };
beforeEach(async () => {
  store = createLocalPerformanceStore({ indexedDB: new IDBFactory(), IDBKeyRange });
  jest.spyOn(store, "saveProgress");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<Owner />));
  await act(async () => controller.open({ sessionId: "source", blockId: "main_set", draftRevision: 0, changeSequence: 0, plannedTextSnapshot: ["8x100 reference"] }));
  await act(async () => { await controller.start({ athleteId: "a", performedDate: "2026-10-04", timezone: "Australia/Brisbane", plannedDefinition: definition }); });
  expect(controller.state.phase).toBe("record");
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); });

test("complete poolside walkthrough: failed third, retry, double fourth, second correction, 8/8 and persisted P1 summary", async () => {
  expect(byId("performance-time").type).toBe("text"); expect(byId("performance-time").inputMode).toBe("decimal");
  await save("67.2"); await save("1:06.8"); expect(container.textContent).toContain("Rep 3 of 8");
  store.saveProgress.mockRejectedValueOnce({ code: "storage_failure" });
  await save("67.0"); expect(container.textContent).toContain("Rep 3 of 8"); expect(byId("performance-time").value).toBe("67.0");
  expect(container.textContent).toContain("has not been advanced");
  await click("Save & Next"); await settle(); expect(container.textContent).toContain("Rep 4 of 8");
  await enter("66.9"); const before = store.saveProgress.mock.calls.length;
  await act(async () => { byId("performance-save").click(); byId("performance-save").click(); }); await settle();
  expect(store.saveProgress).toHaveBeenCalledTimes(before + 1); expect(controller.state.index).toBe(4);
  await click("Previous"); await click("Previous"); await click("Previous");
  expect(container.textContent).toContain("Rep 2 of 8"); expect(byId("performance-time").value).toBe("1:06.8");
  const version = controller.state.recording.performance.recordVersion;
  await save("66.5"); expect(controller.state.index).toBe(4); expect(controller.state.recording.performance.recordVersion).toBe(version + 1);
  for (const value of ["67.1", "67.3", "67.5", "67.7"]) await save(value);
  await click("Finish"); await settle();
  expect(container.textContent).toContain("Completed 8/8"); expect(container.textContent).toContain("Timed 8/8");
  const pair = controller.state.recording;
  expect(pair.performance.reps).toHaveLength(8); expect(pair.performance.reps[1].time).toEqual({ hundredths: 6650, precision: 1 });
  const metrics = calculatePerformanceMetrics(composePerformance(pair.occurrence, pair.performance)).metrics;
  expect(metrics.completionCount).toBe(8); expect(metrics.averageSeconds).toBeCloseTo(67.15); expect(metrics.bestSeconds).toBe(66.5);
  expect(container.textContent).toContain("Average: 1:07.2"); expect(container.textContent).toContain("Best: 1:06.5");
  await click("Close summary"); expect(controller.state.phase).toBe("closed");
  expect(await store.getRecording({ scopeKey: "device:test", performanceId: pair.performance.id })).toEqual(pair);
});

test("invalid time does not checkpoint; explicit no time, skipped and DNF each checkpoint", async () => {
  await save("67oops"); expect(store.saveProgress).not.toHaveBeenCalled(); expect(container.textContent).toContain("Enter a positive time");
  for (const label of ["No time", "Skipped", "Did not finish"]) { await click(label); await settle(); }
  expect(controller.state.recording.performance.reps.slice(0, 3).map(r => [r.outcome, r.time])).toEqual([["completed", null], ["skipped", null], ["dnf", null]]);
  await click("Finish"); expect(controller.state.phase).toBe("record"); expect(container.textContent).toContain("Finish requires every planned rep");
});

test("stop confirmation preserves plan after six, remaining two not attempted and no drift", async () => {
  for (let i = 0; i < 6; i++) await save("67.2");
  await click("Stop Set"); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); expect(controller.state.recording.performance.status).toBe("draft");
  await click("Keep recording"); expect(controller.state.phase).toBe("record");
  await click("Stop Set"); await click("Confirm stop"); await settle();
  expect(controller.state.recording.occurrence.plannedDefinition.segment.repeatCount).toBe(8);
  expect(controller.state.recording.performance.reps.slice(6).map(r => r.outcome)).toEqual(["not_attempted", "not_attempted"]);
  expect(container.textContent).toContain("Completed 6/8"); expect(container.textContent).toContain("drift unavailable"); expect(container.textContent).not.toContain("Second-half drift:");
});

test("close preserves saved draft, ignores unsaved input explicitly, resume reads saved state", async () => {
  await save("67.2"); await enter("70.0"); await click("Save draft and close");
  expect(document.querySelector('[role="alertdialog"]').textContent).toContain("typed time not saved");
  await act(async () => byId("performance-confirm-action").click()); await settle();
  expect(controller.state.phase).toBe("closed");
  await act(async () => { await controller.resume(); }); expect(controller.state.index).toBe(1); expect(byId("performance-time").value).toBe("");
});

test("pending checkpoint disables actions and retains current input until success", async () => {
  const original = store.saveProgress.getMockImplementation(); let release;
  store.saveProgress.mockImplementationOnce(input => new Promise(resolve => { release = () => original(input).then(resolve); }));
  await enter("67.2"); await click("Save & Next");
  expect(byId("performance-save").disabled).toBe(true); expect(button("Previous").disabled).toBe(true); expect(controller.state.index).toBe(0); expect(byId("performance-time").value).toBe("67.2");
  await act(async () => { await release(); }); await settle(); expect(controller.state.index).toBe(1);
});
