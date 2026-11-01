import { createCoachAccessController, parseCoachEntitlements, ACCESS_RECHECK_MS, ACCESS_LEASE_MS, ACCESS_TIMEOUT_MS } from "./coachAccessController";

const baseTime = Date.parse("2030-01-01T00:00:00Z");
const userA = { id: "user-a", email: "a@example.test" };
const userB = { id: "user-b", email: "b@example.test" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let client, state, controller, authCallback, currentUser, mono, overrides, history, paidQuery;
const response = (values = {}) => ({
  user_id: currentUser.id, checked_at: new Date(baseTime + mono).toISOString(),
  paid_active: false, founding_active: false, founding_expires_at: null, founding_status: "none", is_pro: false,
  ...values,
});
const trial = (ms = 5000, values = {}) => response({
  founding_active: true, founding_status: "active", founding_expires_at: new Date(baseTime + mono + ms).toISOString(), is_pro: true, ...values,
});
const start = async () => {
  controller = createCoachAccessController({ client, configured: true, onChange: next => { state = next; history.push(next); } });
  await flush();
};
const tick = async ms => { mono += ms; jest.advanceTimersByTime(ms); await flush(); };
beforeEach(() => {
  sessionStorage.clear();
  jest.useFakeTimers(); mono = 0; currentUser = userA; history = []; overrides = {};
  jest.spyOn(performance, "now").mockImplementation(() => mono);
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  jest.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  paidQuery = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) };
  client = {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: currentUser }, error: null })),
      onAuthStateChange: jest.fn(callback => { authCallback = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    rpc: jest.fn(async () => ({ data: response(overrides), error: null })),
    from: jest.fn(() => paidQuery),
  };
});
afterEach(() => { controller?.dispose(); controller = null; jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([
  ["free", {}, false, "free"],
  ["paid", { paid_active: true, is_pro: true }, true, "paid"],
  ["founding", { founding_active: true, founding_status: "active", founding_expires_at: "2030-04-01T00:00:00Z", is_pro: true }, true, "founding"],
  ["both", { paid_active: true, founding_active: true, founding_status: "active", founding_expires_at: "2030-04-01T00:00:00Z", is_pro: true }, true, "paid"],
  ["paid + expired", { paid_active: true, founding_status: "expired", founding_expires_at: "2029-12-31T00:00:00Z", is_pro: true }, true, "paid"],
  ["paid + revoked", { paid_active: true, founding_status: "revoked", founding_expires_at: "2030-04-01T00:00:00Z", is_pro: true }, true, "paid"],
])("server result preserves %s precedence", async (_, values, isPro, source) => {
  overrides = values; await start();
  expect(state).toMatchObject({ user: userA, isPro, accessSource: source, loading: false, error: null });
  expect(client.rpc).toHaveBeenCalledWith("get_coach_entitlements"); expect(client.from).not.toHaveBeenCalled();
});

test("user-editable and JWT metadata cannot grant paid or trial access", async () => {
  currentUser = { ...userA, user_metadata: { plan: "pro", isPro: true, founding_active: true }, app_metadata: { plan: "pro" } };
  await start(); expect(state.isPro).toBe(false); expect(state.paidActive).toBe(false); expect(state.foundingActive).toBe(false);
});

test("A to B clears A immediately and discards late A grants without calling auth inside callback", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  const delayed = deferred(); client.rpc.mockReturnValueOnce(delayed.promise);
  const pending = controller.refresh(); await flush();
  const calls = client.auth.getUser.mock.calls.length;
  currentUser = userB; overrides = {}; authCallback("SIGNED_IN", { user: userB });
  expect(state).toMatchObject({ user: userB, isPro: false, loading: true });
  expect(client.auth.getUser).toHaveBeenCalledTimes(calls);
  await tick(0); expect(state).toMatchObject({ user: userB, isPro: false, loading: false });
  delayed.resolve({ data: response({ user_id: userA.id, paid_active: true, is_pro: true }) }); await pending;
  expect(state).toMatchObject({ user: userB, isPro: false });
});

test("RPC identity mismatch is rejected even if getUser and auth token switch between calls", async () => {
  client.rpc.mockResolvedValue({ data: response({ user_id: userB.id, paid_active: true, is_pro: true }) });
  await start(); expect(state).toMatchObject({ user: userA, isPro: false }); expect(state.error).toContain("could not verify");
});

test("A to B to A does not reuse the first A request after an identity boundary", async () => {
  await start(); const firstA = deferred(); client.rpc.mockReturnValueOnce(firstA.promise);
  const pending = controller.refresh(); await flush();
  currentUser = userB; authCallback("SIGNED_IN", { user: userB });
  currentUser = userA; authCallback("SIGNED_IN", { user: userA });
  await tick(0); expect(state).toMatchObject({ user: userA, isPro: false });
  firstA.resolve({ data: response({ paid_active: true, is_pro: true }) }); await pending;
  expect(state).toMatchObject({ user: userA, isPro: false });
});

test("signed-out auth event clears all access and rejects inflight auth response", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  const delayed = deferred(); client.auth.getUser.mockReturnValueOnce(delayed.promise);
  const pending = controller.refresh(); authCallback("SIGNED_OUT", null);
  expect(state).toMatchObject({ user: null, isPro: false, loading: false });
  delayed.resolve({ data: { user: userA } }); await pending;
  expect(state).toMatchObject({ user: null, isPro: false });
});

test("explicit signout removes access before network completion and cannot restore inflight results", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  const request = deferred(), signout = deferred();
  client.rpc.mockReturnValueOnce(request.promise); client.auth.signOut.mockReturnValueOnce(signout.promise);
  const pending = controller.refresh(); await flush(); const leaving = controller.signOut();
  expect(state).toMatchObject({ user: null, isPro: false });
  request.resolve({ data: response(overrides) }); await pending;
  expect(state.isPro).toBe(false);
  signout.resolve({ error: null }); await leaving; expect(state.user).toBeNull();
});

test("failed signout remains closed and reports that logout was not confirmed", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.auth.signOut.mockResolvedValueOnce({ error: new Error("offline") });
  await expect(controller.signOut()).rejects.toThrow("offline");
  expect(state).toMatchObject({ isPro: false, user: null }); expect(state.error).toContain("Sign out could not be confirmed");
});

test("failed signout cannot restore the old session on reconnect or auth events; explicit retry unlocks after success", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.auth.signOut.mockResolvedValueOnce({ error: new Error("offline") });
  await expect(controller.signOut()).rejects.toThrow("offline");
  const checks = client.auth.getUser.mock.calls.length;
  window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("offline"));
  document.dispatchEvent(new Event("visibilitychange"));
  authCallback("SIGNED_IN", { user: userA }); authCallback("TOKEN_REFRESHED", { user: userA });
  await controller.refresh(); await tick(ACCESS_RECHECK_MS);
  expect(state).toMatchObject({ isPro: false, user: null, logoutPending: true, loading: false });
  expect(client.auth.getUser).toHaveBeenCalledTimes(checks);
  await controller.signOut();
  expect(state).toMatchObject({ isPro: false, user: null, logoutPending: false });
  currentUser = userB; authCallback("SIGNED_IN", { user: userB }); await tick(0);
  expect(state).toMatchObject({ user: userB, isPro: true, logoutPending: false });
});

test("a failed logout intent survives controller remount without reading the old authenticated session", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.auth.signOut.mockResolvedValueOnce({ error: new Error("offline") });
  await expect(controller.signOut()).rejects.toThrow("offline");
  controller.dispose();
  const checks = client.auth.getUser.mock.calls.length;
  await start();
  expect(state).toMatchObject({ user: null, isPro: false, logoutPending: true });
  expect(client.auth.getUser).toHaveBeenCalledTimes(checks);
  await controller.signOut(); expect(state.logoutPending).toBe(false);
  controller.dispose(); currentUser = null; await start();
  expect(state).toMatchObject({ user: null, isPro: false, logoutPending: false });
});

test("latest refresh wins over older success", async () => {
  await start(); const older = deferred(); client.rpc.mockReturnValueOnce(older.promise);
  const pending = controller.refresh(); await flush(); await controller.refresh();
  older.resolve({ data: response({ paid_active: true, is_pro: true }) }); await pending;
  expect(state.isPro).toBe(false);
});

test.each(["PGRST202", "42883"])("%s missing RPC preserves paid-only rollout compatibility", async code => {
  client.rpc.mockResolvedValue({ error: { code } }); paidQuery.maybeSingle.mockResolvedValue({ data: { plan: "pro", status: "active" } });
  await start(); expect(state).toMatchObject({ isPro: true, paidActive: true, foundingActive: false, accessSource: "paid", error: null });
  expect(client.from).toHaveBeenCalledWith("coach_access"); expect(paidQuery.eq).toHaveBeenCalledWith("user_id", userA.id);
});

test("missing RPC never invents a trial and reports unavailable for unpaid account", async () => {
  client.rpc.mockResolvedValue({ error: { code: "PGRST202" } }); await start();
  expect(state).toMatchObject({ isPro: false, foundingActive: false, foundingStatus: "unavailable" }); expect(state.error).toBeTruthy();
});

test.each(["42501", "PGRST301", "500", undefined])("RPC failure %s fails closed without paid fallback, and recovery rechecks server", async code => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.rpc.mockResolvedValueOnce({ error: { code, message: "sensitive diagnostic" } }); await controller.refresh();
  expect(state).toMatchObject({ isPro: false, user: userA }); expect(state.error).toContain("could not verify"); expect(state.error).not.toContain("sensitive"); expect(client.from).not.toHaveBeenCalled();
  await controller.refresh(); expect(state).toMatchObject({ isPro: true, error: null });
});

test("network failure in getUser keeps account identity and saved-data scope, but removes access", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.auth.getUser.mockRejectedValueOnce(new Error("offline")); await controller.refresh();
  expect(state).toMatchObject({ user: userA, isPro: false, loading: false }); expect(state.error).toBeTruthy();
});

test("hung RPC times out and a late success cannot resurrect access", async () => {
  await start(); const pending = deferred(); client.rpc.mockReturnValueOnce(pending.promise);
  const check = controller.refresh(); await flush(); await tick(ACCESS_TIMEOUT_MS); await check;
  expect(state.isPro).toBe(false); expect(state.error).toBeTruthy();
  pending.resolve({ data: response({ paid_active: true, is_pro: true }) }); await flush(); expect(state.isPro).toBe(false);
});

test("trial expires using server duration despite a wrong device clock, before recheck succeeds", async () => {
  jest.spyOn(Date, "now").mockReturnValue(0);
  client.rpc.mockResolvedValueOnce({ data: trial(1000) }); await start(); expect(state.isPro).toBe(true);
  client.rpc.mockReturnValue(new Promise(() => {})); await tick(1000);
  expect(state).toMatchObject({ isPro: false, foundingActive: false, foundingStatus: "expired", user: userA, loading: true });
});

test("response travel time is subtracted so a trial that expires in flight is not granted", async () => {
  const pending = deferred(); client.rpc.mockReturnValue(pending.promise); await start();
  const snapshot = trial(1000); mono += 1200; pending.resolve({ data: snapshot }); await flush();
  expect(state).toMatchObject({ isPro: false, foundingActive: false, foundingStatus: "expired" });
});

test("trial expiry keeps separately paid Pro active", async () => {
  client.rpc.mockResolvedValueOnce({ data: trial(1000, { paid_active: true }) }); await start();
  const pending = deferred(); client.rpc.mockReturnValueOnce(pending.promise); await tick(1000);
  expect(state).toMatchObject({ isPro: true, paidActive: true, foundingActive: false, foundingStatus: "expired", loading: true });
  pending.resolve({ data: response({ paid_active: true, is_pro: true, founding_status: "expired", founding_expires_at: "2030-01-01T00:00:01Z" }) }); await flush();
  expect(state).toMatchObject({ isPro: true, accessSource: "paid", loading: false });
});

test("periodic revalidation observes revocation without mutating data", async () => {
  client.rpc.mockResolvedValueOnce({ data: trial(90 * 24 * 60 * 60 * 1000) }); await start();
  overrides = { founding_status: "revoked", founding_expires_at: "2030-04-01T00:00:00Z" };
  await tick(ACCESS_RECHECK_MS); expect(state).toMatchObject({ isPro: false, foundingStatus: "revoked", user: userA });
  expect(client.rpc).toHaveBeenCalledTimes(2); expect(client.from).not.toHaveBeenCalled();
});

test("offline immediately suspends access and online recovers from the server", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  window.dispatchEvent(new Event("offline")); expect(state.isPro).toBe(false); expect(state.error).toBeTruthy();
  window.dispatchEvent(new Event("online")); expect(state.isPro).toBe(false); await flush(); expect(state.isPro).toBe(true);
});

test("hidden/foreground and focus suspend existing grants until server validation", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
  expect(state).toMatchObject({ isPro: false, user: userA, loading: true });
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
  expect(state.isPro).toBe(false); await flush(); expect(state.isPro).toBe(true);
  window.dispatchEvent(new Event("focus")); expect(state.isPro).toBe(false); await flush(); expect(state.isPro).toBe(true);
});

test("lease cannot be stretched indefinitely by repeated overlapping refreshes", async () => {
  overrides = { paid_active: true, is_pro: true }; await start();
  client.auth.getUser.mockReturnValue(new Promise(() => {}));
  // Simulate a busy event loop reaching the lease boundary without settling work.
  mono = ACCESS_LEASE_MS; jest.advanceTimersByTime(ACCESS_LEASE_MS); await flush();
  expect(state.isPro).toBe(false);
});

test.each([
  { user_id: "other" }, { checked_at: "invalid" }, { paid_active: "true" }, { is_pro: true },
  { founding_active: true }, { founding_status: "invalid" }, { founding_status: "expired" },
])("malformed or inconsistent server result fails closed: %j", async values => {
  overrides = values; await start(); expect(state.isPro).toBe(false); expect(state.error).toBeTruthy();
});

test("parser compares only server timestamps and rejects active at the exact expiry boundary", () => {
  expect(() => parseCoachEntitlements(trial(0), userA.id, 0)).toThrow();
  expect(parseCoachEntitlements(trial(1000), userA.id, 1000)).toMatchObject({ foundingActive: false, remainingMs: 0 });
});

test("unmount unsubscribes, removes rechecks, and ignores late completions", async () => {
  const pending = deferred(); client.rpc.mockReturnValueOnce(pending.promise); await start();
  controller.dispose(); const count = history.length;
  pending.resolve({ data: response({ paid_active: true, is_pro: true }) }); await flush();
  window.dispatchEvent(new Event("focus")); await tick(ACCESS_RECHECK_MS);
  expect(history).toHaveLength(count); expect(client.auth.onAuthStateChange.mock.results[0].value.data.subscription.unsubscribe).toHaveBeenCalled();
});
