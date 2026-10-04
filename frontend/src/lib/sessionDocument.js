// Read-only interpretation of the legacy format. Never persist this view.
export const LEGACY_BLOCKS = Object.freeze([
  { key: "warm_up", title: "Warm up" },
  { key: "drill_set", title: "Drill set" },
  { key: "kick_set", title: "Kick set" },
  { key: "sprint_or_pace_set", title: "Speed prep set" },
  { key: "main_set", title: "Main set" },
  { key: "pull_set", title: "Pull set" },
  { key: "cool_down", title: "Cool down" },
].map(Object.freeze));

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value : "";

// Keep array positions (including blank edit lines) so legacy edit indices stay valid.
// Malformed slots become blank in the view, not in the saved source object.
export function readTextItems(value) {
  return Array.isArray(value) ? Array.from(value, text) : [];
}

function numericDistance(value) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const distance = Number(value);
  return Number.isFinite(distance) && distance >= 0 ? distance : undefined;
}

export function readSessionBlocks(session) {
  return LEGACY_BLOCKS.flatMap(({ key, title }) => {
    const block = session?.[key];
    if (!isRecord(block)) return [];
    const distance = numericDistance(block.distance_m) ?? 0;
    const items = readTextItems(block.items);
    if (distance === 0 && items.length === 0) return [];
    return [{
      key,
      generatedKey: key,
      kind: "workout",
      source: "generated",
      // The legacy UI uses canonical labels, not the stored block.title.
      title,
      distance,
      items,
      energySystem: text(block.energy_system),
    }];
  });
}

export function sumSessionBlockDistances(session) {
  return readSessionBlocks(session).reduce((sum, block) => sum + block.distance, 0);
}

export function readSessionTotalDistance(session, profile) {
  const declared = numericDistance(session?.total_distance_m);
  if (declared !== undefined) return declared;
  // Existing blocks, including hidden zero blocks, provide a better fallback
  // than the requested target. Only use the target when no legacy blocks exist.
  if (LEGACY_BLOCKS.some(({ key }) => isRecord(session?.[key]))) {
    return sumSessionBlockDistances(session);
  }
  return numericDistance(profile?.distance) ?? 0;
}

export function readSessionDocument(session, profile) {
  const brain = session?.coach_brain;
  return {
    blocks: readSessionBlocks(session),
    totalDistance: readSessionTotalDistance(session, profile),
    unit: profile?.unit === "yd" ? "yd" : "m",
    summary: text(session?.summary),
    coachingPoints: readTextItems(session?.coaching_points),
    coachBrain: isRecord(brain) ? {
      ...Object.fromEntries(Object.entries(brain).map(([key, value]) => [key, text(value)])),
      coach_adjustment_prompts: readTextItems(brain.coach_adjustment_prompts),
    } : null,
  };
}
