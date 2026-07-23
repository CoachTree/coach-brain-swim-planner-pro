import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  FileDown,
  Share2,
  Pencil,
  Check,
  RotateCcw,
  Plus,
  X,
  Star,
  Save,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Favourites, SavedSessions } from "@/lib/localStore";
import JournalPanel from "@/components/swim/JournalPanel";
import { encodeShare, SHARE_TTL_DAYS } from "@/lib/shareLink";

const BLOCKS = [
  { key: "warm_up", label: "Warm up" },
  { key: "drill_set", label: "Drill set" },
  { key: "kick_set", label: "Kick set" },
  { key: "sprint_or_pace_set", label: "Speed prep set" },
  { key: "main_set", label: "Main set" },
  { key: "pull_set", label: "Pull set" },
  { key: "cool_down", label: "Cool down" },
];

function formatDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function unitLabel(profile) {
  return profile?.unit === "yd" ? "yd" : "m";
}

function buildPlainText(session, profile) {
  const u = unitLabel(profile);
  const lines = [];
  lines.push("SWIM TRAINING SESSION");
  lines.push("=".repeat(28));
  lines.push(`Date: ${formatDate()}`);
  lines.push(
    `Age: ${profile.age} | Level: ${profile.level} | Stroke: ${profile.stroke}`,
  );
  lines.push(
    `Goal: ${profile.goal} | Intensity: ${profile.intensity} | Pool: ${profile.poolType}`,
  );
  lines.push(`Total: ${session.total_distance_m || profile.distance} ${u}`);
  if (session.summary) {
    lines.push("");
    lines.push(session.summary);
  }
  if (session.coach_brain) {
    const cb = session.coach_brain;
    lines.push("");
    lines.push("COACH BRAIN");
    lines.push(`Phase: ${cb.phase || ""}`);
    lines.push(`Today's Objective: ${cb.objective || ""}`);
    lines.push(`Technical Focus: ${cb.technical_focus || ""}`);
    lines.push(`Mental Focus: ${cb.mental_focus || ""}`);
    lines.push(`Coach Tip: ${cb.coach_tip || ""}`);
    lines.push(`Athlete Reflection: ${cb.athlete_reflection || ""}`);
    lines.push(`Coaching Principle: ${cb.yuji_principle_title || ""} — ${cb.yuji_principle || ""}`);
    lines.push("Coach Adjustment Area:");
    (cb.coach_adjustment_prompts || []).forEach((q) => lines.push(`  • ${q}`));
  }
  lines.push("");
  BLOCKS.forEach(({ key, label }) => {
    const b = session[key];
    if (!b || (Number(b.distance_m) === 0 && !(b.items || []).length)) return;
    const tag = b.energy_system ? ` [${b.energy_system}]` : "";
    lines.push(`${label.toUpperCase()}${tag} — ${b.distance_m} ${u}`);
    (b.items || []).forEach((it) => lines.push(`  • ${it}`));
    lines.push("");
  });
  if (session.coaching_points?.length) {
    lines.push("COACHING POINTS");
    session.coaching_points.forEach((p) => lines.push(`  • ${p}`));
  }
  return lines.join("\n");
}

function exportPdf(session, profile) {
  const u = unitLabel(profile);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const marginBottom = 56;
  const contentW = pageW - marginX * 2;
  let y = 56;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - marginBottom) {
      doc.addPage();
      y = 56;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("SWIM TRAINING SESSION", marginX, y);
  y += 10;
  doc.setDrawColor(0);
  doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  const totalM = session.total_distance_m || profile.distance;
  const sessionTitle = session.summary || `${totalM} ${u} ${profile.goal || "training session"}`;
  const metaLines = [
    `Session title: ${sessionTitle}`,
    `Athlete: ${profile.athleteName || "Manual profile"}`,
    `Date: ${formatDate()}`,
    `Goal: ${profile.goal || "Not specified"}`,
    `Total distance: ${totalM} ${u}`,
    `Age: ${profile.age}    Level: ${profile.level}    Stroke: ${profile.stroke}`,
    `Intensity: ${profile.intensity}    Pool: ${profile.poolType}`,
  ];
  metaLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, contentW);
    ensureSpace(18 * wrapped.length);
    wrapped.forEach((part) => {
      doc.text(part, marginX, y);
      y += 18;
    });
  });
  y += 8;

  if (session.summary) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(13);
    doc.splitTextToSize(session.summary, contentW).forEach((line) => {
      ensureSpace(18);
      doc.text(line, marginX, y);
      y += 18;
    });
    y += 6;
  }

  if (session.coach_brain) {
    const cb = session.coach_brain;
    ensureSpace(90);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("COACH BRAIN", marginX, y);
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    [
      `Phase: ${cb.phase || ""}`,
      `Today's Objective: ${cb.objective || ""}`,
      `Technical Focus: ${cb.technical_focus || ""}`,
      `Mental Focus: ${cb.mental_focus || ""}`,
      `Coach Tip: ${cb.coach_tip || ""}`,
      `Athlete Reflection: ${cb.athlete_reflection || ""}`,
      `Coaching Principle: ${cb.yuji_principle_title || ""} — ${cb.yuji_principle || ""}`,
    ].forEach((line) => {
      const wrapped = doc.splitTextToSize(line, contentW);
      ensureSpace(16 * wrapped.length);
      wrapped.forEach((w) => { doc.text(w, marginX, y); y += 16; });
    });
    y += 8;
  }

  BLOCKS.forEach(({ key, label }) => {
    const b = session[key];
    if (!b || (Number(b.distance_m) === 0 && !(b.items || []).length)) return;
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    const tag = b.energy_system ? `   [${b.energy_system}]` : "";
    doc.text(`${label.toUpperCase()}${tag}   —   ${b.distance_m} ${u}`, marginX, y);
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    (b.items || []).forEach((it) => {
      const wrapped = doc.splitTextToSize(it, contentW - 18);
      ensureSpace(18 * wrapped.length);
      doc.text("•", marginX + 4, y);
      wrapped.forEach((line, i) => {
        doc.text(line, marginX + 18, y + i * 18);
      });
      y += 18 * wrapped.length;
    });
    y += 12;
  });

  if (session.coaching_points?.length) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("COACHING POINTS", marginX, y);
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    session.coaching_points.forEach((p) => {
      const wrapped = doc.splitTextToSize(p, contentW - 18);
      ensureSpace(18 * wrapped.length);
      doc.text("•", marginX + 4, y);
      wrapped.forEach((line, i) => {
        doc.text(line, marginX + 18, y + i * 18);
      });
      y += 18 * wrapped.length;
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Page ${i} of ${pageCount}`, pageW - marginX, pageH - 24, {
      align: "right",
    });
    doc.text("Swim Training Planner", marginX, pageH - 24);
  }

  const safe = (s) => String(s).replace(/\s+/g, "-").toLowerCase();
  doc.save(`swim-${totalM}${u}-${safe(profile.stroke)}-${safe(profile.intensity)}.pdf`);
}

function deepCloneSession(s) {
  if (!s) return s;
  return {
    ...s,
    warm_up: s.warm_up && { ...s.warm_up, items: [...(s.warm_up.items || [])] },
    drill_set: s.drill_set && { ...s.drill_set, items: [...(s.drill_set.items || [])] },
    kick_set: s.kick_set && { ...s.kick_set, items: [...(s.kick_set.items || [])] },
    sprint_or_pace_set:
      s.sprint_or_pace_set && {
        ...s.sprint_or_pace_set,
        items: [...(s.sprint_or_pace_set.items || [])],
      },
    main_set: s.main_set && { ...s.main_set, items: [...(s.main_set.items || [])] },
    pull_set: s.pull_set && { ...s.pull_set, items: [...(s.pull_set.items || [])] },
    cool_down: s.cool_down && { ...s.cool_down, items: [...(s.cool_down.items || [])] },
    coaching_points: [...(s.coaching_points || [])],
  };
}

export default function SessionResult({
  originalSession,
  profile,
  readOnly = false,
  hideShare = false,
  defaultFavouriteId = null,
}) {
  const [session, setSession] = useState(() => deepCloneSession(originalSession));
  const [editing, setEditingState] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [favouriteId, setFavouriteId] = useState(defaultFavouriteId);

  // Stable session-key for journal entries. Tied to the originalSession reference.
  const sessionKey = useMemo(
    () =>
      `${originalSession?.summary || ""}|${originalSession?.total_distance_m || ""}|${profile?.stroke || ""}|${profile?.intensity || ""}|${profile?.poolType || ""}`,
    [originalSession, profile],
  );

  // In read-only mode the edit UI must never be active
  const setEditing = (v) => {
    if (readOnly) return;
    setEditingState(typeof v === "function" ? v(editing) : v);
  };

  // Reset internal state when a fresh generated session arrives.
  // Calls the underlying state setter directly to keep this effect's dependency
  // list stable (the `setEditing` wrapper is recreated each render).
  useEffect(() => {
    setSession(deepCloneSession(originalSession));
    setEditingState(false);
    setFavouriteId(defaultFavouriteId);
  }, [originalSession, defaultFavouriteId]);

  const text = useMemo(
    () => buildPlainText(session, profile),
    [session, profile],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  };

  const handleReset = () => {
    setSession(deepCloneSession(originalSession));
    toast.success("Reset to original version");
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const encoded = encodeShare({ session, profile });
      const url = `${window.location.origin}/s#${encoded}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Copied share link", {
          description: `Expires in ${SHARE_TTL_DAYS} days`,
        });
      } catch {
        toast.success(`Share link ready: ${url}`);
      }
    } catch (e) {
      toast.error("Could not create share link");
    } finally {
      setSharing(false);
    }
  };

  const handleFavourite = () => {
    if (favouriteId) {
      // Toggle off / update existing
      Favourites.upsert({ id: favouriteId, session, profile });
      toast.success("Favourite updated");
      return;
    }
    const defaultName = `${profile.distance} ${profile.unit || "m"} · ${profile.stroke} · ${profile.intensity}`;
    const name = window.prompt("Name this favourite session", defaultName);
    if (!name) return;
    const saved = Favourites.upsert({
      name: name.trim() || defaultName,
      session,
      profile,
    });
    setFavouriteId(saved.id);
    toast.success("Saved to favourites");
  };

  const handleSaveSession = () => {
    const defaultName = `${session.total_distance_m || profile.distance} ${profile.unit || "m"} · ${profile.stroke} · ${profile.intensity}`;
    const name = window.prompt("Name this saved session", defaultName);
    if (!name?.trim()) return;
    SavedSessions.upsert({
      name: name.trim(),
      session,
      profile,
    });
    toast.success("Session saved");
  };

  // ---- edit helpers ----
  const updateItem = useCallback((blockKey, idx, val) => {
    setSession((s) => {
      const next = { ...s };
      next[blockKey] = { ...s[blockKey], items: [...s[blockKey].items] };
      next[blockKey].items[idx] = val;
      return next;
    });
  }, []);

  const updateDistance = useCallback((blockKey, val) => {
    setSession((s) => ({
      ...s,
      [blockKey]: { ...s[blockKey], distance_m: Number(val) || 0 },
    }));
  }, []);

  const addItem = useCallback((blockKey) => {
    setSession((s) => {
      const next = { ...s };
      next[blockKey] = { ...s[blockKey], items: [...s[blockKey].items, ""] };
      return next;
    });
  }, []);

  const removeItem = useCallback((blockKey, idx) => {
    setSession((s) => {
      const next = { ...s };
      next[blockKey] = {
        ...s[blockKey],
        items: s[blockKey].items.filter((_, i) => i !== idx),
      };
      return next;
    });
  }, []);

  const updateCoachingPoint = useCallback((idx, val) => {
    setSession((s) => {
      const points = [...s.coaching_points];
      points[idx] = val;
      return { ...s, coaching_points: points };
    });
  }, []);

  const addCoachingPoint = useCallback(() => {
    setSession((s) => ({
      ...s,
      coaching_points: [...(s.coaching_points || []), ""],
    }));
  }, []);

  const removeCoachingPoint = useCallback((idx) => {
    setSession((s) => ({
      ...s,
      coaching_points: s.coaching_points.filter((_, i) => i !== idx),
    }));
  }, []);

  const u = unitLabel(profile);

  return (
    <article
      className="border border-[#CBD5E1] rounded-sm bg-white"
      data-testid="session-result-card"
    >
      {/* Header */}
      <div className="bg-[#003366] text-white px-5 sm:px-6 py-5 flex flex-col gap-4 rounded-t-sm">
        <div>
          <div className="label-eyebrow text-[#00E5FF]">Session output</div>
          <h3 className="font-display text-2xl sm:text-3xl font-black tracking-tight mt-1">
            {session.total_distance_m || profile.distance} {u} ·{" "}
            <span className="capitalize">{profile.goal}</span>
          </h3>
          <p className="text-sm text-white/80 mt-1 capitalize">
            Age {profile.age} · {profile.level} · {profile.stroke} ·{" "}
            {profile.intensity} · {profile.poolType} pool
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button
              onClick={handleSaveSession}
              data-testid="save-session-button"
              className="h-11 rounded-sm bg-[#00E5FF] text-[#003366] hover:bg-white font-display font-bold tracking-wide"
            >
              <Save className="h-4 w-4 mr-2" /> Save Session
            </Button>
          )}
          {!readOnly && (
            <Button
              onClick={handleFavourite}
              data-testid="favourite-button"
              className="h-11 rounded-sm bg-white/10 hover:bg-white/20 text-white border border-white/30 font-display font-bold tracking-wide"
            >
              <Star
                className={`h-4 w-4 mr-2 ${favouriteId ? "fill-[#00E5FF] text-[#00E5FF]" : ""}`}
              />
              {favouriteId ? "Saved" : "Save"}
            </Button>
          )}
          {!readOnly && (
            <JournalPanel
              sessionKey={sessionKey}
              session={session}
              profile={profile}
            />
          )}
          {!readOnly && (
            <Button
              onClick={() => setEditing((v) => !v)}
              data-testid="edit-toggle-button"
              className="h-11 rounded-sm bg-white/10 hover:bg-white/20 text-white border border-white/30 font-display font-bold tracking-wide"
            >
              {editing ? (
                <>
                  <Check className="h-4 w-4 mr-2" /> Done
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </>
              )}
            </Button>
          )}
          {!readOnly && (
            <Button
              onClick={handleReset}
              data-testid="reset-button"
              className="h-11 rounded-sm bg-white/10 hover:bg-white/20 text-white border border-white/30 font-display font-bold tracking-wide"
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
          )}
          {!readOnly && !hideShare && (
            <Button
              onClick={handleShare}
              disabled={sharing}
              data-testid="share-button"
              className="h-11 rounded-sm bg-white/10 hover:bg-white/20 text-white border border-white/30 font-display font-bold tracking-wide disabled:opacity-60"
            >
              <Share2 className="h-4 w-4 mr-2" />
              {sharing ? "Sharing…" : "Share"}
            </Button>
          )}
          <Button
            onClick={() => exportPdf(session, profile)}
            data-testid="export-pdf-button"
            className="h-11 rounded-sm bg-white text-[#003366] hover:bg-[#F1F5F9] font-display font-bold tracking-wide"
          >
            <FileDown className="h-4 w-4 mr-2" /> Export PDF
          </Button>
          <Button
            onClick={handleCopy}
            data-testid="copy-button"
            className="h-11 rounded-sm bg-[#00E5FF] text-[#003366] hover:bg-white font-display font-bold tracking-wide"
          >
            <Copy className="h-4 w-4 mr-2" /> Copy
          </Button>
        </div>
      </div>

      {/* Summary */}
      {session.summary && (
        <div
          className="px-5 sm:px-6 py-5 border-b border-[#CBD5E1] text-[#0F172A] text-base leading-relaxed"
          data-testid="session-summary"
        >
          {session.summary}
        </div>
      )}

      {/* Coach Brain */}
      {session.coach_brain && (
        <section className="px-5 sm:px-6 py-5 border-b border-[#CBD5E1] bg-[#F8FAFC]" data-testid="coach-brain-section">
          <div className="label-eyebrow text-[#003366]">Coach Brain Engine</div>
          <h4 className="font-display text-xl font-black tracking-tight text-[#0F172A] mt-1">
            Today's Objective
          </h4>
          <p className="mt-2 text-[#0F172A] leading-relaxed">{session.coach_brain.objective}</p>

          <div className="grid md:grid-cols-2 gap-3 mt-5">
            <div className="border border-[#CBD5E1] bg-white rounded-sm p-4">
              <div className="label-eyebrow text-[#003366]">Technical Focus</div>
              <p className="mt-1 text-sm text-[#0F172A]">{session.coach_brain.technical_focus}</p>
            </div>
            <div className="border border-[#CBD5E1] bg-white rounded-sm p-4">
              <div className="label-eyebrow text-[#003366]">Mental Focus</div>
              <p className="mt-1 text-sm text-[#0F172A]">{session.coach_brain.mental_focus}</p>
            </div>
            <div className="border border-[#CBD5E1] bg-white rounded-sm p-4">
              <div className="label-eyebrow text-[#003366]">Coach Tip</div>
              <p className="mt-1 text-sm text-[#0F172A]">{session.coach_brain.coach_tip}</p>
            </div>
            <div className="border border-[#CBD5E1] bg-white rounded-sm p-4">
              <div className="label-eyebrow text-[#003366]">Athlete Reflection</div>
              <p className="mt-1 text-sm text-[#0F172A]">{session.coach_brain.athlete_reflection}</p>
            </div>
          </div>

          <div className="mt-4 border-l-4 border-[#00E5FF] bg-white p-4">
            <div className="label-eyebrow text-[#003366]">Coaching Principle · {session.coach_brain.yuji_principle_title}</div>
            <p className="mt-1 text-sm text-[#0F172A] leading-relaxed">{session.coach_brain.yuji_principle}</p>
          </div>

          <div className="mt-4 border border-[#CBD5E1] bg-white rounded-sm p-4">
            <div className="label-eyebrow text-[#003366]">Coach Adjustment Area</div>
            <p className="mt-1 text-sm text-[#475569] leading-relaxed">
              This app creates the base. The coach completes the session through observation, creativity, and adjustment.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-[#0F172A] list-disc pl-5">
              {(session.coach_brain.coach_adjustment_prompts || []).map((q, idx) => (
                <li key={`coach-adjustment-${idx}`}>{q}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Blocks */}
      <div className="divide-y divide-[#CBD5E1]">
        {BLOCKS.map(({ key, label }) => {
          const b = session[key];
          if (!b || (Number(b.distance_m) === 0 && !(b.items || []).length)) return null;
          return (
            <section
              key={key}
              className="px-5 sm:px-6 py-5"
              data-testid={`block-${key}`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-display text-lg font-bold tracking-tight text-[#0F172A]">
                    {label}
                  </h4>
                  {b.energy_system && (
                    <span
                      data-testid={`energy-badge-${key}`}
                      className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-sm bg-[#003366] text-[#00E5FF] uppercase"
                    >
                      {b.energy_system}
                    </span>
                  )}
                </div>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={b.distance_m}
                      onChange={(e) => updateDistance(key, e.target.value)}
                      data-testid={`edit-distance-${key}`}
                      className="h-9 w-20 rounded-sm border-[#CBD5E1] text-right font-display font-bold p-2"
                    />
                    <span className="label-eyebrow text-[#003366]">{u}</span>
                  </div>
                ) : (
                  <span className="label-eyebrow text-[#003366]">
                    {b.distance_m} {u}
                  </span>
                )}
              </div>

              {editing ? (
                <div className="space-y-2">
                  {(b.items || []).map((it, idx) => (
                    <div
                      key={`${key}-edit-${idx}`}
                      className="flex items-start gap-2"
                    >
                      <Input
                        value={it}
                        onChange={(e) => updateItem(key, idx, e.target.value)}
                        data-testid={`edit-item-${key}-${idx}`}
                        className="rounded-sm border-[#CBD5E1] h-10 p-3 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(key, idx)}
                        data-testid={`remove-item-${key}-${idx}`}
                        className="h-10 w-10 flex items-center justify-center border border-[#CBD5E1] rounded-sm text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"
                        aria-label="Remove item"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addItem(key)}
                    data-testid={`add-item-${key}`}
                    className="inline-flex items-center gap-1 text-sm font-bold text-[#003366] hover:text-[#002244]"
                  >
                    <Plus className="h-4 w-4" /> Add line
                  </button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {(b.items || []).map((it, idx) => (
                    <li
                      key={`${key}-${idx}-${it.slice(0, 24)}`}
                      className="flex items-start gap-3 text-[#0F172A]"
                    >
                      <span className="mt-2 h-1.5 w-1.5 bg-[#003366] flex-shrink-0" />
                      <span className="text-base leading-relaxed">{it}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {(session.coaching_points?.length > 0 || editing) && (
          <section
            className="px-5 sm:px-6 py-5 bg-[#F1F5F9]"
            data-testid="block-coaching-points"
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h4 className="font-display text-lg font-bold tracking-tight text-[#0F172A]">
                Coaching points
              </h4>
              <span className="label-eyebrow text-[#003366]">Cues</span>
            </div>
            {editing ? (
              <div className="space-y-2">
                {(session.coaching_points || []).map((p, idx) => (
                  <div
                    key={`cp-edit-${idx}`}
                    className="flex items-start gap-2"
                  >
                    <Input
                      value={p}
                      onChange={(e) =>
                        updateCoachingPoint(idx, e.target.value)
                      }
                      data-testid={`edit-coaching-${idx}`}
                      className="rounded-sm border-[#CBD5E1] h-10 p-3 text-sm bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => removeCoachingPoint(idx)}
                      data-testid={`remove-coaching-${idx}`}
                      className="h-10 w-10 flex items-center justify-center border border-[#CBD5E1] rounded-sm bg-white text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"
                      aria-label="Remove coaching point"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCoachingPoint}
                  data-testid="add-coaching"
                  className="inline-flex items-center gap-1 text-sm font-bold text-[#003366] hover:text-[#002244]"
                >
                  <Plus className="h-4 w-4" /> Add point
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {session.coaching_points.map((p, idx) => (
                  <li
                    key={`cp-${idx}-${p.slice(0, 24)}`}
                    className="flex items-start gap-3 text-[#0F172A]"
                  >
                    <span className="mt-2 h-1.5 w-1.5 bg-[#00E5FF] border border-[#003366] flex-shrink-0" />
                    <span className="text-base leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
