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
import AthleteProfile from "@/components/swim/AthleteProfile";
import SessionHistory from "@/components/swim/SessionHistory";
import { generateSession } from "@/lib/sessionGenerator";
import { Athletes } from "@/lib/localStore";

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
  const [athletes, setAthletes] = useState(() => Athletes.list());
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
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

  const restoreProfile = (savedProfile = {}) => {
    if (typeof savedProfile.age !== "undefined") setAge(savedProfile.age);
    if (savedProfile.level) setLevel(savedProfile.level);
    if (savedProfile.stroke) setStroke(savedProfile.stroke);
    if (savedProfile.goal) setGoal(savedProfile.goal);
    if (typeof savedProfile.distance !== "undefined") setDistance(savedProfile.distance);
    if (savedProfile.intensity) setIntensity(savedProfile.intensity);
    if (savedProfile.sessionRole) setSessionRole(savedProfile.sessionRole);
    if (savedProfile.unit) setUnit(savedProfile.unit);
    if (typeof savedProfile.includeSprintFinisher !== "undefined") {
      setIncludeSprintFinisher(Boolean(savedProfile.includeSprintFinisher));
    }
    if (savedProfile.poolType) {
      setPoolSize(savedProfile.poolType.startsWith("50") ? "50" : "25");
    }
    setSelectedAthleteId(savedProfile.athleteId || "");
  };

  const handleLoadFavourite = (fav) => {
    restoreProfile(fav.profile);
    setOriginalSession(fav.session);
    setLoadedFavouriteId(fav.id);
    setActiveTab("session");
    setTimeout(() => {
      document
        .getElementById("session-result")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const ageValid = useMemo(
    () => Number(age) >= MIN_AGE && Number(age) <= MAX_AGE,
    [age],
  );
  const canSubmit = ageValid && !loading;

  const poolType = `${poolSize}${unit === "m" ? "m" : "y"}`;
  const poolTypeLabel = `${poolSize}${unit === "m" ? "m" : "y"}`;

  const profile = useMemo(
    () => ({
      athleteId: selectedAthleteId || undefined,
      athleteName: athletes.find((athlete) => athlete.id === selectedAthleteId)?.name,
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
    [age, athletes, level, stroke, goal, distance, intensity, poolTypeLabel, unit, includeSprintFinisher, sessionRole, selectedAthleteId],
  );

  const handleSelectAthlete = (athlete) => {
    if (!athlete) {
      setSelectedAthleteId("");
      return;
    }
    setSelectedAthleteId(athlete.id);
    if (athlete.age !== "" && Number(athlete.age) >= MIN_AGE && Number(athlete.age) <= MAX_AGE) {
      setAge(athlete.age);
    }
    if (STROKES.includes(athlete.mainStroke)) setStroke(athlete.mainStroke);
    setActiveTab("session");
    toast.success(`Selected ${athlete.name}`);
  };

  const handleLoadSavedSession = (saved) => {
    const savedProfile = saved.profile || {};
    if (typeof savedProfile.age !== "undefined") setAge(savedProfile.age);
    if (savedProfile.level) setLevel(savedProfile.level);
    if (savedProfile.stroke) setStroke(savedProfile.stroke);
    if (savedProfile.goal) setGoal(savedProfile.goal);
    if (typeof savedProfile.distance !== "undefined") setDistance(savedProfile.distance);
    if (savedProfile.intensity) setIntensity(savedProfile.intensity);
    if (savedProfile.sessionRole) setSessionRole(savedProfile.sessionRole);
    if (savedProfile.unit) setUnit(savedProfile.unit);
    if (typeof savedProfile.includeSprintFinisher !== "undefined") setIncludeSprintFinisher(Boolean(savedProfile.includeSprintFinisher));
    if (savedProfile.poolType) setPoolSize(savedProfile.poolType.startsWith("50") ? "50" : "25");
    setSelectedAthleteId(savedProfile.athleteId || "");
    setOriginalSession(saved.session);
    setLoadedFavouriteId(null);
    setActiveTab("session");
    toast.success(`Opened "${saved.name}"`);
    setTimeout(() => {
      document.getElementById("session-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

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
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-5 border border-[#CBD5E1] rounded-sm overflow-hidden">
          {[
            ["session", "Session Builder"],
            ["season", "Season Planner"],
            ["library", "Coach Library"],
            ["athletes", "Athletes"],
            ["history", "Session History"],
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
            Coach Brain
            <br />
            <span className="text-[#003366]">in seconds.</span>
          </h2>
          <p className="mt-5 text-base sm:text-lg text-[#475569] max-w-lg leading-relaxed">
            Pick the swimmer profile and the goal. Get a clean, structured pool
            menu you can hand straight to your athlete.
          </p>
        </div>

        <section className="space-y-10">
          <div data-testid="athlete-session-selector">
            <label className="label-eyebrow block mb-3" htmlFor="session-athlete">01 · Athlete</label>
            {athletes.length > 0 ? (
              <select
                id="session-athlete"
                value={selectedAthleteId}
                onChange={(event) => handleSelectAthlete(athletes.find((athlete) => athlete.id === event.target.value) || null)}
                className="flex h-14 w-full rounded-sm border border-[#CBD5E1] bg-white px-4 text-base font-display font-bold"
                data-testid="session-athlete-select"
              >
                <option value="">Manual profile / no athlete selected</option>
                {athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}{athlete.team ? ` · ${athlete.team}` : ""}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => setActiveTab("athletes")} className="w-full border border-dashed border-[#CBD5E1] p-4 text-left text-sm text-[#475569] hover:border-[#003366] hover:text-[#003366]">No athlete profiles yet. Add one in Athletes.</button>
            )}
          </div>
          <div data-testid="field-age">
            <label className="label-eyebrow block mb-3">02 · Swimmer age</label>
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
            label="03 · Level"
            options={LEVELS}
            value={level}
            onChange={setLevel}
            testIdPrefix="level"
            columns={2}
          />

          <TileGroup
            label="04 · Main stroke"
            options={STROKES}
            value={stroke}
            onChange={setStroke}
            testIdPrefix="stroke"
            columns={2}
            renderLabel={(v) => (v === "IM" ? "IM (Medley)" : v)}
          />

          <TileGroup
            label="05 · Goal"
            options={GOALS}
            value={goal}
            onChange={setGoal}
            testIdPrefix="goal"
            columns={2}
          />

          <TileGroup
            label={`06 · Total distance (${unit})`}
            options={DISTANCES}
            value={distance}
            onChange={setDistance}
            testIdPrefix="distance"
            columns={3}
            renderLabel={(v) => `${v} ${unit}`}
          />

          <TileGroup
            label="07 · Intensity"
            options={INTENSITIES}
            value={intensity}
            onChange={setIntensity}
            testIdPrefix="intensity"
            columns={2}
            renderLabel={(v) => INTENSITY_LABELS[v]}
          />

          <TileGroup
            label="08 · Season phase / session role"
            options={SESSION_ROLES}
            value={sessionRole}
            onChange={setSessionRole}
            testIdPrefix="session-role"
            columns={2}
            renderLabel={(v) => SESSION_ROLE_LABELS[v]}
          />

          <TileGroup
            label="09 · Pool type"
            options={POOL_SIZES}
            value={poolSize}
            onChange={setPoolSize}
            testIdPrefix="pool-type"
            columns={2}
            renderLabel={(v) => `${v}${unit === "m" ? "m" : "y"} Pool`}
          />

          <EquipmentSelector
            label="10 · Power equipment (optional)"
            value={equipment}
            onChange={setEquipment}
          />

          <TileGroup
            label="11 · Sprint finisher after main set"
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
            onLoadFavourite={handleLoadFavourite}
          />
        </div>
          </>
        )}

        {activeTab === "season" && <SeasonPlanner />}

        {activeTab === "library" && (
          <CoachLibrary onLoadFavourite={handleLoadFavourite} />
        )}

        {activeTab === "athletes" && (
          <AthleteProfile
            selectedAthleteId={selectedAthleteId}
            onAthletesChange={() => setAthletes(Athletes.list())}
            onSelectAthlete={(athlete) => {
              setAthletes(Athletes.list());
              handleSelectAthlete(athlete);
            }}
          />
        )}

        {activeTab === "history" && (
          <SessionHistory onOpen={handleLoadSavedSession} />
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
