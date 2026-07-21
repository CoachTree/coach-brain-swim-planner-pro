
// Coaching System - Coach Brain Engine
// Local rule-based coaching messages. No AI API, no network.

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

const PRINCIPLES = [
  {
    title: "Good Practice",
    text: "A good practice is one where the coach and athlete share a clear objective, then achieve it together.",
  },
  {
    title: "Victory",
    text: "Victory begins before defeating others. It begins when the athlete can control themselves under pressure.",
  },
  {
    title: "Success",
    text: "Success is built on repeated failure. Failure is not the opposite of success; it is part of the process.",
  },
  {
    title: "Talent",
    text: "Talent is not the starting point. Talent is the result of awareness, adaptation, and repeated growth.",
  },
  {
    title: "Effort",
    text: "Everyone is making effort. The difference is the heat, awareness, and direction of that effort.",
  },
  {
    title: "Coach Role",
    text: "The app provides the base. The coach creates the final value through observation, judgment, and adjustment.",
  },
];

const TECHNICAL_BY_GOAL = {
  endurance: [
    "Hold stroke length while fatigue slowly rises.",
    "Keep body position high before increasing effort.",
    "Maintain rhythm and line instead of chasing volume.",
  ],
  sprint: [
    "Protect the first three strokes after breakout.",
    "Swim fast only while mechanics stay clean.",
    "Long rest is part of speed training, not weakness.",
  ],
  technique: [
    "Make the movement repeatable before making it harder.",
    "Feel pressure on the water before adding speed.",
    "Today is about precision, not survival.",
  ],
  "race preparation": [
    "Connect race pace with stroke count, stroke rate, and breakout quality.",
    "Do not add speed if the race pattern disappears.",
    "Rehearse the race detail, not just the race effort.",
  ],
};

const MENTAL_BY_PHASE = {
  preparation: ["Be curious. Learn what the water is teaching you.", "Build habits slowly and correctly."],
  build: ["Consistency creates capacity.", "The goal is adaptation, not exhaustion."],
  "build kick/pull emphasis": ["Attack the part-strength work, but protect quality.", "Use variety to stay engaged and keep learning."],
  intensive: ["Stay calm when the session becomes uncomfortable.", "Pressure reveals habits. Keep your standards."],
  "race specific": ["Every repeat must connect to the race plan.", "Execute one detail at a time."],
  taper: ["Trust the work. Sharpen speed without creating fatigue.", "Confidence comes from preparation."],
  "race week": ["Stay composed. The work is already inside you.", "Simple execution beats emotional over-control."],
  recovery: ["Recovery is not wasted time. It is where adaptation is allowed to happen.", "Restore movement quality before adding load."],
  standalone: ["Know the purpose of the set before starting it.", "The base menu is a starting point; coaching completes it."],
};

function hashProfile(profile = {}) {
  const s = [profile.age, profile.level, profile.stroke, profile.goal, profile.distance, profile.intensity, profile.poolType, profile.sessionRole].join("|");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pick(list, h, offset = 0) {
  if (!list || !list.length) return "";
  return list[(h + offset) % list.length];
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

function objective(profile = {}) {
  const role = roleKey(profile);
  const stroke = profile.stroke || "choice";
  const goal = profile.goal || "balanced training";

  if (role === "build kick/pull emphasis") {
    return "Develop kick and pull as part-strength blocks while keeping the swim main set controlled enough to avoid empty fatigue.";
  }
  if (goal === "race preparation") {
    return `Prepare ${stroke} race performance by linking pace, breakout quality, stroke count, and back-half control.`;
  }
  if (goal === "sprint") {
    return `Create high-quality ${stroke} speed without allowing mechanics to collapse.`;
  }
  if (goal === "technique") {
    return `Improve repeatable ${stroke} movement quality before adding intensity.`;
  }
  return "Build useful capacity while keeping the athlete fresh enough to complete the main objective.";
}

export function generateCoachBrain(profile = {}, session = {}) {
  const h = hashProfile(profile);
  const role = roleKey(profile);
  const principle = pick(PRINCIPLES, h, 3);
  const technical = pick(TECHNICAL_BY_GOAL[profile.goal] || TECHNICAL_BY_GOAL.endurance, h, 1);
  const mental = pick(MENTAL_BY_PHASE[role] || MENTAL_BY_PHASE.standalone, h, 2);

  let coachTip = "Use this generated session as the base. Observe the swimmer, then adjust the detail that matters today.";
  if (role === "build kick/pull emphasis") {
    coachTip = "This day should not become only another swim main set. Let kick and pull carry the main training effect.";
  } else if (profile.goal === "race preparation") {
    coachTip = "Race preparation must be specific and clean. If the swimmer loses rhythm, reduce volume before adding effort.";
  } else if (profile.goal === "sprint") {
    coachTip = "Speed work needs recovery. If rest is too short, the session becomes conditioning, not speed development.";
  }

  const athleteReflection = pick([
    "What did you learn today that you did not know before the session?",
    "Where did you compete with yourself today, and where did you settle?",
    "What changed in your stroke, body, or mindset during the session?",
    "If this session were repeated tomorrow, what would you improve first?",
    "Did you understand the purpose of the session before starting the main set?",
  ], h, 4);

  const observationPrompts = [
    "What did you see that the app cannot see?",
    "Which swimmer needs a technical adjustment today?",
    "Does the main set still match the athlete in front of you?",
    "Should today become a kick, pull, turn, or breakout focused session instead?",
    "What one change would make this session more valuable?",
  ];

  return {
    phase: PHASE_LABELS[role] || PHASE_LABELS.standalone,
    objective: objective(profile),
    technical_focus: technical,
    mental_focus: mental,
    coach_tip: coachTip,
    athlete_reflection: athleteReflection,
    yuji_principle_title: principle.title,
    yuji_principle: principle.text,
    coach_adjustment_prompts: observationPrompts,
  };
}
