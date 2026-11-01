import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { createCoachAccessController, emptyCoachAccess } from "./coachAccessController";

export function useCoachAccess() {
  const [access, setAccess] = useState(() => ({
    ...emptyCoachAccess(isSupabaseConfigured), loading: isSupabaseConfigured,
  }));
  const controller = useRef(null);

  useEffect(() => {
    const instance = createCoachAccessController({ client: supabase, configured: isSupabaseConfigured, onChange: setAccess });
    controller.current = instance;
    return () => { instance.dispose(); controller.current = null; };
  }, []);

  const refresh = useCallback(() => controller.current?.refresh(), []);
  const signOut = useCallback(() => controller.current?.signOut(), []);
  const sendMagicLink = useCallback(async (email) => {
    if (!supabase) throw new Error("Account sign-in is not configured yet.");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
  }, []);

  return { ...access, refresh, sendMagicLink, signOut };
}
