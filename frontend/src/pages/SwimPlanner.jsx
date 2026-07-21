import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Waves, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TileGroup from "@/components/swim/TileGroup";
import SessionResult from "@/components/swim/SessionResult";
import PaceCalculator from "@/components/swim/PaceCalculator";
import EquipmentSelector from "@/components/swim/EquipmentSelector";
import CoachLibrary from "@/components/swim/CoachLibrary";
import SeasonPlanner from "@/components/swim/SeasonPlanner";
import { generateSession } from "@/lib/sessionGenerator";

const MIN_AGE = 4;
const MAX_AGE = 99;
const DEFAULT_AGE = 16;
const DEFAULT_DISTANCE = 3000;

const LEVELS = ["beginner", "intermediate", "competitive", "elite"];
const STROKES = ["freestyle", "backstroke", "breaststroke", "butterfly", "IM"];
const GOALS = ["endurance", "sprint", "technique", "race preparation"];
const DISTANCES = [1500, 2000, 3000, 4000, 5000, 6000];
const INTENSITIES = ["recovery", "easy", "moderate", "hard", "race pace"];
const SESSION_ROLES = ["standalone", "preparation", "build kick/pull emphasis", "intensive", "race specific", "taper", "race week"];
const POOL_SIZES = ["25", "50"];
const UNITS = ["m", "yd"];

const INTENSITY_LABELS = {
  recovery: "1 · Recovery",
  easy: "2 · Easy",
  moderate: "3 · Moderate",
  hard: "4 · Hard",
  "race pace": "5 · Race Pace",
};

const SESSION_ROLE_LABELS = {
  standalone: "Standalone session",
  preparation: "Preparation",
  "build kick/pull emphasis": "Build · Kick/Pull emphasis",
  intensive: "Intensive",
  "race specific": "Race specific",
  taper: "Taper",
  "race week": "Race week",
};

export default function SwimPlanner() {
  const [activeTab, setActiveTab] = useState("session");
  const [age, setAge] = useState(DEFAULT_AGE);
  const [level, setLevel] = useState("intermediate");
  const [stroke, setStroke] = useState("freestyle");
  const [goal, setGoal] = useState("endurance");
  const [distance, setDistance] = useState(DEFAULT_DISTANCE);
  const [intensity, setIntensity] = useState("easy");
  const [sessionRole, setSessionRole] = useState("standalone");
  const [poolSize, setPoolSize] = useState("50");
  const [unit, setUnit] = useState("m");
  const [paceTarget, setPaceTarget] = useState(null); // {race_distance, target_seconds}
  const [equipment, setEquipment] = useState([]);
  const [includeSprintFinisher, setIncludeSprintFinisher] = useState(false);

  const [loading, setLoading] = useState(false);
  const [originalSession, setOriginalSession] = useState(null);
  const [loadedFavouriteId, setLoadedFavouriteId] = useState(null);

  const ageValid = useMemo(
    () => Number(age) >= MIN_AGE && Number(age) <= MAX_AGE,
    [age],
  );
  const canSubmit = ageValid && !loading;

  const poolType = `${poolSize}${unit === "m" ? "m" : "y"}`;
  const poolTypeLabel = `${poolSize}${unit === "m" ? "m" : "y"}`;

  const profile = useMemo(
    () => ({
      age,
      level,
      stroke,
      goal,
      distance,
      intensity,
      poolType: poolTypeLabel,
      unit,
      includeSprintFinisher,
      sessionRole,
    }),
    [age, level, stroke, goal, distance, intensity, poolTypeLabel, unit, includeSprintFinisher, sessionRole],
  );

  const handleGenerate = async () => {
    if (!ageValid) {
      toast.error(`Please enter an age between ${MIN_AGE} and ${MAX_AGE}`);
      return;
    }
    setLoading(true);
    setOriginalSession(null);
    // Rule-based local generator — yields a tick so the spinner has time to render.
    await new Promise((r) => setTimeout(r, 60));
    try {
      const data = generateSession({
        age: Number(age),
        level,
        stroke,
        goal,
        distance,
        intensity,
        poolType,
        unit,
        equipment,
        includeSprintFinisher,
        sessionRole,
        paceTarget,
      });
      setOriginalSession(data);
      setLoadedFavouriteId(null);
      toast.success("Session ready");
      setTimeout(() => {
        document
          .getElementById("session-result")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (e) {
      toast.error("Could not generate session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white" data-testid="swim-planner-page">
      {/* Header */}
      <header className="border-b border-[#CBD5E1] bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#003366] flex items-center justify-center rounded-sm">
              <Waves className="h-5 w-5 text-[#00E5FF]" strokeWidth={2.5} />
            </div>
            <div>
              <div className="label-eyebrow">Coach Brain · Swim</div>
              <h1 className="font-display text-xl font-black tracking-tight text-[#0F172A] leading-none mt-1">
                Training Planner Pro
              </h1>
            </div>
          </div>
          {/* Unit toggle */}
          <div
            className="flex items-center border border-[#CBD5E1] rounded-sm overflow-hidden"
            data-testid="unit-toggle"
          >
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                data-active={unit === u}
                data-testid={`unit-toggle-${u}`}
                className="px-3 py-2 font-display text-sm font-bold uppercase tracking-wider transition-colors data-[active=true]:bg-[#003366] data-[active=true]:text-white text-[#475569] hover:text-[#003366]"
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14">
        <div className="mb-8 grid grid-cols-3 border border-[#CBD5E1] rounded-sm overflow-hidden">
          {[
            ["session", "Session Builder"],
            ["season", "Season Planner"],
            ["library", "Coach Library"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              data-active={activeTab === key}
              className="px-3 py-3 text-xs sm:text-sm font-display font-black tracking-wide border-r last:border-r-0 border-[#CBD5E1] data-[active=true]:bg-[#003366] data-[active=true]:text-white text-[#475569] hover:text-[#003366]"
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "session" && (
          <>
        <div className="mb-10 sm:mb-12">
          <div className="label-eyebrow mb-3">Build a session</div>
          <h2
            className="font-display text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-[#0F172A] leading-[0.95]"
            data-testid="hero-heading"
          >
            Plan a swim set
            <br />
            <span className="text-[#003366]">in seconds.</span>
          </h2>
          <p className="mt-5 text-base sm:text-lg text-[#475569] max-w-lg leading-relaxed">
            Pick the swimmer profile and the goal. Get a clean, structured pool
            menu you can hand straight to your athlete.
          </p>
        </div>

        <section className="space-y-10">
          <div data-testid="field-age">
            <label className="label-eyebrow block mb-3">01 · Swimmer age</label>
            <Input
              type="number"
              min={MIN_AGE}
              max={MAX_AGE}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="h-14 rounded-sm border-[#CBD5E1] focus-visible:ring-[#003366] focus-visible:border-[#003366] text-2xl font-display font-bold p-4"
              data-testid="input-age"
              placeholder="e.g. 14"
            />
            {!ageValid && (
              <p className="mt-2 text-sm text-[#FF3B30]">
                Age must be between {MIN_AGE} and {MAX_AGE}.
              </p>
            )}
          </div>

          <TileGroup
            label="02 · Level"
            options={LEVELS}
            value={level}
            onChange={setLevel}
            testIdPrefix="level"
            columns={2}
          />

          <TileGroup
            label="03 · Main stroke"
            options={STROKES}
            value={stroke}
            onChange={setStroke}
            testIdPrefix="stroke"
            columns={2}
            renderLabel={(v) => (v === "IM" ? "IM (Medley)" : v)}
          />

          <TileGroup
            label="04 · Goal"
            options={GOALS}
            value={goal}
            onChange={setGoal}
            testIdPrefix="goal"
            columns={2}
          />

          <TileGroup
            label={`05 · Total distance (${unit})`}
            options={DISTANCES}
            value={distance}
            onChange={setDistance}
            testIdPrefix="distance"
            columns={3}
            renderLabel={(v) => `${v} ${unit}`}
          />

          <TileGroup
            label="06 · Intensity"
            options={INTENSITIES}
            value={intensity}
            onChange={setIntensity}
            testIdPrefix="intensity"
            columns={2}
            renderLabel={(v) => INTENSITY_LABELS[v]}
          />

          <TileGroup
            label="07 · Season phase / session role"
            options={SESSION_ROLES}
            value={sessionRole}
            onChange={setSessionRole}
            testIdPrefix="session-role"
            columns={2}
            renderLabel={(v) => SESSION_ROLE_LABELS[v]}
          />

          <TileGroup
            label="08 · Pool type"
            options={POOL_SIZES}
            value={poolSize}
            onChange={setPoolSize}
            testIdPrefix="pool-type"
            columns={2}
            renderLabel={(v) => `${v}${unit === "m" ? "m" : "y"} Pool`}
          />

          <EquipmentSelector
            label="09 · Power equipment (optional)"
            value={equipment}
            onChange={setEquipment}
          />

          <TileGroup
            label="10 · Sprint finisher after main set"
            options={[false, true]}
            value={includeSprintFinisher}
            onChange={setIncludeSprintFinisher}
            testIdPrefix="sprint-finisher"
            columns={2}
            renderLabel={(v) => (v ? "Yes · 50-200 max" : "No · endurance only")}
          />

          <PaceCalculator
            unit={unit}
            onChange={setPaceTarget}
            data-testid="pace-calculator"
          />

          <div className="pt-2">
            <Button
              onClick={handleGenerate}
              disabled={!canSubmit}
              data-testid="generate-button"
              className="w-full h-14 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold tracking-wide text-base disabled:opacity-60 transition-transform active:scale-[0.98]"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Building session…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  Generate session
                  <ArrowDown className="h-5 w-5" />
                </span>
              )}
            </Button>
          </div>
        </section>

        <div id="session-result" className="mt-14">
          {originalSession && (
            <SessionResult
              key={originalSession.summary + (originalSession.total_distance_m || "")}
              originalSession={originalSession}
              profile={profile}
              defaultFavouriteId={loadedFavouriteId}
            />
          )}
        </div>

        <div className="mt-14">
          <CoachLibrary
            onLoadFavourite={(fav) => {
              // restore profile fields where we can
              if (fav.profile) {
                if (typeof fav.profile.age !== "undefined") setAge(fav.profile.age);
                if (fav.profile.level) setLevel(fav.profile.level);
                if (fav.profile.stroke) setStroke(fav.profile.stroke);
                if (fav.profile.goal) setGoal(fav.profile.goal);
                if (typeof fav.profile.distance !== "undefined")
                  setDistance(fav.profile.distance);
                if (fav.profile.intensity) setIntensity(fav.profile.intensity);
                if (fav.profile.sessionRole) setSessionRole(fav.profile.sessionRole);
                if (fav.profile.unit) setUnit(fav.profile.unit);
                if (typeof fav.profile.includeSprintFinisher !== "undefined") setIncludeSprintFinisher(Boolean(fav.profile.includeSprintFinisher));
                if (fav.profile.poolType) {
                  const size = fav.profile.poolType.startsWith("50") ? "50" : "25";
                  setPoolSize(size);
                }
              }
              setOriginalSession(fav.session);
              setLoadedFavouriteId(fav.id);
              setActiveTab("session");
              setTimeout(() => {
                document
                  .getElementById("session-result")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 80);
            }}
          />
        </div>
          </>
        )}

        {activeTab === "season" && <SeasonPlanner />}

        {activeTab === "library" && (
          <CoachLibrary
            onLoadFavourite={(fav) => {
              // restore profile fields where we can
              if (fav.profile) {
                if (typeof fav.profile.age !== "undefined") setAge(fav.profile.age);
                if (fav.profile.level) setLevel(fav.profile.level);
                if (fav.profile.stroke) setStroke(fav.profile.stroke);
                if (fav.profile.goal) setGoal(fav.profile.goal);
                if (typeof fav.profile.distance !== "undefined")
                  setDistance(fav.profile.distance);
                if (fav.profile.intensity) setIntensity(fav.profile.intensity);
                if (fav.profile.sessionRole) setSessionRole(fav.profile.sessionRole);
                if (fav.profile.unit) setUnit(fav.profile.unit);
                if (typeof fav.profile.includeSprintFinisher !== "undefined") setIncludeSprintFinisher(Boolean(fav.profile.includeSprintFinisher));
                if (fav.profile.poolType) {
                  const size = fav.profile.poolType.startsWith("50") ? "50" : "25";
                  setPoolSize(size);
                }
              }
              setOriginalSession(fav.session);
              setLoadedFavouriteId(fav.id);
              setActiveTab("session");
              setTimeout(() => {
                document
                  .getElementById("session-result")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 80);
            }}
          />
        )}
      </main>

      <footer className="border-t border-[#CBD5E1] mt-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 label-eyebrow">
          Coach Brain Swim Planner Pro · local-first planning tool
        </div>
      </footer>
    </div>
  );
}
