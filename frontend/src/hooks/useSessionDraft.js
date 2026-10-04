import { useCallback, useState } from "react";
import { createSessionDraft, editSessionDraft, resetSessionDraft } from "@/lib/sessionDraft";

export function useSessionDraft(initialSession = null, initialProfile = {}) {
  const [draft, setDraft] = useState(() => initialSession ? { ...createSessionDraft(initialSession, initialProfile), lifecycle: 1 } : null);
  const baseline = draft?.originalDraft;
  const load = useCallback((session, profile, context, favouriteId) => {
    const next = createSessionDraft(session, profile, context, favouriteId);
    setDraft(current => ({ ...next, lifecycle: (current?.lifecycle || 0) + 1 }));
  }, []);
  const update = useCallback(updater => {
    setDraft(current => current && current.originalDraft === baseline ? editSessionDraft(current, updater) : current);
  }, [baseline]);
  const reset = useCallback(() => {
    setDraft(current => current && current.originalDraft === baseline ? resetSessionDraft(current) : current);
  }, [baseline]);
  const setFavouriteId = useCallback(favouriteId => {
    // A completed request for a replaced draft must not mark the new draft saved.
    setDraft(current => current && current.originalDraft === baseline ? { ...current, favouriteId } : current);
  }, [baseline]);
  return { draft, load, update, reset, setFavouriteId };
}
