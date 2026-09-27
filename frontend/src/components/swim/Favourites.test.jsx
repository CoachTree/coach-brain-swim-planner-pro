import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import SessionResult from "./SessionResult";
import CoachLibrary from "./CoachLibrary";
import { Favourites as LocalFavourites } from "@/lib/localStore";
import { Favourites as CloudFavourites } from "@/lib/cloudStore";
import { selectFavouriteStore } from "@/lib/favouriteStore";
import { supabase } from "@/lib/supabaseClient";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("./JournalPanel", () => () => null);
jest.mock("@/lib/supabaseClient", () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, rows, calls;
const session = { total_distance_m: 1000 };
const profile = { distance: 1000, stroke: "freestyle", unit: "m" };
const render = async (element) => { await act(async () => root.render(element)); };
const click = async (id) => {
  const button = container.querySelector(`[data-testid="${id}"]`);
  expect(button).not.toBeNull();
  await act(async () => button.click());
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(window, "prompt").mockReturnValue("Keep this favourite name");
  rows = new Map();
  calls = [];
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
  // Exercise the actual cloud repository against an in-memory Supabase API mock.
  supabase.from.mockImplementation((table) => {
    expect(table).toBe("favourites");
    let filters = {}, operation = "select", pending;
    const matching = () => [...rows.values()].filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    const query = {
      select() { return this; },
      eq(key, value) { filters[key] = value; return this; },
      order: async () => ({ data: matching(), error: null }),
      maybeSingle: async () => ({ data: matching()[0] || null, error: null }),
      upsert(row) { operation = "upsert"; pending = row; return this; },
      single: async () => {
        calls.push({ operation, row: pending });
        rows.set(pending.id, pending);
        return { data: pending, error: null };
      },
      delete() { operation = "delete"; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push({ operation, filters });
          if (operation === "delete") matching().forEach(row => rows.delete(row.id));
          return { error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

test.each([
  ["guest", { user: null, isPro: false }, false],
  ["Free", { user: { id: "test-user" }, isPro: false }, false],
  ["Pro without login", { user: null, isPro: true }, false],
  ["signed-in Pro", { user: { id: "test-user" }, isPro: true }, true],
])("%s selects correct repository and supports favourite Save → Update → Delete", async (_, access, cloud) => {
  const store = selectFavouriteStore(access, LocalFavourites, CloudFavourites);
  expect(store).toBe(cloud ? CloudFavourites : LocalFavourites);
  await render(<SessionResult originalSession={session} profile={profile} favouriteStore={store} />);
  await click("favourite-button");
  const [saved] = await store.list();
  expect(saved.name).toBe("Keep this favourite name");
  await store.upsert({ ...saved, coach_note: "Preserve this custom field" });
  const nextSession = { total_distance_m: 1500 };
  const nextProfile = { ...profile, distance: 1500 };
  await render(<SessionResult originalSession={nextSession} profile={nextProfile} defaultFavouriteId={saved.id} favouriteStore={store} />);
  await click("favourite-button");
  const updated = await store.get(saved.id);
  expect(updated).toMatchObject({ name: saved.name, coach_note: "Preserve this custom field", session: nextSession, profile: nextProfile, created_at: saved.created_at });
  expect(toast.success).toHaveBeenCalledWith("Favourite updated");
  expect(await store.list()).toHaveLength(1);
  await render(<CoachLibrary favouriteStore={store} />);
  expect(container.textContent).toContain(saved.name);
  await click(`favourite-remove-${saved.id}`);
  expect(await store.list()).toEqual([]);
  expect(container.textContent).not.toContain(saved.name);
  expect(toast.success).toHaveBeenCalledWith("Removed from favourites");
  expect(toast.error).not.toHaveBeenCalled();
  if (cloud) {
    expect(calls.filter(call => call.operation === "upsert")).toHaveLength(3);
    expect(calls.find(call => call.operation === "delete").filters).toEqual({ id: saved.id, user_id: "test-user" });
    expect(LocalFavourites.list()).toEqual([]);
  } else {
    expect(supabase.from).not.toHaveBeenCalled();
  }
});

test.each(["false", "throw"])("Delete %s shows an error and retains the row", async (mode) => {
  const record = { id: "test-favourite", name: "Still here", profile };
  const store = { list: async () => [record], remove: async () => {
    if (mode === "throw") throw new Error("Denied");
    return false;
  } };
  await render(<CoachLibrary favouriteStore={store} />);
  await click("favourite-remove-test-favourite");
  expect(container.textContent).toContain("Still here");
  expect(toast.error).toHaveBeenCalledWith("Could not remove favourite.");
  expect(toast.success).not.toHaveBeenCalled();
});

test("missing favourite is not recreated by Update", async () => {
  const store = { get: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
  await render(<SessionResult originalSession={session} profile={profile} defaultFavouriteId="missing" favouriteStore={store} />);
  await click("favourite-button");
  expect(store.upsert).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("failed read aborts Update without replacing existing data", async () => {
  const store = { get: jest.fn().mockRejectedValue(new Error("Offline")), upsert: jest.fn() };
  await render(<SessionResult originalSession={session} profile={profile} defaultFavouriteId="existing" favouriteStore={store} />);
  await click("favourite-button");
  expect(store.upsert).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Offline");
});

test("failed local write reports deletion failure and preserves data", async () => {
  const saved = LocalFavourites.upsert({ name: "Preserved", profile });
  await render(<CoachLibrary favouriteStore={LocalFavourites} />);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
  await click(`favourite-remove-${saved.id}`);
  expect(LocalFavourites.get(saved.id).name).toBe("Preserved");
  expect(container.textContent).toContain("Preserved");
  expect(toast.error).toHaveBeenCalledWith("Could not remove favourite.");
});
