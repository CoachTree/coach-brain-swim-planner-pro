import { generateCoachBrain } from "./coachBrain";
/**
 * Rule-based local swim training session generator.
 *
 * Pure JavaScript — no network, no LLM, no external dependencies.
 * Variety Engine v1.1 rotates physiologically compatible set structures and
 * avoids the two most recent structures for the same profile while the app is open.
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

// ---- Variety Engine v1 ----------------------------------------------------
// Avoid the most recently used structures for the same session profile.
// This is intentionally module-local: Generate again feels fresh without
// persisting coaching data or changing the public API.
const VARIETY_HISTORY = new Map();

function profileVarietyKey(profile, block) {
  return [
    block,
    profile.goal,
    profile.intensity,
    profile.stroke,
    profile.level,
    profile.poolType,
    profile.sessionRole || "standalone",
  ].join("|");
}

function pickFresh(profile, block, variants, rng = Math.random) {
  if (!variants.length) return null;
  const key = profileVarietyKey(profile, block);
  const recent = VARIETY_HISTORY.get(key) || [];
  let candidates = variants.filter((variant) => !recent.includes(variant.id));
  if (!candidates.length) candidates = variants;
  const chosen = pick(candidates, rng);
  const nextRecent = [chosen.id, ...recent.filter((id) => id !== chosen.id)].slice(0, Math.min(2, Math.max(1, variants.length - 1)));
  VARIETY_HISTORY.set(key, nextRecent);
  return chosen;
}

function repsForDistance(dist, rep, minimum = 1) {
  return Math.max(minimum, Math.round(dist / rep));
}

// Distance Integrity v1.1 helpers.
// Build the largest complete repeated set that fits inside the assigned block,
// then explicitly prescribe any remainder so written work always equals distance_m.
function exactRepeatPlan(dist, rep, minimum = 1) {
  if (!dist || dist <= 0) return { reps: 0, used: 0, remainder: 0 };
  let reps = Math.floor(dist / rep);
  if (reps < minimum && rep <= dist) reps = minimum;
  reps = Math.max(0, reps);
  const used = Math.min(dist, reps * rep);
  return { reps, used, remainder: Math.max(0, dist - used) };
}

function addRemainder(items, remainder, u, label = "easy choice to complete the block") {
  if (remainder > 0) items.push(`${remainder}${u} ${label}`);
  return items;
}

function repeatableRep(profile, options25 = [25, 50, 100], options50 = [50, 100, 200]) {
  return pick(poolSize(profile) === 50 ? options50 : options25);
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
  const specialist = specialistText(profile);
  const ps = poolSize(profile);
  const variants = [
    {
      id: "broken-race",
      build: () => {
        const workRep = workRepDistance(profile);
        const roundCount = dist >= 1200 ? 4 : dist >= 800 ? 3 : 2;
        const easy = ps === 50 ? 100 : 50;
        const work = Math.max(workRep * 2, roundDownTo((dist - roundCount * easy) / roundCount, workRep));
        const reps = Math.max(2, Math.round(work / workRep));
        return [
          `${roundCount} rounds broken-race quality:`,
          `  · ${reps}x${workRep}${u} ${specialist} @ race pace, 15-30 sec between reps`,
          `  · ${easy}${u} easy choice, then 3-5 min between rounds`,
          "Keep every repetition race-specific. Stop the round if speed or stroke mechanics fall away.",
        ];
      },
    },
    {
      id: "pace-ladder",
      build: () => {
        const short = ps === 50 ? 50 : 25;
        const long = short * 2;
        const roundDistance = short + long + short + (ps === 50 ? 100 : 50);
        const rounds = Math.max(2, Math.floor(dist / roundDistance));
        return [
          `${rounds} rounds race-pace ladder:`,
          `  · ${short}${u} fast into race rhythm`,
          `  · ${long}${u} ${specialist} @ target race pace`,
          `  · ${short}${u} faster than race pace with perfect mechanics`,
          `  · ${ps === 50 ? 100 : 50}${u} easy choice + 3-4 min reset`,
          "The ladder changes distance, not intent: precision first, fatigue second.",
        ];
      },
    },
    {
      id: "quality-clusters",
      build: () => {
        const rep = workRepDistance(profile);
        const cluster = profile.stroke === "butterfly" || profile.stroke === "breaststroke" ? 3 : 4;
        const easy = ps === 50 ? 100 : 50;
        const one = cluster * rep + easy;
        const rounds = Math.max(2, Math.floor(dist / one));
        return [
          `${rounds} quality clusters:`,
          `  · ${cluster}x${rep}${u} ${specialist} @ race pace, enough rest to reproduce speed`,
          `  · ${easy}${u} easy choice after each cluster`,
          `  · 3-6 min between clusters if required`,
          "Record time, stroke count and breakout quality. The set ends when repeatability ends.",
        ];
      },
    },
    {
      id: "race-pace-plus-easy",
      build: () => {
        const rep = ps === 50 ? 100 : 50;
        const easyRep = ps === 50 ? 100 : 50;
        const pair = rep + easyRep;
        const pairs = Math.max(2, Math.round(dist / pair));
        return [
          `${pairs}x (${rep}${u} race-specific + ${easyRep}${u} easy)`,
          `Race-specific rep: ${specialist} at controlled target pace; attack turns, underwater and breakout details.`,
          "Easy rep: fully restore rhythm before the next quality effort.",
          "Aim for a narrow performance band across all quality repetitions, not one heroic repeat.",
        ];
      },
    },
  ];

  const chosen = pickFresh(profile, "race-main", variants);
  const items = chosen.build();
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
  const baseStroke = splitChoiceText(profile);
  const step = safeMultiple(profile);
  const specialist = specialistText(profile);
  const variants = [
    {
      id: "split-build",
      build: () => {
        const first = roundDownTo(Math.min(dist * 0.55, poolSize(profile) === 50 ? 400 : 300), step);
        const remaining = Math.max(0, dist - first);
        const items = [`${repsForDistance(first, 100, 2)}x100${u} ${baseStroke} easy — relaxed and technically clean`];
        if (remaining > 0) items.push(`${repsForDistance(remaining, 50, 2)}x50${u} build 1-4 rhythm, reset and repeat`);
        return items;
      },
    },
    {
      id: "progressive-100s",
      build: () => {
        const rep = 100;
        const reps = repsForDistance(dist, rep, 2);
        return [
          `${reps}x${rep}${u} ${baseStroke} progressive`,
          "Within each 100: 25 relaxed + 25 long stroke + 25 build + 25 smooth-fast, never forced.",
        ];
      },
    },
    {
      id: "choice-mix",
      build: () => {
        const rep = 50;
        const reps = repsForDistance(dist, rep, 4);
        return [
          `${reps}x${rep}${u} warm-up mix`,
          `Cycle: easy ${baseStroke} · kick on side/back · choice drill · smooth build; repeat until the block is complete.`,
        ];
      },
    },
    {
      id: "continuous-plus-build",
      build: () => {
        const continuous = roundDownTo(Math.max(step, dist * 0.5), step);
        const remaining = Math.max(0, dist - continuous);
        const items = [`${continuous}${u} continuous ${baseStroke}, change stroke/skill every 50${u}`];
        if (remaining) items.push(`${repsForDistance(remaining, 50, 2)}x50${u} descend 1-3 or 1-4 from easy to strong`);
        return items;
      },
    },
  ];
  const items = pickFresh(profile, "warm-up", variants).build();
  if (specialistAllowedInMainOnly(profile)) items.push(`Specialist stroke note: keep warm-up mostly choice/free; save ${specialist} quality for the main/race-specific work.`);
  return items;
}

function genKickSet(profile, dist, u) {
  const fins = withFins(profile.equipment);
  const specialist = specialistText(profile);

  if (isBuildKickPull(profile)) {
    const variants = [
      { id: "best-average-50", build: () => [`${repsForDistance(Math.max(200, dist - 100), 50, 4)}x50${u} kick${fins} best average`, `100${u} easy choice recovery`, "Hold repeatable pressure and body line; do not chase one exceptional repeat."] },
      { id: "strength-100", build: () => [`${repsForDistance(Math.max(300, dist - 100), 100, 3)}x100${u} kick${fins} strong and consistent`, `100${u} easy choice`, "Last 25 of every second 100 can be faster if line and timing stay clean."] },
      { id: "mixed-distance", build: () => [`3 rounds: 2x50${u} strong kick${fins} + 1x100${u} controlled kick${fins}`, "Take extra recovery between rounds when power falls.", "Build-phase purpose: part-strength development, not survival kicking."] },
    ];
    return pickFresh(profile, "kick-build", variants).build();
  }

  const kickMode = specialistAllowedInMainOnly(profile) ? `choice kick + short ${specialist} kick focus` : `${specialist === "IM order" ? "IM/choice" : specialist} kick`;
  const variants = [
    { id: "50-alternate", build: () => [`${repsForDistance(dist, 50, 4)}x50${u} ${kickMode}${fins}`, "Odd: streamline/back or side kick · Even: board or choice kick; stable hips throughout."] },
    { id: "25-quality", build: () => [`${repsForDistance(dist, 25, 8)}x25${u} ${kickMode}${fins}`, "Cycle 4 reps: easy line · strong line · underwater/streamline focus · fast clean kick."] },
    { id: "100-descend", build: () => [`${repsForDistance(dist, 100, 3)}x100${u} ${kickMode}${fins} descend 1-3`, "Build pressure through each mini-series without shortening the kick or losing body line."] },
    { id: "broken-kick", build: () => {
        const roundDistance = 200;
        const rounds = Math.max(1, Math.floor(dist / roundDistance));
        const used = Math.min(dist, rounds * roundDistance);
        const items = [`${rounds} rounds: 2x50${u} strong kick${fins} + 4x25${u} quality kick${fins}`, "Short reps are faster; 50s stay controlled and technically stable."];
        return addRemainder(items, dist - used, u, "easy/steady kick to complete the block");
      } },
  ];
  const items = pickFresh(profile, "kick", variants).build();
  if (eqIn(profile.equipment, "kickboard-power")) items.push(`Optional power insert: 4x25${u} strong kick with full control.`);
  return items;
}

function genDrillSet(profile, dist, u) {
  const stroke = profile.stroke;
  const drills = DRILLS[stroke] || DRILLS.freestyle;
  const chosen = pickN(drills, Math.min(4, drills.length));
  const paddles = withPaddles(profile.equipment);
  const variants = [
    { id: "alternate-50", build: () => [`${repsForDistance(dist, 50, 4)}x50${u}${paddles} alternating drill and swim`, "Carry one technical cue from each drill into the following swim rep."] },
    { id: "25-drill-swim", build: () => [`${repsForDistance(dist, 25, 8)}x25${u} drill/swim skill transfer`, "Pattern: drill · swim same skill · drill · swim faster with same shape."] },
    { id: "100-skill-blocks", build: () => [`${repsForDistance(dist, 100, 3)}x100${u} technical blocks`, `Each 100: 25 drill + 25 swim + 25 drill + 25 swim/build.`] },
    { id: "scull-transfer", build: () => [`${repsForDistance(dist, 50, 4)}x50${u} skill transfer`, "Cycle: scull/feel-for-water · drill · swim long · swim with controlled tempo."] },
  ];
  const items = pickFresh(profile, "drill", variants).build();
  chosen.forEach((d, i) => items.push(`Drill ${i + 1}: ${d}`));
  if (specialistAllowedInMainOnly(profile)) items.push(`Do not force every drill as full ${specialistText(profile)}. Use choice/free between drill reps to protect rhythm and shoulder quality.`);
  return items;
}

function genPullSet(profile, dist, u) {
  const paddles = withPaddles(profile.equipment);
  const base = profile.stroke === "freestyle" ? "freestyle pull" : "freestyle/choice pull";

  if (isBuildKickPull(profile)) {
    const variants = [
      { id: "best-average-50", build: () => [`${repsForDistance(Math.max(200, dist - 100), 50, 4)}x50${u} ${base}${paddles} best average`, `100${u} easy choice recovery`, "Repeatable catch pressure and stable hips."] },
      { id: "strength-100", build: () => [`${repsForDistance(Math.max(300, dist - 100), 100, 3)}x100${u} ${base}${paddles} strong aerobic/strength`, `100${u} easy choice`, "Hold distance per stroke; do not rush the recovery."] },
      { id: "mixed-200-50", build: () => [`${Math.max(2, Math.floor(dist / 300))} rounds: 1x200${u} ${base}${paddles} controlled + 2x50${u} best-average pull`, "Use the 200 to establish pressure; 50s add speed without shoulder-heavy failure work."] },
    ];
    return pickFresh(profile, "pull-build", variants).build();
  }

  const variants = [
    { id: "100-aerobic", build: () => [`${repsForDistance(dist, 100, 4)}x100${u} ${base}${paddles} aerobic support`, "Hold clean catch and stable body line; descend every 3rd or 4th rep if appropriate."] },
    { id: "50-descend", build: () => [`${repsForDistance(dist, 50, 6)}x50${u} ${base}${paddles}`, "Descend 1-3 from smooth to strong, then reset. Keep stroke length stable as pressure rises."] },
    { id: "200-negative", build: () => [`${repsForDistance(dist, 200, 2)}x200${u} ${base}${paddles} negative split`, "Second half slightly faster while maintaining catch position and hip stability."] },
    { id: "mixed-aerobic", build: () => {
        const roundDistance = 300;
        const rounds = Math.max(1, Math.floor(dist / roundDistance));
        const used = Math.min(dist, rounds * roundDistance);
        const items = [`${rounds} rounds: 1x200${u} aerobic pull + 2x50${u} strong clean pull`, "The 50s add pressure; the 200 protects aerobic continuity."];
        return addRemainder(items, dist - used, u, "easy/steady pull to complete the block");
      } },
  ];
  const items = pickFresh(profile, "pull", variants).build();
  if (profile.goal === "race preparation") items.push("Keep pull controlled. Do not create fatigue that damages race-pace quality later in the session.");
  return items;
}

function genMainSet(profile, dist, u, paceTarget) {
  const specialist = specialistText(profile);
  const intensity = profile.intensity;
  const paddles = profile.stroke === "freestyle" ? withPaddles(profile.equipment) : "";
  const drag = profile.goal === "sprint" ? dragLabel(profile.equipment) : "";

  if (isBuildKickPull(profile)) {
    const variants = [
      { id: "100-support", build: () => [`${repsForDistance(dist, 100, 4)}x100${u} freestyle/choice aerobic support`, "Hold technique after kick and pull fatigue; this is not today's hardest block."] },
      { id: "200-support", build: () => [`${repsForDistance(dist, 200, 3)}x200${u} freestyle/choice smooth aerobic`, `Every second rep may finish with 25-50${u} ${specialist} rhythm if mechanics remain clean.`] },
    ];
    return pickFresh(profile, "main-build", variants).build();
  }

  if (hasRaceFocus(profile)) return buildRaceSpecificMain(profile, dist, u, paceTarget);

  if (intensity === "recovery") {
    const variants = [
      { id: "100-easy", build: () => [`${repsForDistance(dist, 100, 3)}x100${u} freestyle/choice easy`, `Technique priority only; use short clean ${specialist} inserts if desired.`] },
      { id: "200-easy", build: () => [`${repsForDistance(dist, 200, 2)}x200${u} easy aerobic recovery`, "Change stroke or drill every 50; keep breathing relaxed and effort conversational."] },
      { id: "50-reset", build: () => [`${repsForDistance(dist, 50, 6)}x50${u} easy reset`, "Odd reps long relaxed swim · even reps choice drill/backstroke."] },
    ];
    return pickFresh(profile, "main-recovery", variants).build();
  }

  if (profile.goal === "sprint") {
    const resistance = `${resistanceLabel(profile.equipment)}${drag}`;
    const variants = [
      {
        id: "15-resisted-release",
        build: () => {
          const rounds = dist >= 1200 ? 4 : 3;
          const easy = poolSize(profile) === 50 ? 100 : 50;
          return [`${rounds} rounds resisted → free speed:`, `  · 4x15${u} ${specialist}${resistance} MAX quality, rest 1:00-1:30`, `  · 2x25${u} ${specialist} free speed, rest 1:30-2:00`, `  · ${easy}${u} easy + 3-5 min between rounds`, "Low high-speed volume. End a round when acceleration or mechanics deteriorate."];
        },
      },
      {
        id: "25-quality",
        build: () => {
          const rounds = dist >= 1000 ? 4 : 3;
          return [`${rounds} rounds pure-speed quality:`, `  · 3x25${u} ${specialist} @ 95-100%, full recovery 2:00-3:00`, `  · ${poolSize(profile) === 50 ? 100 : 50}${u} easy choice`, "Each 25 must be fast enough to justify the long rest; stop before the set becomes conditioning."];
        },
      },
      {
        id: "broken-50",
        build: () => {
          const short = poolSize(profile) === 50 ? 25 : 25;
          const rounds = dist >= 1000 ? 4 : 3;
          return [`${rounds} rounds broken 50 speed:`, `  · 2x${short}${u} ${specialist} FAST, 20-30 sec between pieces`, `  · 1x25${u} easy reset`, `  · 3-5 min between rounds`, "Judge the set by speed preservation and technical shape, not accumulated fatigue."];
        },
      },
      {
        id: "speed-ladder",
        build: () => {
          const rounds = dist >= 1000 ? 3 : 2;
          return [`${rounds} rounds speed ladder:`, `  · 15${u} acceleration + 25${u} max-quality + 50${u} fast/clean`, `  · ${poolSize(profile) === 50 ? 100 : 50}${u} easy choice`, "Use increasing distance to test whether speed mechanics survive without converting the set into lactate survival work."];
        },
      },
      {
        id: "race-start-speed",
        build: () => {
          const reps = Math.max(6, Math.min(12, Math.round(dist / 100)));
          return [`${reps}x25${u} race-start speed`, "Odd reps: breakout + first 6-8 strokes MAX · Even reps: fast finish into the wall.", "Full recovery 1:30-3:00. Quality threshold decides when to stop."];
        },
      },
    ];
    return pickFresh(profile, "main-sprint", variants).build();
  }

  if (profile.goal === "technique") {
    const variants = [
      { id: "25-25", build: () => [`${repsForDistance(dist, 50, 8)}x50${u} as 25 technical focus + 25 swim`, `Every 4th rep may include ${specialist} if skill quality remains stable.`] },
      { id: "drill-build-100", build: () => [`${repsForDistance(dist, 100, 4)}x100${u} skill transfer`, `25 drill + 25 swim + 25 build + 25 ${specialist}/choice maintaining the same technical cue.`] },
      { id: "tempo-control", build: () => [`${repsForDistance(dist, 50, 8)}x50${u} technique with tempo control`, "Alternate long-stroke/low-rate and slightly faster race-shaped rhythm without losing line."] },
      { id: "turn-skill", build: () => [`${repsForDistance(dist, 50, 8)}x50${u} skill precision`, "Cycle focus: entry/catch · body line · turn approach · breakout. Swim easy between high-attention reps."] },
    ];
    return pickFresh(profile, "main-technique", variants).build();
  }

  const enduranceVariants = [
    { id: "100-best-average", build: () => {
        const plan = exactRepeatPlan(dist, 100, 1);
        const items = [`${plan.reps}x100${u} freestyle/choice aerobic${paddles}`, "Hold a narrow repeatable pace band; every 3rd or 4th rep may include short specialist rhythm."];
        return addRemainder(items, plan.remainder, u, "aerobic choice, same effort and technical standard");
      } },
    { id: "200-negative", build: () => {
        const plan = exactRepeatPlan(dist, 200, 1);
        const items = [`${plan.reps}x200${u} freestyle/choice negative split${paddles}`, `Second 100 slightly faster. Insert 25-50${u} ${specialist} only while mechanics remain high quality.`];
        return addRemainder(items, plan.remainder, u, "aerobic choice to finish the assigned main-set distance");
      } },
    { id: "400-descending", build: () => {
        const plan = exactRepeatPlan(dist, 400, 1);
        const items = [`${plan.reps}x400${u} aerobic progression`, "Descend by 100 within each 400: smooth → steady → strong → controlled-fast; never sprint the finish."];
        return addRemainder(items, plan.remainder, u, "steady aerobic choice to complete the block");
      } },
    { id: "aerobic-ladder", build: () => {
        const roundDistance = 700;
        const rounds = Math.max(1, Math.floor(dist / roundDistance));
        const used = Math.min(dist, rounds * roundDistance);
        const items = [`${rounds} rounds aerobic ladder: 100 + 200 + 400${u}`, "100 strong rhythm · 200 steady · 400 aerobic control; repeat with consistent technique."];
        return addRemainder(items, dist - used, u, "steady aerobic choice to complete the block");
      } },
    { id: "broken-aerobic", build: () => {
        const roundDistance = 400; // 4x50 + 1x200
        const rounds = Math.max(1, Math.floor(dist / roundDistance));
        const used = Math.min(dist, rounds * roundDistance);
        const items = [`${rounds} rounds: 4x50${u} steady + 1x200${u} aerobic`, `Use the 50s to sharpen rhythm; hold ${specialist} inserts short enough to preserve mechanics.`];
        return addRemainder(items, dist - used, u, "steady aerobic choice to complete the block");
      } },
  ];
  const items = pickFresh(profile, "main-endurance", enduranceVariants).build();
  items.push("Aerobic work should build capacity without destroying specialist-stroke mechanics.");
  if (paceTarget && paceTarget.race_distance && paceTarget.target_seconds) {
    const per100 = paceTarget.target_seconds / (paceTarget.race_distance / 100);
    items.push(`Goal pace reference only: ${fmtTime(per100)}/100${u}. This is not a maximal set.`);
  }
  return items;
}

function genSprintSet(profile, dist, u) {
  if (!dist || dist <= 0) return [];
  const specialist = specialistText(profile);
  const load = `${resistanceLabel(profile.equipment)}${dragLabel(profile.equipment)}${eqIn(profile.equipment, "fins") ? " with fins" : ""}`;
  const target = Math.max(50, Math.min(200, dist));
  const variants = [
    { id: "10m-accel", rep: 10, min: 5, cue: "acceleration from push, first 3 strokes" },
    { id: "15m-breakout", rep: 15, min: 4, cue: "underwater + breakout speed" },
    { id: "25m-max", rep: 25, min: 4, cue: "max-quality speed with full mechanics" },
    { id: "mixed-15-25", mixed: true, cue: "contrast breakout speed with free swimming speed" },
  ];
  const chosen = pickFresh(profile, "speed-prep", variants);
  if (chosen.mixed) {
    const rounds = target >= 150 ? 4 : 3;
    return [
      `${rounds} rounds: 2x15${u} ${specialist}${load} MAX + 1x25${u} ${specialist} free speed`,
      "Full recovery between fast repetitions; 2-3 min between rounds.",
      `Focus: ${chosen.cue}. Stop if speed, stroke count, or rhythm drops.`,
    ];
  }
  const reps = Math.max(chosen.min, Math.round(target / chosen.rep));
  const sprintVolume = reps * chosen.rep;
  return [
    `${reps}x${chosen.rep}${u} ${specialist}${load} @ 95-100%, full recovery`,
    `Sprint volume: ${sprintVolume}${u}. Long rest by design.`,
    `Focus: ${chosen.cue}. Stop if speed, stroke count, or rhythm drops.`,
  ];
}

function genCoolDown(profile, dist, u) {
  const specialist = specialistText(profile);
  const variants = [
    { id: "continuous", build: () => [`${dist}${u} easy freestyle/choice, change stroke or drill every 50-100${u}`, "Long relaxed stroke, low heart rate, easy breathing."] },
    { id: "split", build: () => {
        const first = roundDownTo(Math.max(safeMultiple(profile), dist * 0.65), safeMultiple(profile));
        const remaining = Math.max(0, dist - first);
        const items = [`${first}${u} easy freestyle/choice, long relaxed stroke`];
        if (remaining) items.push(`${remaining}${u} choice drill/backstroke easy, deep relaxed breathing`);
        return items;
      } },
    { id: "50-reset", build: () => {
        const plan = exactRepeatPlan(dist, 50, 1);
        const items = [`${plan.reps}x50${u} recovery reset`, "Odd: easy free/choice · Even: backstroke or drill. No pace target."];
        return addRemainder(items, plan.remainder, u, "very easy choice");
      } },
  ];
  const items = pickFresh(profile, "cool-down", variants).build();
  if (specialistAllowedInMainOnly(profile)) items.push(`Cool-down should not be continuous ${specialist}; restore movement quality and breathing.`);
  if (profile.intensity === "hard" || profile.intensity === "race pace") items.push("Recovery quality matters — leave the pool fresher than the main set finished.");
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
// v1.1: displayed block distances remain the source of truth; generators above
// explicitly fill remainders for variable structures instead of silently rounding up/down.
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
