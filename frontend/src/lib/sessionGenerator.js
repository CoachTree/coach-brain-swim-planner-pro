import { generateCoachBrain } from "./coachBrain";

function createSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Rule-based local swim training session generator.
 *
 * Pure JavaScript — no network, no LLM, no external dependencies.
 * Variety Engine v1.2 rotates physiologically compatible set structures,
 * avoids the five most recent structures for the same profile while the app is open,
 * and keeps every written block distance exactly aligned with distance_m.
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

// ---- Variety Engine v1.2 --------------------------------------------------
// Avoid the five most recently used structures for the same session profile.
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
  const nextRecent = [chosen.id, ...recent.filter((id) => id !== chosen.id)].slice(0, Math.min(5, Math.max(1, variants.length - 1)));
  VARIETY_HISTORY.set(key, nextRecent);
  return chosen;
}

function repsForDistance(dist, rep, minimum = 1) {
  if (!dist || dist <= 0 || !rep || rep <= 0) return 0;
  const reps = Math.floor(dist / rep);
  return reps >= minimum ? reps : (rep <= dist ? minimum : 0);
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

function exactRepeatedItems(dist, rep, u, lineBuilder, remainderLabel) {
  const plan = exactRepeatPlan(dist, rep, 1);
  const items = [];
  if (plan.reps > 0) items.push(lineBuilder(plan.reps, rep));
  return addRemainder(items, plan.remainder, u, remainderLabel);
}

function supportDistanceLine(distance, u, label = "easy aerobic / technical reset") {
  return distance > 0 ? `${distance}${u} ${label}` : null;
}

function intensityCategory(profile, block) {
  if (block === "cool_down") return "REC";
  if (block === "drill_set") return "A1";
  if (block === "sprint_or_pace_set") {
    if (profile.goal === "sprint") return profile.intensity === "race pace" ? "SP3" : "SP2";
    if (hasRaceFocus(profile)) return "RP-PREP";
    return profile.intensity === "recovery" ? "REC" : "A2";
  }
  if (block === "main_set") {
    if (profile.goal === "sprint") {
      if (profile.intensity === "recovery") return "SP1";
      if (profile.intensity === "easy" || profile.intensity === "moderate") return "SP2";
      return profile.intensity === "race pace" ? "SP3" : "SP2";
    }
    if (hasRaceFocus(profile)) return "RP";
    if (profile.goal === "technique") return profile.intensity === "hard" ? "SK2" : "SK1";
    if (profile.goal === "endurance") {
      return { recovery: "A1", easy: "EN1", moderate: "EN2", hard: "EN3", "race pace": "EN3" }[profile.intensity] || "EN1";
    }
  }
  if (block === "kick_set") return profile.intensity === "recovery" ? "A1" : profile.intensity === "hard" ? "A2+" : "A2";
  if (block === "pull_set") return profile.intensity === "hard" ? "EN2" : profile.intensity === "recovery" ? "A1" : "EN1";
  if (block === "warm_up") return profile.intensity === "recovery" ? "REC" : profile.intensity === "hard" || profile.intensity === "race pace" ? "A2" : "A1";
  return (ENERGY[profile.intensity] || ENERGY.easy)[block] || "A1";
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
        const rep = workRepDistance(profile);
        const plan = exactRepeatPlan(dist, rep, 1);
        const items = [`${plan.reps}x${rep}${u} broken race-quality segments`, `Work: ${specialist} @ race pace with 15-30 sec between quality pieces; insert recovery as needed without adding distance.`, "Keep every repetition race-specific. Stop the quality portion if speed or mechanics fall away."];
        return addRemainder(items, plan.remainder, u, "easy choice to complete the assigned main-set distance");
      },
    },
    {
      id: "pace-ladder",
      build: () => {
        const unit = ps === 50 ? 100 : 50;
        const plan = exactRepeatPlan(dist, unit, 1);
        const items = [`${plan.reps}x${unit}${u} race-pace ladder units`, `Rotate: controlled race rhythm · target race pace · faster-than-race-pace finish, with recovery between quality units.`, "The ladder changes speed emphasis, not the training category: precision first, fatigue second."];
        return addRemainder(items, plan.remainder, u, "easy choice to complete the main-set distance");
      },
    },
    {
      id: "quality-clusters",
      build: () => {
        const rep = workRepDistance(profile);
        const plan = exactRepeatPlan(dist, rep, 1);
        const items = [`${plan.reps}x${rep}${u} race-pace quality clustered in groups of 3-4`, `Take enough rest inside and between clusters to reproduce ${specialist} speed and race details.`, "Record time, stroke count and breakout quality. The quality set ends when repeatability ends."];
        return addRemainder(items, plan.remainder, u, "easy choice to complete the main-set distance");
      },
    },
    {
      id: "race-pace-plus-easy",
      build: () => {
        const pair = ps === 50 ? 200 : 100;
        const quality = pair / 2;
        const plan = exactRepeatPlan(dist, pair, 1);
        const items = [`${plan.reps}x (${quality}${u} race-specific + ${quality}${u} easy)`, `Race-specific rep: ${specialist} at controlled target pace; attack turns, underwater and breakout details.`, "Easy rep: fully restore rhythm before the next quality effort."];
        return addRemainder(items, plan.remainder, u, "easy/race-skill choice to complete the main-set distance");
      },
    },
    {
      id: "race-detail-50s",
      build: () => {
        const rep = ps === 50 ? 100 : 50;
        const plan = exactRepeatPlan(dist, rep, 1);
        const items = [`${plan.reps}x${rep}${u} race-detail repeats`, `Cycle focus: start speed · breakout · mid-pool rhythm · turn approach · finish.`, "Keep target pace only when the selected race detail remains technically accurate."];
        return addRemainder(items, plan.remainder, u, "easy choice to complete the main-set distance");
      },
    },
    {
      id: "target-band",
      build: () => {
        const rep = ps === 50 ? 100 : 50;
        const plan = exactRepeatPlan(dist, rep, 1);
        const items = [`${plan.reps}x${rep}${u} target-band race pace`, `Hold ${specialist} times inside a narrow target window; use additional rest rather than accepting large pace drift.`, "Quality is defined by repeatability of pace plus mechanics, not by one fastest repetition."];
        return addRemainder(items, plan.remainder, u, "easy choice to complete the main-set distance");
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
  const specialist = specialistText(profile);
  const variants = [
    {
      id: "split-build",
      build: () => {
        const first = Math.min(dist, roundDownTo(Math.max(100, dist * 0.55), 50));
        const remaining = Math.max(0, dist - first);
        const items = exactRepeatedItems(first, 100, u, (reps, rep) => `${reps}x${rep}${u} ${baseStroke} easy — relaxed and technically clean`, "easy choice to complete the first warm-up segment");
        if (remaining > 0) addRemainder(exactRepeatedItems(remaining, 50, u, (reps, rep) => `${reps}x${rep}${u} build rhythm, reset and repeat`, "easy choice to complete the warm-up"), 0, u).forEach(x => items.push(x));
        return items;
      },
    },
    {
      id: "progressive-100s",
      build: () => {
        const items = exactRepeatedItems(dist, 100, u, (reps, rep) => `${reps}x${rep}${u} ${baseStroke} progressive`, "easy choice, progressive finish");
        items.push("Within each 100: 25 relaxed + 25 long stroke + 25 build + 25 smooth-fast, never forced.");
        return items;
      },
    },
    {
      id: "choice-mix",
      build: () => {
        const items = exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u} warm-up mix`, "easy choice to complete the warm-up");
        items.push(`Cycle: easy ${baseStroke} · kick on side/back · choice drill · smooth build.`);
        return items;
      },
    },
    {
      id: "continuous-plus-build",
      build: () => {
        const continuous = Math.min(dist, roundDownTo(Math.max(50, dist * 0.5), 50));
        const remaining = Math.max(0, dist - continuous);
        const items = [`${continuous}${u} continuous ${baseStroke}, change stroke/skill every 50${u}`];
        if (remaining > 0) exactRepeatedItems(remaining, 50, u, (reps, rep) => `${reps}x${rep}${u} descend from easy to strong`, "easy choice to complete the warm-up").forEach(x => items.push(x));
        return items;
      },
    },
    {
      id: "25-50-build",
      build: () => {
        const rep = poolSize(profile) === 50 ? 50 : 25;
        const items = exactRepeatedItems(dist, rep, u, (reps, r) => `${reps}x${r}${u} alternating easy / build / skill`, "easy choice to complete the block");
        items.push("Rotate breathing, body-line and tempo cues while keeping effort below main-set intensity.");
        return items;
      },
    },
    {
      id: "stroke-mix-reset",
      build: () => {
        const rep = 50;
        const items = exactRepeatedItems(dist, rep, u, (reps, r) => `${reps}x${r}${u} warm-up reset`, "very easy choice to complete the block");
        items.push("Cycle free/choice · backstroke · drill · build. Start smooth; finish ready, not tired.");
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
  const kickMode = specialistAllowedInMainOnly(profile) ? `choice kick + short ${specialist} kick focus` : `${specialist === "IM order" ? "IM/choice" : specialist} kick`;
  const variants = [
    { id: "50-alternate", build: () => {
      const items = exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u} ${kickMode}${fins}`, "easy/steady kick to complete the block");
      items.push("Odd: streamline/back or side kick · Even: board or choice kick; stable hips throughout."); return items;
    }},
    { id: "25-quality", build: () => {
      const items = exactRepeatedItems(dist, 25, u, (reps, rep) => `${reps}x${rep}${u} ${kickMode}${fins}`, "easy kick to complete the block");
      items.push("Cycle 4 reps: easy line · strong line · underwater/streamline focus · fast clean kick."); return items;
    }},
    { id: "100-descend", build: () => {
      const items = exactRepeatedItems(dist, 100, u, (reps, rep) => `${reps}x${rep}${u} ${kickMode}${fins} descend 1-3`, "easy/steady kick to complete the block");
      items.push("Build pressure through each mini-series without shortening the kick or losing body line."); return items;
    }},
    { id: "broken-kick", build: () => {
      const roundDistance = 200; const rounds = Math.floor(dist / roundDistance); const used = rounds * roundDistance;
      const items = rounds > 0 ? [`${rounds} rounds: 2x50${u} strong kick${fins} + 4x25${u} quality kick${fins}`, "Short reps are faster; 50s stay controlled and technically stable."] : [];
      return addRemainder(items, dist - used, u, "easy/steady kick to complete the block");
    }},
    { id: "power-25-reset", build: () => {
      const round = 100; const rounds = Math.floor(dist / round); const used = rounds * round;
      const items = rounds > 0 ? [`${rounds} rounds: 2x25${u} strong kick + 2x25${u} easy line`, "Power reps are crisp; easy reps restore range and alignment."] : [];
      return addRemainder(items, dist-used, u, "easy kick reset to complete the block");
    }},
    { id: "tempo-kick", build: () => {
      const items = exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u} ${kickMode}${fins} tempo control`, "easy kick to complete the block");
      items.push("Alternate controlled cadence and stronger cadence without losing line or kick amplitude."); return items;
    }},
  ];
  const items = pickFresh(profile, isBuildKickPull(profile) ? "kick-build" : "kick", variants).build();
  if (eqIn(profile.equipment, "kickboard-power")) items.push(`Optional power insert inside the prescribed distance: use selected 25${u} reps as strong kick with full control.`);
  return items;
}

function genDrillSet(profile, dist, u) {
  const stroke = profile.stroke;
  const drills = DRILLS[stroke] || DRILLS.freestyle;
  const chosen = pickN(drills, Math.min(4, drills.length));
  const paddles = withPaddles(profile.equipment);
  const variants = [
    { id: "alternate-50", build: () => exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u}${paddles} alternating drill and swim`, "easy drill/swim to complete the block") },
    { id: "25-drill-swim", build: () => exactRepeatedItems(dist, 25, u, (reps, rep) => `${reps}x${rep}${u} drill/swim skill transfer`, "easy skill transfer to complete the block") },
    { id: "100-skill-blocks", build: () => exactRepeatedItems(dist, 100, u, (reps, rep) => `${reps}x${rep}${u} technical blocks`, "easy drill/swim to complete the block") },
    { id: "scull-transfer", build: () => exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u} skill transfer`, "easy technical choice to complete the block") },
    { id: "cue-by-25", build: () => exactRepeatedItems(dist, 25, u, (reps, rep) => `${reps}x${rep}${u} one-cue precision`, "easy technical choice to complete the block") },
    { id: "drill-build-free", build: () => exactRepeatedItems(dist, 50, u, (reps, rep) => `${reps}x${rep}${u} as drill/build or drill/swim`, "easy skill transfer to complete the block") },
  ];
  const items = pickFresh(profile, "drill", variants).build();
  items.push("Transfer the same technical cue into normal swimming; do not let the drill become the goal itself.");
  chosen.forEach((d, i) => items.push(`Drill ${i + 1}: ${d}`));
  if (specialistAllowedInMainOnly(profile)) items.push(`Do not force every drill as full ${specialistText(profile)}. Use choice/free between drill reps to protect rhythm and shoulder quality.`);
  return items;
}

function genPullSet(profile, dist, u) {
  const paddles = withPaddles(profile.equipment);
  const base = profile.stroke === "freestyle" ? "freestyle pull" : "freestyle/choice pull";
  const variants = [
    { id: "100-aerobic", build: () => { const items=exactRepeatedItems(dist,100,u,(reps,rep)=>`${reps}x${rep}${u} ${base}${paddles} aerobic support`,"easy pull to complete the block"); items.push("Hold clean catch and stable body line; descend selected reps if appropriate."); return items;}},
    { id: "50-descend", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} ${base}${paddles}`,"easy pull to complete the block"); items.push("Descend 1-3 from smooth to strong, then reset. Keep stroke length stable."); return items;}},
    { id: "200-negative", build: () => { const items=exactRepeatedItems(dist,200,u,(reps,rep)=>`${reps}x${rep}${u} ${base}${paddles} negative split`,"easy/steady pull to complete the block"); items.push("Second half slightly faster while maintaining catch position and hip stability."); return items;}},
    { id: "mixed-aerobic", build: () => { const rd=300, rounds=Math.floor(dist/rd), used=rounds*rd; const items=rounds>0?[`${rounds} rounds: 1x200${u} aerobic pull + 2x50${u} strong clean pull`,"The 50s add pressure; the 200 protects aerobic continuity."]:[]; return addRemainder(items,dist-used,u,"easy/steady pull to complete the block");}},
    { id: "25-pressure", build: () => { const items=exactRepeatedItems(dist,25,u,(reps,rep)=>`${reps}x${rep}${u} ${base}${paddles} catch-pressure focus`,"easy pull to complete the block"); items.push("Alternate smooth pressure and stronger pressure; no slipping at the front of the stroke."); return items;}},
    { id: "150-control", build: () => { const items=exactRepeatedItems(dist,150,u,(reps,rep)=>`${reps}x${rep}${u} ${base}${paddles} controlled aerobic`,"easy pull to complete the block"); items.push("Each rep: settle first third, hold middle third, finish with slightly firmer pressure."); return items;}},
  ];
  const items = pickFresh(profile, isBuildKickPull(profile) ? "pull-build" : "pull", variants).build();
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
      { id: "100-support", build: () => { const items=exactRepeatedItems(dist,100,u,(reps,rep)=>`${reps}x${rep}${u} freestyle/choice aerobic support`,"easy aerobic choice to complete the block"); items.push("Hold technique after kick and pull fatigue; this is not today's hardest block."); return items;} },
      { id: "200-support", build: () => { const items=exactRepeatedItems(dist,200,u,(reps,rep)=>`${reps}x${rep}${u} freestyle/choice smooth aerobic`,"easy aerobic choice to complete the block"); items.push(`Every second rep may finish with 25-50${u} ${specialist} rhythm if mechanics remain clean.`); return items;} },
      { id: "50-support", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} smooth aerobic support`,"easy choice to complete the block"); items.push("Alternate long-stroke swimming and controlled build without turning the block into a second main set."); return items;} },
    ];
    return pickFresh(profile, "main-build", variants).build();
  }

  if (hasRaceFocus(profile)) return buildRaceSpecificMain(profile, dist, u, paceTarget);

  if (intensity === "recovery") {
    const variants = [
      { id: "100-easy", build: () => { const items=exactRepeatedItems(dist,100,u,(reps,rep)=>`${reps}x${rep}${u} freestyle/choice easy`,"very easy choice to complete the block"); items.push(`Technique priority only; use short clean ${specialist} inserts if desired.`); return items;} },
      { id: "200-easy", build: () => { const items=exactRepeatedItems(dist,200,u,(reps,rep)=>`${reps}x${rep}${u} easy aerobic recovery`,"very easy choice to complete the block"); items.push("Change stroke or drill every 50; keep breathing relaxed and effort conversational."); return items;} },
      { id: "50-reset", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} easy reset`,"very easy choice to complete the block"); items.push("Odd reps long relaxed swim · even reps choice drill/backstroke."); return items;} },
      { id: "25-release", build: () => { const items=exactRepeatedItems(dist,25,u,(reps,rep)=>`${reps}x${rep}${u} low-load movement quality`,"very easy choice to complete the block"); items.push("Use short repeats only to improve feel, alignment and breathing — never to add intensity."); return items;} },
    ];
    return pickFresh(profile, "main-recovery", variants).build();
  }

  if (profile.goal === "sprint") {
    const resistance = `${resistanceLabel(profile.equipment)}${drag}`;
    const ps = poolSize(profile);
    const variants = [
      {
        id: "25-quality-support",
        build: () => {
          const cluster = ps === 50 ? 200 : 150;
          const rounds = Math.max(1, Math.floor(dist / cluster));
          const used = rounds * cluster;
          const work = ps === 50 ? `2x50${u}` : `4x25${u}`;
          const easy = ps === 50 ? `100${u}` : `50${u}`;
          const items = [`${rounds} rounds pure-speed quality:`, `  · ${work} ${specialist} @ 95-100%, full recovery`, `  · ${easy} easy choice / technical reset`, "Protect maximum velocity and mechanics; the easy distance is part of the prescription."];
          return addRemainder(items, dist-used, u, "easy aerobic / skill reset to complete the main-set distance");
        },
      },
      {
        id: "broken-50-support",
        build: () => {
          const roundDist = ps === 50 ? 200 : 150;
          const rounds = Math.max(1, Math.floor(dist / roundDist));
          const used = rounds * roundDist;
          const items = [`${rounds} rounds broken-speed quality:`, `  · 2x25${u} ${specialist} FAST, 20-30 sec between pieces`, `  · ${ps === 50 ? 150 : 100}${u} easy choice / drill reset`, `  · 2-4 min between rounds if required`, "Judge the set by speed preservation and technical shape, not accumulated fatigue."];
          return addRemainder(items, dist-used, u, "easy aerobic / technical reset to complete the main-set distance");
        },
      },
      {
        id: "speed-ladder-support",
        build: () => {
          const roundDist = ps === 50 ? 300 : 225;
          const rounds = Math.max(1, Math.floor(dist / roundDist));
          const used = rounds * roundDist;
          const easy = roundDist - 90;
          const items = [`${rounds} rounds speed ladder:`, `  · 15${u} acceleration + 25${u} max-quality + 50${u} fast/clean`, `  · ${easy}${u} easy choice / drill / aerobic reset`, "Increasing speed distance tests mechanics; recovery keeps the category as sprint rather than conditioning."];
          return addRemainder(items, dist-used, u, "easy technical reset to complete the main-set distance");
        },
      },
      {
        id: "race-start-cluster",
        build: () => {
          const qualityRep = 25;
          const qualityCount = Math.max(6, Math.min(12, Math.floor(dist / 100)));
          const quality = qualityCount * qualityRep;
          const support = Math.max(0, dist - quality);
          const items = [`${qualityCount}x25${u} race-start speed`, "Odd reps: breakout + first 6-8 strokes MAX · Even reps: fast finish into the wall.", "Full recovery 1:30-3:00. Quality threshold decides when to stop."];
          if (support > 0) items.push(`${support}${u} easy aerobic / drill swimming distributed between quality reps and after the final rep`);
          return items;
        },
      },
      {
        id: "resisted-release-support",
        build: () => {
          const rounds = 3;
          const qualityPerRound = 150; // 4x25 (first 15 fast + 10 easy) + 2x25 free speed
          const totalQuality = rounds * qualityPerRound;
          const support = Math.max(0, dist-totalQuality);
          const baseSupport = Math.floor(support/rounds/25)*25;
          const remainder = support-baseSupport*rounds;
          const items = [`${rounds} rounds resisted → free speed:`, `  · 4x25${u}: first 15${u} ${specialist}${resistance} MAX quality + easy to wall, rest 1:00-1:30`, `  · 2x25${u} ${specialist} free speed, rest 1:30-2:00`, `  · ${baseSupport}${u} easy choice / drill reset after each round`, "Low high-speed volume. End a round when acceleration or mechanics deteriorate."];
          return addRemainder(items, remainder, u, "easy choice to complete the main-set distance");
        },
      },
      {
        id: "25-on-off",
        build: () => {
          const pair=50, pairs=Math.floor(dist/pair), used=pairs*pair;
          const items=[`${pairs}x (25${u} sprint quality + 25${u} easy)`, `Fast 25: ${specialist} @ 95-100% with full technical intent. Easy 25: restore line, breathing and stroke length.`, "Add extra rest every 4-6 pairs so velocity remains the limiting variable."];
          return addRemainder(items,dist-used,u,"easy choice to complete the main-set distance");
        },
      },
      {
        id: "quality-50-plus-reset",
        build: () => {
          const cycle=ps===50?200:150, rounds=Math.max(1,Math.floor(dist/cycle)), used=rounds*cycle;
          const items=[`${rounds} rounds speed + reset:`, `  · 1x50${u} fast/clean ${specialist}`, `  · ${cycle-50}${u} easy choice, drill or relaxed aerobic swimming`, "Use the fast 50 only while speed and shape remain reproducible; recovery preserves sprint quality."];
          return addRemainder(items,dist-used,u,"easy technical reset to complete the main-set distance");
        },
      },
    ];
    return pickFresh(profile, "main-sprint", variants).build();
  }

  if (profile.goal === "technique") {
    const variants = [
      { id: "25-25", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} as 25 technical focus + 25 swim`,"easy technical choice to complete the block"); items.push(`Every 4th rep may include ${specialist} if skill quality remains stable.`); return items;} },
      { id: "drill-build-100", build: () => { const items=exactRepeatedItems(dist,100,u,(reps,rep)=>`${reps}x${rep}${u} skill transfer`,"easy technical choice to complete the block"); items.push(`25 drill + 25 swim + 25 build + 25 ${specialist}/choice maintaining the same technical cue.`); return items;} },
      { id: "tempo-control", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} technique with tempo control`,"easy technical choice to complete the block"); items.push("Alternate long-stroke/low-rate and slightly faster race-shaped rhythm without losing line."); return items;} },
      { id: "turn-skill", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} skill precision`,"easy technical choice to complete the block"); items.push("Cycle focus: entry/catch · body line · turn approach · breakout. Swim easy between high-attention reps."); return items;} },
      { id: "single-cue-25", build: () => { const items=exactRepeatedItems(dist,25,u,(reps,rep)=>`${reps}x${rep}${u} single-cue technical repeats`,"easy technical choice to complete the block"); items.push("Keep one cue for 4-8 reps, then change only after the athlete can reproduce it."); return items;} },
      { id: "skill-under-speed", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} skill under controlled speed`,"easy technical choice to complete the block"); items.push("First 25 precise, second 25 slightly faster while preserving the same movement pattern."); return items;} },
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
  const ps = poolSize(profile);
  const rep = ps === 50 ? 50 : 25;
  const variants = [
    { id: "10m-accel", cue: "acceleration from push, first 3 strokes", line: (reps) => `${reps}x${rep}${u}: first 10${u} MAX acceleration${load}, then easy to the wall` },
    { id: "15m-breakout", cue: "underwater + breakout speed", line: (reps) => `${reps}x${rep}${u}: first 15${u} MAX breakout speed${load}, then easy to the wall` },
    { id: "25m-max", cue: "max-quality speed with full mechanics", line: (reps) => `${reps}x${rep}${u} ${specialist}${load} @ 95-100%, full recovery` },
    { id: "mixed-15-25", cue: "contrast breakout speed with free swimming speed", line: (reps) => `${reps}x${rep}${u} alternating breakout-speed and free-speed emphasis` },
    { id: "turn-exit", cue: "turn exit and first-cycle speed", line: (reps) => `${reps}x${rep}${u} speed prep: turn/underwater exit into first 3-6 fast strokes` },
    { id: "build-to-max", cue: "smooth acceleration into maximum velocity", line: (reps) => `${reps}x${rep}${u} build-to-max speed prep with full recovery` },
  ];
  const chosen = pickFresh(profile, "speed-prep", variants);
  const plan = exactRepeatPlan(dist, rep, 1);
  const items = [];
  if (plan.reps > 0) items.push(chosen.line(plan.reps));
  items.push("Use full recovery between quality repetitions; speed and mechanics must remain reproducible.");
  items.push(`Focus: ${chosen.cue}. Stop the quality portion if speed, stroke count, or rhythm drops.`);
  return addRemainder(items, plan.remainder, u, "easy choice to complete the speed-prep distance");
}

function genCoolDown(profile, dist, u) {
  const specialist = specialistText(profile);
  const variants = [
    { id: "continuous", build: () => [`${dist}${u} easy freestyle/choice, change stroke or drill every 50-100${u}`, "Long relaxed stroke, low heart rate, easy breathing."] },
    { id: "split", build: () => { const first=Math.floor(dist*0.6/25)*25; const second=dist-first; return [`${first}${u} easy freestyle/choice, long relaxed stroke`, `${second}${u} choice drill/backstroke easy, deep relaxed breathing`]; } },
    { id: "50-reset", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} recovery reset`,"very easy choice"); items.push("Odd: easy free/choice · Even: backstroke or drill. No pace target."); return items;} },
    { id: "25-release", build: () => { const items=exactRepeatedItems(dist,25,u,(reps,rep)=>`${reps}x${rep}${u} very easy release`,"very easy choice"); items.push("Alternate long stroke, backstroke and simple drill; finish with calm breathing."); return items;} },
    { id: "breathing-reset", build: () => [`${dist}${u} easy choice with breathing reset`, "Reduce stroke rate gradually; use relaxed exhalation and long body line." ] },
    { id: "mixed-recovery", build: () => { const items=exactRepeatedItems(dist,50,u,(reps,rep)=>`${reps}x${rep}${u} mixed recovery`,"very easy choice"); items.push("Cycle easy free · backstroke · drill · choice. No hard kicking or resisted work."); return items;} },
  ];
  const items = pickFresh(profile, "cool-down", variants).build();
  if (specialistAllowedInMainOnly(profile)) items.push(`Cool-down should not be continuous ${specialist}; restore movement quality and breathing.`);
  if (profile.intensity === "hard" || profile.intensity === "race pace") items.push("Recovery quality matters — leave the pool fresher than the main set finished.");
  return items;
}

// ---- coaching points ----
function coachingPoints(profile) {
  const ps = poolSize(profile);
  const stroke = profile.stroke;
  const goal = profile.goal;
  const intensity = profile.intensity;
  const strokeVariants = {
    freestyle: [
      "Front-quadrant timing — begin the catch while the lead arm still gives length.",
      "Keep the head quiet and let rotation connect the catch to the hip.",
      "Hold water early; do not let the hand slip through the first half of the pull.",
      "Build speed from body line and catch pressure, not from rushed recovery.",
      "Keep kick timing connected to hip rotation as stroke rate rises.",
      "Enter clean, extend forward and keep pressure directed backward.",
      "Protect distance per stroke when effort increases.",
      "Accelerate the hand through the back half without shortening the front end.",
    ],
    backstroke: [
      "Keep the head still while the shoulders and hips rotate around the spine.",
      "Enter with control and establish pressure before accelerating the pull.",
      "Drive rotation from the hips; avoid swimming flat when tempo rises.",
      "Keep the kick narrow, continuous and connected to body line.",
      "Maintain a clean hand exit and relaxed recovery.",
      "Hold line through the shoulders so the pull does not cross under the body.",
    ],
    breaststroke: [
      "Finish the kick into a complete streamline before beginning the next pull.",
      "Keep the line narrow after the kick; do not rush the glide away.",
      "Use the kick to send the body forward, not upward.",
      "Recover the hands forward quickly while keeping the shoulders relaxed.",
      "Preserve timing as effort rises: pull, breathe, kick, line.",
      "Hold water with the forearms without making the pull too wide.",
    ],
    butterfly: [
      "Keep two connected kicks per cycle and let the chest rhythm drive the stroke.",
      "Breathe forward and low; return the head before the hands enter.",
      "Maintain pressure through the catch without forcing the shoulders.",
      "Keep the second kick connected to the finish of the pull.",
      "Protect rhythm before adding force or stroke rate.",
      "Use the body wave to carry speed forward, not up and down.",
    ],
    IM: [
      "Protect each transition; the turn and first strokes of the next leg are part of the race.",
      "Hold legal, efficient stroke mechanics before chasing tempo.",
      "Use the strongest stroke to create momentum without over-spending energy.",
      "Reset body line immediately after every turn.",
      "Keep the medley rhythm connected from fly through freestyle.",
      "Track where speed is lost between strokes, not only within each stroke.",
    ],
  };
  const goalVariants = {
    sprint: [
      "Speed first — extend recovery if velocity or mechanics begin to drop.",
      "The set stays sprint only while each quality rep is truly fast.",
      "Stop chasing volume when acceleration, breakout or stroke shape deteriorates.",
      "Use full recovery so the nervous system, not fatigue tolerance, drives the set.",
      "Compare the first and last quality reps; the performance band should stay narrow.",
      "Fast swimming should look technically organised, not frantic.",
      "If the athlete cannot reproduce speed, convert the next rep to easy reset rather than forcing it.",
      "Prioritise start, breakout and first-cycle speed before adding more sprint metres.",
    ],
    endurance: [
      "Hold a repeatable aerobic rhythm before increasing pressure.",
      "Keep the pace band narrow; aerobic quality comes from consistency.",
      "Do not trade stroke length for tempo too early in the set.",
      "Use breathing control and body line to protect efficiency under volume.",
      "Finish the set stronger only if mechanics remain stable.",
      "Track pace, stroke count and perceived effort together.",
    ],
    technique: [
      "One clear technical cue is more useful than five cues at once.",
      "Transfer the drill into normal swimming immediately.",
      "Slow the rep down if the athlete cannot feel the intended movement.",
      "Technical success is repeatable movement, not simply completing the distance.",
      "Choose the cue that changes propulsion or line, not the cue that only looks different.",
      "Progress from awareness to control, then to speed.",
    ],
    "race preparation": [
      "Race pace must include race details: turn, underwater, breakout and stroke rhythm.",
      "Use a narrow target band; one exceptional rep is less valuable than repeatability.",
      "Protect race-specific mechanics when fatigue begins to rise.",
      "Record where pace changes: start, middle, turn or finish.",
      "Enough recovery is required to rehearse the intended race, not a fatigued imitation of it.",
      "Use target pace as a reference, then coach the athlete in front of you.",
    ],
  };
  const intensityVariants = {
    recovery: ["Recovery intensity: conversational effort, relaxed breathing and no forced speed.", "Keep recovery genuinely easy; the goal is restoration, not hidden training load."],
    easy: ["Easy intensity: controlled aerobic swimming with full technical ownership.", "Keep effort below threshold; finish each block capable of another repeat."],
    moderate: ["Moderate intensity: stable pressure with room to lift pace without technical collapse.", "Control the middle of the set; do not turn moderate work into hard work by accident."],
    hard: ["Hard intensity: high training pressure, but quality still governs the final repetitions.", "Hard does not mean uncontrolled — hold the intended category and technical standard."],
    "race pace": ["Race-pace intensity: reproduce target rhythm, speed and race details with adequate recovery.", "Race pace is precision work; stop or reset if pace and mechanics leave the target band."],
  };
  const pts = [];
  pts.push(pick(strokeVariants[stroke] || strokeVariants.freestyle));
  pts.push(pick(goalVariants[goal] || goalVariants.endurance));
  pts.push(pick(intensityVariants[intensity] || intensityVariants.easy));
  if (ps === 25 && hasRaceFocus(profile)) pts.push("Short-course detail: protect speed into the wall and accelerate the breakout off every turn.");
  if (ps === 50 && hasRaceFocus(profile)) pts.push("Long-course detail: sustain speed through the full length and avoid deceleration into the wall.");
  if (eqIn(profile.equipment, "paddles")) pts.push("Paddles: keep pressure connected to body line; remove them if shoulder position or catch quality deteriorates.");
  if (eqIn(profile.equipment, "parachute") || eqIn(profile.equipment, "tubing")) pts.push("Resistance: use enough load to challenge acceleration without changing stroke mechanics.");
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

  const session = {
    session_id: createSessionId(),
    summary: buildSummary(profile, allocated),
    total_distance_m: Object.values(allocated).reduce((a, b) => a + b, 0),
    training_goal: profile.goal,
    intensity: profile.intensity,
    category: profile.goal === "sprint" ? "Speed / Sprint" : profile.goal === "race preparation" ? "Race Pace / Race Specific" : profile.goal === "technique" ? "Technique / Skill" : "Endurance / Aerobic",
    warm_up: {
      title: "Warm up",
      distance_m: allocated.warm_up,
      items: genWarmUp(profile, allocated.warm_up, u),
      energy_system: intensityCategory(profile, "warm_up"),
    },
    drill_set: {
      title: "Drill set",
      distance_m: allocated.drill_set,
      items: genDrillSet(profile, allocated.drill_set, u),
      energy_system: intensityCategory(profile, "drill_set"),
    },
    kick_set: {
      title: "Kick set",
      distance_m: allocated.kick_set,
      items: genKickSet(profile, allocated.kick_set, u),
      energy_system: intensityCategory(profile, "kick_set"),
    },
    sprint_or_pace_set: {
      title: "Speed prep set",
      distance_m: allocated.sprint_or_pace_set,
      items: genSprintSet(profile, allocated.sprint_or_pace_set, u),
      energy_system: intensityCategory(profile, "sprint_or_pace_set"),
    },
    main_set: {
      title: "Main set",
      distance_m: allocated.main_set,
      items: genMainSet(profile, allocated.main_set, u, profile.paceTarget),
      energy_system: intensityCategory(profile, "main_set"),
    },
    pull_set: {
      title: "Pull set",
      distance_m: allocated.pull_set,
      items: genPullSet(profile, allocated.pull_set, u),
      energy_system: intensityCategory(profile, "pull_set"),
    },
    cool_down: {
      title: "Cool down",
      distance_m: allocated.cool_down,
      items: genCoolDown(profile, allocated.cool_down, u),
      energy_system: intensityCategory(profile, "cool_down"),
    },
    coaching_points: coachingPoints(profile),
  };

  session.coach_brain = generateCoachBrain(profile, session);

  return session;
}
