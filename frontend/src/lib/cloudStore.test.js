import { supabase } from "./supabaseClient";
import { SavedSessions } from "./cloudStore";

jest.mock("./supabaseClient", () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

test.each([null, new Error("Delete denied")])("remove returns true or throws the database error: %s", async (error) => {
  const query = { delete: jest.fn().mockReturnThis(), eq: jest.fn() };
  query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error });
  supabase.from.mockReturnValue(query);
  if (error) await expect(SavedSessions.remove("session-1")).rejects.toBe(error);
  else await expect(SavedSessions.remove("session-1")).resolves.toBe(true);
  expect(supabase.from).toHaveBeenCalledWith("saved_sessions");
  expect(query.eq.mock.calls).toEqual([["id", "session-1"], ["user_id", "user-1"]]);
});

test("unauthenticated delete never reaches the database", async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(SavedSessions.remove("session-1")).rejects.toThrow("signed in");
  expect(supabase.from).not.toHaveBeenCalled();
});
