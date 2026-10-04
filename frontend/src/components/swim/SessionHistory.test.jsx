import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import SessionHistory from "./SessionHistory";
import SessionResult from "./SessionResult";
import { SavedSessions } from "@/lib/localStore";
import { selectSessionStore } from "@/lib/sessionStore";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("./JournalPanel", () => () => null);

global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
const entry = { id: "session-1", name: "Morning", session: { total_distance_m: 1000 }, profile: { stroke: "freestyle" } };
const render = async (element) => { await act(async () => { root.render(element); }); };
const click = async (id) => {
  const button = container.querySelector(`[data-testid="${id}"]`);
  expect(button).not.toBeNull();
  await act(async () => { button.click(); });
};
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(window, "prompt").mockReturnValue("Morning");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

test("local Save button → History → Delete immediately removes the row without error", async () => {
  await render(<SessionResult session={entry.session} profile={entry.profile} sessionStore={SavedSessions} />);
  await click("save-session-button");
  const [saved] = SavedSessions.list();
  expect(saved.name).toBe("Morning");
  await render(<SessionHistory sessionStore={SavedSessions} />);
  expect(container.textContent).toContain("Morning");
  await click(`session-delete-${saved.id}`);
  expect(SavedSessions.list()).toEqual([]);
  expect(container.textContent).not.toContain("Morning");
  expect(toast.success).toHaveBeenCalledWith("Session deleted");
  expect(toast.error).not.toHaveBeenCalled();
});

test.each([
  ["guest", { isPro: false, user: null }, false],
  ["Free signed in", { isPro: false, user: { id: "user-1" } }, false],
  ["Pro without login", { isPro: true, user: null }, false],
  ["Pro signed in", { isPro: true, user: { id: "user-1" } }, true],
])("%s uses the expected store for Save and History", async (_, access, usesCloud) => {
  const cloud = { upsert: jest.fn().mockResolvedValue(entry), list: jest.fn().mockResolvedValue([entry]), remove: jest.fn().mockResolvedValue(true) };
  const store = selectSessionStore(access, SavedSessions, cloud);
  expect(store).toBe(usesCloud ? cloud : SavedSessions);
  await render(<SessionResult session={entry.session} profile={entry.profile} sessionStore={store} />);
  await click("save-session-button");
  await render(<SessionHistory sessionStore={store} />);
  expect(container.textContent).toContain("Morning");
  if (usesCloud) {
    expect(cloud.upsert).toHaveBeenCalled();
    expect(cloud.list).toHaveBeenCalled();
    expect(SavedSessions.list()).toEqual([]);
    await click("session-delete-session-1");
    expect(cloud.remove).toHaveBeenCalledWith(entry.id);
    expect(container.textContent).not.toContain("Morning");
    expect(toast.error).not.toHaveBeenCalled();
  } else {
    expect(SavedSessions.list()).toHaveLength(1);
    expect(cloud.upsert).not.toHaveBeenCalled();
    expect(cloud.list).not.toHaveBeenCalled();
  }
});

test.each(["false", "throw"])("Delete failure (%s) retains row and reports error", async (mode) => {
  const store = { list: async () => [entry], remove: jest.fn(() => mode === "false" ? false : Promise.reject(new Error("denied"))) };
  await render(<SessionHistory sessionStore={store} />);
  await click("session-delete-session-1");
  expect(container.textContent).toContain("Morning");
  expect(toast.error).toHaveBeenCalledWith("Could not delete session.");
  expect(toast.success).not.toHaveBeenCalled();
});

test.each(["local", "cloud"])("Rename updates %s storage and visible row", async (mode) => {
  SavedSessions.upsert(entry);
  const cloud = { list: async () => [entry], upsert: jest.fn(async (record) => record) };
  const store = mode === "local" ? SavedSessions : cloud;
  await render(<SessionHistory sessionStore={store} />);
  window.prompt.mockReturnValue("Evening");
  await click("session-rename-session-1");
  expect(container.textContent).toContain("Evening");
  expect(container.textContent).not.toContain("Morning");
  if (mode === "local") expect(SavedSessions.get(entry.id).name).toBe("Evening");
  else expect(cloud.upsert).toHaveBeenCalledWith({ ...entry, name: "Evening" });
  expect(toast.error).not.toHaveBeenCalled();
});

test("Rename rejection retains original row", async () => {
  await render(<SessionHistory sessionStore={{ list: async () => [entry], upsert: async () => { throw new Error("denied"); } }} />);
  window.prompt.mockReturnValue("Evening");
  await click("session-rename-session-1");
  expect(container.textContent).toContain("Morning");
  expect(toast.error).toHaveBeenCalledWith("Could not rename session.");
});

test("switching stores ignores an old pending list and preserves local data", async () => {
  SavedSessions.upsert(entry);
  let resolve;
  const oldStore = { list: () => new Promise((done) => { resolve = done; }) };
  await render(<SessionHistory sessionStore={oldStore} />);
  await render(<SessionHistory sessionStore={SavedSessions} />);
  await act(async () => resolve([{ ...entry, name: "Other account" }]));
  expect(container.textContent).toContain("Morning");
  expect(container.textContent).not.toContain("Other account");
  expect(SavedSessions.list()).toHaveLength(1);
});

test("list failure is reported", async () => {
  await render(<SessionHistory sessionStore={{ list: async () => { throw new Error("offline"); } }} />);
  expect(toast.error).toHaveBeenCalledWith("Could not load sessions.");
});

test("local remove returns false on write failure without deleting saved data", () => {
  SavedSessions.upsert(entry);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(SavedSessions.remove(entry.id)).toBe(false);
  expect(SavedSessions.get(entry.id)).not.toBeNull();
});
