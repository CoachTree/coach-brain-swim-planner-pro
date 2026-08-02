import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const initialState = {
  configured: isSupabaseConfigured,
  loading: isSupabaseConfigured,
  user: null,
  plan: "free",
  isPro: false,
  error: null,
};

export function useCoachAccess() {
  const [access, setAccess] = useState(initialState);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setAccess({ ...initialState, loading: false });
      return;
    }

    setAccess((current) => ({ ...current, loading: true, error: null }));
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      setAccess({
        configured: true,
        loading: false,
        user: null,
        plan: "free",
        isPro: false,
        error: userError?.message || null,
      });
      return;
    }

    const { data: entitlement, error: entitlementError } = await supabase
      .from("coach_access")
      .select("plan, status")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    const isPro = entitlement?.plan === "pro" && entitlement?.status === "active";
    setAccess({
      configured: true,
      loading: false,
      user: userData.user,
      plan: isPro ? "pro" : "free",
      isPro,
      error: entitlementError?.message || null,
    });
  }, []);

  useEffect(() => {
    refresh();
    if (!supabase) return undefined;

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => listener.subscription.unsubscribe();
  }, [refresh]);

  const sendMagicLink = useCallback(async (email) => {
    if (!supabase) throw new Error("Account sign-in is not configured yet.");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  return { ...access, refresh, sendMagicLink, signOut };
}
