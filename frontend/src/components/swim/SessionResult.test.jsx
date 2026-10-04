import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import SessionResult from "./SessionResult";
import { useSessionDraft } from "@/hooks/useSessionDraft";

function DraftOwner({ originalSession, profile, ...props }) {
  const { draft, update, reset } = useSessionDraft(originalSession, profile);
  return <SessionResult session={draft.workingDraft} profile={draft.profile} onSessionChange={update} onReset={reset} resetKey={draft.originalDraft} {...props} />;
}

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("./JournalPanel", () => () => null);
global.IS_REACT_ACT_ENVIRONMENT = true;
const rows = [
  ["warm_up", "Warm up", 100], ["drill_set", "Drill set", 100],
  ["kick_set", "Kick set", 100], ["sprint_or_pace_set", "Speed prep set", 100],
  ["main_set", "Main set", 400], ["pull_set", "Pull set", 100], ["cool_down", "Cool down", 100],
];
const fixture = (unit = "m") => ({
  session_id: "legacy-1", summary: "Legacy training session", total_distance_m: 1000,
  ...Object.fromEntries(rows.map(([key, , distance_m]) => [key, { title: "Ignored stored title", distance_m, items: [`${distance_m}${unit} ${key}`, "Relax and align"], energy_system: "A1" }])),
  coaching_points: ["One cue"],
});
const profile = unit => ({ age: 16, level: "competitive", stroke: "freestyle", goal: "technique", intensity: "recovery", poolType: unit === "yd" ? "50y" : "25m", unit, distance: 1000 });
let container, root, pdf;
const render = async (session, unit = "m", props = {}) => { await act(async () => root.render(<DraftOwner originalSession={session} profile={profile(unit)} {...props} />)); };
const click = async id => { await act(async () => container.querySelector(`[data-testid="${id}"]`).click()); };
const change = async (id, value) => {
  const input = container.querySelector(`[data-testid="${id}"]`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  pdf = { internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 }, getNumberOfPages: () => 1 } };
  ["setFont", "setFontSize", "setDrawColor", "setLineWidth", "line", "text", "addPage", "setPage", "save"].forEach(key => { pdf[key] = jest.fn(); });
  pdf.splitTextToSize = jest.fn(text => [text]);
  jsPDF.mockImplementation(() => pdf);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); });

// Expected copy layout deliberately mirrors the pre-refactor output contract,
// without importing the new adapter/order as the test oracle.
test.each(["m", "yd"])("legacy %s screen, Copy and PDF preserve titles, order, distances and text", async unit => {
  const session = fixture(unit); await render(session, unit);
  expect([...container.querySelectorAll('section[data-testid^="block-"]')].map(el => el.dataset.testid)).toEqual([...rows.map(([key]) => `block-${key}`), "block-coaching-points"]);
  rows.forEach(([key, title, distance]) => {
    const block = container.querySelector(`[data-testid="block-${key}"]`);
    expect(block.querySelector("h4").textContent).toBe(title);
    expect(block.textContent).toContain(`${distance} ${unit}`);
    expect([...block.querySelectorAll("li")].map(el => el.textContent)).toEqual(session[key].items);
    expect(block.querySelector(`[data-testid="energy-badge-${key}"]`).textContent).toBe("A1");
  });
  await click("copy-button");
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith([
    "SWIM TRAINING SESSION", "=".repeat(28), `Date: ${date}`,
    "Age: 16 | Level: competitive | Stroke: freestyle",
    `Goal: technique | Intensity: recovery | Pool: ${profile(unit).poolType}`,
    `Total: 1000 ${unit}`, "", session.summary, "",
    ...rows.flatMap(([key, title, distance]) => [`${title.toUpperCase()} [A1] — ${distance} ${unit}`, ...session[key].items.map(it => `  • ${it}`), ""]),
    "COACHING POINTS", "  • One cue",
  ].join("\n"));
  await click("export-pdf-button");
  const texts = pdf.text.mock.calls.map(call => call[0]);
  const first = texts.indexOf(`WARM UP   [A1]   —   100 ${unit}`);
  expect(texts.slice(first, first + 35)).toEqual(rows.flatMap(([key, title, distance]) => [`${title.toUpperCase()}   [A1]   —   ${distance} ${unit}`, "•", session[key].items[0], "•", session[key].items[1]]));
  expect(texts).toContain(`Total distance: 1000 ${unit}`);
});

test("zero total is preserved on screen, Copy, PDF and save-name prompt", async () => {
  const session = { session_id: "zero", total_distance_m: 0, main_set: { distance_m: 0, items: [] } };
  await render(session); expect(container.querySelector("h3").textContent).toContain("0 m");
  expect(container.querySelector('[data-testid="block-main_set"]')).toBeNull();
  await click("copy-button"); expect(navigator.clipboard.writeText.mock.calls[0][0]).toContain("Total: 0 m");
  await click("export-pdf-button"); expect(pdf.text.mock.calls.map(c => c[0])).toContain("Total distance: 0 m");
  jest.spyOn(window, "prompt").mockReturnValue(null); await click("save-session-button");
  expect(window.prompt).toHaveBeenCalledWith("Name this saved session", "0 m · freestyle · recovery");
});

test("malformed blocks/items/metadata render and export safely without rewriting save payload", async () => {
  const session = { session_id: "old", total_distance_m: 100, summary: {}, main_set: { distance_m: 100, energy_system: {}, items: ["Safe", {}, null, "Last"] }, warm_up: { distance_m: "bad", items: {} }, coaching_points: {}, coach_brain: { objective: {}, coach_adjustment_prompts: {} }, unknown: { retain: true } };
  const before = JSON.stringify(session), store = { upsert: jest.fn().mockResolvedValue({ id: "saved" }) };
  await render(session, "m", { sessionStore: store });
  await click("copy-button"); await click("export-pdf-button");
  expect(container.textContent).toContain("Safe"); expect(container.textContent).not.toContain("[object Object]");
  jest.spyOn(window, "prompt").mockReturnValue("Saved"); await click("save-session-button");
  expect(store.upsert.mock.calls[0][0].session).toEqual(session);
  expect(JSON.stringify(session)).toBe(before);
  await click("edit-toggle-button"); await change("edit-item-main_set-3", "Edited last");
  await click("save-session-button");
  expect(store.upsert.mock.calls[1][0].session.main_set.items).toEqual(["Safe", "", "", "Edited last"]);
});

test("legacy edit, add/remove line, numeric total, Save and Reset continue to work", async () => {
  const session = fixture(), store = { upsert: jest.fn().mockResolvedValue({ id: "saved" }) };
  await render(session, "m", { sessionStore: store }); await click("edit-toggle-button");
  await change("edit-item-main_set-0", "6x50m controlled");
  await change("edit-distance-main_set", "300");
  await click("add-item-main_set"); await change("edit-item-main_set-2", "New cue");
  await click("remove-item-main_set-1");
  jest.spyOn(window, "prompt").mockReturnValue("Edited"); await click("save-session-button");
  const saved = store.upsert.mock.calls[0][0].session;
  expect(saved.main_set.items).toEqual(["6x50m controlled", "New cue"]);
  expect(saved.total_distance_m).toBe(900); expect(saved.editor).toBeUndefined();
  expect(session.main_set.items).toEqual(["400m main_set", "Relax and align"]);
  await click("reset-button");
  expect(container.querySelector('[data-testid="edit-distance-main_set"]').value).toBe("400");
});
