// In-memory editor lifecycle only. None of these wrapper fields are persisted.
export function cloneDraftValue(value) {
  if (Array.isArray(value)) return value.map(cloneDraftValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneDraftValue(entry)]));
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Compare JSON-shaped session content independent of object property order.
// This is a dirty-state comparison, not a performance-set fingerprint.
function content(value) {
  return JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
    : entry);
}

export function createSessionDraft(session, profile = {}, knownContext = {}, favouriteId = null) {
  const originalDraft = cloneDraftValue(session || {});
  if (!originalDraft.session_id) {
    originalDraft.session_id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const frozenProfile = freeze(cloneDraftValue(profile));
  const pool = /^(25|50)(m|y|yd)$/.exec(profile.poolType || "");
  const context = freeze(cloneDraftValue({
    ...frozenProfile,
    // Only explicit in-memory selection provenance can suggest recording identity.
    recordingAthleteRef: knownContext.recordingAthleteRef || null,
    poolLength: pool ? Number(pool[1]) : undefined,
    // Missing legacy inputs stay undefined; [] and null mean known none/no target.
    equipment: Object.prototype.hasOwnProperty.call(knownContext, "equipment") ? knownContext.equipment : profile.equipment,
    paceTarget: Object.prototype.hasOwnProperty.call(knownContext, "paceTarget") ? knownContext.paceTarget : profile.paceTarget,
  }));
  return {
    originalDraft: freeze(originalDraft),
    workingDraft: freeze(cloneDraftValue(originalDraft)),
    profile: frozenProfile,
    context,
    favouriteId,
    dirty: false,
    revision: 0,
    changeSequence: 0,
  };
}

export function editSessionDraft(draft, updater) {
  if (!draft) return draft;
  const proposed = typeof updater === "function" ? updater(draft.workingDraft) : updater;
  if (content(proposed) === content(draft.workingDraft)) return draft;
  const workingDraft = freeze(cloneDraftValue(proposed));
  const dirty = content(workingDraft) !== content(draft.originalDraft);
  const changeSequence = draft.changeSequence + 1;
  return { ...draft, workingDraft, dirty, changeSequence, revision: dirty ? changeSequence : 0 };
}

export function resetSessionDraft(draft) {
  return draft ? editSessionDraft(draft, cloneDraftValue(draft.originalDraft)) : draft;
}
