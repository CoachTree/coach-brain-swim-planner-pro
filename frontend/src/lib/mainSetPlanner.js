// Numeric planning is internal: only rendered strings leave the generator.
const CAPS = { 25: 20, 50: 12, 100: 8 };
const PREFERRED = { 25: [4, 8], 50: [4, 6], 100: [2, 4] };
const recentPlans = new Map();

export function mainSetContext(profile, distance) {
  const pool = profile.poolType?.startsWith("50") ? 50 : 25;
  if (!Number.isInteger(distance) || distance <= 0 || distance % pool !== 0) {
    throw new Error("Main Set distance must be a positive whole number of pool lengths.");
  }
  return { ...profile, distance, pool, mode: profile.intensity === "recovery" ? "recovery" : "technique" };
}

export function eligibleMainSetFamilies(context) {
  const short = context.pool;
  const medium = context.pool === 25 ? 50 : 100;
  const recovery = context.mode === "recovery";
  const families = [
    { id: "short-medium", roles: recovery ? ["reset", "integration"] : ["drill", "swim"], distances: [short, medium] },
    { id: "reset-integrate", roles: recovery ? ["reset", "integration"] : ["skill", "integration"], distances: [short, 100] },
    { id: "three-stage", roles: recovery ? ["reset", "relaxed", "integration"] : ["drill", "swim", "integration"], distances: [short, 50, 100] },
    { id: "split-transfer", roles: recovery ? ["reset", "choice"] : ["split", "integration"], distances: [50, 100] },
    { id: "cue-progression", roles: ["skill", "integration"], distances: [50, 100] },
  ];
  // Beginners retain one cue and two tasks; higher levels may transfer through three.
  return families.filter(f => context.level !== "beginner" || f.roles.length === 2).map(f => ({
    ...f,
    roles: f.roles.map(role => {
      if (context.stroke !== "butterfly") return role;
      if (role === "swim") return "integration";
      if (role === "relaxed") return f.id === "short-medium" ? "reset" : "integration";
      return role;
    }),
  }));
}

function segment(repeats, distance, task) {
  return { repeats, distance, task };
}

function blockDistance(block) {
  return block.rounds * block.segments.reduce((sum, s) => sum + s.repeats * s.distance, 0);
}

const TASK_STAGE = { reset: 0, drill: 0, skill: 0, split: 0, relaxed: 1, swim: 1, integration: 2, choice: 2 };

function progressiveBlocks(rounds, segments) {
  if (rounds < 4 || rounds > 6) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  // These repeat distances divide 100. Move one longer repeat's distance
  // from focused work to transfer/integration without changing round volume.
  const transfer = Math.max(first.distance, last.distance);
  const later = segments.map(s => ({ ...s }));
  later[0].repeats -= transfer / first.distance;
  later[later.length - 1].repeats += transfer / last.distance;
  if (later[0].repeats < 1 || later[later.length - 1].repeats > CAPS[last.distance]) return null;
  const earlyRounds = Math.ceil(rounds / 2);
  return [
    { rounds: earlyRounds, segments, emphasis: "Establish the technical cue before transferring it into swimming." },
    { rounds: rounds - earlyRounds, segments: later, emphasis: "Briefly revisit the same cue, then spend more distance applying it in swimming; keep the same effort." },
  ];
}

export function fitMainSetFamily(family, context) {
  const candidates = [];
  function enumerate(segments) {
    if (segments.length < family.roles.length) {
      const index = segments.length;
      const distance = family.distances[index];
      for (let repeats = 1; repeats <= PREFERRED[distance][1]; repeats++) {
        enumerate([...segments, segment(repeats, distance, family.roles[index])]);
      }
      return;
    }
    const roundDistance = blockDistance({ rounds: 1, segments });
    for (let rounds = 1; rounds <= Math.min(8, Math.floor(context.distance / roundDistance)); rounds++) {
      const remainder = context.distance - rounds * roundDistance;
      if (remainder > 100) continue;
      const progression = context.distance >= 1000 ? progressiveBlocks(rounds, segments) : null;
      const blocks = progression || [{ rounds, segments }];
      if (remainder) {
        // Finish by applying the cue, not returning to isolated drill work.
        const rep = [100, 50, 25].find(d => d >= context.pool && remainder % d === 0);
        blocks.push({ rounds: 1, segments: [segment(remainder / rep, rep, "integration")] });
      }
      const score = segments.reduce((sum, s) => {
        const [low, high] = PREFERRED[s.distance];
        return sum + Math.max(0, low - s.repeats) * 4 + Math.abs(s.repeats - (low + high) / 2);
      }, 0) + (remainder ? 5 : 0) + Math.max(0, rounds - 4) * 3;
      candidates.push({ familyId: family.id, blocks, score });
    }
  }
  enumerate([]);
  // Quality outranks freshness: do not fall back to four identical rounds just
  // because the cleaner candidates have appeared recently.
  const clean = candidates.filter(p => p.blocks.every(b => b.rounds <= 3));
  return context.distance >= 1000 && clean.length ? clean : candidates;
}

export function validateMainSetPlan(plan, context) {
  let total = 0;
  let previous = null;
  const tasks = new Set();
  const distances = new Set();
  for (const block of plan.blocks) {
    if (!Number.isInteger(block.rounds) || block.rounds < 1) throw new Error("Invalid round count.");
    let stage = -1;
    for (const s of block.segments) {
      if (TASK_STAGE[s.task] === undefined || TASK_STAGE[s.task] < stage) throw new Error("Technical tasks must progress toward integration.");
      stage = TASK_STAGE[s.task];
    }
    for (let round = 0; round < block.rounds; round++) {
      for (const s of block.segments) {
        if (!Number.isInteger(s.repeats) || s.repeats < 1 || !CAPS[s.distance] || s.distance % context.pool !== 0) {
          throw new Error("Invalid Main Set segment.");
        }
        const count = previous?.task === s.task && previous?.distance === s.distance ? previous.count + s.repeats : s.repeats;
        if (count > CAPS[s.distance]) throw new Error("Uninterrupted repetition cap exceeded.");
        previous = { task: s.task, distance: s.distance, count };
        tasks.add(s.task);
        distances.add(s.distance);
        total += s.repeats * s.distance;
      }
    }
  }
  if (total !== context.distance) throw new Error("Main Set distance mismatch.");
  if (TASK_STAGE[plan.blocks[0]?.segments[0]?.task] !== 0) throw new Error("Start with focused technical work.");
  if (context.distance >= 300 && (tasks.size < 2 || distances.size < 2)) throw new Error("Main Set needs meaningful variation.");
  return total;
}

export function planStructuredMainSet(profile, distance, selectFamily) {
  const context = mainSetContext(profile, distance);
  const families = eligibleMainSetFamilies(context).map(f => ({ ...f, plans: fitMainSetFamily(f, context) })).filter(f => f.plans.length);
  let plan;
  if (!families.length) {
    // Only tiny allocations need this; never force a full round into insufficient space.
    if (distance >= 300) throw new Error("No compatible structured Main Set.");
    const segments = [segment(1, context.pool, "reset")];
    if (distance > context.pool) segments.push(segment(distance / context.pool - 1, context.pool, "integration"));
    plan = { familyId: "small-reset", blocks: [{ rounds: 1, segments }] };
  } else {
    const family = selectFamily ? selectFamily(families) : families[Math.floor(Math.random() * families.length)];
    const key = JSON.stringify([context.mode, context.goal, context.intensity, context.stroke, context.level, context.pool, distance]);
    const recent = recentPlans.get(key) || [];
    // Ignore wording/task labels here: prefer genuinely different numeric layouts
    // even when two families can fit the same round structure.
    const signature = p => JSON.stringify(p.blocks.map(b => [b.rounds, b.segments.map(s => [s.repeats, s.distance])]));
    const fresh = family.plans.filter(p => !recent.includes(signature(p)));
    const available = fresh.length ? fresh : family.plans;
    const best = Math.min(...available.map(p => p.score));
    const preferred = available.filter(p => p.score <= best + 1);
    plan = preferred[Math.floor(Math.random() * preferred.length)];
    recentPlans.delete(key);
    recentPlans.set(key, [signature(plan), ...recent].slice(0, 5));
    if (recentPlans.size > 128) recentPlans.delete(recentPlans.keys().next().value);
  }
  validateMainSetPlan(plan, context);
  return plan;
}

function taskText(task, distance, context, unit) {
  const recovery = context.mode === "recovery";
  const effort = recovery ? "very easy, relaxed" : context.intensity === "easy" ? "easy, controlled" : "controlled technical effort, never maximal";
  const stroke = context.stroke === "IM" ? "one IM stroke at a time" : context.stroke;
  const cue = context.level === "beginner" ? "one simple body-line cue" : context.level === "elite" ? "precise alignment and repeatable stroke timing" : "consistent alignment and stroke timing";
  if (task === "integration" || task === "choice") return `${effort} freestyle/choice integration; carry the same cue into relaxed swimming${context.stroke === "butterfly" ? " (no continuous butterfly)" : ""}`;
  if (context.stroke === "butterfly" || task === "split" || (context.pool === 50 && ["drill", "skill", "reset"].includes(task))) {
    const action = ["drill", "reset", "split"].includes(task) ? "simple drill" : "controlled technique";
    return `continuous ${distance}${unit}: first 25${unit} ${stroke} ${action}, remaining ${distance - 25}${unit} relaxed freestyle; no stop at 25${unit}; ${effort}; ${cue}`;
  }
  const actions = { relaxed: "relaxed swimming", reset: "simple technique reset", drill: "simple drill", skill: "focused skill work", swim: "whole-stroke technical swimming" };
  return `${stroke} ${actions[task]}; ${effort}; ${cue}`;
}

export function renderMainSetPlan(plan, profile, distance, unit) {
  const context = mainSetContext(profile, distance);
  validateMainSetPlan(plan, context);
  const items = [];
  for (const [index, block] of plan.blocks.entries()) {
    items.push(`Block ${index + 1} — ${block.rounds} round${block.rounds === 1 ? "" : "s"} (${blockDistance(block) / block.rounds}${unit} per round; ${blockDistance(block)}${unit} total):`);
    if (block.emphasis) items.push(block.emphasis);
    for (const s of block.segments) {
      // A 25-length butterfly repeat is a short standalone task, not a zero-length split.
      const text = context.stroke === "butterfly" && s.distance === 25 && !["integration", "choice"].includes(s.task)
        ? `short butterfly drill / controlled skill; ${context.mode === "recovery" ? "very easy, relaxed" : "controlled, never maximal"}; restore rhythm in the integration swimming`
        : taskText(s.task, s.distance, context, unit);
      items.push(`  ${s.repeats}x${s.distance}${unit} ${text}`);
    }
    items.push(context.mode === "recovery" ? "Rest as needed between repeats and rounds; keep breathing relaxed throughout." : "Reset between tasks and rounds; preserve the same technical cue rather than chasing speed.");
  }
  return items;
}
