import { supabase } from "./supabaseClient";
import { SavedSessions } from "./cloudStore";

jest.mock("./supabaseClient", () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

test.each([null, new Error("Delete denied")])("remove returns true or throws the database error: %s", async (error) => {
  const query = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), select: jest.fn().mockResolvedValue({ data: [{ id: "session-1" }], error }) };
  supabase.from.mockReturnValue(query);
  if (error) await expect(SavedSessions.remove("session-1")).rejects.toBe(error);
  else await expect(SavedSessions.remove("session-1")).resolves.toBe(true);
  expect(supabase.from).toHaveBeenCalledWith("saved_sessions");
  expect(query.eq.mock.calls).toEqual([["id", "session-1"], ["user_id", "user-1"]]);
});

test("RLS-filtered deletion does not claim an inaccessible record was removed", async () => {
  const query = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), select: jest.fn().mockResolvedValue({ data: [], error: null }) };
  supabase.from.mockReturnValue(query);
  await expect(SavedSessions.forUser("user-1").remove("session-1")).resolves.toBe(false);
});

test("unauthenticated delete never reaches the database", async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(SavedSessions.remove("session-1")).rejects.toThrow("signed in");
  expect(supabase.from).not.toHaveBeenCalled();
});

test.each(["list", "get", "upsert", "remove", "clear"])("account-bound %s rejects another authenticated account before database access", async method => {
  const bound = SavedSessions.forUser("previous-user");
  const args = method === "upsert" ? [{ name: "Previous account draft" }] : ["record-1"];
  if (method === "list" || method === "clear") args.length = 0;
  await expect(bound[method](...args)).rejects.toThrow("Account changed");
  expect(supabase.from).not.toHaveBeenCalled();
});

test("expired, revoked, or unmounted scope cannot start a read or write", async () => {
  const bound = SavedSessions.forUser("user-1", () => false);
  await expect(bound.upsert({ name: "Draft" })).rejects.toThrow("access changed");
  await expect(bound.list()).rejects.toThrow("access changed");
  expect(supabase.auth.getUser).not.toHaveBeenCalled();
  expect(supabase.from).not.toHaveBeenCalled();
});

test("an in-flight authentication check cannot authorize a retired scope", async () => {
  let active = true, resolveUser;
  supabase.auth.getUser.mockImplementation(() => new Promise(resolve => { resolveUser = resolve; }));
  const request = SavedSessions.forUser("user-1", () => active).upsert({ name: "Old draft" });
  active = false;
  resolveUser({ data: { user: { id: "user-1" } }, error: null });
  await expect(request).rejects.toThrow("access changed");
  expect(supabase.from).not.toHaveBeenCalled();
});

test("a record with a foreign owner is not copied to the current account", async () => {
  await expect(SavedSessions.forUser("user-1").upsert({ user_id: "user-2", name: "Other account" })).rejects.toThrow("another account");
  expect(supabase.from).not.toHaveBeenCalled();
});

test("account changes during an existing-record lookup prevent the pending upsert", async () => {
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(), upsert: jest.fn() };
  query.maybeSingle.mockImplementation(async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    return { data: { id: "session-1", user_id: "user-1", data: {} }, error: null };
  });
  supabase.from.mockReturnValue(query);
  await expect(SavedSessions.forUser("user-1").upsert({ id: "session-1", name: "Old draft" })).rejects.toThrow("Account changed");
  expect(query.upsert).not.toHaveBeenCalled();
});

test("an obsolete cloud response cannot repopulate a new account screen", async () => {
  let active = true;
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn() };
  query.order.mockImplementation(async () => {
    active = false;
    return { data: [{ id: "private-session", user_id: "user-1", data: { name: "Private" } }], error: null };
  });
  supabase.from.mockReturnValue(query);
  await expect(SavedSessions.forUser("user-1", () => active).list()).rejects.toThrow("access changed");
});

test("a valid bound write preserves the account owner and cloud errors propagate without fallback", async () => {
  const row = { id: "new-session", user_id: "user-1", data: { name: "Draft" } };
  const query = { upsert: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: row, error: null }) };
  supabase.from.mockReturnValue(query);
  await expect(SavedSessions.forUser("user-1").upsert({ name: "Draft" })).resolves.toMatchObject({ user_id: "user-1", name: "Draft" });
  expect(query.upsert.mock.calls[0][0]).toMatchObject({ user_id: "user-1", data: { user_id: "user-1", name: "Draft" } });
  const failure = new Error("Network unavailable");
  query.single.mockResolvedValueOnce({ data: null, error: failure });
  await expect(SavedSessions.forUser("user-1").upsert({ name: "Draft" })).rejects.toBe(failure);
});
