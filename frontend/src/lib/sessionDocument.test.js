import { LEGACY_BLOCKS, readSessionBlocks, readSessionDocument, readSessionTotalDistance, sumSessionBlockDistances } from "./sessionDocument";

const keys = ["warm_up", "drill_set", "kick_set", "sprint_or_pace_set", "main_set", "pull_set", "cool_down"];
const titles = ["Warm up", "Drill set", "Kick set", "Speed prep set", "Main set", "Pull set", "Cool down"];
const legacy = () => ({
  session_id: "legacy-session",
  total_distance_m: 1000,
  ...Object.fromEntries(keys.map((key, i) => [key, { title: "Stored title was not displayed", distance_m: [100, 100, 100, 100, 400, 100, 100][i], items: [`${key} prescription`, "Keep relaxed"], energy_system: "A1" }])),
});
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("seven legacy blocks retain deterministic identity, canonical titles and order", () => {
  const session = legacy();
  const blocks = readSessionBlocks(session);
  expect(blocks.map(b => b.key)).toEqual(keys);
  expect(blocks.map(b => b.title)).toEqual(titles);
  expect(blocks.map(b => b.generatedKey)).toEqual(keys);
  blocks.forEach(b => {
    expect(b.kind).toBe("workout"); expect(b.source).toBe("generated");
    expect(b.items).toEqual(session[b.key].items); expect(b.energySystem).toBe("A1");
  });
  expect(readSessionBlocks(Object.fromEntries(Object.entries(session).reverse()))).toEqual(blocks);
  expect(LEGACY_BLOCKS.map(b => b.key)).toEqual(keys);
});

test.each([
  ["missing", undefined, false],
  ["optional empty Speed Prep", { distance_m: 0, items: [] }, false],
  ["populated Speed Prep", { distance_m: 100, items: ["4x25"] }, true],
  ["zero populated", { distance_m: 0, items: ["Relax before main"] }, true],
  ["zero blank edit line", { distance_m: 0, items: [""] }, true],
  ["missing items", { distance_m: 100 }, true],
  ["zero missing items", { distance_m: 0 }, false],
  ["malformed block", "not a block", false],
])("%s visibility", (_, block, visible) => {
  const session = { ...legacy(), sprint_or_pace_set: block };
  expect(readSessionBlocks(session).some(b => b.key === "sprint_or_pace_set")).toBe(visible);
});

test.each([undefined, null, {}, "4x50", 123])("non-array items %p safely become an empty view", items => {
  expect(readSessionBlocks({ main_set: { distance_m: 200, items } })[0].items).toEqual([]);
});

test("malformed array slots are blank without shifting edit indices or changing strings", () => {
  const items = [" 4x50 ", null, { text: "unsafe" }, 4, ["nested"], "", "Cue"];
  expect(readSessionBlocks({ main_set: { items } })[0].items).toEqual([" 4x50 ", "", "", "", "", "", "Cue"]);
});

test.each([undefined, null, "", "bad", {}, [], true, NaN, Infinity, -25])("malformed distance %p becomes zero", distance_m => {
  expect(readSessionBlocks({ main_set: { distance_m, items: ["Cue"] } })[0].distance).toBe(0);
});

test("numeric strings in old records are interpreted numerically", () => {
  expect(readSessionBlocks({ main_set: { distance_m: "200", items: [] } })[0].distance).toBe(200);
  expect(readSessionTotalDistance({ total_distance_m: "200" })).toBe(200);
});

test.each(["m", "yd"])("legacy saved record in %s preserves values without unit conversion", unit => {
  const saved = { id: "record-1", name: "Old session", session: legacy(), profile: { unit, distance: 1000 } };
  const document = readSessionDocument(saved.session, saved.profile);
  expect(document.unit).toBe(unit);
  expect(document.totalDistance).toBe(1000);
  expect(document.blocks.map(b => b.distance)).toEqual([100, 100, 100, 100, 400, 100, 100]);
});

test("legitimate declared total is preserved even if block sum differs", () => {
  const session = { ...legacy(), total_distance_m: 1200 };
  expect(readSessionTotalDistance(session, { distance: 4000 })).toBe(1200);
  expect(sumSessionBlockDistances(session)).toBe(1000);
  expect(session.total_distance_m).toBe(1200);
});

test("all-zero session remains zero instead of falling back to target", () => {
  const session = { total_distance_m: 0, ...Object.fromEntries(keys.map(key => [key, { distance_m: 0, items: [] }])) };
  expect(readSessionDocument(session, { distance: 4000 }).totalDistance).toBe(0);
  expect(readSessionBlocks(session)).toEqual([]);
  delete session.total_distance_m;
  expect(readSessionTotalDistance(session, { distance: 4000 })).toBe(0);
});

test("missing/invalid total sums existing blocks, otherwise uses valid target or zero", () => {
  expect(readSessionTotalDistance({ ...legacy(), total_distance_m: "bad" }, { distance: 4000 })).toBe(1000);
  expect(readSessionTotalDistance({}, { distance: 4000 })).toBe(4000);
  expect(readSessionTotalDistance(null, { distance: "bad" })).toBe(0);
});

test("reading frozen input never mutates it or exposes mutable items", () => {
  const input = freeze({ ...legacy(), unknown: { nested: true }, coaching_points: ["Cue"], coach_brain: { objective: "Focus", coach_adjustment_prompts: ["Observe"] } });
  const before = JSON.stringify(input);
  const document = readSessionDocument(input, { unit: "yd" });
  document.blocks[0].items.push("new"); document.coachingPoints.push("new"); document.coachBrain.coach_adjustment_prompts.push("new");
  expect(JSON.stringify(input)).toBe(before);
  expect(input.editor).toBeUndefined();
});

test("known text metadata is safe and unknown properties do not affect traversal", () => {
  const document = readSessionDocument({ ...legacy(), summary: {}, coaching_points: [null, "Safe"], coach_brain: { objective: {}, coach_adjustment_prompts: {} }, arbitrary: { items: ["not a block"] } });
  expect(document.summary).toBe(""); expect(document.coachingPoints).toEqual(["", "Safe"]);
  expect(document.coachBrain.objective).toBe(""); expect(document.coachBrain.coach_adjustment_prompts).toEqual([]);
  expect(document.blocks).toHaveLength(7);
});
