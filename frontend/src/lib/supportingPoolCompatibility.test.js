const base = { age: 16, level: "competitive", stroke: "freestyle", goal: "technique", intensity: "recovery", distance: 4000, poolType: "25m", unit: "m", sessionRole: "standalone", equipment: [], includeSprintFinisher: false };
const blocks = ["warm_up", "drill_set", "kick_set", "sprint_or_pace_set", "main_set", "pull_set", "cool_down"];
const paths = [
  ["25-drill-swim", "drill_set", 1], ["cue-by-25", "drill_set", 4],
  ["25-quality", "kick_set", 1], ["broken-kick", "kick_set", 3],
  ["power-25-reset", "kick_set", 4], ["25-pressure", "pull_set", 4],
  ["25-release", "cool_down", 3], ["split", "cool_down", 1],
];

// Fresh history + a fixed random choice visits each template once, in order.
// Exercise the public generator without adding test-only production exports.
function variants(profile) {
  let generateSession;
  jest.isolateModules(() => { generateSession = require("./sessionGenerator").generateSession; });
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  try { return Array.from({ length: 6 }, () => generateSession(profile)); }
  finally { random.mockRestore(); }
}

function prescription(items, pool, unit) {
  let total = 0;
  const stops = [];
  for (const line of items) {
    const rounds = line.match(/^(\d+) rounds:/);
    if (rounds) {
      const terms = [...line.matchAll(/(\d+)x(\d+)(m|yd)\b/g)];
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term[3]).toBe(unit);
        stops.push(+term[2]); total += +rounds[1] * +term[1] * +term[2];
      }
    } else {
      const repeat = line.match(/^(\d+)x(\d+)(m|yd)\b/);
      const continuous = line.match(/^(\d+)(m|yd)\b/);
      if (repeat) { expect(repeat[3]).toBe(unit); stops.push(+repeat[2]); total += +repeat[1] * +repeat[2]; }
      else if (continuous) { expect(continuous[2]).toBe(unit); stops.push(+continuous[1]); total += +continuous[1]; }
    }
  }
  for (const distance of stops) { expect(distance).toBeGreaterThan(0); expect(distance % pool).toBe(0); }
  return total;
}

describe.each([[25, "m"], [50, "m"], [25, "yd"], [50, "yd"]])("%i pool, %s", (pool, unit) => {
  const profile = { ...base, poolType: `${pool}${unit === "yd" ? "y" : "m"}`, unit };
  let generated;
  beforeAll(() => { generated = variants(profile); });
  test.each(paths)("%s preserves allocation and wall stops", (id, key, index) => {
    const session = generated[index];
    const block = session[key];
    expect(prescription(block.items, pool, unit)).toBe(block.distance_m);
    expect(blocks.reduce((sum, k) => sum + session[k].distance_m, 0)).toBe(profile.distance);
    if (pool === 50 && id !== "split") {
      expect(block.items.join(" ")).toContain("continuous");
      expect(block.items.join(" ")).toContain(`no stop at 25${unit}`);
    }
  });

  test("all eight paths handle small, remainder and large UI allocations", () => {
    for (const distance of [1500, 2000, 3000, 5000, 6000]) for (const sessionRole of ["standalone", "build kick/pull emphasis"]) {
      const sessions = variants({ ...profile, distance, sessionRole });
      for (const [, key, index] of paths) {
        const s = sessions[index];
        expect(prescription(s[key].items, pool, unit)).toBe(s[key].distance_m);
        expect(blocks.reduce((sum, k) => sum + s[k].distance_m, 0)).toBe(distance);
      }
    }
  });

  test("preserves existing 25-pool text or explicit continuous 50-pool phase concepts", () => {
    const text = (key, index) => generated[index][key].items.join(" ");
    if (pool === 25) {
      expect(generated[1].drill_set.items[0]).toBe(`20x25${unit} drill/swim skill transfer`);
      expect(generated[4].drill_set.items[0]).toBe(`20x25${unit} one-cue precision`);
      expect(generated[1].kick_set.items.slice(0, 2)).toEqual([`16x25${unit} freestyle kick`, "Cycle 4 reps: easy line · strong line · underwater/streamline focus · fast clean kick."]);
      expect(generated[3].kick_set.items[0]).toBe(`2 rounds: 2x50${unit} strong kick + 4x25${unit} quality kick`);
      expect(generated[4].kick_set.items[0]).toBe(`4 rounds: 2x25${unit} strong kick + 2x25${unit} easy line`);
      expect(generated[4].pull_set.items[0]).toBe(`24x25${unit} freestyle pull catch-pressure focus`);
      expect(generated[3].cool_down.items[0]).toBe(`20x25${unit} very easy release`);
      expect(generated[1].cool_down.items).toEqual([`300${unit} easy freestyle/choice, long relaxed stroke`, `200${unit} choice drill/backstroke easy, deep relaxed breathing`]);
    } else {
      expect(text("drill_set", 1)).toContain(`first 25${unit} drill + second 25${unit} swim`);
      expect(text("drill_set", 4)).toContain(`first 25${unit} focus on the cue + second 25${unit} maintain the same cue`);
      expect(text("kick_set", 1)).toContain(`25${unit} easy line + 25${unit} strong line`);
      expect(text("kick_set", 1)).toContain(`25${unit} streamline/body-line focus + 25${unit} fast clean kick`);
      expect(text("kick_set", 3)).toContain(`first 25${unit} faster quality kick + second 25${unit} easy reset`);
      expect(generated[4].kick_set.items[0]).toBe(`4 rounds: 2x50${unit} continuous power/reset kick`);
      expect(text("pull_set", 4)).toContain(`first 25${unit} smooth pressure + second 25${unit} stronger pressure`);
      expect(text("cool_down", 3)).toContain(`25${unit} long stroke + 25${unit} backstroke; 25${unit} simple drill + 25${unit} long stroke; 25${unit} backstroke + 25${unit} simple drill`);
    }
  });
});

describe.each(["m", "yd"])("50-pool short-quality semantics (%s)", unit => {
  const profile = { ...base, unit, poolType: unit === "m" ? "50m" : "50y" };
  test.each([["power-25-reset", 4, "strong, crisp quality kick", "easy alignment/reset", 100], ["broken-kick", 3, "faster quality kick", "easy reset", 200]])("%s retains 25-unit quality followed by easy work", (id, index, quality, easy, roundDistance) => {
    for (const distance of [1500, 4000, 6000]) for (const sessionRole of ["standalone", "build kick/pull emphasis"]) {
      const session = variants({ ...profile, distance, sessionRole })[index];
      const block = session.kick_set;
      const text = block.items.join(" ");
      const phase = block.items[1].match(/first (\d+)(m|yd) (.*?) \+ second (\d+)(m|yd) ([^;]+);/);
      expect(phase).not.toBeNull();
      expect([+phase[1], phase[2], phase[3], +phase[4], phase[5], phase[6]]).toEqual([25, unit, quality, 25, unit, easy]);
      expect(+phase[1] + +phase[4]).toBe(50);
      expect(text).toContain(`no stop at 25${unit}`);
      expect(text).toContain(`Reset at the wall after completing each 50${unit}`);
      expect(text).not.toMatch(/1x50(?:m|yd) strong|25(?:m|yd) quality kick \+ 25(?:m|yd) quality kick/);
      const roundTerms = [...block.items[0].matchAll(/(\d+)x(\d+)(?:m|yd)/g)];
      expect(roundTerms.reduce((sum, m) => sum + +m[1] * +m[2], 0)).toBe(roundDistance);
      if (id === "power-25-reset") expect(roundTerms.map(m => [+m[1], +m[2]])).toEqual([[2, 50]]);
      else expect(roundTerms.map(m => [+m[1], +m[2]])).toEqual([[1, 100], [2, 50]]);
      expect(prescription(block.items, 50, unit)).toBe(block.distance_m);
      expect(blocks.reduce((sum, key) => sum + session[key].distance_m, 0)).toBe(distance);
    }
  });
  test("25-quality confines underwater work to a real wall push-off, followed by surface kicking", () => {
    const block = variants(profile)[1].kick_set;
    const text = block.items.join(" ");
    expect(text).toContain("Any underwater component starts only from the actual wall push-off");
    expect(text).toContain(`surface for the remainder of the first 25${unit}`);
    expect(text).toContain("then transition to fast kicking without stopping");
    expect(text).toContain(`no stop at 25${unit}`);
    expect(text).not.toMatch(/25(?:m|yd) underwater|push-off at 25|push off at 25/);
    expect(prescription(block.items, 50, unit)).toBe(block.distance_m);
  });
});

test.each(["m", "yd"])("50-pool split fixes former 225/175 and 525/375 prescriptions (%s)", unit => {
  const p = { ...base, unit, poolType: unit === "m" ? "50m" : "50y" };
  const small = variants({ ...p, distance: 3000 })[1].cool_down;
  expect(small.items).toEqual([`200${unit} easy freestyle/choice, long relaxed stroke`, `200${unit} choice drill/backstroke easy, deep relaxed breathing`]);
  const large = variants({ ...p, distance: 6000, sessionRole: "build kick/pull emphasis" })[1].cool_down;
  expect(large.items).toEqual([`500${unit} easy freestyle/choice, long relaxed stroke`, `400${unit} choice drill/backstroke easy, deep relaxed breathing`]);
});
