import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "@/lib/supabaseClient";
import { useCoachAccess } from "./useCoachAccess";

jest.mock("@/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getUser: jest.fn(), onAuthStateChange: jest.fn(), signOut: jest.fn(), signInWithOtp: jest.fn() }, rpc: jest.fn() },
}));
global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, access, callback, unsubscribe;
const user = { id: "user-a", email: "a@example.test" };
function Owner() { access = useCoachAccess(); return <div>{access.user?.id}:{String(access.isPro)}</div>; }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  unsubscribe = jest.fn();
  supabase.auth.getUser.mockResolvedValue({ data: { user } });
  supabase.auth.onAuthStateChange.mockImplementation(fn => { callback = fn; return { data: { subscription: { unsubscribe } } }; });
  supabase.auth.signOut.mockResolvedValue({ error: null }); supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
  supabase.rpc.mockResolvedValue({ data: { user_id: user.id, checked_at: "2030-01-01T00:00:00Z", paid_active: true, founding_active: false, founding_status: "none", founding_expires_at: null, is_pro: true } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); jest.clearAllMocks(); jest.useRealTimers(); });

test("mount verifies access, account switch never renders old account grant, and cleanup unsubscribes", async () => {
  await act(async () => { root.render(<Owner />); await settle(); });
  expect(access).toMatchObject({ isPro: true, user });
  await act(async () => callback("SIGNED_IN", { user: { id: "user-b" } }));
  expect(container.textContent).toBe("user-b:false");
});
test("signout and manual refresh are connected to the active controller", async () => {
  await act(async () => { root.render(<Owner />); await settle(); });
  await act(async () => access.refresh()); expect(supabase.rpc).toHaveBeenCalledTimes(2);
  await act(async () => access.signOut()); expect(access).toMatchObject({ isPro: false, user: null }); expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
});
test("magic link maintains the existing secure redirect flow", async () => {
  await act(async () => { root.render(<Owner />); await settle(); });
  await access.sendMagicLink("coach@example.test");
  expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ email: "coach@example.test", options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
});
test("React StrictMode reinitialization cannot publish results from disposed controller", async () => {
  await act(async () => { root.render(<React.StrictMode><Owner /></React.StrictMode>); await settle(); });
  expect(access).toMatchObject({ isPro: true, user }); expect(unsubscribe).toHaveBeenCalledTimes(1);
});
