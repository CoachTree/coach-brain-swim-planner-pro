
/**
 * Rule-based modern swim season planner.
 * Static, local-only logic. No network, no AI API.
 */

const PHASE_LABELS = {
  preparation: "Preparation",
  build: "Build",
  intensive: "Intensive",
  raceSpecific: "Race Specific",
  taper: "Taper",
  raceWeek: "Race Week",
};

const PHASE_DESCRIPTIONS = {
  preparation:
    "Technique rebuild, aerobic base, mobility, movement quality, and low-cost consistency.",
  build:
    "Progressive aerobic power, threshold tolerance, kick/pull capacity, and durable technique.",
  intensive:
    "Targeted high-intensity work: race pace, VO2, lactate tolerance, and fatigue-resilient skills.",
  raceSpecific:
    "Event-specific pace, starts, breakouts, turns, race modelling, and confidence-building rehearsals.",
  taper:
    "Reduce total load while preserving speed, race rhythm, neural freshness, and confidence.",
  raceWeek:
    "Low fatigue, high clarity: starts, turns, breakouts, race plan, and relaxed speed.",
};


const COURSE_LABELS = {
  SCM: "Short course meters · 25m",
  LCM: "Long course meters · 50m",
  SCY: "Short course yards · 25y",
};

function courseContext(input = {}) {
  const targetCourse = input.targetCourse || (input.poolLength === "yards" ? "SCY" : input.poolLength === "25m" ? "SCM" : "LCM");
  const currentPBs = input.currentPBs || {};
  const relevantPB = currentPBs[targetCourse] || input.currentPB || "";
  return {
    targetCourse,
    targetCourseLabel: COURSE_LABELS[targetCourse] || targetCourse,
    currentPBs: {
      SCM: currentPBs.SCM || "",
      LCM: currentPBs.LCM || "",
      SCY: currentPBs.SCY || "",
    },
    relevantPB,
    goalTime: input.goalTime || "",
    note: "PBs are course-specific. Do not compare SCM, LCM, and SCY as the same performance without coach review or validated conversion logic.",
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function weeksBetween(start, end) {
  if (!start || !end) return 12;
  const ms = end.getTime() - start.getTime();
  return clamp(Math.ceil(ms / (1000 * 60 * 60 * 24 * 7)), 1, 24);
}

function eventGroup(mainEvent) {
  const e = String(mainEvent || "").toLowerCase();
  if (e.includes("50") || e.includes("100")) return "sprint";
  if (e.includes("200")) return "middle";
  if (e.includes("400") || e.includes("distance") || e.includes("800") || e.includes("1500")) return "distance";
  if (e.includes("im")) return "im";
  return "stroke";
}

function cycleType(weeks) {
  if (weeks <= 4) return "Mini Peak Plan";
  if (weeks <= 8) return "Short Cycle";
  if (weeks <= 12) return "Standard Cycle";
  if (weeks <= 18) return "Extended Build Cycle";
  return "Full Season Cycle";
}

function taperWeeks(weeks, pref, level) {
  if (pref && pref !== "auto") return Number(pref);
  if (weeks <= 4) return 0;
  if (weeks <= 8) return 1;
  if (weeks <= 12) return level === "national" ? 2 : 1;
  if (weeks <= 18) return 2;
  return 3;
}

function phaseDurations(totalWeeks, taperPref, level) {
  const raceWeek = 1;
  const taper = clamp(taperWeeks(totalWeeks, taperPref, level), 0, Math.max(0, totalWeeks - 2));
  const remaining = Math.max(0, totalWeeks - raceWeek - taper);

  if (totalWeeks <= 4) {
    return [
      ["build", Math.max(1, totalWeeks - 2)],
      ["taper", totalWeeks >= 3 ? 1 : 0],
      ["raceWeek", 1],
    ].filter(([, n]) => n > 0);
  }

  if (totalWeeks <= 8) {
    const build = Math.max(1, Math.round(remaining * 0.45));
    const intensive = Math.max(1, Math.round(remaining * 0.30));
    const raceSpecific = Math.max(1, remaining - build - intensive);
    return [["build", build], ["intensive", intensive], ["raceSpecific", raceSpecific], ["taper", taper], ["raceWeek", 1]].filter(([, n]) => n > 0);
  }

  if (totalWeeks <= 12) {
    const preparation = Math.max(1, Math.round(remaining * 0.20));
    const build = Math.max(2, Math.round(remaining * 0.35));
    const intensive = Math.max(2, Math.round(remaining * 0.25));
    const raceSpecific = Math.max(1, remaining - preparation - build - intensive);
    return [["preparation", preparation], ["build", build], ["intensive", intensive], ["raceSpecific", raceSpecific], ["taper", taper], ["raceWeek", 1]].filter(([, n]) => n > 0);
  }

  const preparation = Math.max(2, Math.round(remaining * 0.22));
  const build = Math.max(3, Math.round(remaining * 0.34));
  const intensive = Math.max(3, Math.round(remaining * 0.24));
  const raceSpecific = Math.max(2, remaining - preparation - build - intensive);
  return [["preparation", preparation], ["build", build], ["intensive", intensive], ["raceSpecific", raceSpecific], ["taper", taper], ["raceWeek", 1]].filter(([, n]) => n > 0);
}

const TARGETS = {
  sprint: {
    preparation: "Movement quality, streamline, start mechanics, low-volume speed skills",
    build: "Power base, kick speed, resisted sprint mechanics, aerobic support",
    intensive: "Max velocity, lactate tolerance, race-pace repeatability, long-rest quality",
    raceSpecific: "Start-breakout, 15m/25m speed, broken 50/100, finish skills",
    taper: "Freshness with short speed exposures and long recoveries",
    raceWeek: "Confidence, sharpness, race rhythm, no fatigue",
  },
  middle: {
    preparation: "Technique efficiency, aerobic base, stroke rhythm, kick durability",
    build: "Threshold, aerobic power, 100/200 pace control, turn efficiency",
    intensive: "Speed endurance, broken 200, race-pace under fatigue",
    raceSpecific: "4x50 target pace, 100/150 broken models, race distribution",
    taper: "Reduce volume while keeping race rhythm and speed endurance touches",
    raceWeek: "Clear race plan, smooth speed, turns and finishes",
  },
  distance: {
    preparation: "Economy, relaxed aerobic volume, negative-split habits",
    build: "Threshold, aerobic power, pace control, sustainable mechanics",
    intensive: "VO2 blocks, threshold-plus sets, controlled high-volume stress",
    raceSpecific: "Target pace repeats, negative split, fueling/recovery habits",
    taper: "Volume reduction with pace confidence and rhythm",
    raceWeek: "Light pace feel, relaxed confidence, no unnecessary fatigue",
  },
  im: {
    preparation: "Stroke balance, weak-stroke skills, transitions, mobility",
    build: "IM aerobic power, kick/pull balance, weak stroke development",
    intensive: "IM pace, transition stress, back-half tolerance",
    raceSpecific: "IM order modelling, turn transitions, weakest leg protection",
    taper: "Race rhythm across all strokes, short quality, freshness",
    raceWeek: "Transitions, starts, turns, confidence across all strokes",
  },
  stroke: {
    preparation: "Stroke-specific mechanics, aerobic base, skill consistency",
    build: "Threshold and technical durability in main stroke",
    intensive: "Race pace, speed endurance, fatigue-resilient technique",
    raceSpecific: "Event modelling, turns, pace precision, finish skills",
    taper: "Fresh race-specific speed and rhythm",
    raceWeek: "Low volume, high clarity, race confidence",
  },
};

function keySet(eventType, phase, weekInPhase, profile) {
  const unit = profile.poolLength === "yards" ? "yd" : "m";
  const level = profile.level;
  const event = profile.mainEvent;

  const sprintSets = {
    preparation: `8x15${unit} breakout skill, walk-back rest + 6x25${unit} smooth speed on 1:30`,
    build: `2 rounds: 4x25${unit} resisted or fins on 1:15 + 4x50${unit} easy technique`,
    intensive: `8x15${unit} max speed from push/dive on 1:30-2:00 + 4x25${unit} race tempo on 2:00`,
    raceSpecific: `Broken ${event}: 25${unit} + 25${unit} / long rest, exact race skills and finish`,
    taper: `6x15${unit} fast breakout on 1:30 + 2x25${unit} race-feel, full recovery`,
    raceWeek: `4x15${unit} breakout + 2x25${unit} relaxed fast, stop while sharp`,
  };

  const middleSets = {
    preparation: `12x50${unit} drill/swim by 25 on 1:00-1:15, hold stroke count`,
    build: `10x100${unit} threshold rhythm, descend 1-5 twice, technical cap`,
    intensive: `3 rounds: 4x50${unit} at 200 pace on 1:00 + 100${unit} easy`,
    raceSpecific: `4x50${unit} target 200 pace with 20-30s rest + 1x100${unit} controlled finish`,
    taper: `6x50${unit}: 2 pace, 2 easy, 2 pace-feel; full technical quality`,
    raceWeek: `3x50${unit} race rhythm with generous rest + turns/finish check`,
  };

  const distanceSets = {
    preparation: `3x600${unit} aerobic negative split, 30s rest, count strokes last 100`,
    build: `5x300${unit} threshold with last 50 strong, 30-40s rest`,
    intensive: `12x100${unit} at threshold-plus, every 4th strong, maintain efficiency`,
    raceSpecific: `8x100${unit} target race pace, strict rhythm, negative split final 4`,
    taper: `6x100${unit} race rhythm / easy alternation, leave the pool fresh`,
    raceWeek: `4x100${unit} light pace feel + 4x25${unit} relaxed fast`,
  };

  const imSets = {
    preparation: `12x50${unit} as 3 rounds of fly/back/breast/free drill-swim by 25`,
    build: `8x100${unit} IM aerobic, hold weak-stroke quality, 20s rest`,
    intensive: `4 rounds: 25${unit} fast weak stroke + 75${unit} IM pace, full control`,
    raceSpecific: `Broken IM: 4x50${unit} in race order at target rhythm, 30-45s rest`,
    taper: `8x25${unit} stroke rhythm in IM order, long rest, no strain`,
    raceWeek: `1 round IM order 25${unit} each + starts/turns, finish confident`,
  };

  const map = eventType === "sprint" ? sprintSets : eventType === "middle" ? middleSets : eventType === "distance" ? distanceSets : eventType === "im" ? imSets : middleSets;
  let set = map[phase] || map.build;
  if (level === "beginner") set = set.replace(/threshold-plus|lactate tolerance/gi, "controlled aerobic");
  return set;
}

function technicalFocus(eventType, phase, limitation) {
  const common = {
    preparation: "Body line, breathing rhythm, catch mechanics, and efficient kick timing",
    build: "Hold mechanics as distance and pressure increase",
    intensive: "Keep technical shape under speed and fatigue",
    raceSpecific: "Start, breakout, turn timing, finish skills, and pace precision",
    taper: "Race rhythm, water feel, relaxed speed",
    raceWeek: "Confidence cues, start/turn checklist, simple race plan",
  };
  const eventCue = {
    sprint: "Powerful breakout, low-drag acceleration, and long-rest quality",
    middle: "Pace accuracy, turn speed, and controlled back-half mechanics",
    distance: "Efficiency, stroke-count stability, and negative-split discipline",
    im: "Transitions, weak-stroke protection, and stroke rhythm changes",
    stroke: "Main-stroke efficiency and race-specific timing",
  };
  return `${common[phase]}. Priority: ${eventCue[eventType]}. Limitation focus: ${limitation}.`;
}

function drylandFocus(phase, level) {
  const base = {
    preparation: "Mobility, trunk control, scapular control, landing mechanics",
    build: "General strength, pull/kick support, medicine ball basics",
    intensive: "Power maintenance, low-volume explosive work, protect freshness",
    raceSpecific: "Short neural primers, mobility, start-power rehearsal",
    taper: "Very low volume activation, mobility, no soreness",
    raceWeek: "Activation only: bands, mobility, breathing routine",
  };
  return level === "beginner" ? base[phase].replace("Power", "Coordination") : base[phase];
}

function recoveryNote(phase, week, sessionsPerWeek) {
  if (phase === "intensive") return "Monitor mood, sleep, soreness, and stroke quality. Add recovery if speed drops.";
  if (phase === "taper") return "Reduce volume before reducing quality. Athlete should finish sessions feeling sharper.";
  if (phase === "raceWeek") return "No fitness gains are needed this week. Protect confidence and freshness.";
  if (sessionsPerWeek >= 6) return "Place at least one low-load or technical recovery session after key intensity work.";
  return "Keep easy days truly easy so quality days can stay high.";
}

function weeklyLoad(phase, baseVolume, taperIndex = 0) {
  const factors = {
    preparation: 0.75,
    build: 0.9,
    intensive: 1.0,
    raceSpecific: 0.82,
    taper: Math.max(0.42, 0.65 - taperIndex * 0.10),
    raceWeek: 0.32,
  };
  return Math.round((baseVolume * (factors[phase] || 0.8)) / 100) * 100;
}

export function generateSeasonPlan(input = {}) {
  const today = parseDate(input.currentDate) || new Date();
  const meet = parseDate(input.targetMeetDate);
  const weeks = weeksBetween(today, meet);
  const eventType = eventGroup(input.mainEvent);
  const course = courseContext(input);
  const phases = phaseDurations(weeks, input.taperPreference, input.level);
  const sessions = Number(input.sessionsPerWeek || 5);
  const duration = Number(input.sessionDuration || 90);
  const baseVolume = clamp(sessions * duration * 35, 6000, 65000); // rough weekly swim load proxy
  const targetMap = TARGETS[eventType] || TARGETS.stroke;

  const weeksOut = [];
  let weekNo = 1;
  const phasePlan = [];
  phases.forEach(([phase, count]) => {
    const start = weekNo;
    let taperIndex = 0;
    for (let i = 1; i <= count; i += 1) {
      const weekly = {
        week: weekNo,
        phase: PHASE_LABELS[phase],
        phaseKey: phase,
        weeklyGoal: targetMap[phase],
        physiologicalTarget:
          phase === "preparation" ? "Aerobic base + skill acquisition" :
          phase === "build" ? "Threshold / aerobic power development" :
          phase === "intensive" ? "High-intensity adaptation: VO2, lactate tolerance, race pace" :
          phase === "raceSpecific" ? "Event-specific pace, skills, and race modelling" :
          phase === "taper" ? "Fatigue reduction with speed maintenance" :
          "Freshness, confidence, and race execution",
        technicalFocus: technicalFocus(eventType, phase, input.mainLimitation || "balanced development"),
        keySet: keySet(eventType, phase, i, input),
        drylandFocus: drylandFocus(phase, input.level || "competitive"),
        recoveryNote: recoveryNote(phase, weekNo, sessions),
        estimatedWeeklyVolume: weeklyLoad(phase, baseVolume, taperIndex),
      };
      weeksOut.push(weekly);
      if (phase === "taper") taperIndex += 1;
      weekNo += 1;
    }
    phasePlan.push({
      phase: PHASE_LABELS[phase],
      phaseKey: phase,
      weeks: count,
      range: count === 1 ? `Week ${start}` : `Week ${start}-${weekNo - 1}`,
      purpose: PHASE_DESCRIPTIONS[phase],
    });
  });

  const priorities = {
    sprint: ["Start/breakout speed", "Max velocity with full recovery", "Lactate tolerance only when quality is high"],
    middle: ["Race pace accuracy", "Speed endurance", "Threshold support and turn efficiency"],
    distance: ["Aerobic power", "Pace control", "Efficiency under sustained load"],
    im: ["Stroke balance", "Transitions", "Weak stroke protection"],
    stroke: ["Stroke-specific efficiency", "Race pace", "Technical consistency under fatigue"],
  }[eventType];

  return {
    weeks,
    cycleType: cycleType(weeks),
    eventType,
    courseContext: course,
    overview: {
      strategy: `Build toward ${input.mainEvent || "the target event"} in ${course.targetCourseLabel} with a ${cycleType(weeks).toLowerCase()} that balances adaptation, recovery, race-specificity, and taper freshness.`,
      priorities,
      peakStrategy:
        "Progress from general capacity to race-specific quality. Protect the final 7-21 days for fatigue reduction while preserving speed stimulus.",
      evidenceNote:
        "Evidence-informed logic: periodized load progression, event specificity, high-quality speed with long rest, and taper volume reduction while maintaining intensity.",
    },
    phasePlan,
    weeklyPlan: weeksOut,
    input,
  };
}

export function copySeasonPlanText(plan) {
  const lines = [];
  lines.push("SWIM SEASON PLAN");
  lines.push("=".repeat(28));
  lines.push(`${plan.cycleType} · ${plan.weeks} weeks`);
  lines.push(plan.overview.strategy);
  if (plan.courseContext) {
    lines.push(`Course: ${plan.courseContext.targetCourseLabel}`);
    lines.push(`Current PB used: ${plan.courseContext.relevantPB || "Not entered"}`);
    lines.push(`Goal time: ${plan.courseContext.goalTime || "Not entered"}`);
    lines.push(`SCM PB: ${plan.courseContext.currentPBs?.SCM || "-"} / LCM PB: ${plan.courseContext.currentPBs?.LCM || "-"} / SCY PB: ${plan.courseContext.currentPBs?.SCY || "-"}`);
  }
  lines.push("");
  lines.push("PERFORMANCE PRIORITIES");
  plan.overview.priorities.forEach((p) => lines.push(`• ${p}`));
  lines.push("");
  lines.push("PHASE PLAN");
  plan.phasePlan.forEach((p) => lines.push(`• ${p.range}: ${p.phase} — ${p.purpose}`));
  lines.push("");
  lines.push("WEEKLY PLAN");
  plan.weeklyPlan.forEach((w) => {
    lines.push(`Week ${w.week} · ${w.phase}`);
    lines.push(`Goal: ${w.weeklyGoal}`);
    lines.push(`Target: ${w.physiologicalTarget}`);
    lines.push(`Technical: ${w.technicalFocus}`);
    lines.push(`Key set: ${w.keySet}`);
    lines.push(`Dryland: ${w.drylandFocus}`);
    lines.push(`Recovery: ${w.recoveryNote}`);
    lines.push("");
  });
  return lines.join("\n");
}
