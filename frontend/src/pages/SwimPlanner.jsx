import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Waves, ArrowDown, LockKeyhole, Sparkles } from "lucide-react";
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
import CommunityHub from "@/components/swim/CommunityHub";
import AccountPanel from "@/components/auth/AccountPanel";
import { generateSession } from "@/lib/sessionGenerator";
import { trackGenerateSession } from "@/lib/generateAnalytics";
import { SavedSessions as CloudSessions } from "@/lib/cloudStore";
import { SavedSessions as LocalSessions } from "@/lib/localStore";
import { selectFavouriteStore } from "@/lib/favouriteStore";
import { selectSessionStore } from "@/lib/sessionStore";
import { Athletes as CloudAthletes } from "@/lib/cloudStore";
import { Favourites as CloudFavourites } from "@/lib/cloudStore";
import { Athletes as LocalAthletes } from "@/lib/localStore";
import { Favourites as LocalFavourites } from "@/lib/localStore";
import { useCoachAccess } from "@/hooks/useCoachAccess";

import { useSessionDraft } from "@/hooks/useSessionDraft";
import { usePerformanceRecorder } from "@/hooks/usePerformanceRecorder";
import PerformanceConfirmation from "@/components/swim/PerformanceConfirmation";
import PerformanceRecorder from "@/components/swim/PerformanceRecorder";
import PerformanceSummary from "@/components/swim/PerformanceSummary";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cloneDraftValue } from "@/lib/sessionDraft";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

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
const GUMROAD_URL = "https://coachtree.gumroad.com/l/coach-brain-pro";

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

function ProGate({ feature, access, onOpenAccount }) {
  return (
    <section className="border border-[#CBD5E1] bg-[#F8FAFC] p-7 sm:p-9 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center bg-[#003366] text-[#00E5FF]">
        <LockKeyhole className="h-5 w-5" />
      </div>
      <div className="label-eyebrow mt-5">Coach Brain Pro</div>
      <h2 className="mt-2 font-display text-3xl font-black text-[#0F172A]">{feature} is a Pro feature</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#475569]">
        The free version lets coaches build sessions and explore Community. Pro adds planning, saved coaching work, and athlete workflow tools.
      </p>
      {access.configured && !access.user && (
        <button type="button" onClick={onOpenAccount} className="mt-5 text-sm font-bold text-[#003366] underline underline-offset-4">
          Sign in with your purchase email to activate Pro
        </button>
      )}
      {access.configured && access.user && !access.isPro && (
        <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-[#64748B]">Signed in as {access.user.email}. Pro is activated after your purchase receipt is checked.</p>
      )}
      <a
        href={GUMROAD_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-2 bg-[#003366] px-5 py-3 text-sm font-bold text-white hover:bg-[#002244]"
      >
        <Sparkles className="h-4 w-4" /> Founding Coach Early Access · US$39
      </a>
      <p className="mt-3 text-xs text-[#64748B]">First 25 coaches · regular price US$59</p>
    </section>
  );
}

export default function SwimPlanner() {
  const access = useCoachAccess();
  const [activeTab, setActiveTab] = useState("session");
  const [accountPanelOpenSignal, setAccountPanelOpenSignal] = useState(0);
  const [athletes, setAthletes] = useState([]);
  const [athleteRosterScope, setAthleteRosterScope] = useState(null);
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
  const { draft, load: loadDraft, update: updateDraft, reset: resetDraft, setFavouriteId } = useSessionDraft();
  const [replacementRequest, setReplacementRequest] = useState(null);
  const generationInFlight = useRef(false);
  const freeTabs = new Set(["session", "community"]);
  const sessionStore = selectSessionStore(access, LocalSessions, CloudSessions);
  const sessionScope = `${access.user?.id || "guest"}:${access.isPro ? "pro" : "free"}`;
  const athleteStore = access.isPro && access.user ? CloudAthletes : LocalAthletes;
  const favouriteStore = selectFavouriteStore(access, LocalFavourites, CloudFavourites);
  const performanceScope = access.isPro && access.user ? `account:${access.user.id}` : "device:browser-local";
  const rosterScopeRef = useRef(performanceScope);
  rosterScopeRef.current = performanceScope;
  const performanceAthletes = athleteRosterScope === performanceScope ? athletes.filter(a => /^[A-Za-z0-9_-]{1,128}$/.test(String(a.id || ""))) : [];
  const recorder = usePerformanceRecorder({ scopeKey: performanceScope, athleteStore: access.isPro && access.user ? "supabase" : "local",
    athletes: performanceAthletes, enabled: access.isPro, checkingAccess: access.loading });
  const performanceOpen = recorder.state.phase !== "closed";
  const performanceReturnFocus = useRef(null);
  const openRecorder = block => {
    if (!draft || loading) return;
    performanceReturnFocus.current = document.activeElement;
    recorder.open({ sessionId: /^[A-Za-z0-9_-]{1,128}$/.test(draft.workingDraft.session_id || "") ? draft.workingDraft.session_id : null,
      blockId: block.generatedKey, draftRevision: draft.revision, changeSequence: draft.changeSequence,
      plannedTextSnapshot: block.items || [] },
    { unit: draft.context.unit, poolLength: draft.context.poolLength, stroke: draft.context.stroke });
  };

  useEffect(() => {
    let active = true;
    Promise.resolve(athleteStore.list())
      .then((records) => {
        if (active) { setAthletes(records); setAthleteRosterScope(performanceScope); }
      })
      .catch(() => {
        if (active) toast.error("Could not load athletes.");
      });

    return () => {
      active = false;
    };
  }, [athleteStore, performanceScope]);

  const refreshAthletes = async () => {
    const records = await athleteStore.list();
    if (rosterScopeRef.current === performanceScope) { setAthletes(records); setAthleteRosterScope(performanceScope); }
    return records;
  };

  const selectTab = (key) => {
    if (!access.isPro && !freeTabs.has(key)) {
      setActiveTab("upgrade");
      toast.info("This is a Coach Brain Pro feature");
      return;
    }
    setActiveTab(key);
  };

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

  const handleLoadFavourite = (fav) => requestReplacement({ type: "load", saved: fav, favouriteId: fav.id });

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
athleteName: athletes.find(
  (athlete) => String(athlete.id) === String(selectedAthleteId)
)?.name,
team: athletes.find(
  (athlete) => String(athlete.id) === String(selectedAthleteId)
)?.team || "",
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
    setSelectedAthleteId(String(athlete.id));
    if (athlete.age !== "" && Number(athlete.age) >= MIN_AGE && Number(athlete.age) <= MAX_AGE) {
      setAge(athlete.age);
    }
    if (STROKES.includes(athlete.mainStroke)) setStroke(athlete.mainStroke);
    setActiveTab("session");
    toast.success(`Selected ${athlete.name}`);
  };

  const handleLoadSavedSession = (saved) => requestReplacement({ type: "load", saved, favouriteId: null });

  const executeReplacement = async (request) => {
    if (generationInFlight.current) return;
    if (request.type === "load") {
      loadDraft(request.saved.session, request.saved.profile || {}, {}, request.favouriteId);
      restoreProfile(request.saved.profile);
      setActiveTab("session");
      toast.success(`${request.favouriteId ? "Loaded" : "Opened"} "${request.saved.name}"`);
      setTimeout(() => document.getElementById("session-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return;
    }
    generationInFlight.current = true;
    setLoading(true);
    // Retain the current draft until the replacement has been generated successfully.
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const data = generateSession(request.input);
      loadDraft(data, request.profile, { equipment: request.input.equipment, paceTarget: request.input.paceTarget });
      trackGenerateSession({
        stroke: request.input.stroke,
        goal: request.input.goal,
        level: request.input.level,
        distance: request.input.distance,
        intensity: request.input.intensity,
        pool_type: request.input.poolType,
      });
      toast.success("Session ready");
      setTimeout(() => document.getElementById("session-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (error) {
      toast.error("Could not generate session");
    } finally {
      generationInFlight.current = false;
      setLoading(false);
    }
  };

  const requestReplacement = (request) => {
    if (performanceOpen) return;
    if (generationInFlight.current) return;
    const snapshot = cloneDraftValue(request);
    if (draft?.dirty) setReplacementRequest(snapshot);
    else executeReplacement(snapshot);
  };

  const handleGenerate = () => {
    if (!ageValid) {
      toast.error(`Please enter an age between ${MIN_AGE} and ${MAX_AGE}`);
      return;
    }
    requestReplacement({
      type: "generate",
      profile,
      input: { age: Number(age), level, stroke, goal, distance, intensity, poolType, unit, equipment, includeSprintFinisher, sessionRole, paceTarget },
    });
  };

  return (
    <div className="min-h-screen bg-white" data-testid="swim-planner-page">
      <Dialog open={performanceOpen} onOpenChange={open => { if (!open) recorder.requestClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6 [&>button]:h-12 [&>button]:w-12" onInteractOutside={e => e.preventDefault()}
          onCloseAutoFocus={e => {
            e.preventDefault();
            const previous = performanceReturnFocus.current;
            (previous?.isConnected && previous !== document.body ? previous : document.querySelector('[data-testid="performance-resume"], [data-testid="record-results"], [data-testid="generate-button"]'))?.focus();
          }}>
          <DialogTitle className="pr-12">{recorder.state.phase === "confirm" ? "Confirm Performance Segment" : recorder.state.phase === "summary" ? "Saved performance" : "Poolside Recorder"}</DialogTitle>
          <DialogDescription>Record one athlete’s confirmed segment. Stored on this device.</DialogDescription>
          {recorder.state.checkingAccess && <p role="status">Checking Pro access… Your recording and entries are preserved.</p>}
          <fieldset disabled={recorder.state.checkingAccess} className="min-w-0" aria-busy={recorder.state.checkingAccess}>
          {recorder.state.phase === "confirm" && <PerformanceConfirmation athletes={performanceAthletes} state={recorder.state} onStart={recorder.start} />}
          {recorder.state.phase === "record" && <PerformanceRecorder key={recorder.state.viewKey} controller={recorder} />}
          {recorder.state.phase === "summary" && <PerformanceSummary recording={recorder.state.recording} athleteLabel={recorder.state.athleteLabel} onClose={recorder.requestClose} />}
          </fieldset>
        </DialogContent>
      </Dialog>
      {recorder.state.recording && !performanceOpen && <div className="max-w-2xl mx-auto px-4 py-3 border" data-testid="performance-resume-panel">
        <p>{recorder.state.athleteLabel} · {recorder.state.recording.occurrence.plannedDefinition.segment.repeatCount} × {recorder.state.recording.occurrence.plannedDefinition.segment.repeatDistance}{recorder.state.recording.occurrence.plannedDefinition.unit} · Stored on this device</p>
        <button data-testid="performance-resume" disabled={recorder.state.busy || recorder.state.checkingAccess} className="min-h-12 font-bold underline" onClick={e => { performanceReturnFocus.current = e.currentTarget; recorder.resume(); }}>{recorder.state.recording.performance.status === "draft" ? "Resume recording" : "View saved summary"}</button>
        {recorder.state.checkingAccess && <p role="status">Checking Pro access… Your recording is preserved.</p>}
        {recorder.state.error && <p role="alert">{recorder.state.error.message}</p>}
      </div>}
      <AlertDialog open={Boolean(replacementRequest)} onOpenChange={(open) => { if (!open) setReplacementRequest(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your edited session?</AlertDialogTitle>
            <AlertDialogDescription>Your current edits will be replaced. Keep editing to return to this draft and save a copy first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="keep-editing">Keep Editing</AlertDialogCancel>
            <AlertDialogAction data-testid="replace-draft" onClick={() => {
              const request = replacementRequest;
              setReplacementRequest(null);
              if (request) executeReplacement(request);
            }}>Replace With New Draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
         
          <AccountPanel access={access} openSignal={accountPanelOpenSignal} />
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
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-3 border border-[#CBD5E1] rounded-sm overflow-hidden">
          {[
            ["session", "Session Builder", false],
            ["season", "Season Planner", true],
            ["library", "Coach Library", true],
            ["athletes", "Athletes", true],
            ["history", "Session History", true],
            ["community", "Community", false],
          ].map(([key, label, isPro]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              data-active={activeTab === key}
              className="px-3 py-3 text-xs sm:text-sm font-display font-black tracking-wide border-r last:border-r-0 border-[#CBD5E1] data-[active=true]:bg-[#003366] data-[active=true]:text-white text-[#475569] hover:text-[#003366]"
            >
              <span className="inline-flex items-center gap-1">{label}{isPro && !access.isPro && <LockKeyhole className="h-3 w-3" />}</span>
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
                onChange={(event) => handleSelectAthlete(athletes.find((athlete) => String(athlete.id) === String(event.target.value)) || null)}
                className="flex h-14 w-full rounded-sm border border-[#CBD5E1] bg-white px-4 text-base font-display font-bold"
                data-testid="session-athlete-select"
              >
                <option value="">Manual profile / no athlete selected</option>
                {athletes.map((athlete) => <option key={athlete.id} value={String(athlete.id)}>{athlete.name}{athlete.team ? ` · ${athlete.team}` : ""}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => selectTab("athletes")} className="w-full border border-dashed border-[#CBD5E1] p-4 text-left text-sm text-[#475569] hover:border-[#003366] hover:text-[#003366]">No athlete profiles yet. Athlete profiles are available in Coach Brain Pro.</button>
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

        <div id="session-result" className="mt-14" data-dirty={draft?.dirty || false} data-revision={draft?.revision || 0}>
          {draft && (
            <SessionResult
              key={draft.lifecycle}
              session={draft.workingDraft}
              onSessionChange={updateDraft}
              onReset={resetDraft}
              resetKey={draft.originalDraft}
              profile={draft.profile}
              defaultFavouriteId={draft.favouriteId}
              onFavouriteChange={setFavouriteId}
              onRecordResults={!loading && recorder.state.recording?.performance.status !== "draft" ? openRecorder : undefined}
              isPro={access.isPro}
              sessionStore={sessionStore}
              favouriteStore={favouriteStore}
            />
          )}
          {(draft || loading) && (
            <div className="mt-6 text-center">
              <Button
                onClick={handleGenerate}
                disabled={!canSubmit}
                data-testid="generate-another-button"
                className="w-full h-14 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold tracking-wide text-base disabled:opacity-60"
              >
                {loading ? "Building session…" : "Generate Another Session"}
              </Button>
              <p className="mt-2 text-sm text-[#475569]">Same settings. A different session.</p>
            </div>
          )}
        </div>

        {!access.isPro && <div className="mt-14"><ProGate feature="Coach Library" access={access} onOpenAccount={() => setAccountPanelOpenSignal((value) => value + 1)} /></div>}
          </>
        )}

        {activeTab === "season" && access.isPro && <SeasonPlanner />}

        {activeTab === "library" && access.isPro && <CoachLibrary favouriteStore={favouriteStore} onLoadFavourite={handleLoadFavourite} />}

        {activeTab === "athletes" && access.isPro && <AthleteProfile athleteStore={athleteStore} selectedAthleteId={selectedAthleteId} onAthletesChange={refreshAthletes} onSelectAthlete={(athlete) => { refreshAthletes().then(() => handleSelectAthlete(athlete)).catch(() => toast.error("Could not refresh athletes.")); }} />}

        {activeTab === "history" && <SessionHistory key={sessionScope} sessionStore={sessionStore} onOpen={handleLoadSavedSession} />}

        {activeTab === "community" && <CommunityHub />}

        {activeTab === "upgrade" && <ProGate feature="Planning, library, athletes and history" access={access} onOpenAccount={() => setAccountPanelOpenSignal((value) => value + 1)} />}
      </main>

      <footer className="border-t border-[#CBD5E1] mt-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 label-eyebrow">
          Coach Brain Swim Planner Pro · local-first planning tool
        </div>
      </footer>
    </div>
  );
}
