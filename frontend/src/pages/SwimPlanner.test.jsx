import "core-js/actual/structured-clone";
import React, { act } from "react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import * as performanceStorage from "@/lib/localPerformanceStore";
import { useCoachAccess } from "@/hooks/useCoachAccess";
import { Athletes as CloudAthletes } from "@/lib/cloudStore";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import SwimPlanner from "./SwimPlanner";
import { generateSession } from "@/lib/sessionGenerator";
import { Athletes, SavedSessions, Favourites } from "@/lib/localStore";
import { decodeShare } from "@/lib/shareLink";
import * as draftLifecycle from "@/lib/sessionDraft";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("@/hooks/useCoachAccess", () => ({ useCoachAccess: jest.fn() }));
jest.mock("@/lib/supabaseClient", () => ({ supabase: null }));
jest.mock("@/lib/sessionGenerator", () => ({ generateSession: jest.fn() }));
jest.mock("@/components/auth/AccountPanel", () => () => null);
jest.mock("@/components/swim/CommunityHub", () => () => <div>Community view</div>);
jest.mock("@/components/swim/SeasonPlanner", () => () => <div>Season view</div>);
global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, pdf, serial, performanceStore;
const query = id => document.querySelector(`[data-testid="${id}"]`);
const click = async id => { expect(query(id)).not.toBeNull(); await act(async () => query(id).click()); };
const tab = async name => {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === name);
  expect(button).toBeDefined(); await act(async () => button.click());
};
const change = async (id, value) => {
  const input = query(id); expect(input).not.toBeNull();
  await act(async () => {
    const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const tick = async () => { await act(async () => jest.advanceTimersByTime(60)); };
const generate = async () => { await click("generate-button"); await tick(); };
const dirty = () => container.querySelector("#session-result").dataset.dirty;
const revision = () => container.querySelector("#session-result").dataset.revision;
const startEdit = async () => { if (query("edit-toggle-button").textContent.includes("Edit")) await click("edit-toggle-button"); };
const editedLine = async () => { await startEdit(); await change("edit-item-main_set-0", "Coach revised work"); };

beforeEach(async () => {
  jest.useFakeTimers(); localStorage.clear(); jest.clearAllMocks(); serial = 0;
  useCoachAccess.mockReturnValue({ isPro: true, user: null, configured: false });
  performanceStore = performanceStorage.createLocalPerformanceStore({ indexedDB: new IDBFactory(), IDBKeyRange });
  jest.spyOn(performanceStorage, "createLocalPerformanceStore").mockReturnValue(performanceStore);
  jest.spyOn(performanceStore, "startRecording"); jest.spyOn(performanceStore, "saveProgress"); jest.spyOn(performanceStore, "getRecording");
  HTMLElement.prototype.scrollIntoView = jest.fn();
  window.gtag = jest.fn();
  jest.spyOn(window, "prompt").mockReturnValue("Saved snapshot");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  pdf = { internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 }, getNumberOfPages: () => 1 }, splitTextToSize: text => [text] };
  ["setFont", "setFontSize", "setDrawColor", "setLineWidth", "line", "text", "addPage", "setPage", "save"].forEach(key => { pdf[key] = jest.fn(); });
  jsPDF.mockImplementation(() => pdf);
  generateSession.mockImplementation(p => ({ session_id: `generated-${++serial}`, summary: `${p.distance}${p.unit} draft ${serial}`, total_distance_m: p.distance, main_set: { title: "Main set", distance_m: p.distance, items: [`${p.distance}${p.unit} original work`] }, coaching_points: ["Original cue"] }));
  Athletes.upsert({ id: "a", name: "Athlete A", team: "Team A", age: 16, mainStroke: "freestyle" });
  Athletes.upsert({ id: "b", name: "Athlete B", team: "Team B", age: 18, mainStroke: "butterfly" });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<SwimPlanner />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); delete window.gtag; });

test.each([
  ["line", "edit-item-main_set-0", "Edited", "3000m original work"],
  ["distance", "edit-distance-main_set", "3100", "3000"],
  ["coaching point", "edit-coaching-0", "Edited cue", "Original cue"],
])("%s editing, exact revert and Reset drive dirty/revision", async (_, id, value, original) => {
  await generate(); expect(dirty()).toBe("false"); expect(revision()).toBe("0");
  await startEdit(); expect(dirty()).toBe("false");
  await change(id, value); expect(dirty()).toBe("true"); const changedRevision = revision(); expect(changedRevision).not.toBe("0");
  await change(id, original); expect(dirty()).toBe("false"); expect(revision()).toBe("0");
  await change(id, value); expect(revision()).not.toBe(changedRevision);
  await click("reset-button"); expect(query(id).value).toBe(original); expect(dirty()).toBe("false"); expect(revision()).toBe("0");
});

test.each([["add-item-main_set", "remove-item-main_set-1"], ["add-coaching", "remove-coaching-1"]])("%s and its removal restore exact content", async (add, remove) => {
  await generate(); await startEdit(); await click(add); expect(dirty()).toBe("true");
  await click(remove); expect(dirty()).toBe("false"); expect(revision()).toBe("0");
});

test.each(["Community", "Coach Library", "Session History", "Athletes", "Season Planner"])("unsaved edits survive %s navigation", async view => {
  await generate(); await editedLine(); const rev = revision();
  await tab(view); expect(query("session-result-card")).toBeNull();
  await tab("Session Builder"); expect(query("session-result-card").textContent).toContain("Coach revised work");
  expect(dirty()).toBe("true"); expect(revision()).toBe(rev);
});

test.each(["m", "yd"])("%s workout keeps athlete, unit, pool and metadata in Save/Copy/PDF/Share after next-form changes", async unit => {
  await change("session-athlete-select", "a"); await click(`unit-toggle-${unit}`); await click("pool-type-tile-25");
  await click("equipment-tile-fins"); await generate(); await editedLine();
  await click(`unit-toggle-${unit === "m" ? "yd" : "m"}`); await click("pool-type-tile-50");
  await change("session-athlete-select", "b"); await click("goal-tile-sprint"); await click("intensity-tile-hard"); await click("level-tile-elite"); await click("distance-tile-4000");
  const card = query("session-result-card").textContent;
  expect(card).toContain(`3000 ${unit}`); expect(card).toContain(`25${unit === "m" ? "m" : "y"} pool`); expect(card).toContain("freestyle"); expect(card).toContain("endurance"); expect(card).not.toContain("butterfly");
  await click("save-session-button"); await click("save-session-button");
  const records = SavedSessions.list(); expect(records).toHaveLength(2); expect(records[0].id).not.toBe(records[1].id);
  const saved = records[0]; expect(saved.session.main_set.items[0]).toBe("Coach revised work");
  expect(saved.profile).toMatchObject({ athleteId: "a", athleteName: "Athlete A", team: "Team A", age: 16, unit, poolType: `25${unit === "m" ? "m" : "y"}`, stroke: "freestyle", goal: "endurance", intensity: "easy", level: "intermediate", distance: 3000 });
  expect(saved.profile.equipment).toBeUndefined(); expect(saved.profile.paceTarget).toBeUndefined();
  expect(saved.session.editor).toBeUndefined(); expect(saved.session.revision).toBeUndefined(); expect(dirty()).toBe("true");
  await click("copy-button"); const copy = navigator.clipboard.writeText.mock.calls.at(-1)[0];
  expect(copy).toContain(`Total: 3000 ${unit}`); expect(copy).toContain(`Goal: endurance | Intensity: easy | Pool: 25${unit === "m" ? "m" : "y"}`); expect(copy).toContain("Coach revised work");
  await click("export-pdf-button"); const texts = pdf.text.mock.calls.map(c => c[0]);
  expect(texts).toContain("Athlete: Athlete A"); expect(texts).toContain(`Total distance: 3000 ${unit}`); expect(texts).toContain("Coach revised work");
  await click("share-button"); const link = navigator.clipboard.writeText.mock.calls.at(-1)[0];
  const payload = decodeShare(new URLSearchParams(link.split("?")[1]).get("data"));
  expect(payload.profile).toEqual(saved.profile); expect(payload.session).toEqual(saved.session);
  await click("favourite-button"); expect(Favourites.list()[0].profile).toEqual(saved.profile);
  await tab("Community"); await tab("Session Builder"); expect(query("favourite-button").textContent).toBe("Saved");
  await click("favourite-button"); expect(Favourites.list()).toHaveLength(0);
});

test.each(["generate-button", "generate-another-button"])("dirty %s requires explicit confirmation; cancellation preserves draft", async button => {
  await generate(); await editedLine(); const rev = revision();
  await click(button); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(generateSession).toHaveBeenCalledTimes(1); expect(window.gtag).toHaveBeenCalledTimes(1);
  await click("keep-editing"); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(query("edit-item-main_set-0").value).toBe("Coach revised work"); expect(revision()).toBe(rev); expect(dirty()).toBe("true");
});

test("confirmed generation retains old draft while loading and installs new clean context only on success", async () => {
  await generate(); await editedLine(); await click("unit-toggle-yd"); await click("generate-another-button");
  await click("replace-draft"); expect(query("session-result-card").textContent).toContain("3000 m"); expect(dirty()).toBe("true");
  expect(query("generate-button").disabled).toBe(true); expect(query("generate-another-button").disabled).toBe(true);
  await tick(); expect(query("session-result-card").textContent).toContain("3000 yd"); expect(query("session-result-card").textContent).not.toContain("Coach revised work");
  expect(dirty()).toBe("false"); expect(revision()).toBe("0"); expect(window.gtag).toHaveBeenCalledTimes(2);
});

test("failed generation preserves original, edits, context, dirty and revision", async () => {
  await change("session-athlete-select", "a"); await generate(); await editedLine(); const rev = revision();
  await click("unit-toggle-yd"); await change("session-athlete-select", "b");
  generateSession.mockImplementationOnce(() => { throw new Error("failure"); });
  await click("generate-another-button"); await click("replace-draft"); await tick();
  expect(toast.error).toHaveBeenCalledWith("Could not generate session"); expect(window.gtag).toHaveBeenCalledTimes(1);
  expect(query("edit-item-main_set-0").value).toBe("Coach revised work"); expect(dirty()).toBe("true"); expect(revision()).toBe(rev);
  await click("save-session-button"); expect(SavedSessions.list()[0].profile).toMatchObject({ unit: "m", athleteId: "a" });
  await click("reset-button"); expect(query("edit-item-main_set-0").value).toBe("3000m original work"); expect(dirty()).toBe("false");
});

test("loading a legacy saved snapshot creates a clean baseline without borrowing live athlete/form context", async () => {
  const session = { session_id: "loaded", total_distance_m: 500, main_set: { distance_m: 500, items: ["500yd legacy"] } };
  const profile = { unit: "yd", poolType: "50y", athleteId: "a", athleteName: "Old snapshot name", distance: 500, goal: "technique" };
  SavedSessions.upsert({ id: "old", name: "Old", session, profile });
  await generate(); await editedLine(); await tab("Session History"); await click("session-open-old");
  await click("keep-editing"); await tab("Session Builder"); expect(dirty()).toBe("true");
  await tab("Session History"); await click("session-open-old"); await click("replace-draft");
  expect(dirty()).toBe("false"); expect(revision()).toBe("0");
  await startEdit(); await change("edit-item-main_set-0", "Revised loaded"); await click("reset-button");
  expect(query("edit-item-main_set-0").value).toBe("500yd legacy"); expect(dirty()).toBe("false");
  await click("unit-toggle-m"); await change("session-athlete-select", "b"); await click("save-session-button");
  const saved = SavedSessions.list().find(s => s.id !== "old"); expect(saved.profile).toEqual(profile); expect(saved.session).toEqual(session);
  expect(saved.profile.equipment).toBeUndefined(); expect(saved.profile.paceTarget).toBeUndefined(); expect(saved.profile.team).toBeUndefined();
  expect(SavedSessions.get("old").session).toEqual(session);
});

test("loading Favourite establishes its snapshot and keeps the existing remove toggle", async () => {
  Favourites.upsert({ id: "fav", name: "Favourite", session: { session_id: "fav-session", total_distance_m: 200, main_set: { distance_m: 200, items: ["200m saved"] } }, profile: { unit: "m", athleteName: "Saved athlete", distance: 200 } });
  await tab("Coach Library"); await click("favourite-load-fav");
  expect(dirty()).toBe("false"); expect(query("favourite-button").textContent).toBe("Saved");
  await editedLine(); await click("reset-button"); expect(query("edit-item-main_set-0").value).toBe("200m saved");
  await click("favourite-button"); expect(Favourites.get("fav")).toBeNull();
});

test("full planner remount does not restore an unsaved draft", async () => {
  await generate(); await editedLine(); await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(<SwimPlanner />)); expect(query("session-result-card")).toBeNull();
});

test("generation snapshots inputs at request time, even if next-form values change while loading", async () => {
  await change("session-athlete-select", "a"); await click("equipment-tile-fins");
  await click("generate-button"); await click("unit-toggle-yd"); await change("session-athlete-select", "b"); await click("equipment-tile-fins");
  await tick();
  expect(generateSession.mock.calls[0][0]).toMatchObject({ unit: "m", equipment: ["fins"], stroke: "freestyle" });
  await click("save-session-button"); expect(SavedSessions.list()[0].profile).toMatchObject({ unit: "m", athleteId: "a", athleteName: "Athlete A" });
  await click("generate-another-button"); await tick();
  expect(generateSession.mock.calls[1][0]).toMatchObject({ unit: "yd", equipment: [], stroke: "butterfly" });
});

test("cancelling a favourite replacement does not report it as loaded", async () => {
  Favourites.upsert({ id: "fav", name: "Other work", session: { session_id: "other", total_distance_m: 100 }, profile: { unit: "m" } });
  await generate(); await editedLine(); await tab("Coach Library"); toast.success.mockClear();
  await click("favourite-load-fav"); expect(toast.success).not.toHaveBeenCalled();
  await click("keep-editing"); await tab("Session Builder"); expect(dirty()).toBe("true");
  await tab("Coach Library"); await click("favourite-load-fav"); await click("replace-draft");
  expect(toast.success).toHaveBeenCalledWith('Loaded "Other work"'); expect(dirty()).toBe("false");
});


test("generation captures equipment and pace in working context without extending the saved profile", async () => {
  const create = jest.spyOn(draftLifecycle, "createSessionDraft");
  await click("equipment-tile-fins"); await click("pace-toggle"); await change("pace-time-input", "1:05.2");
  await generate();
  const draft = create.mock.results.at(-1).value;
  expect(draft.context.equipment).toEqual(["fins"]);
  expect(draft.context.paceTarget).toEqual({ race_distance: 100, target_seconds: 65.2 });
  expect(draft.context.poolLength).toBe(50); expect(draft.context.unit).toBe("m");
  await click("equipment-tile-fins"); await change("pace-time-input", "1:20");
  expect(draft.context.equipment).toEqual(["fins"]); expect(draft.context.paceTarget.target_seconds).toBe(65.2);
  await click("save-session-button"); const saved = SavedSessions.list()[0];
  expect(saved.profile.equipment).toBeUndefined(); expect(saved.profile.paceTarget).toBeUndefined();
  await tab("Session History"); await click(`session-open-${saved.id}`);
  const loaded = create.mock.results.at(-1).value;
  expect(loaded.context.equipment).toBeUndefined(); expect(loaded.context.paceTarget).toBeUndefined();
});

const flushPerformance = async method => { await act(async () => { await performanceStore[method].mock.results.at(-1).value; }); };
async function confirmPerformance(count = "1") {
  await change("performance-athleteId", "b"); await change("performance-task", "swim");
  await change("performance-count", count); await change("performance-distance", "100");
  await click("performance-confirmed"); await click("performance-start"); await flushPerformance("startRecording");
}
test("builder → recording → finish stays private in Save/Favourite/Copy/PDF/Share/Journal/GA4; modal protects replacement", async () => {
  await change("session-athlete-select", "a"); await click("pool-type-tile-25"); await generate();
  await change("session-athlete-select", "b"); await click("pool-type-tile-50");
  jest.useRealTimers(); const cryptoBefore = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: require("crypto").webcrypto });
  try {
    await click("record-results");
    expect(query("performance-athleteId").value).toBe(""); expect(query("performance-pool").value).toBe("25");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(document.body.style.pointerEvents).toBe("none");
    await click("generate-another-button"); expect(generateSession).toHaveBeenCalledTimes(1);
    await confirmPerformance(); expect(query("performance-recorder")).not.toBeNull();
    const start = performanceStore.startRecording.mock.calls[0][0];
    expect(start.athleteRef).toEqual({ store: "local", id: "b" }); expect(start.scopeKey).toBe("device:browser-local");
    expect(start.source).toEqual({ sessionId: "generated-1", blockId: "main_set", draftRevision: 0, changeSequence: 0 });
    await change("performance-time", "67.23"); await click("performance-save"); await flushPerformance("saveProgress");
    await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "Finish").click()); await flushPerformance("saveProgress");
    expect(query("performance-summary").textContent).toContain("Completed 1/1");
    await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "Close summary").click());
    await click("save-session-button"); await click("favourite-button"); await click("copy-button");
    const copy = navigator.clipboard.writeText.mock.calls.at(-1)[0];
    await click("export-pdf-button"); await click("share-button");
    const payload = decodeShare(new URLSearchParams(navigator.clipboard.writeText.mock.calls.at(-1)[0].split("?")[1]).get("data"));
    const saved = SavedSessions.list()[0]; expect(saved.profile.athleteId).toBe("a"); expect(payload.session).toEqual(saved.session); expect(Favourites.list()[0].session).toEqual(saved.session);
    for (const data of [saved, payload, copy, pdf.text.mock.calls, window.gtag.mock.calls, Object.values(localStorage)]) {
      const serialized = JSON.stringify(data); expect(serialized).not.toContain(start.performanceId); expect(serialized).not.toContain("67.23"); expect(serialized).not.toContain("plannedDefinition");
    }
    expect(window.gtag).toHaveBeenCalledTimes(1);
    const persisted = await performanceStore.getRecording({ scopeKey: start.scopeKey, performanceId: start.performanceId }); expect(persisted.performance.reps[0].time.hundredths).toBe(6723);
  } finally { Object.defineProperty(globalThis, "crypto", { configurable: true, value: cryptoBefore }); }
});

test("known draft resumes outside keyed result after session replacement without rebinding athlete or snapshot", async () => {
  await generate(); jest.useRealTimers(); const cryptoBefore = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: require("crypto").webcrypto });
  try {
    await click("record-results"); await confirmPerformance("8");
    await change("performance-time", "67.2"); await click("performance-save"); await flushPerformance("saveProgress");
    await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "Save draft and close").click());
    await click("performance-confirm-action"); await flushPerformance("saveProgress");
    expect(query("performance-resume").textContent).toBe("Resume recording");
    jest.useFakeTimers(); await change("session-athlete-select", "a"); await generate(); jest.useRealTimers();
    await tab("Community"); await click("performance-resume"); await flushPerformance("getRecording");
    expect(query("performance-recorder").textContent).toContain("Athlete B"); expect(query("performance-recorder").textContent).toContain("Rep 2 of 8");
    expect(performanceStore.startRecording).toHaveBeenCalledTimes(1);
  } finally { Object.defineProperty(globalThis, "crypto", { configurable: true, value: cryptoBefore }); }
});

test("Free entry is hidden; account roster selection is explicit and cannot reuse old scope athletes", async () => {
  await generate(); useCoachAccess.mockReturnValue({ isPro: false, user: null, configured: false });
  await act(async () => root.render(<SwimPlanner />)); expect(query("record-results")).toBeNull();
  let resolveRoster; jest.spyOn(CloudAthletes, "list").mockImplementation(() => new Promise(resolve => { resolveRoster = resolve; }));
  useCoachAccess.mockReturnValue({ isPro: true, user: { id: "account-a" }, configured: false });
  await act(async () => root.render(<SwimPlanner />)); await click("record-results");
  expect(query("performance-start").disabled).toBe(true); expect(query("performance-athleteId").options).toHaveLength(1);
  await act(async () => resolveRoster([{ id: "cloud-a", name: "Cloud athlete" }]));
  expect([...query("performance-athleteId").options].map(o => o.value)).toEqual(["", "cloud-a"]);
});
