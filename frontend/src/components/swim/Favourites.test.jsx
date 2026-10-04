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
])("%s selects correct repository and supports favourite Save → Remove → Save again → Library Delete", async (_, access, cloud) => {
  const store = selectFavouriteStore(access, LocalFavourites, CloudFavourites);
  expect(store).toBe(cloud ? CloudFavourites : LocalFavourites);
  await render(<SessionResult session={session} profile={profile} favouriteStore={store} />);
  await click("favourite-button");
  const [saved] = await store.list();
  expect(saved.name).toBe("Keep this favourite name");
  expect(container.querySelector('[data-testid="favourite-button"]').textContent).toBe("Saved");
  await click("favourite-button");
  expect(await store.get(saved.id)).toBeNull();
  expect(container.querySelector('[data-testid="favourite-button"]').textContent).toBe("Save");
  expect(toast.success).toHaveBeenCalledWith("Removed from favourites");
  await click("favourite-button");
  const [resaved] = await store.list();
  expect(resaved.id).not.toBe(saved.id);
  expect(resaved).toMatchObject({ name: saved.name, session, profile });
  expect(container.querySelector('[data-testid="favourite-button"]').textContent).toBe("Saved");
  await render(<CoachLibrary favouriteStore={store} />);
  expect(container.textContent).toContain(saved.name);
  await click(`favourite-remove-${resaved.id}`);
  expect(await store.list()).toEqual([]);
  expect(container.textContent).not.toContain(saved.name);
  expect(toast.success).toHaveBeenCalledWith("Removed from favourites");
  expect(toast.error).not.toHaveBeenCalled();
  if (cloud) {
    expect(calls.filter(call => call.operation === "upsert")).toHaveLength(2);
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

test.each(["false", "throw"])("toggle delete failure (%s) keeps Saved and retries the same id", async (mode) => {
  const remove = jest.fn(() => mode === "false" ? false : Promise.reject(new Error("Denied")));
  const store = { remove, upsert: jest.fn() };
  await render(<SessionResult session={session} profile={profile} defaultFavouriteId="existing" favouriteStore={store} />);
  await click("favourite-button");
  expect(container.querySelector('[data-testid="favourite-button"]').textContent).toBe("Saved");
  expect(toast.error).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  remove.mockResolvedValue(true);
  await click("favourite-button");
  expect(remove.mock.calls).toEqual([["existing"], ["existing"]]);
  expect(store.upsert).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="favourite-button"]').textContent).toBe("Save");
});

test.each(["save", "delete"])("pending %s prevents duplicate requests", async (operation) => {
  let resolve;
  const pending = jest.fn(() => new Promise(done => { resolve = done; }));
  const store = { upsert: pending, remove: pending };
  await render(<SessionResult session={session} profile={profile} defaultFavouriteId={operation === "delete" ? "existing" : null} favouriteStore={store} />);
  const button = container.querySelector('[data-testid="favourite-button"]');
  await act(async () => { button.click(); button.click(); });
  expect(pending).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(pending).toHaveBeenCalledTimes(1);
  await act(async () => resolve(operation === "delete" ? true : { id: "new" }));
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe(operation === "delete" ? "Save" : "Saved");
});

test.each(["false", "throw", "cancel"])("unsuccessful save (%s) retains Save and releases lock", async (mode) => {
  const store = { upsert: jest.fn(() => mode === "throw" ? Promise.reject(new Error("Offline")) : false) };
  if (mode === "cancel") window.prompt.mockReturnValue(null);
  await render(<SessionResult session={session} profile={profile} favouriteStore={store} />);
  await click("favourite-button");
  const button = container.querySelector('[data-testid="favourite-button"]');
  expect(button.textContent).toBe("Save");
  expect(button.disabled).toBe(false);
  if (mode === "cancel") expect(store.upsert).not.toHaveBeenCalled();
  else expect(toast.error).toHaveBeenCalled();
  window.prompt.mockReturnValue("Retry");
  store.upsert.mockResolvedValue({ id: "retry" });
  await click("favourite-button");
  expect(button.textContent).toBe("Saved");
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
