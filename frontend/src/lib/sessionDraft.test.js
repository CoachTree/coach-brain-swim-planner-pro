import { createSessionDraft, editSessionDraft, resetSessionDraft } from "./sessionDraft";

const session = () => ({ session_id: "s1", total_distance_m: 200, main_set: { distance_m: 200, items: ["4x50"] }, coaching_points: ["Align"], coach_brain: { coach_adjustment_prompts: ["Observe"] } });
const profile = { athleteId: "a1", athleteName: "Original Name", team: "Team", unit: "yd", poolType: "50y", distance: 200, stroke: "freestyle", goal: "technique", intensity: "easy", level: "competitive", sessionRole: "standalone" };

test("baseline and context are isolated from source and working references", () => {
  const input = session(), sourceProfile = { ...profile }, equipment = ["fins"], paceTarget = { race_distance: 100, target_seconds: 65 };
  const draft = createSessionDraft(input, sourceProfile, { equipment, paceTarget });
  expect(draft.dirty).toBe(false); expect(draft.revision).toBe(0);
  expect(draft.context).toMatchObject({ ...profile, poolLength: 50, equipment: ["fins"], paceTarget });
  expect(draft.workingDraft).not.toBe(draft.originalDraft);
  expect(draft.workingDraft.main_set.items).not.toBe(draft.originalDraft.main_set.items);
  expect(() => draft.workingDraft.main_set.items.push("mutation")).toThrow();
  expect(() => { draft.originalDraft.main_set.distance_m = 999; }).toThrow();
  input.main_set.items[0] = "Changed input"; sourceProfile.athleteName = "Renamed"; equipment.push("paddles"); paceTarget.target_seconds = 99;
  expect(draft.originalDraft.main_set.items).toEqual(["4x50"]);
  expect(draft.context.athleteName).toBe("Original Name"); expect(draft.context.equipment).toEqual(["fins"]); expect(draft.context.paceTarget.target_seconds).toBe(65);
  expect(draft.profile.equipment).toBeUndefined(); expect(draft.profile.paceTarget).toBeUndefined();
});

test.each([
  ["line edit", s => ({ ...s, main_set: { ...s.main_set, items: ["6x50"] } })],
  ["line add", s => ({ ...s, main_set: { ...s.main_set, items: [...s.main_set.items, ""] } })],
  ["line remove", s => ({ ...s, main_set: { ...s.main_set, items: [] } })],
  ["distance", s => ({ ...s, main_set: { ...s.main_set, distance_m: 300 }, total_distance_m: 300 })],
  ["coaching point edit", s => ({ ...s, coaching_points: ["New cue"] })],
  ["coaching point add", s => ({ ...s, coaching_points: [...s.coaching_points, ""] })],
  ["coaching point remove", s => ({ ...s, coaching_points: [] })],
])("%s updates revision; exact revert and Reset restore baseline", (_, change) => {
  const baseline = createSessionDraft(session(), profile);
  expect(editSessionDraft(baseline, s => ({ ...s }))).toBe(baseline);
  const edited = editSessionDraft(baseline, change);
  expect(edited.dirty).toBe(true); expect(edited.revision).toBe(1);
  expect(edited.originalDraft).toBe(baseline.originalDraft); expect(edited.context).toBe(baseline.context);
  expect(editSessionDraft(edited, s => s)).toBe(edited);
  const reverted = editSessionDraft(edited, session());
  expect(reverted.dirty).toBe(false); expect(reverted.revision).toBe(0);
  const reset = resetSessionDraft(edited);
  expect(reset.workingDraft).toEqual(baseline.originalDraft); expect(reset.dirty).toBe(false); expect(reset.revision).toBe(0);
  expect(editSessionDraft(reset, change).revision).toBeGreaterThan(edited.revision);
});

test("property order is not a meaningful revision", () => {
  const draft = createSessionDraft(session(), profile);
  expect(editSessionDraft(draft, s => Object.fromEntries(Object.entries(s).reverse()))).toBe(draft);
});

test("legacy missing context stays unknown; explicit none stays known", () => {
  const draft = createSessionDraft(session(), { athleteId: "deleted-athlete", unit: "m" });
  expect(draft.context.athleteId).toBe("deleted-athlete");
  for (const key of ["athleteName", "team", "poolLength", "equipment", "paceTarget", "sessionRole"]) expect(draft.context[key]).toBeUndefined();
  const known = createSessionDraft(session(), profile, { equipment: [], paceTarget: null });
  expect(known.context.equipment).toEqual([]); expect(known.context.paceTarget).toBeNull();
});

test("loading a legacy session supplies one stable journal ID without modifying source", () => {
  const source = { main_set: { items: ["Old"] } };
  const draft = createSessionDraft(source, {});
  expect(draft.originalDraft.session_id).toBeTruthy();
  expect(resetSessionDraft(draft).workingDraft.session_id).toBe(draft.originalDraft.session_id);
  expect(source.session_id).toBeUndefined();
});

test("recording identity is frozen in memory and never inferred from a saved profile", () => {
  const ref = { scopeKey: "device:browser-local", store: "local", id: "a1", scopeVersion: 0 };
  const draft = createSessionDraft(session(), profile, { recordingAthleteRef: ref });
  ref.id = "other";
  expect(draft.context.recordingAthleteRef.id).toBe("a1");
  expect(Object.isFrozen(draft.context.recordingAthleteRef)).toBe(true);
  expect(draft.profile.recordingAthleteRef).toBeUndefined();
  expect(draft.workingDraft.recordingAthleteRef).toBeUndefined();
  expect(createSessionDraft(session(), { ...profile, recordingAthleteRef: ref }).context.recordingAthleteRef).toBeNull();
});
