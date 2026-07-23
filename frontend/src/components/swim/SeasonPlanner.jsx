
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Copy, Target, Dumbbell, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TileGroup from "@/components/swim/TileGroup";
import { copySeasonPlanText, generateSeasonPlan } from "@/lib/seasonPlanner";

const LEVELS = ["beginner", "intermediate", "competitive", "national"];
const EVENTS = ["50 free", "100 free", "200 free", "400 free", "distance", "IM", "stroke"];
const SESSION_COUNTS = [3, 4, 5, 6, 7, 8];
const DURATIONS = [60, 75, 90, 105, 120];
const POOLS = ["25m", "50m", "yards"];
const COURSE_TYPES = ["SCM", "LCM", "SCY"];
const COURSE_LABELS = {
  SCM: "Short course meters · 25m",
  LCM: "Long course meters · 50m",
  SCY: "Short course yards · 25y",
};
const LIMITATIONS = ["speed", "endurance", "back half", "technique", "starts/turns", "race pace"];
const TAPERS = ["auto", "1", "2", "3"];
const STYLES = [
  "balanced modern",
  "sprint focus",
  "endurance focus",
  "race pace focus",
  "technique rebuild",
  "junior development",
  "national level preparation",
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultMeetISO() {
  const d = new Date();
  d.setDate(d.getDate() + 84);
  return d.toISOString().slice(0, 10);
}

function FieldLabel({ children }) {
  return <label className="label-eyebrow block mb-3">{children}</label>;
}

function InfoCard({ icon: Icon, title, children }) {
  return (
    <div className="border border-[#CBD5E1] rounded-sm p-4 bg-white">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="h-4 w-4 text-[#003366]" />}
        <h4 className="font-display font-black text-[#0F172A]">{title}</h4>
      </div>
      <div className="text-sm text-[#475569] leading-relaxed">{children}</div>
    </div>
  );
}

export default function SeasonPlanner() {
  const [currentDate, setCurrentDate] = useState(todayISO());
  const [targetMeetDate, setTargetMeetDate] = useState(defaultMeetISO());
  const [age, setAge] = useState(16);
  const [level, setLevel] = useState("competitive");
  const [mainEvent, setMainEvent] = useState("100 free");
  const [currentPBs, setCurrentPBs] = useState({ SCM: "", LCM: "", SCY: "" });
  const [targetCourse, setTargetCourse] = useState("LCM");
  const [goalTime, setGoalTime] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState(5);
  const [sessionDuration, setSessionDuration] = useState(90);
  const [poolLength, setPoolLength] = useState("50m");
  const [mainLimitation, setMainLimitation] = useState("race pace");
  const [taperPreference, setTaperPreference] = useState("auto");
  const [trainingStyle, setTrainingStyle] = useState("balanced modern");
  const [plan, setPlan] = useState(null);

  const input = useMemo(
    () => ({
      currentDate,
      targetMeetDate,
      age: Number(age),
      level,
      mainEvent,
      currentPBs,
      targetCourse,
      goalTime,
      sessionsPerWeek,
      sessionDuration,
      poolLength,
      mainLimitation,
      taperPreference,
      trainingStyle,
    }),
    [
      currentDate,
      targetMeetDate,
      age,
      level,
      mainEvent,
      currentPBs,
      targetCourse,
      goalTime,
      sessionsPerWeek,
      sessionDuration,
      poolLength,
      mainLimitation,
      taperPreference,
      trainingStyle,
    ],
  );

  const handleGenerate = () => {
    try {
      const result = generateSeasonPlan(input);
      setPlan(result);
      toast.success("Season plan ready");
      setTimeout(() => {
        document.getElementById("season-plan-result")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    } catch (e) {
      toast.error("Could not generate season plan");
    }
  };

  const handleCopy = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(copySeasonPlanText(plan));
      toast.success("Season plan copied");
    } catch {
      toast.error("Could not copy season plan");
    }
  };

  const volumeUnit = poolLength === "yards" ? "yd" : "m";

  return (
    <div data-testid="season-planner-page">
      <div className="mb-10 sm:mb-12">
        <div className="label-eyebrow mb-3">Build a season</div>
        <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-[#0F172A] leading-[0.95]">
          Plan the peak
          <br />
          <span className="text-[#003366]">from race day.</span>
        </h2>
        <p className="mt-5 text-base sm:text-lg text-[#475569] max-w-lg leading-relaxed">
          Create a 1–24 week evidence-informed training cycle with preparation,
          build, intensive, race-specific, taper and race-week phases.
        </p>
      </div>

      <section className="space-y-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>01 · Current date</FieldLabel>
            <Input
              type="date"
              value={currentDate}
              onChange={(e) => setCurrentDate(e.target.value)}
              className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] font-display font-bold"
            />
          </div>
          <div>
            <FieldLabel>02 · Target meet date</FieldLabel>
            <Input
              type="date"
              value={targetMeetDate}
              onChange={(e) => setTargetMeetDate(e.target.value)}
              className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] font-display font-bold"
            />
          </div>
        </div>

        <div>
          <FieldLabel>03 · Athlete age</FieldLabel>
          <Input
            type="number"
            min="8"
            max="99"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] text-2xl font-display font-bold p-4"
          />
        </div>

        <TileGroup label="04 · Level" options={LEVELS} value={level} onChange={setLevel} testIdPrefix="season-level" columns={2} />

        <TileGroup label="05 · Main event" options={EVENTS} value={mainEvent} onChange={setMainEvent} testIdPrefix="season-event" columns={2} />

        <div>
          <FieldLabel>06 · Current PB by course</FieldLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {COURSE_TYPES.map((course) => (
              <div key={course}>
                <div className="text-xs font-display font-bold text-[#475569] mb-2">{COURSE_LABELS[course]}</div>
                <Input
                  value={currentPBs[course]}
                  onChange={(e) =>
                    setCurrentPBs((prev) => ({ ...prev, [course]: e.target.value }))
                  }
                  placeholder={course === "SCY" ? "e.g. 48.20" : "e.g. 55.20"}
                  className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] font-display font-bold"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-[#64748B] leading-relaxed">
            Store PBs separately because short-course meters, long-course meters, and yards should not be treated as the same performance.
          </p>
        </div>

        <TileGroup
          label="07 · Target meet course"
          options={COURSE_TYPES}
          value={targetCourse}
          onChange={setTargetCourse}
          testIdPrefix="season-target-course"
          columns={3}
          renderLabel={(v) => COURSE_LABELS[v]}
        />

        <div>
          <FieldLabel>08 · Goal time for target course</FieldLabel>
          <Input
            value={goalTime}
            onChange={(e) => setGoalTime(e.target.value)}
            placeholder={targetCourse === "SCY" ? "e.g. 47.99" : "e.g. 53.99"}
            className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] font-display font-bold"
          />
        </div>

        <TileGroup
          label="09 · Sessions per week"
          options={SESSION_COUNTS}
          value={sessionsPerWeek}
          onChange={setSessionsPerWeek}
          testIdPrefix="season-sessions"
          columns={3}
          renderLabel={(v) => `${v} sessions`}
        />

        <TileGroup
          label="10 · Session duration"
          options={DURATIONS}
          value={sessionDuration}
          onChange={setSessionDuration}
          testIdPrefix="season-duration"
          columns={3}
          renderLabel={(v) => `${v} min`}
        />

        <TileGroup label="11 · Training pool length" options={POOLS} value={poolLength} onChange={setPoolLength} testIdPrefix="season-pool" columns={3} />

        <TileGroup label="12 · Main limitation" options={LIMITATIONS} value={mainLimitation} onChange={setMainLimitation} testIdPrefix="season-limitation" columns={2} />

        <TileGroup
          label="13 · Taper preference"
          options={TAPERS}
          value={taperPreference}
          onChange={setTaperPreference}
          testIdPrefix="season-taper"
          columns={4}
          renderLabel={(v) => (v === "auto" ? "Auto" : `${v} week${v === "1" ? "" : "s"}`)}
        />

        <TileGroup label="14 · Training style" options={STYLES} value={trainingStyle} onChange={setTrainingStyle} testIdPrefix="season-style" columns={2} />

        <div className="pt-2">
          <Button
            onClick={handleGenerate}
            className="w-full h-14 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold tracking-wide text-base transition-transform active:scale-[0.98]"
          >
            Generate season plan
          </Button>
        </div>
      </section>

      {plan && (
        <div id="season-plan-result" className="mt-14 border border-[#CBD5E1] rounded-sm overflow-hidden">
          <div className="bg-[#003366] text-white p-6">
            <div className="label-eyebrow text-white/70 mb-2">Cycle overview</div>
            <h3 className="font-display text-3xl sm:text-4xl font-black tracking-tight">
              {plan.weeks} weeks · {plan.cycleType}
            </h3>
            <p className="mt-3 text-white/80 leading-relaxed">{plan.overview.strategy}</p>
            <div className="mt-5">
              <Button
                onClick={handleCopy}
                className="rounded-sm bg-[#00E5FF] hover:bg-[#22D3EE] text-[#003366] font-display font-bold"
              >
                <Copy className="h-4 w-4 mr-2" /> Copy plan
              </Button>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#F8FAFC]">
            <InfoCard icon={Target} title="Performance priorities">
              <ul className="list-disc pl-5 space-y-1">
                {plan.overview.priorities.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </InfoCard>
            <InfoCard icon={Activity} title="Peak strategy">
              {plan.overview.peakStrategy}
            </InfoCard>
            <InfoCard icon={Target} title="PB / course context">
              <div className="space-y-1">
                <div>Target course: <span className="font-bold text-[#0F172A]">{plan.courseContext.targetCourseLabel}</span></div>
                <div>Current PB used: <span className="font-bold text-[#0F172A]">{plan.courseContext.relevantPB || "Not entered"}</span></div>
                <div>Goal time: <span className="font-bold text-[#0F172A]">{plan.courseContext.goalTime || "Not entered"}</span></div>
                <div className="pt-1 text-xs text-[#64748B]">SCM, LCM and SCY are stored separately to avoid false conversions.</div>
              </div>
            </InfoCard>
          </div>

          <div className="p-5 bg-white border-t border-[#CBD5E1]">
            <div className="label-eyebrow mb-4">Phase plan</div>
            <div className="space-y-3">
              {plan.phasePlan.map((phase) => (
                <div key={phase.range + phase.phase} className="border border-[#CBD5E1] rounded-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-display font-black text-[#0F172A]">{phase.phase}</h4>
                      <p className="text-sm text-[#475569] mt-1">{phase.purpose}</p>
                    </div>
                    <div className="label-eyebrow text-right whitespace-nowrap">{phase.range}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 bg-white border-t border-[#CBD5E1]">
            <div className="label-eyebrow mb-4">Weekly plan</div>
            <div className="space-y-4">
              {plan.weeklyPlan.map((week) => (
                <div key={week.week} className="border border-[#CBD5E1] rounded-sm p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="label-eyebrow">Week {week.week}</div>
                      <h4 className="font-display text-xl font-black text-[#003366]">{week.phase}</h4>
                    </div>
                    <div className="text-right">
                      <div className="label-eyebrow">Est. load</div>
                      <div className="font-display font-black text-[#0F172A]">{week.estimatedWeeklyVolume}{volumeUnit}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm leading-relaxed">
                    <div><span className="font-bold text-[#0F172A]">Goal:</span> {week.weeklyGoal}</div>
                    <div><span className="font-bold text-[#0F172A]">Physiology:</span> {week.physiologicalTarget}</div>
                    <div><span className="font-bold text-[#0F172A]">Technical focus:</span> {week.technicalFocus}</div>
                    <div className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-sm p-3">
                      <span className="font-bold text-[#0F172A]">Key set:</span> {week.keySet}
                    </div>
                    <div className="flex gap-2 items-start">
                      <Dumbbell className="h-4 w-4 text-[#003366] mt-0.5 shrink-0" />
                      <span><span className="font-bold text-[#0F172A]">Dryland:</span> {week.drylandFocus}</span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <CalendarDays className="h-4 w-4 text-[#003366] mt-0.5 shrink-0" />
                      <span><span className="font-bold text-[#0F172A]">Recovery:</span> {week.recoveryNote}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 bg-[#F8FAFC] border-t border-[#CBD5E1] text-sm text-[#475569] leading-relaxed">
            <span className="font-bold text-[#0F172A]">Planning note:</span> {plan.overview.evidenceNote}
          </div>
        </div>
      )}
    </div>
  );
}
