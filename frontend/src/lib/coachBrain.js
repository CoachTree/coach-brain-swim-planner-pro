// Coaching System - Coach Brain Engine v2
// Local rule-based coaching messages. No AI API, no network.
// Adds profile-aware variety and avoids the five most recent messages per field.

const PHASE_LABELS = {
  standalone: "Foundation session",
  "build kick/pull emphasis": "Build phase · Kick/Pull emphasis",
  build: "Build phase",
  preparation: "Preparation phase",
  intensive: "Intensive phase",
  "race specific": "Race Specific phase",
  taper: "Taper phase",
  "race week": "Race Week",
  recovery: "Recovery / Regeneration",
};

const RECENT_LIMIT = 5;
const MESSAGE_HISTORY = new Map();

function profileKey(profile = {}, field = "general") {
  return [
    field,
    profile.age ?? "",
    profile.level || "",
    profile.stroke || "",
    profile.goal || "",
    profile.intensity || "",
    profile.poolType || "",
    roleKey(profile),
  ].join("|");
}

function pickFresh(profile, field, list, rng = Math.random) {
  if (!Array.isArray(list) || !list.length) return "";
  const key = profileKey(profile, field);
  const recent = MESSAGE_HISTORY.get(key) || [];
  let candidates = list.filter((_, index) => !recent.includes(index));
  if (!candidates.length) candidates = list;
  const chosenText = candidates[Math.floor(rng() * candidates.length)];
  const chosenIndex = list.indexOf(chosenText);
  const nextRecent = [chosenIndex, ...recent.filter((index) => index !== chosenIndex)].slice(
    0,
    Math.min(RECENT_LIMIT, Math.max(1, list.length - 1)),
  );
  MESSAGE_HISTORY.set(key, nextRecent);
  return chosenText;
}

function roleKey(profile = {}) {
  const raw = String(profile.sessionRole || "standalone").toLowerCase();
  if (raw.includes("kick/pull")) return "build kick/pull emphasis";
  if (raw.includes("race week")) return "race week";
  if (raw.includes("race specific")) return "race specific";
  if (raw.includes("recovery")) return "recovery";
  if (raw.includes("taper")) return "taper";
  if (raw.includes("intensive")) return "intensive";
  if (raw.includes("build")) return "build";
  if (raw.includes("preparation")) return "preparation";
  return "standalone";
}

function strokeName(profile = {}) {
  return profile.stroke === "IM" ? "IM" : profile.stroke || "choice";
}

function intensityDescriptor(profile = {}) {
  const map = {
    recovery: "very low-load recovery",
    easy: "low-intensity aerobic",
    moderate: "controlled moderate-intensity",
    hard: "high-intensity",
    "race pace": "race-specific",
  };
  return map[profile.intensity] || "controlled";
}

function trainingCategory(profile = {}) {
  if (profile.goal === "sprint") return profile.intensity === "race pace" ? "Race-speed / SP2" : "Sprint speed / SP2";
  if (profile.goal === "race preparation" || profile.intensity === "race pace") return "Race pace / RP";
  if (profile.goal === "technique") return profile.intensity === "hard" ? "Skill under pressure / SK2" : "Technical skill / SK1";
  if (profile.intensity === "recovery") return "Recovery / REC";
  if (profile.intensity === "hard") return "Aerobic power / EN3";
  if (profile.intensity === "moderate") return "Aerobic development / EN2";
  return "Aerobic base / EN1";
}

const PRINCIPLES = [
  { title: "Good Practice", text: "A useful practice starts with a clear objective and finishes with evidence that the athlete understood it." },
  { title: "Quality", text: "More work is not automatically better work. Protect the quality that creates the adaptation you actually want." },
  { title: "Awareness", text: "Athletes improve faster when they can feel, describe, and reproduce what good movement is." },
  { title: "Consistency", text: "Performance grows from repeatable standards, not occasional exceptional sessions." },
  { title: "Adaptation", text: "Training creates a stimulus; recovery and repetition turn that stimulus into adaptation." },
  { title: "Talent", text: "Talent is not the starting point. It is built through awareness, adaptation, and repeated growth." },
  { title: "Pressure", text: "Pressure does not create habits; it exposes them. Train the habits you want to see in racing." },
  { title: "Precision", text: "A small technical improvement repeated well can be more valuable than extra volume completed poorly." },
  { title: "Coach Role", text: "The app provides structure. The coach creates value through observation, judgment, and adjustment." },
  { title: "Progress", text: "Progress is not one perfect session. It is a sequence of useful sessions moving in the same direction." },
];

const TECHNICAL_BY_GOAL = {
  endurance: [
    "Hold stroke length while fatigue gradually rises.",
    "Keep body position high before asking for more speed.",
    "Maintain rhythm and line instead of chasing volume mechanically.",
    "Protect the catch as breathing rate increases.",
    "Keep the kick connected to body line rather than using it only to survive fatigue.",
    "Maintain stable turns and breakouts even when the aerobic work becomes uncomfortable.",
    "Use stroke count as a guardrail for efficiency, not as a target to force.",
    "Keep the final third technically similar to the first third.",
  ],
  sprint: [
    "Protect acceleration through the first three strokes after breakout.",
    "Swim fast only while mechanics remain clean and reproducible.",
    "Create speed from line, catch, and acceleration rather than extra tension.",
    "Hold the head and trunk stable when stroke rate increases.",
    "Attack the wall without shortening the final strokes.",
    "Keep breakout distance and first-stroke timing consistent across repetitions.",
    "Use full recovery so each sprint is truly a speed repetition.",
    "Stop adding speed when technical shape starts to deteriorate.",
  ],
  technique: [
    "Make the movement repeatable before making it faster.",
    "Feel pressure on the water before increasing effort.",
    "Change one technical variable at a time so the athlete can identify cause and effect.",
    "Carry the drill feeling into normal swimming immediately after the drill.",
    "Keep technical cues simple enough to reproduce without overthinking.",
    "Use the same body line at easy and moderate speed.",
    "Prioritise timing and balance before adding force.",
    "Finish each repetition with the same technical cue used at the start.",
  ],
  "race preparation": [
    "Connect race pace with stroke count, stroke rate, and breakout quality.",
    "Do not add speed if the race pattern disappears.",
    "Rehearse race detail, not just race effort.",
    "Make every turn and breakout part of the pace prescription.",
    "Hold target rhythm through the back half instead of over-swimming the first half.",
    "Use recovery to reproduce the race pattern accurately.",
    "Treat approach strokes, wall contact, and first strokes out as one continuous skill.",
    "Keep race-specific mechanics inside a narrow repeatable performance band.",
  ],
};

const MENTAL_BY_PHASE = {
  preparation: ["Be curious about what the water is teaching you.", "Build the habit correctly before trying to build it quickly.", "Use each repetition to learn one thing about your movement.", "Leave the session understanding the skill better than when you started.", "Do not rush adaptation; repeat good habits until they feel normal.", "Stay patient with technical change and precise with execution."],
  build: ["Consistency creates capacity.", "The goal is adaptation, not exhaustion.", "Keep standards high even as the work grows.", "Build the ability to repeat good swimming under increasing load.", "Do not confuse tiredness with progress.", "Accumulate useful work without losing the purpose of the set."],
  "build kick/pull emphasis": ["Attack the part-strength work while protecting movement quality.", "Use variety to stay engaged without losing the session objective.", "Treat kick and pull as performance tools, not filler volume.", "Stay disciplined when the work shifts away from full-stroke swimming.", "Build strength in the parts, then reconnect it to the whole stroke.", "Keep pressure consistent rather than chasing one exceptional repetition."],
  intensive: ["Stay calm when the session becomes uncomfortable.", "Pressure reveals habits; keep your standards.", "Commit to the process when the body starts asking for shortcuts.", "Control the first response to fatigue before trying to control the pace.", "Keep decision-making simple when intensity rises.", "Strong execution under pressure matters more than emotional effort."],
  "race specific": ["Every repeat must connect to the race plan.", "Execute one race detail at a time.", "Use each repeat as rehearsal, not just hard swimming.", "Race rhythm should feel familiar before race day.", "Protect the plan when fatigue tries to change it.", "Measure success by repeatability, not by one heroic effort."],
  taper: ["Trust the work and sharpen speed without creating fatigue.", "Confidence comes from preparation, not extra last-minute volume.", "Leave the pool wanting to do more rather than needing recovery from too much.", "Keep the nervous system sharp and the mind quiet.", "Small doses of quality are enough now.", "Do not chase fitness during taper; protect freshness."],
  "race week": ["Stay composed; the work is already inside you.", "Simple execution beats emotional over-control.", "Keep attention on controllable race details.", "Race week is for confidence, rhythm, and clarity.", "Do not invent new problems before the race.", "Use familiar cues and trust established routines."],
  recovery: ["Recovery is where adaptation is allowed to happen.", "Restore movement quality before adding load.", "Keep the ego out of recovery work.", "Easy swimming should finish with the athlete feeling better, not flatter.", "Use recovery to reset rhythm, breathing, and body position.", "Leave enough energy for the next meaningful training stimulus."],
  standalone: ["Know the purpose of the set before starting it.", "The base menu is a starting point; coaching completes it.", "Decide what success looks like before the main set begins.", "Stay connected to the objective instead of simply completing distance.", "Make each block serve the same overall training purpose.", "Finish the session able to explain what improved and why."],
};

const OBJECTIVES_BY_GOAL = {
  endurance: [
    (s) => `Build repeatable ${s} aerobic capacity while protecting stroke efficiency.`,
    (s) => `Develop sustainable ${s} speed without allowing technique to erode under fatigue.`,
    (s) => `Improve ${s} aerobic durability while keeping body line, rhythm, and catch quality stable.`,
    (s) => `Accumulate useful ${s} aerobic work with enough control to preserve technical standards.`,
    (s) => `Raise repeatable ${s} training capacity while keeping the final repetitions mechanically sound.`,
    (s) => `Build endurance that transfers to better ${s} performance, not just more completed distance.`,
  ],
  sprint: [
    (s) => `Create high-quality ${s} speed without allowing mechanics to collapse.`,
    (s) => `Develop maximum-velocity ${s} swimming with enough recovery to reproduce speed.`,
    (s) => `Improve ${s} acceleration, breakout quality, and speed maintenance over short efforts.`,
    (s) => `Train true ${s} speed while keeping tension low and technical shape stable.`,
    (s) => `Build repeatable ${s} sprint quality rather than turning the session into conditioning.`,
    (s) => `Expose the athlete to high ${s} velocity while protecting acceleration and stroke mechanics.`,
    (s) => `Sharpen ${s} speed through quality repetitions, full recovery, and strict technical standards.`,
  ],
  technique: [
    (s) => `Improve repeatable ${s} movement quality before adding intensity.`,
    (s) => `Make one or two ${s} technical changes clear enough to reproduce without conscious overload.`,
    (s) => `Convert ${s} drill awareness into cleaner full-stroke swimming.`,
    (s) => `Improve ${s} timing, balance, and feel for the water with low technical noise.`,
    (s) => `Build a more efficient ${s} pattern that remains stable as speed increases slightly.`,
    (s) => `Create technical consistency in ${s} by repeating high-quality movement rather than chasing fatigue.`,
  ],
  "race preparation": [
    (s) => `Prepare ${s} race performance by linking pace, breakout quality, stroke count, and back-half control.`,
    (s) => `Rehearse ${s} race rhythm under controlled fatigue while preserving starts, turns, and breakouts.`,
    (s) => `Improve ${s} race-specific repeatability inside a narrow target-performance band.`,
    (s) => `Connect ${s} pace, stroke rate, and technical detail so the race pattern remains stable under pressure.`,
    (s) => `Build confidence in the ${s} race plan through precise, repeatable race-specific work.`,
    (s) => `Rehearse the key ${s} race demands without adding fatigue that reduces technical quality.`,
  ],
};

const COACH_TIPS_BY_GOAL = {
  endurance: [
    "Aerobic work should finish with the stroke still organised. Reduce pace before allowing technique to unravel.",
    "Watch the final third of the set closely. That is where efficiency often disappears first.",
    "Use stroke count, breathing pattern, and turn quality to judge whether the aerobic load is still productive.",
    "Do not reward extra distance if it is completed with poor line and rushed mechanics.",
    "Keep aerobic intensity honest. If the athlete drifts too hard, the purpose of the set changes.",
    "Progress endurance by improving repeatability before simply increasing volume.",
  ],
  sprint: [
    "Speed work needs recovery. If rest is too short, the session becomes conditioning rather than speed development.",
    "End the sprint set when velocity or mechanics fall outside the quality standard.",
    "Do not use fatigue as proof of a good sprint session. Use speed, acceleration, and repeatability.",
    "Give enough rest to make every sprint meaningful. The recovery is part of the prescription.",
    "Keep high-speed volume low enough that the athlete can attack every quality repetition.",
    "If the athlete adds tension to create speed, reduce the demand and restore technical shape first.",
    "Use timing, stroke count, or breakout distance to define a quality threshold before the set begins.",
  ],
  technique: [
    "Use one clear cue at a time. Too many corrections reduce learning quality.",
    "Move from drill to swim quickly so the athlete can connect the feeling to full stroke.",
    "If the athlete cannot describe the technical goal, simplify the cue before adding more repetitions.",
    "Technical work should become more automatic across the set, not more complicated.",
    "Correct the largest movement error first; do not chase every small detail at once.",
    "Use speed only when the athlete can preserve the technical change under slightly more pressure.",
  ],
  "race preparation": [
    "Race preparation must be specific and clean. If rhythm disappears, reduce volume before adding effort.",
    "Judge the set by how closely each quality repeat matches the race plan, not by total suffering.",
    "Track one or two race metrics consistently: pace, stroke count, stroke rate, breakout distance, or turn quality.",
    "Keep recovery long enough to reproduce the race pattern accurately.",
    "Race-specific work should sharpen confidence. If the athlete becomes mechanically chaotic, the dose is too high.",
    "Protect the back-half race pattern. Early speed is only useful if the athlete can still execute late.",
  ],
};

const REFLECTIONS_BY_GOAL = {
  endurance: [
    "Where did your stroke begin to change as fatigue increased?",
    "Which repetition felt most efficient, and what made it different?",
    "Could you hold the same rhythm at the end as at the beginning?",
    "What helped you maintain body line when the aerobic work became harder?",
    "Where did you lose efficiency first: catch, kick, breathing, turn, or rhythm?",
    "If you repeated the set tomorrow, what would you control better?",
  ],
  sprint: [
    "Which sprint felt fastest without feeling forced?",
    "When did your acceleration or breakout quality begin to drop?",
    "What technical cue helped you create speed with less tension?",
    "Could you reproduce the same first three strokes on every quality repetition?",
    "Where did speed come from today: better line, stronger catch, faster rate, or better timing?",
    "What would you change to make the next sprint faster without adding effort?",
  ],
  technique: [
    "What technical change could you actually feel in the water today?",
    "Which drill transferred best into normal swimming?",
    "Could you reproduce the same movement without thinking about it every stroke?",
    "What one cue made the largest difference to your stroke?",
    "Did the technical change survive when you increased speed slightly?",
    "What movement still feels unclear and needs another attempt?",
  ],
  "race preparation": [
    "Which part of the race pattern was most repeatable today?",
    "Where did your target rhythm start to break down?",
    "Did your turns and breakouts support the pace or cost you speed?",
    "How close was your final quality repetition to your best one?",
    "Which race detail needs the most attention before competition?",
    "Did you execute the race plan, or did effort change the plan?",
  ],
};

const ADJUSTMENT_PROMPTS = [
  "What did you see that the app cannot see?",
  "Which swimmer needs a technical adjustment today?",
  "Does the main set still match the athlete in front of you?",
  "Should the next block become more technical, more aerobic, or more speed-focused?",
  "What one change would make this session more valuable?",
  "Is the athlete still inside the intended intensity and energy-system category?",
  "Has the quality threshold been reached before the prescribed volume is complete?",
  "Does the athlete need more recovery to preserve the purpose of the set?",
  "What metric will you use to judge whether the next repetition is still useful?",
  "Should volume be reduced today to protect the quality of tomorrow's training?",
];

function objectiveOptions(profile = {}) {
  const stroke = strokeName(profile);
  const role = roleKey(profile);
  if (role === "build kick/pull emphasis") {
    return [
      "Develop kick and pull as part-strength blocks while keeping the swim main set controlled enough to avoid empty fatigue.",
      "Build propulsion through kick and pull work, then reconnect that strength to clean full-stroke swimming.",
      "Use kick and pull volume to strengthen the parts of the stroke without turning the session into survival work.",
      "Increase part-specific strength and pressure while preserving technical quality across the session.",
      "Create a meaningful kick/pull training effect while keeping the final swim work technically organised.",
      "Develop part-strength with enough recovery and control that the athlete can transfer it back into swimming.",
    ];
  }
  const builders = OBJECTIVES_BY_GOAL[profile.goal] || OBJECTIVES_BY_GOAL.endurance;
  return builders.map((fn) => fn(stroke));
}

function mentalOptions(profile = {}) {
  return MENTAL_BY_PHASE[roleKey(profile)] || MENTAL_BY_PHASE.standalone;
}

function technicalOptions(profile = {}) {
  const base = TECHNICAL_BY_GOAL[profile.goal] || TECHNICAL_BY_GOAL.endurance;
  const stroke = strokeName(profile);
  const extras = {
    freestyle: ["Keep the lead arm connected to the catch as rotation begins.", "Hold hip-driven alignment as stroke rate rises."],
    backstroke: ["Keep head position stable while rotation drives the stroke.", "Maintain clean hand entry and continuous rotation through the hips."],
    breaststroke: ["Finish the kick into a complete line before starting the next pull.", "Keep the pull compact enough that recovery returns quickly to streamline."],
    butterfly: ["Keep the second kick connected to hand exit and forward recovery.", "Protect body rhythm before trying to increase stroke rate."],
    IM: ["Protect transition quality so the next stroke begins with rhythm, not panic.", "Treat every wall as the start of the next stroke segment."],
  };
  return [...base, ...(extras[stroke] || [])];
}

function coachTipOptions(profile = {}) {
  const role = roleKey(profile);
  if (role === "build kick/pull emphasis") {
    return [
      "Let kick and pull carry the main training effect today; do not turn the session back into another swim-main day.",
      "Judge part-strength work by pressure and technical stability, not by how tired the athlete becomes.",
      "If kick or pull mechanics deteriorate, reduce load before adding more volume.",
      "Use the full-stroke work to reconnect the strength created in the kick and pull blocks.",
      "Keep shoulder load sensible in pull work and protect body line in kick work.",
      "Part-strength training is valuable only if it transfers back into better swimming mechanics.",
    ];
  }
  return COACH_TIPS_BY_GOAL[profile.goal] || [
    "Use this generated session as the base. Observe the swimmer and adjust the detail that matters today.",
    "Protect the training objective even if that means changing the prescribed volume.",
    "The best adjustment is the smallest one that keeps the session physiologically and technically on target.",
    "Use the plan as a framework, then coach the athlete who is actually in front of you.",
    "If the athlete leaves the intended category, adjust pace, rest, or volume immediately.",
    "A correct session is one that produces the intended adaptation, not one that merely matches the printed page.",
  ];
}

function reflectionOptions(profile = {}) {
  return REFLECTIONS_BY_GOAL[profile.goal] || [
    "What did you learn today that you did not know before the session?",
    "Where did you compete with yourself today, and where did you settle?",
    "What changed in your stroke, body, or mindset during the session?",
    "If this session were repeated tomorrow, what would you improve first?",
    "Did you understand the purpose of the session before starting the main set?",
    "Which part of the session created the most useful learning?",
  ];
}

function intensityNote(profile = {}) {
  const notes = {
    recovery: [
      "Keep RPE low and breathing relaxed; the athlete should finish fresher than they started.",
      "No block should drift into threshold work today.",
      "The correct intensity is easy enough to restore rhythm and movement quality.",
      "Use pace only as a ceiling; recovery quality is the priority.",
      "Reduce distance if fatigue prevents genuine regeneration.",
      "Recovery sessions should protect tomorrow's training, not compete with it.",
    ],
    easy: [
      "Keep the effort comfortably aerobic and technically controlled.",
      "The athlete should be able to repeat the same mechanics without strain.",
      "Do not let easy work creep into moderate intensity because the athlete feels good.",
      "Use relaxed breathing and stable stroke length to confirm the intensity.",
      "Easy training should accumulate quality without creating unnecessary residual fatigue.",
      "Keep the effort below the point where technique needs compensation.",
    ],
    moderate: [
      "Hold controlled pressure without allowing the set to become threshold survival work.",
      "Moderate means sustainable quality, not halfway to maximal effort.",
      "Use repeatability and technical stability to control the pace.",
      "The athlete should feel challenged but still able to make technical decisions.",
      "Avoid early over-pacing; the final third should remain organised.",
      "Keep effort stable enough that mechanics remain coachable throughout the set.",
    ],
    hard: [
      "High intensity is appropriate only while the set remains inside the intended energy-system category.",
      "Hard work should create a specific training effect, not uncontrolled fatigue.",
      "Use rest and volume to preserve the quality required by today's goal.",
      "Define a technical or performance threshold before the hard work begins.",
      "If mechanics collapse, the athlete has left the useful part of the set.",
      "Protect quality first; extra hard volume is optional, not mandatory.",
    ],
    "race pace": [
      "Race pace must look like racing: pace, rhythm, turns, and breakouts all matter.",
      "Use enough recovery to reproduce the target pattern accurately.",
      "Do not accept a fast time produced with the wrong race mechanics.",
      "Keep the athlete inside a narrow performance band rather than chasing one best repeat.",
      "Race-pace training should increase confidence in the plan, not uncertainty.",
      "Stop or modify the block when race-specific quality is no longer repeatable.",
    ],
  };
  return notes[profile.intensity] || notes.easy;
}

export function generateCoachBrain(profile = {}, session = {}) {
  const role = roleKey(profile);
  const principle = pickFresh(profile, "principle", PRINCIPLES);

  const technical = pickFresh(profile, "technical", technicalOptions(profile));
  const mental = pickFresh(profile, "mental", mentalOptions(profile));
  const objective = pickFresh(profile, "objective", objectiveOptions(profile));
  const coachTip = pickFresh(profile, "coach-tip", coachTipOptions(profile));
  const athleteReflection = pickFresh(profile, "reflection", reflectionOptions(profile));
  const intensityCue = pickFresh(profile, "intensity-cue", intensityNote(profile));

  const observationPrompts = [];
  const promptPool = [...ADJUSTMENT_PROMPTS];
  while (observationPrompts.length < 5 && promptPool.length) {
    const idx = Math.floor(Math.random() * promptPool.length);
    observationPrompts.push(promptPool.splice(idx, 1)[0]);
  }

  return {
    phase: PHASE_LABELS[role] || PHASE_LABELS.standalone,
    objective,
    technical_focus: technical,
    mental_focus: mental,
    coach_tip: coachTip,
    athlete_reflection: athleteReflection,
    yuji_principle_title: principle.title,
    yuji_principle: principle.text,
    coach_adjustment_prompts: observationPrompts,

    // Optional v2 metadata. Existing UI can ignore these safely.
    training_category: trainingCategory(profile),
    intensity_label: `${String(profile.intensity || "easy").replace(/\b\w/g, (c) => c.toUpperCase())} · ${intensityDescriptor(profile)}`,
    intensity_coaching_note: intensityCue,
  };
}
