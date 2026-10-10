import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PerformanceConfirmation from "./PerformanceConfirmation";

global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, onStart;
const query = key => container.querySelector(`[data-testid="performance-${key}"]`);
const state = { context: { unit: "yd", poolLength: 50, stroke: "butterfly", equipment: ["fins"], intensity: "hard", paceTarget: 65 }, source: { plannedTextSnapshot: ["8 x 100 Free @1:30 with fins hard"] }, busy: false };
const render = async (athletes = [{ id: "a", name: "A" }], s = state) => { await act(async () => root.render(<PerformanceConfirmation athletes={athletes} state={s} onStart={onStart} />)); };
const change = async (key, value) => { const el = query(key); await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); };
const click = async key => { await act(async () => query(key).click()); };
const valid = async () => { await change("athleteId", "a"); await change("task", "swim"); await change("count", "8"); await change("distance", "100"); await click("confirmed"); };
beforeEach(async () => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); onStart = jest.fn().mockResolvedValue(true); await render(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

test("reference is never parsed, only safe context is suggested, date is local editable and athlete remains unselected", async () => {
  expect(container.textContent).toContain(state.source.plannedTextSnapshot[0]);
  expect(query("unit").value).toBe("yd"); expect(query("pool").value).toBe("50"); expect(query("stroke").value).toBe("butterfly");
  for (const key of ["athleteId", "task", "count", "distance", "effort", "startType"]) expect(query(key).value).toBe("");
  for (const key of ["recovery", "equipment", "target"]) expect(query(key).value).toBe("unknown");
  const now = new Date(); expect(query("date").value).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  await valid(); await change("date", "2026-09-20"); await click("start");
  expect(onStart.mock.calls[0][0]).toMatchObject({ athleteId: "a", performedDate: "2026-09-20", plannedDefinition: { unit: "yd", poolLength: 50, segment: { repeatCount: 8, repeatDistance: 100, equipment: null, effort: null, recovery: null, target: { state: "unknown" } } } });
  expect(onStart.mock.calls[0][0].timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("Unknown and explicit None remain distinct; send-off uses shared time parser", async () => {
  await valid(); await change("equipment", "none"); await change("target", "none"); await change("recovery", "none"); await click("start");
  expect(onStart.mock.calls[0][0].plannedDefinition.segment).toMatchObject({ equipment: [], target: { state: "none" }, recovery: { mode: "none" } });
  await change("recovery", "send_off"); await change("recoveryTime", "1:30"); await click("start");
  expect(onStart.mock.calls[1][0].plannedDefinition.segment.recovery).toEqual({ mode: "send_off", seconds: 90 });
});

test.each(["structure", "equipment", "recovery", "startType", "effort", "target"])("unsupported %s blocks rather than discards conditions", async key => {
  await valid(); await change(key, "unsupported"); expect(query("start").disabled).toBe(true); expect(container.textContent).toContain("cannot be represented safely"); await click("start"); expect(onStart).not.toHaveBeenCalled();
});

test("no athletes prevents start; incomplete and incompatible protocol rejected by P1", async () => {
  await render([]); expect(query("start").disabled).toBe(true); expect(container.textContent).toContain("No usable roster athlete");
  await render(); await valid(); await change("distance", "25"); await click("start"); expect(onStart).not.toHaveBeenCalled(); expect(container.textContent).toContain("wall-compatible");
  await change("distance", "100"); await change("task", ""); await click("start"); expect(onStart).not.toHaveBeenCalled();
});

test("selected empty equipment cannot silently become None; generic skill warns without Exact promise", async () => {
  await valid(); await change("equipment", "selected"); await click("start"); expect(onStart).not.toHaveBeenCalled(); expect(container.textContent).toContain("Select the equipment used");
  await change("equipment", "unknown"); await change("task", "skill"); await change("stroke", "choice"); await click("start"); expect(onStart).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("cannot establish Exact comparability");
});

const exactProtocol = async () => {
  for (const [key, value] of Object.entries({ unit: "m", pool: "25", structure: "uniform", task: "swim", stroke: "freestyle", count: "8", distance: "100", startType: "push", recovery: "send_off", recoveryTime: "90", equipment: "none", effort: "controlled", target: "none" })) await change(key, value);
  await click("confirmed");
};

test("hotfix: missing confirmation athlete has actionable feedback beside Start, even with the exact valid protocol", async () => {
  await exactProtocol();
  expect(query("start").disabled).toBe(true);
  expect(query("start-reason").textContent).toBe("Select an athlete above in this confirmation to start recording.");
  expect(query("start").getAttribute("aria-describedby")).toBe("performance-start-reason");
  await change("athleteId", "a"); expect(query("start").disabled).toBe(false); expect(query("start-reason").textContent).toBe("");
});

test("hotfix: a removed roster ID is not startable and a valid replacement clears the block", async () => {
  await valid(); await render([{ id: "b", name: "A" }]);
  expect(query("start").disabled).toBe(true); expect(query("start-reason").textContent).toContain("no longer in the current roster");
  await click("start"); expect(onStart).not.toHaveBeenCalled();
  await change("athleteId", "b"); await click("start"); expect(onStart.mock.calls[0][0].athleteId).toBe("b");
});

test.each(["90", "1:30"])("hotfix: exact 8x100 protocol converts recovery %s using real P1 normalization", async value => {
  const id = "00000000-0000-4000-8000-000000000001";
  await render([{ id, name: "Cloud athlete" }]); await exactProtocol(); await change("athleteId", id); await change("recoveryTime", value);
  expect(query("start").matches(":disabled")).toBe(false); await click("start");
  expect(onStart.mock.calls[0][0].plannedDefinition).toEqual({ schemaVersion: 1, unit: "m", poolLength: 25, segment: { task: "swim", stroke: "freestyle", repeatCount: 8, repeatDistance: 100, startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [], effort: "controlled", target: { state: "none" } } });
});

test("hotfix: recovery words produce a linked recovery-time error; correcting input succeeds", async () => {
  await exactProtocol(); await change("athleteId", "a"); await change("recoveryTime", "90 seconds"); await click("start");
  expect(onStart).not.toHaveBeenCalled(); expect(query("recoveryTime").getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(query("recoveryTime").getAttribute("aria-describedby")).textContent).toContain("Enter recovery time as 90 or 1:30, without words");
  await change("recoveryTime", "90"); await click("start"); expect(onStart).toHaveBeenCalledTimes(1); expect(query("recoveryTime").getAttribute("aria-invalid")).toBe("false");
});

test("hotfix: checkbox survives ordinary edits, while explicit unmount/reopen resets confirmation", async () => {
  await exactProtocol(); await change("athleteId", "a"); await change("distance", "200"); await change("recoveryTime", "1:30"); await change("effort", "easy");
  expect(query("confirmed").checked).toBe(true); expect(query("start").disabled).toBe(false);
  await act(async () => root.render(null)); await render();
  expect(query("confirmed").checked).toBe(false); expect(query("athleteId").value).toBe(""); expect(query("count").value).toBe("");
});

test("hotfix: all blocking states are explained beside Start, with access/storage separate from invalid input", async () => {
  await render([]); expect(query("start-reason").textContent).toContain("No roster athletes");
  await render(); await change("athleteId", "a"); expect(query("start-reason").textContent).toContain("Check the confirmation box");
  await change("structure", "unsupported"); expect(query("start-reason").textContent).toContain("supported conditions");
  await render(undefined, { ...state, checkingAccess: true });
  expect(query("start").textContent).toBe("Checking access…"); expect(query("start-reason").textContent).toContain("Checking Pro access"); expect(query("start").matches(":disabled")).toBe(true);
  await render(undefined, { ...state, busy: true }); expect(query("start-reason").textContent).toContain("Starting recording"); expect(query("start").matches(":disabled")).toBe(true);
});

test("verified suggestion is editable, unchecked, and never reapplied on rerender", async () => {
  await act(async () => root.render(null));
  const roster = [{ id: "a", name: "Same" }, { id: "b", name: "Same" }];
  const suggested = { ...state, context: { ...state.context, suggestedAthleteId: "a" }, source: { plannedTextSnapshot: ["2 x (4 x 100) with fins hard"] } };
  await render(roster, suggested);
  expect(query("athleteId").value).toBe("a"); expect(query("confirmed").checked).toBe(false);
  for (const key of ["task", "count", "distance", "effort", "startType"]) expect(query(key).value).toBe("");
  for (const key of ["recovery", "equipment", "target"]) expect(query(key).value).toBe("unknown");
  await change("athleteId", "b"); await render(roster, suggested);
  expect(query("athleteId").value).toBe("b");
  await change("athleteId", ""); await render(roster, suggested);
  expect(query("athleteId").value).toBe(""); expect(onStart).not.toHaveBeenCalled();
});
