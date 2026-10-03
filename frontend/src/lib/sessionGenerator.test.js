import { generateSession } from "./sessionGenerator";
import { mainSetContext, eligibleMainSetFamilies, fitMainSetFamily, planStructuredMainSet, renderMainSetPlan, validateMainSetPlan } from "./mainSetPlanner";

const base = { age: 16, level: "competitive", stroke: "freestyle", goal: "technique", intensity: "recovery", distance: 4000, poolType: "25m", unit: "m", sessionRole: "standalone", equipment: [], includeSprintFinisher: false };
const levels = ["beginner", "intermediate", "competitive", "elite"];
const strokes = ["freestyle", "backstroke", "breaststroke", "butterfly", "IM"];
const totals = [1500, 2000, 3000, 4000, 5000, 6000];
const blocks = ["warm_up", "drill_set", "kick_set", "sprint_or_pace_set", "main_set", "pull_set", "cool_down"];

// Parse the prescription independently of the planner's distance accounting.
function inspectRendered(items, pool, expected, unit) {
  let total = 0, rounds = 0, perRound = 0, statedRound = 0, statedBlock = 0;
  const distances = new Set();
  function finish() {
    if (!rounds) return;
    expect(perRound).toBe(statedRound);
    expect(perRound * rounds).toBe(statedBlock);
    total += perRound * rounds;
  }
  for (const line of items) {
    const header = line.match(/^Block \d+ — (\d+) rounds? \((\d+)(m|yd) per round; (\d+)(m|yd) total\):$/);
    if (header) {
      finish();
      rounds = Number(header[1]); perRound = 0; statedRound = Number(header[2]); statedBlock = Number(header[4]);
      expect(header[3]).toBe(unit); expect(header[5]).toBe(unit);
      continue;
    }
    const repeat = line.match(/^  (\d+)x(\d+)(m|yd) /);
    if (repeat) {
      const count = Number(repeat[1]), distance = Number(repeat[2]);
      expect(repeat[3]).toBe(unit);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual({ 25: 20, 50: 12, 100: 8 }[distance]);
      expect(distance % pool).toBe(0);
      perRound += count * distance;
      distances.add(distance);
      if (line.includes("continuous" ) && line.includes("first 25")) {
        const phases = line.match(/first 25(?:m|yd).*remaining (\d+)(?:m|yd)/);
        expect(Number(phases[1]) + 25).toBe(distance);
        expect(line).toContain(`no stop at 25${unit}`);
      }
    }
  }
  finish();
  expect(total).toBe(expected);
  if (expected >= 300) expect(distances.size).toBeGreaterThanOrEqual(2);
}

test("reported 1400m main never becomes an uninterrupted 56x25, 28x50 or 14x100", () => {
  for (let i = 0; i < 20; i++) {
    const s = generateSession(base);
    expect(s.main_set.distance_m).toBe(1400);
    inspectRendered(s.main_set.items, 25, 1400, "m");
    expect(s.main_set.items.join("\n")).not.toMatch(/\b(?:56x25|28x50|14x100)m/);
    expect(Object.keys(s.main_set).sort()).toEqual(["distance_m", "energy_system", "items", "title"]);
  }
});

test.each(["recovery", "easy", "moderate", "hard"])("%s: all totals, pools, units, strokes and levels preserve distance and caps", intensity => {
  for (const distance of totals) for (const pool of [25, 50]) for (const unit of ["m", "yd"]) for (const level of levels) for (const stroke of strokes) {
    const p = { ...base, intensity, distance, poolType: `${pool}${unit === "yd" ? "y" : "m"}`, unit, level, stroke };
    const s = generateSession(p);
    expect(blocks.reduce((sum, key) => sum + s[key].distance_m, 0)).toBe(distance);
    expect(s.total_distance_m).toBe(distance);
    inspectRendered(s.main_set.items, pool, s.main_set.distance_m, unit);
    if (intensity === "recovery") expect(s.main_set.items.join(" ")).not.toMatch(/MAX|race pace|strong|descend|95-/);
  }
});

test.each(["recovery", "moderate"])("every %s family fits awkward allocations in metres and yards", intensity => {
  for (const pool of [25, 50]) for (const unit of ["m", "yd"]) {
    const p = { ...base, intensity, poolType: `${pool}${unit === "yd" ? "y" : "m"}`, unit };
    for (const distance of [300, 350, 550, 700, 1400, 2200]) {
      const context = mainSetContext(p, distance);
      const families = eligibleMainSetFamilies(context);
      expect(families).toHaveLength(5);
      for (const family of families) {
        const plan = planStructuredMainSet(p, distance, available => available.find(f => f.id === family.id));
        expect(plan.familyId).toBe(family.id);
        expect(new Set(plan.blocks.flatMap(b => b.segments.map(s => s.task))).size).toBeGreaterThanOrEqual(2);
        expect(validateMainSetPlan(plan, context)).toBe(distance);
        inspectRendered(renderMainSetPlan(plan, p, distance, unit), pool, distance, unit);
      }
    }
  }
});

test("small allocations and single-length remainders are exact; invalid pool distances fail explicitly", () => {
  for (const pool of [25, 50]) for (const distance of [pool, pool * 2, pool * 3, pool * 5, pool * 13, pool * 29]) {
    const p = { ...base, poolType: `${pool}m` };
    const plan = planStructuredMainSet(p, distance);
    inspectRendered(renderMainSetPlan(plan, p, distance, "m"), pool, distance, "m");
  }
  for (const distance of [0, -25, 26, 125]) expect(() => planStructuredMainSet({ ...base, poolType: "50m" }, distance)).toThrow();
});

test("beginner complexity is limited to two tasks per round, while advanced families allow three", () => {
  for (const level of levels) {
    const families = eligibleMainSetFamilies(mainSetContext({ ...base, level }, 1400));
    expect(families.some(f => f.roles.length === 3)).toBe(level !== "beginner");
    const plan = planStructuredMainSet({ ...base, level }, 1400);
    const text = renderMainSetPlan(plan, { ...base, level }, 1400, "m").join(" ");
    if (level === "beginner") expect(text).toContain("one simple body-line cue");
  }
});

test("butterfly work stays short and integration remains freestyle/choice in every family", () => {
  for (const intensity of ["recovery", "moderate"]) for (const pool of [25, 50]) {
    const p = { ...base, intensity, stroke: "butterfly", poolType: `${pool}m` };
    for (const family of eligibleMainSetFamilies(mainSetContext(p, 1400))) {
      const plan = planStructuredMainSet(p, 1400, fs => fs.find(f => f.id === family.id));
      const items = renderMainSetPlan(plan, p, 1400, "m");
      expect(items.some(line => line.includes("freestyle/choice integration"))).toBe(true);
      for (const line of items.filter(line => /^  \d+x/.test(line))) {
        if (line.includes("freestyle/choice integration")) continue;
        if (/x25m /.test(line)) expect(line).toContain("short butterfly drill / controlled skill");
        else { expect(line).toContain("first 25m butterfly"); expect(line).toContain("relaxed freestyle; no stop at 25m"); }
      }
    }
  }
});

test("build and race precedence remains above recovery and technique; sprint/endurance remain outside planner", () => {
  for (const p of [
    { ...base, sessionRole: "build kick/pull emphasis" },
    { ...base, goal: "race preparation" },
    { ...base, intensity: "race pace" },
    { ...base, goal: "sprint", intensity: "moderate" },
    { ...base, goal: "endurance", intensity: "moderate" },
  ]) expect(generateSession(p).main_set.items.some(line => line.startsWith("Block "))).toBe(false);
  for (const goal of ["technique", "endurance", "sprint"]) {
    const s = generateSession({ ...base, goal });
    inspectRendered(s.main_set.items, 25, s.main_set.distance_m, "m");
  }
  for (const poolType of ["25m", "50m"]) {
    const s = generateSession({ ...base, poolType, includeSprintFinisher: true });
    expect(blocks.reduce((sum, k) => sum + s[k].distance_m, 0)).toBe(4000);
    inspectRendered(s.main_set.items, Number(poolType.slice(0, 2)), s.main_set.distance_m, "m");
  }
});

test("repeated generation changes numeric structure even within one family", () => {
  const signatures = [];
  for (let i = 0; i < 5; i++) {
    const plan = planStructuredMainSet(base, 1400, fs => fs.find(f => f.id === "short-medium"));
    signatures.push(JSON.stringify(plan.blocks));
  }
  expect(new Set(signatures).size).toBe(5);
  for (const poolType of ["25m", "50m"]) {
    const plans = Array.from({ length: 5 }, () => planStructuredMainSet({ ...base, poolType, stroke: "butterfly", intensity: "moderate" }, 1400));
    const numeric = plans.map(p => JSON.stringify(p.blocks.map(b => [b.rounds, b.segments.map(s => [s.repeats, s.distance])])));
    expect(new Set(numeric).size).toBe(5);
  }
  const sessions = Array.from({ length: 5 }, () => generateSession(base));
  expect(new Set(sessions.map(s => s.main_set.items.filter(line => /^Block|^  \d+x/.test(line)).map(line => line.replace(/ (?:freestyle|very easy).*$/, "")).join("\n"))).size).toBeGreaterThan(1);
});

test("validation rejects oversize counts, adjacent identical work, pool mismatch and incorrect totals", () => {
  const context = mainSetContext(base, 1400);
  for (const segments of [
    [{ repeats: 56, distance: 25, task: "skill" }],
    [{ repeats: 28, distance: 50, task: "skill" }],
    [{ repeats: 14, distance: 100, task: "skill" }],
    [{ repeats: 12, distance: 50, task: "skill" }, { repeats: 12, distance: 50, task: "skill" }],
    [{ repeats: 1, distance: 100, task: "skill" }],
  ]) expect(() => validateMainSetPlan({ blocks: [{ rounds: 1, segments }] }, context)).toThrow();
  expect(() => validateMainSetPlan({ blocks: [{ rounds: 1, segments: [{ repeats: 2, distance: 25, task: "skill" }] }] }, mainSetContext({ ...base, poolType: "50m" }, 50))).toThrow();
});

test.each(["recovery", "moderate"])("%s quality: focused start and no four identical rounds across large allocations", intensity => {
  const stage = { reset: 0, drill: 0, skill: 0, split: 0, relaxed: 1, swim: 1, integration: 2, choice: 2 };
  for (const pool of [25, 50]) for (const level of levels) for (const stroke of strokes) {
    const p = { ...base, intensity, poolType: `${pool}m`, level, stroke };
    for (const distance of [1000, 1025, 1050, 1375, 1400, 2175, 2200].filter(d => d % pool === 0)) {
      for (const family of eligibleMainSetFamilies(mainSetContext(p, distance))) {
        const plan = planStructuredMainSet(p, distance, fs => fs.find(f => f.id === family.id));
        expect(stage[plan.blocks[0].segments[0].task]).toBe(0);
        expect(plan.blocks.every(b => b.rounds <= 3)).toBe(true);
        for (const block of plan.blocks) {
          const stages = block.segments.map(s => stage[s.task]);
          expect(stages).toEqual([...stages].sort());
        }
        if (plan.blocks[0].emphasis) {
          const [early, late] = plan.blocks;
          expect(late.segments[0].repeats).toBeLessThan(early.segments[0].repeats);
          expect(late.segments.at(-1).repeats).toBeGreaterThan(early.segments.at(-1).repeats);
          expect(late.emphasis).toContain("same effort");
        }
        const last = plan.blocks.at(-1);
        if (last.segments.length === 1 && plan.blocks.length > 1) expect(last.segments[0].task).toBe("integration");
        inspectRendered(renderMainSetPlan(plan, p, distance, "m"), pool, distance, "m");
      }
    }
  }
});

test("clean two/three rounds remain eligible and small sets do not gain artificial progression blocks", () => {
  const context = mainSetContext(base, 1400);
  const family = eligibleMainSetFamilies(context).find(f => f.id === "split-transfer");
  const candidates = fitMainSetFamily(family, context);
  for (const rounds of [2, 3]) expect(candidates.some(p => p.blocks[0].rounds === rounds && !p.blocks[0].emphasis)).toBe(true);
  for (const pool of [25, 50]) for (const distance of [pool, pool * 2, pool * 3, 200, 250]) {
    const p = { ...base, poolType: `${pool}m` };
    const plan = planStructuredMainSet(p, distance);
    expect(plan.blocks.length).toBeLessThanOrEqual(2);
    expect(plan.blocks.every(b => !b.emphasis)).toBe(true);
    inspectRendered(renderMainSetPlan(plan, p, distance, "m"), pool, distance, "m");
  }
});

test("quality validator rejects integration-first and backwards progression", () => {
  const context = mainSetContext(base, 350);
  for (const segments of [
    [{ repeats: 2, distance: 100, task: "integration" }, { repeats: 6, distance: 25, task: "reset" }],
    [{ repeats: 2, distance: 25, task: "reset" }, { repeats: 2, distance: 100, task: "integration" }, { repeats: 4, distance: 25, task: "skill" }],
  ]) expect(() => validateMainSetPlan({ blocks: [{ rounds: 1, segments }] }, context)).toThrow();
});
