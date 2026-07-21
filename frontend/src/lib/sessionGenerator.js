import { generateCoachBrain } from "./coachBrain";
/**
 * Rule-based local swim training session generator.
 *
 * Pure JavaScript — no network, no LLM, no external dependencies.
 * Returns the same shape the previous /api/generate-session endpoint returned,
 * so SessionResult / PDF / Copy / Edit / Share all continue to work unchanged.
 *
 * Inputs (profile):
 *   age           : number (4-99)
 *   level         : "beginner" | "intermediate" | "competitive" | "elite"
 *   stroke        : "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "IM"
 *   goal          : "endurance" | "sprint" | "technique" | "race preparation"
 *   distance      : 1500|2000|3000|4000|5000|6000  (in the chosen unit)
 *   intensity     : "recovery" | "easy" | "moderate" | "hard" | "race pace"
 *   poolType      : "25m" | "50m" | "25y" | "50y"
 *   unit          : "m" | "yd"
 *   equipment     : array of equipment ids
 *   paceTarget?   : { race_distance: number, target_seconds: number }
 */

const BLOCK_KEYS = [
  "warm_up",
  "drill_set",
  "kick_set",
  "sprint_or_pace_set",
  "main_set",
  "pull_set",
  "cool_down",
];

// -------- coach-quality block distribution --------
// Default model follows Yuji's preferred 4000m structure:
// Warm up 600 / Drill 500 / Kick 400 / Speed prep 200 / Main 1200 / Pull 600 / Down 500.
// For other total distances, scale from this structure while keeping pull in a realistic range.
const TEMPLATE_4000 = {
  warm_up: 600,
  drill_set: 500,
  kick_set: 400,
  sprint_or_pace_set: 200,
  main_set: 1200,
  pull_set: 600,
  cool_down: 500,
};

const TEMPLATE_RATIO = {
  warm_up: 0.15,
  drill_set: 0.125,
  kick_set: 0.10,
  sprint_or_pace_set: 0.05,
  main_set: 0.30,
  pull_set: 0.15,
  cool_down: 0.125,
};

function clampPullVolume(total, value) {
  // Pull should usually be 400-800m for 3000m+ sessions.
  // Smaller sessions need a reduced pull block so the main work is not squeezed out.
  if (total >= 3000) return Math.max(400, Math.min(800, value));
  if (total >= 2000) return Math.max(300, Math.min(600, value));
  return Math.max(200, Math.min(400, value));
}

function isBuildKickPull(profile) {
  return profile.sessionRole === "build kick/pull emphasis";
}

function isTaperLike(profile) {
  return profile.sessionRole === "taper" || profile.sessionRole === "race week";
}

// cool-down volume floors / ceilings by level (in chosen unit)
const COOL_DOWN_RANGE = {
  beginner:     [100, 300],
  intermediate: [150, 400],
  competitive:  [200, 600],
  elite:        [400, 800],
};

// energy system per block, by intensity
const ENERGY = {
  recovery:    { warm_up: "REC", kick_set: "A1", drill_set: "A1", pull_set: "A1",  main_set: "A1",  sprint_or_pace_set: "REC", cool_down: "REC" },
  easy:        { warm_up: "A1",  kick_set: "A2", drill_set: "A1", pull_set: "EN1", main_set: "EN1", sprint_or_pace_set: "A2",  cool_down: "REC" },
  moderate:    { warm_up: "A1",  kick_set: "A2", drill_set: "A1", pull_set: "EN1", main_set: "EN2", sprint_or_pace_set: "SP1", cool_down: "REC" },
  hard:        { warm_up: "A2",  kick_set: "A2", drill_set: "A1", pull_set: "EN2", main_set: "EN3", sprint_or_pace_set: "SP2", cool_down: "REC" },
  "race pace": { warm_up: "A1",  kick_set: "A2", drill_set: "A1", pull_set: "EN1", main_set: "RP",  sprint_or_pace_set: "SP1", cool_down: "REC" },
};

// ---- send-off baselines (seconds per 100 in chosen unit) ----
const SEND_BASE_100 = {
  beginner: 150,
  intermediate: 120,
  competitive: 90,
  elite: 80,
};
const SEND_INTENSITY_OFFSET = {
  recovery: 30,
  easy: 15,
  moderate: 5,
  hard: -5,
  "race pace": -10,
};

// ---- stroke drills ----
const DRILLS = {
  freestyle:   ["catch-up", "fingertip drag", "6-kick-switch", "single-arm", "scull-and-swim"],
  backstroke:  ["single-arm back", "double-arm back", "6-kick-switch back", "head-lead back"],
  breaststroke:["2-kick-1-pull", "pull-pull-kick", "underwater pull-outs", "head-up breast"],
  butterfly:   ["1-arm fly", "3-strokes-1-breath", "fly kick on side", "scull-and-fly"],
  IM:          ["IM transitions", "stroke-by-stroke build", "25 of each stroke"],
};

// ---- helpers ----
function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN(arr, n, rng = Math.random) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function send100(level, intensity) {
  const base = SEND_BASE_100[level] ?? 120;
  const off = SEND_INTENSITY_OFFSET[intensity] ?? 0;
  return fmtTime(base + off);
}
function send50(level, intensity) {
  const base = (SEND_BASE_100[level] ?? 120) / 2;
  const off = (SEND_INTENSITY_OFFSET[intensity] ?? 0) / 2;
  return fmtTime(base + off);
}
function send200(level, intensity) {
  const base = (SEND_BASE_100[level] ?? 120) * 2;
  const off = (SEND_INTENSITY_OFFSET[intensity] ?? 0) * 2;
  return fmtTime(base + off);
}

function poolSize(profile) {
  return profile.poolType?.startsWith("50") ? 50 : 25;
}

function roundStep(profile) {
  // 25m/y pool -> multiples of 25; 50m/y pool -> multiples of 100 for block totals.
  // This prevents continuous 150/350/450/650 type leftovers that finish at the far end.
  return poolSize(profile) === 50 ? 100 : 25;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function strokeWord(profile) {
  const s = profile.stroke;
  if (s === "IM") return "IM";
  return s; // already lowercase
}

// ---- volume allocation ----
function allocateVolumes(profile) {
  const total = Number(profile.distance);
  const step = roundStep(profile);
  const scaled = {};

  // Scale from the 4000m coaching template, then round to pool-friendly block totals.
  BLOCK_KEYS.forEach((k) => {
    const base = TEMPLATE_4000[k] || total * TEMPLATE_RATIO[k];
    scaled[k] = roundTo(base * (total / 4000), step);
  });

  // Season-linked session templates. In Build phase, Yuji prefers 1-2 weekly sessions that emphasise
  // kick and pull for variety and part-strength development instead of only swimming volume.
  if (isBuildKickPull(profile)) {
    scaled.warm_up = roundTo(total * 0.15, step);
    scaled.drill_set = roundTo(total * 0.10, step);
    scaled.kick_set = roundTo(total * 0.20, step);
    scaled.sprint_or_pace_set = 0;
    scaled.main_set = roundTo(total * 0.20, step);
    scaled.pull_set = roundTo(clampPullVolume(total, total * 0.20), step);
    scaled.cool_down = roundTo(total * 0.15, step);
  }

  // Speed preparation / sprint primer should usually be small and controlled.
  const needsSpeedPrep = !isBuildKickPull(profile) && (profile.goal === "sprint" || profile.goal === "race preparation" || profile.intensity === "race pace" || profile.includeSprintFinisher);
  if (!needsSpeedPrep) {
    // Keep a very small preparation block for quality sessions; otherwise move volume into main.
    scaled.main_set += scaled.sprint_or_pace_set;
    scaled.sprint_or_pace_set = 0;
  } else {
    scaled.sprint_or_pace_set = Math.max(step, Math.min(200, scaled.sprint_or_pace_set));
  }

  scaled.pull_set = roundTo(clampPullVolume(total, scaled.pull_set), step);

  // Coach constraints: prevent odd leftovers and impossible block balance.
  scaled.warm_up = Math.max(step, scaled.warm_up);
  scaled.drill_set = Math.max(step, scaled.drill_set);
  scaled.kick_set = Math.max(step, scaled.kick_set);
  scaled.cool_down = Math.max(step, scaled.cool_down);
  scaled.main_set = Math.max(step, scaled.main_set);

  // Adjust the final sum by changing the main set only. This preserves warm/drill/kick/pull/down structure.
  const sum = BLOCK_KEYS.reduce((acc, k) => acc + scaled[k], 0);
  const diff = total - sum;
  scaled.main_set = Math.max(step, scaled.main_set + diff);

  // If adjustment made main too small, borrow from pull first, then drill.
  const minMain = isBuildKickPull(profile) ? (total >= 3000 ? 600 : 300) : (total >= 3000 ? 800 : total >= 2000 ? 500 : 300);
  if (scaled.main_set < minMain) {
    let need = minMain - scaled.main_set;
    const pullMin = total >= 3000 ? 400 : total >= 2000 ? 300 : 200;
    const pullGive = Math.min(need, Math.max(0, scaled.pull_set - pullMin));
    scaled.pull_set -= pullGive;
    scaled.main_set += pullGive;
    need -= pullGive;
    if (need > 0) {
      const drillGive = Math.min(need, Math.max(0, scaled.drill_set - step));
      scaled.drill_set -= drillGive;
      scaled.main_set += drillGive;
    }
  }

  return scaled;
}

// ---- helpers to express equipment ----
function eqIn(equipment, id) {
  return equipment && equipment.includes(id);
}
function withFins(equipment) {
  return eqIn(equipment, "fins") ? " with fins" : "";
}
function withPaddles(equipment) {
  return eqIn(equipment, "paddles") ? " with paddles" : "";
}
function resistanceLabel(equipment) {
  if (eqIn(equipment, "parachute")) return " with parachute";
  if (eqIn(equipment, "tubing")) return " with resistance tubing";
  return "";
}
function dragLabel(equipment) {
  return eqIn(equipment, "drag-socks") ? " with drag socks" : "";
}


function courseLabel(profile) {
  return poolSize(profile) === 50 ? "50" : "25";
}

function safeMultiple(profile) {
  // In 50m pools, prefer 100/200 blocks for continuous swims so swimmers finish on the start side.
  return poolSize(profile) === 50 ? 100 : 50;
}

function roundDownTo(value, step) {
  return Math.max(step, Math.floor(value / step) * step);
}

function splitChoiceText(profile) {
  // Warm-up/cool-down should not be all specialist stroke.
  return profile.stroke === "freestyle" ? "freestyle/choice" : "freestyle or choice";
}

function specialistText(profile) {
  return profile.stroke === "IM" ? "IM order" : strokeWord(profile);
}

function per25Seconds(level, mode = "swim") {
  const table = {
    swim:   { beginner: 45, intermediate: 40, competitive: 35, elite: 32 },
    build:  { beginner: 50, intermediate: 43, competitive: 38, elite: 35 },
    kick:   { beginner: 55, intermediate: 45, competitive: 40, elite: 35 },
    drill:  { beginner: 55, intermediate: 45, competitive: 40, elite: 35 },
    easy:   { beginner: 50, intermediate: 45, competitive: 40, elite: 35 },
  };
  return (table[mode] && table[mode][level]) || table.swim.intermediate;
}

function intervalFor(distance, level, mode = "swim") {
  const seconds = per25Seconds(level, mode) * (distance / 25);
  return fmtTime(seconds);
}

function specialistAllowedInMainOnly(profile) {
  return profile.stroke !== "freestyle" && profile.stroke !== "IM";
}

function hasRaceFocus(profile) {
  return profile.goal === "race preparation" || profile.intensity === "race pace";
}

function workRepDistance(profile) {
  const ps = poolSize(profile);
  if (profile.stroke === "butterfly" || profile.stroke === "breaststroke") {
    return ps === 50 ? 50 : 25;
  }
  if (profile.goal === "sprint") return ps === 50 ? 50 : 25;
  return ps === 50 ? 50 : 50;
}

function racePaceWorkLine(profile, work, u) {
  const rep = workRepDistance(profile);
  const reps = Math.max(2, Math.round(work / rep));
  const specialist = specialistText(profile);
  if (profile.stroke === "IM") {
    return `${reps}x${rep}${u} IM race-pace segments, focus transitions and legal turns`;
  }
  return `${reps}x${rep}${u} ${specialist} @ race pace, full technical quality`;
}

function buildRaceSpecificMain(profile, dist, u, paceTarget) {
  const items = [];
  const step = roundStep(profile);
  const specialist = specialistText(profile);
  const roundCount = dist >= 1200 ? 4 : dist >= 800 ? 3 : 2;
  const easyPerRound = poolSize(profile) === 50 ? 100 : 50;
  let workPerRound = roundTo((dist - roundCount * easyPerRound) / roundCount, step);
  const maxRaceWork = (profile.stroke === "butterfly" || profile.stroke === "breaststroke") ? 200 : 400;
  workPerRound = Math.max(100, Math.min(maxRaceWork, workPerRound));
  const total = roundCount * (workPerRound + easyPerRound);
  const extra = Math.max(0, roundTo(dist - total, step));

  items.push(`${roundCount} rounds, each round has ${workPerRound}${u} quality work + ${easyPerRound}${u} easy recovery`);
  items.push(`  · ${racePaceWorkLine(profile, workPerRound, u)}`);
  items.push(`  · ${easyPerRound}${u} easy choice, then 3-6 min rest before the next round`);
  if (extra >= step) {
    const rep = poolSize(profile) === 50 ? 100 : 50;
    const reps = Math.max(1, Math.round(extra / rep));
    items.push(`${reps}x${rep}${u} choice easy technique between rounds or after the set`);
  }
  items.push(`Focus: stroke count, stroke tempo/rate, underwater kicks, breakout distance, and race rhythm. Stop adding speed if ${specialist} mechanics deteriorate.`);
  if (paceTarget && paceTarget.race_distance && paceTarget.target_seconds) {
    const per50 = paceTarget.target_seconds / (paceTarget.race_distance / 50);
    const per25 = paceTarget.target_seconds / (paceTarget.race_distance / 25);
    items.push(`Target reference: ~${fmtTime(per25)} per 25${u}, ~${fmtTime(per50)} per 50${u} from goal pace.`);
  }
  return items;
}

// ---- block generators ----
function genWarmUp(profile, dist, u) {
  const items = [];
  const baseStroke = splitChoiceText(profile);
  const step = safeMultiple(profile);
  const first = roundDownTo(Math.min(dist * 0.55, poolSize(profile) === 50 ? 400 : 300), step);
  const remaining = Math.max(0, dist - first);

  if (first >= 200) {
    const rep = poolSize(profile) === 50 ? 100 : 100;
    const reps = Math.max(2, Math.round(first / rep));
    items.push(`${reps}x${rep}${u} ${baseStroke} easy — finish relaxed and technically clean`);
  } else {
    items.push(`${first}${u} ${baseStroke} easy, relaxed breathing`);
  }

  if (remaining >= 200) {
    const rep = 50;
    const reps = Math.max(4, Math.round(remaining / rep));
    items.push(`${reps}x${rep}${u} build each 50 from smooth to strong — all reps follow the same build pattern`);
  } else if (remaining > 0) {
    items.push(`${remaining}${u} choice drill/swim, gradually raise body temperature`);
  }

  if (specialistAllowedInMainOnly(profile)) {
    items.push(`Specialist stroke note: keep warm-up mostly choice/free; save ${specialistText(profile)} quality for the main/race-specific work.`);
  }
  return items;
}

function genKickSet(profile, dist, u) {
  const items = [];
  const fins = withFins(profile.equipment);

  if (isBuildKickPull(profile)) {
    if (dist >= 750) {
      items.push(`8x50${u} kick${fins} best average — hold the best repeatable speed, not one-off survival effort`);
      items.push(`100${u} easy choice recovery`);
      items.push(`3x100${u} kick${fins} best average, strong body line and stable rhythm`);
    } else if (dist >= 600) {
      items.push(`3x200${u} kick${fins} best average — consistent pressure and line`);
      items.push(`100${u} easy choice recovery`);
      items.push(`4x25${u} kick${fins} best average, high-quality finish`);
    } else {
      items.push(`6x50${u} kick${fins} best average — controlled high effort`);
      items.push(`100${u} easy choice recovery`);
      items.push(`4x25${u} kick${fins} best average, clean body line`);
    }
    items.push("Build-phase purpose: part-strength development and mental variety. Do not turn it into sloppy survival kicking.");
    return items;
  }

  const rep = poolSize(profile) === 50 ? 50 : 50;
  const reps = Math.max(4, Math.round(dist / rep));
  const specialist = specialistText(profile);
  const kickMode = specialistAllowedInMainOnly(profile)
    ? `choice kick + short ${specialist} kick focus`
    : `${specialist === "IM order" ? "IM/choice" : specialist} kick`;

  items.push(`${reps}x${rep}${u} ${kickMode}${fins}`);
  items.push(`Pattern for all reps: odd reps streamline/back or side kick · even reps board or choice kick; keep hips high and line clean`);
  if (eqIn(profile.equipment, "kickboard-power")) {
    const shortRep = poolSize(profile) === 50 ? 25 : 25;
    items.push(`Optional power insert: 4x${shortRep}${u} strong kick with full control, not survival kicking`);
  }
  return items;
}

function genDrillSet(profile, dist, u) {
  const items = [];
  const stroke = profile.stroke;
  const drills = DRILLS[stroke] || DRILLS.freestyle;
  const chosen = pickN(drills, Math.min(4, drills.length));
  const rep = 50;
  const reps = Math.max(4, Math.round(dist / rep));
  const paddles = withPaddles(profile.equipment);

  items.push(`${reps}x${rep}${u}${paddles} alternating choice swim and technical drills`);
  items.push(`Rep pattern: repeat the drill list until all ${reps} reps are complete`);
  chosen.forEach((d, i) => {
    items.push(`Drill ${i + 1}: ${d}`);
  });
  if (specialistAllowedInMainOnly(profile)) {
    items.push(`Do not force every drill as full ${specialistText(profile)}. Use choice/free between drill reps to protect rhythm and shoulder quality.`);
  }
  return items;
}

function genPullSet(profile, dist, u) {
  const items = [];
  const paddles = withPaddles(profile.equipment);
  const base = profile.stroke === "freestyle" ? "freestyle pull" : "freestyle/choice pull";

  if (isBuildKickPull(profile)) {
    if (dist >= 750) {
      items.push(`8x50${u} ${base}${paddles} best average — repeatable catch pressure, stable hips`);
      items.push(`100${u} easy choice recovery`);
      items.push(`3x100${u} ${base}${paddles} best average, maintain distance per stroke`);
    } else if (dist >= 600) {
      items.push(`3x200${u} ${base}${paddles} best average — strong catch without rushing stroke rate`);
      items.push(`100${u} easy choice recovery`);
      items.push(`4x25${u} ${base}${paddles} best average, high-quality finish`);
    } else {
      items.push(`6x50${u} ${base}${paddles} best average — controlled high effort`);
      items.push(`100${u} easy choice recovery`);
      items.push(`4x25${u} ${base}${paddles} best average, clean catch`);
    }
    items.push("Build-phase purpose: upper-body pulling strength and variety. Keep it repeatable; avoid shoulder-heavy failure work.");
    return items;
  }

  const rep = poolSize(profile) === 50 ? 100 : 100;
  const reps = Math.max(4, Math.round(dist / rep));
  items.push(`${reps}x${rep}${u} ${base}${paddles} — aerobic support, clean catch, stable body line`);
  items.push("Purpose: 400-800m support work in larger sessions; support the main set without turning the whole session into specialist-stroke survival work.");
  if (profile.goal === "race preparation") {
    items.push("Keep pull controlled. Do not create fatigue that damages race-pace quality later in the session.");
  }
  return items;
}

function genMainSet(profile, dist, u, paceTarget) {
  const items = [];
  const specialist = specialistText(profile);
  const intensity = profile.intensity;
  const paddles = profile.stroke === "freestyle" ? withPaddles(profile.equipment) : "";
  const drag = profile.goal === "sprint" ? dragLabel(profile.equipment) : "";

  if (isBuildKickPull(profile)) {
    const rep = poolSize(profile) === 50 ? 100 : 100;
    const reps = Math.max(4, Math.round(dist / rep));
    items.push(`${reps}x${rep}${u} freestyle/choice aerobic support — hold technique after kick and pull fatigue`);
    items.push("This is not the hardest block today. The session priority is kick/pull best-average quality.");
    items.push(`Optional: every 3rd repeat include 25-50${u} ${specialist} rhythm only if mechanics remain clean.`);
    return items;
  }

  if (hasRaceFocus(profile)) {
    return buildRaceSpecificMain(profile, dist, u, paceTarget);
  }

  if (intensity === "recovery") {
    const rep = poolSize(profile) === 50 ? 100 : 100;
    const reps = Math.max(3, Math.round(dist / rep));
    items.push(`${reps}x${rep}${u} freestyle/choice easy`);
    items.push(`Technique priority only. If using ${specialist}, keep it to short, clean 25${u} inserts.`);
    return items;
  }

  if (profile.goal === "sprint") {
    const roundCount = dist >= 1200 ? 4 : 3;
    const easy = poolSize(profile) === 50 ? 100 : 50;
    items.push(`${roundCount} rounds sprint-quality set:`);
    items.push(`  · 4x15${u} ${specialist}${resistanceLabel(profile.equipment)}${drag} max speed, rest 1:00-1:30`);
    items.push(`  · 2x25${u} ${specialist} fast but clean, rest 1:30-2:00`);
    items.push(`  · ${easy}${u} easy choice, then 3-5 min rest`);
    items.push("Total high-speed volume stays low. Quality and mechanics decide the set, not toughness.");
    return items;
  }

  if (profile.goal === "technique") {
    const rep = 50;
    const reps = Math.max(8, Math.round(dist / rep));
    items.push(`${reps}x${rep}${u} as 25${u} technical focus + 25${u} choice swim`);
    items.push(`Every 4th rep may include ${specialist} if the skill quality is stable; otherwise stay choice/free.`);
    return items;
  }

  // Endurance / moderate aerobic work: use freestyle/choice as the base, not endless specialist stroke.
  const rep = poolSize(profile) === 50 ? 200 : 100;
  const reps = Math.max(4, Math.round(dist / rep));
  items.push(`${reps}x${rep}${u} freestyle/choice aerobic${paddles}`);
  items.push(`Every 3rd or 4th repeat: include 25-50${u} ${specialist} rhythm only if stroke quality is high`);
  items.push("Aerobic work should build capacity without destroying specialist-stroke mechanics.");
  if (paceTarget && paceTarget.race_distance && paceTarget.target_seconds) {
    const per100 = paceTarget.target_seconds / (paceTarget.race_distance / 100);
    items.push(`Goal pace reference only: ${fmtTime(per100)}/100${u}. This is not a maximal set.`);
  }
  return items;
}

function genSprintSet(profile, dist, u) {
  if (!dist || dist <= 0) return [];

  const items = [];
  const specialist = specialistText(profile);
  const resistance = resistanceLabel(profile.equipment);
  const drag = dragLabel(profile.equipment);
  const fins = eqIn(profile.equipment, "fins") ? " with fins" : "";

  const target = Math.max(50, Math.min(200, dist));
  let reps = 5;
  let repDistance = 10;

  if (target <= 60) {
    reps = 5; repDistance = 10;
  } else if (target <= 100) {
    reps = 10; repDistance = 10;
  } else if (target <= 130) {
    reps = 8; repDistance = 15;
  } else if (target <= 175) {
    reps = 6; repDistance = 25;
  } else {
    reps = 8; repDistance = 25;
  }

  const sprintVolume = reps * repDistance;
  const load = `${resistance}${drag}${fins}`;

  items.push(`${reps}x${repDistance}${u} ${specialist}${load} MAX quality from a push @ 95-100%, full recovery between reps`);
  items.push(`Sprint volume: ${sprintVolume}${u}. Long rest by design. Stop if speed, stroke count, or rhythm drops.`);
  items.push("Focus: breakout speed, first 3 strokes, clean catch, and race-level body line.");
  return items;
}

function genCoolDown(profile, dist, u) {
  const items = [];
  const step = safeMultiple(profile);
  const first = roundDownTo(Math.max(step, dist * 0.75), step);
  items.push(`${first}${u} easy freestyle/choice, long relaxed stroke, low heart rate`);
  const remaining = dist - first;
  if (remaining > 0) {
    items.push(`${remaining}${u} choice drill or backstroke easy, deep relaxed breathing`);
  }
  if (specialistAllowedInMainOnly(profile)) {
    items.push(`Cool-down should not be continuous ${specialistText(profile)}; restore movement quality and breathing.`);
  }
  if (profile.intensity === "hard" || profile.intensity === "race pace") {
    items.push("Recovery quality matters — leave the pool fresher than the main set finished.");
  }
  return items;
}

// ---- coaching points ----
function coachingPoints(profile) {
  const ps = poolSize(profile);
  const intensity = profile.intensity;
  const pts = [];

  // general stroke focus
  pts.push(
    {
      freestyle: "Front-quadrant timing — catch with the lead hand still in front.",
      backstroke: "Steady rotation — chin pointing up, hips driving each stroke.",
      breaststroke: "Hold the streamline — kick fully ended before the next pull.",
      butterfly: "Two kicks per stroke — high elbow catch, late breath.",
      IM: "Smooth transitions — keep stroke count on every length.",
    }[profile.stroke] || "Hold body line — eyes down, hips up.",
  );

  // intensity-specific cues
  if (intensity === "hard" || intensity === "race pace") {
    pts.push("Hold race stroke count as fatigue rises — efficiency over force.");
  }
  if (intensity === "race pace") {
    if (ps === 50) {
      pts.push("Build speed THROUGH the length — accelerate into the wall, do not slow.");
      pts.push("Maintain acceleration profile across every 50.");
    } else {
      pts.push("Do not decelerate before the turn — hold speed into the wall.");
      pts.push("Sharp breakouts off every wall — protect underwater quality.");
    }
  }

  if (intensity === "recovery" || intensity === "easy") {
    pts.push("Keep heart rate conversational — this is restoration, not training.");
  }

  // equipment cues
  if (eqIn(profile.equipment, "paddles")) {
    pts.push("Paddles: hold stroke length, no hip wiggle — power off the catch.");
  }
  if (eqIn(profile.equipment, "parachute") || eqIn(profile.equipment, "tubing")) {
    pts.push("Resisted sprints: explode from the wall, no slipping on the catch.");
  }

  return pts.slice(0, 6);
}

// ---- summary ----
function buildSummary(profile, allocated) {
  const stroke = strokeWord(profile);
  const total = Object.values(allocated).reduce((a, b) => a + b, 0);
  const u = profile.unit === "yd" ? "yd" : "m";
  const focusByGoal = {
    endurance: "aerobic capacity with choice/free volume and protected specialist-stroke quality",
    sprint: "short high-quality speed with long rest and low sprint volume",
    technique: "technical quality, rhythm, and skill transfer",
    "race preparation": "race-specific pace work with recovery, detail, and controlled fatigue",
  };
  const roleText = profile.sessionRole && profile.sessionRole !== "standalone" ? ` Season link: ${profile.sessionRole}.` : "";
  return `${total}${u} session for ${stroke} focused on ${focusByGoal[profile.goal] || "balanced training"}.${roleText} ${
    profile.equipment?.length
      ? "Equipment option: " + profile.equipment.join(", ") + "."
      : "No equipment required."
  }`;
}

// ---- main API ----
export function generateSession(profile) {
  const u = profile.unit === "yd" ? "yd" : "m";
  const allocated = allocateVolumes(profile);
  const energy = ENERGY[profile.intensity] || ENERGY.easy;

  const session = {
    summary: buildSummary(profile, allocated),
    total_distance_m: Object.values(allocated).reduce((a, b) => a + b, 0),
    warm_up: {
      title: "Warm up",
      distance_m: allocated.warm_up,
      items: genWarmUp(profile, allocated.warm_up, u),
      energy_system: energy.warm_up,
    },
    drill_set: {
      title: "Drill set",
      distance_m: allocated.drill_set,
      items: genDrillSet(profile, allocated.drill_set, u),
      energy_system: energy.drill_set,
    },
    kick_set: {
      title: "Kick set",
      distance_m: allocated.kick_set,
      items: genKickSet(profile, allocated.kick_set, u),
      energy_system: energy.kick_set,
    },
    sprint_or_pace_set: {
      title: "Speed prep set",
      distance_m: allocated.sprint_or_pace_set,
      items: genSprintSet(profile, allocated.sprint_or_pace_set, u),
      energy_system: energy.sprint_or_pace_set,
    },
    main_set: {
      title: "Main set",
      distance_m: allocated.main_set,
      items: genMainSet(profile, allocated.main_set, u, profile.paceTarget),
      energy_system: energy.main_set,
    },
    pull_set: {
      title: "Pull set",
      distance_m: allocated.pull_set,
      items: genPullSet(profile, allocated.pull_set, u),
      energy_system: energy.pull_set,
    },
    cool_down: {
      title: "Cool down",
      distance_m: allocated.cool_down,
      items: genCoolDown(profile, allocated.cool_down, u),
      energy_system: energy.cool_down,
    },
    coaching_points: coachingPoints(profile),
  };

  session.coach_brain = generateCoachBrain(profile, session);

  return session;
}
