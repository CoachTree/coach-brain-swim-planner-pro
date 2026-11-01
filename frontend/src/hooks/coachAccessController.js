// This is a short-lived UI gate, not a replacement for database RLS.
export const ACCESS_RECHECK_MS = 30_000;
export const ACCESS_LEASE_MS = 60_000;
export const ACCESS_TIMEOUT_MS = 10_000;
const CHECK_ERROR = "We could not verify your access. Reconnect and try again. Your saved data is unchanged.";
const SIGNOUT_ERROR = "Sign out could not be confirmed. Account access stays locked. Reconnect and retry sign out.";
const LOGOUT_PENDING_KEY = "coach-brain.logout-pending";
const readLogoutPending = () => {
  try { return sessionStorage.getItem(LOGOUT_PENDING_KEY) === "1"; } catch (_) { return false; }
};
const persistLogoutPending = value => {
  // Only a tab-scoped intent flag, never an identity, grant, or auth token.
  try { if (value) sessionStorage.setItem(LOGOUT_PENDING_KEY, "1"); else sessionStorage.removeItem(LOGOUT_PENDING_KEY); } catch (_) { /* Keep the in-memory lock if storage is unavailable. */ }
};

export const emptyCoachAccess = (configured, user = null) => ({
  configured, loading: false, user, plan: "free", isPro: false,
  paidActive: false, foundingActive: false, foundingExpiresAt: null,
  foundingStatus: "none", accessSource: "free", error: null, logoutPending: false,
});

// Both timestamps come from one server response. The device's wall clock is
// never used to grant or extend an invitation; round-trip time is conservative.
export function parseCoachEntitlements(data, userId, elapsedMs) {
  const checkedAt = Date.parse(data?.checked_at);
  const expiresAt = Date.parse(data?.founding_expires_at);
  const statuses = ["none", "active", "expired", "revoked"];
  if (!data || data.user_id !== userId || typeof data.checked_at !== "string" || !Number.isFinite(checkedAt)
      || !Number.isFinite(elapsedMs) || elapsedMs < 0
      || typeof data.paid_active !== "boolean" || typeof data.founding_active !== "boolean"
      || !statuses.includes(data.founding_status)
      || data.is_pro !== (data.paid_active || data.founding_active)
      || data.founding_active !== (data.founding_status === "active")
      || (data.founding_status === "none" && data.founding_expires_at !== null)
      || (data.founding_status !== "none" && (typeof data.founding_expires_at !== "string" || !Number.isFinite(expiresAt)))
      || (data.founding_active && expiresAt <= checkedAt)) {
    throw new Error("Invalid entitlement response");
  }
  const remainingMs = data.founding_active ? Math.max(0, expiresAt - checkedAt - elapsedMs) : 0;
  const foundingActive = data.founding_active && remainingMs > 0;
  return {
    paidActive: data.paid_active,
    foundingActive,
    foundingExpiresAt: data.founding_expires_at || null,
    foundingStatus: data.founding_active && !foundingActive ? "expired" : data.founding_status,
    remainingMs,
  };
}

export function createCoachAccessController({ client, configured, onChange }) {
  let state = emptyCoachAccess(configured);
  let alive = true;
  let generation = 0;
  let signingOut = false;
  let logoutPending = readLogoutPending();
  let scheduledRefresh;
  let leaseTimer;
  let trialTimer;
  let leaseDeadline = 0;
  const pendingTimeouts = new Set();
  const now = () => performance.now();
  const publish = (next) => { state = next; if (alive) onChange(state); };
  const clearLease = () => {
    clearTimeout(leaseTimer); clearTimeout(trialTimer); leaseDeadline = 0;
  };
  const unavailable = (user = state.user) => {
    clearLease();
    publish({ ...emptyCoachAccess(configured, user), error: CHECK_ERROR });
  };
  const bounded = (request) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingTimeouts.delete(timer); reject(new Error("Access check timed out")); }, ACCESS_TIMEOUT_MS);
    pendingTimeouts.add(timer);
    Promise.resolve(request).then(resolve, reject).finally(() => { clearTimeout(timer); pendingTimeouts.delete(timer); });
  });
  const withPlan = (next) => ({
    ...next,
    isPro: next.paidActive || next.foundingActive,
    plan: next.paidActive || next.foundingActive ? "pro" : "free",
    accessSource: next.paidActive ? "paid" : next.foundingActive ? "founding" : "free",
  });

  async function refresh() {
    if (!alive || signingOut || logoutPending) return;
    clearTimeout(scheduledRefresh);
    const requestId = ++generation;
    const current = () => alive && requestId === generation;
    if (!client) { publish(emptyCoachAccess(configured)); return; }
    if (document.visibilityState === "hidden") {
      clearLease();
      publish({ ...emptyCoachAccess(configured, state.user), loading: true });
      return;
    }
    if (navigator.onLine === false) { unavailable(); return; }
    if (leaseDeadline && now() >= leaseDeadline) clearLease();
    publish({ ...(leaseDeadline ? state : emptyCoachAccess(configured, state.user)), loading: true, error: null });
    try {
      const { data: userData, error: userError } = await bounded(client.auth.getUser());
      if (!current()) return;
      if (userError?.name === "AuthSessionMissingError" || (!userError && !userData?.user)) {
        clearLease(); publish(emptyCoachAccess(configured)); return;
      }
      if (userError) throw userError;
      const user = userData.user;
      if (state.user?.id !== user.id) {
        clearLease(); publish({ ...emptyCoachAccess(configured, user), loading: true });
      }
      const startedAt = now();
      const { data, error } = await bounded(client.rpc("get_coach_entitlements"));
      if (!current()) return;
      let grants;
      if (error && ["PGRST202", "42883"].includes(error.code)) {
        // Safe rollout/rollback compatibility: only a genuinely missing RPC may
        // use the pre-existing paid grant. No trial or metadata fallback exists.
        const paid = await bounded(client.from("coach_access").select("plan, status").eq("user_id", user.id).maybeSingle());
        if (!current()) return;
        if (paid.error) throw paid.error;
        grants = {
          paidActive: paid.data?.plan === "pro" && paid.data?.status === "active",
          foundingActive: false, foundingExpiresAt: null, foundingStatus: "unavailable", remainingMs: 0,
        };
      } else {
        if (error) throw error;
        grants = parseCoachEntitlements(data, user.id, Math.max(0, now() - startedAt));
      }
      clearLease();
      const { remainingMs, ...entitlements } = grants;
      const next = withPlan({ ...emptyCoachAccess(configured, user), ...entitlements });
      if (grants.foundingStatus === "unavailable" && !grants.paidActive) {
        next.error = "Invitation access is not available yet. Please try again later. Your saved data is unchanged.";
      }
      publish(next);
      if (!next.isPro) return;
      leaseDeadline = now() + ACCESS_LEASE_MS;
      leaseTimer = setTimeout(() => {
        if (!alive) return;
        ++generation;
        unavailable();
        void refresh();
      }, ACCESS_LEASE_MS);
      if (grants.foundingActive && remainingMs <= ACCESS_LEASE_MS) {
        trialTimer = setTimeout(() => {
          if (!alive) return;
          // Trial expiry cannot remove an independently verified paid grant.
          publish(withPlan({ ...state, foundingActive: false, foundingStatus: "expired" }));
          void refresh();
        }, remainingMs);
      }
    } catch (_) {
      if (current()) unavailable();
    }
  }

  function authChanged(event, session) {
    if (!alive || signingOut || logoutPending) return;
    ++generation;
    clearTimeout(scheduledRefresh);
    const user = event === "SIGNED_OUT" ? null : session?.user || null;
    if (!user || state.user?.id !== user.id) {
      clearLease(); publish({ ...emptyCoachAccess(configured, user), loading: Boolean(user) });
    }
    // Supabase emits auth callbacks under its session lock. Never call an async
    // auth/database operation synchronously inside that callback.
    if (user) scheduledRefresh = setTimeout(() => { void refresh(); }, 0);
  }

  async function signOut() {
    if (signingOut) throw new Error("Sign out is already in progress.");
    ++generation; signingOut = true; logoutPending = true; clearTimeout(scheduledRefresh); clearLease();
    persistLogoutPending(true);
    publish({ ...emptyCoachAccess(configured), logoutPending: true, loading: true });
    try {
      const result = client ? await bounded(client.auth.signOut()) : {};
      if (result.error) throw result.error;
      logoutPending = false;
      persistLogoutPending(false);
      publish(emptyCoachAccess(configured));
    } catch (error) {
      if (alive) publish({ ...emptyCoachAccess(configured), logoutPending: true, error: SIGNOUT_ERROR });
      throw error;
    } finally { signingOut = false; }
  }

  const recheck = () => {
    if (!alive || signingOut || logoutPending) return;
    ++generation; clearLease();
    publish({ ...emptyCoachAccess(configured, state.user), loading: true });
    void refresh();
  };
  const offline = () => { if (!alive || signingOut || logoutPending) return; ++generation; unavailable(); };
  const interval = setInterval(() => { if (state.user && !signingOut && !logoutPending) void refresh(); }, ACCESS_RECHECK_MS);
  const subscription = client?.auth.onAuthStateChange(authChanged)?.data?.subscription;
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("focus", recheck);
  window.addEventListener("online", recheck);
  window.addEventListener("offline", offline);
  if (logoutPending) publish({ ...emptyCoachAccess(configured), logoutPending: true, error: SIGNOUT_ERROR });
  else void refresh();

  return {
    refresh, signOut,
    dispose() {
      alive = false; ++generation; clearLease(); clearTimeout(scheduledRefresh); clearInterval(interval);
      pendingTimeouts.forEach(clearTimeout); pendingTimeouts.clear();
      subscription?.unsubscribe();
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", offline);
    },
  };
}
