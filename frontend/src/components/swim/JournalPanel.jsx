import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NotebookPen, ChevronDown, X, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Journal } from "@/lib/localStore";

/**
 * Per-session training journal entry. Keyed by sessionKey (stable per session render).
 * Data schema (forward-compatible with a future REST API):
 *   { id, coach_id, session_key, session_snapshot, profile_snapshot,
 *     observations, athlete_feedback, fatigue, performance_notes,
 *     injury_concerns, created_at, updated_at }
 */
export default function JournalPanel({ sessionKey, session, profile }) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState(null);

  // Load existing entry for this session (if any) when opened
  useEffect(() => {
    if (!open) return;
    const existing = Journal.list().find((e) => e.session_key === sessionKey);
    if (existing) setEntry(existing);
    else
      setEntry({
        session_key: sessionKey,
        session_snapshot: session,
        profile_snapshot: profile,
        observations: "",
        athlete_feedback: "",
        fatigue: 5,
        performance_notes: "",
        injury_concerns: "",
      });
  }, [open, sessionKey, session, profile]);

  const set = (field) => (e) =>
    setEntry((prev) => ({ ...prev, [field]: e.target.value }));

  const hasContent = useMemo(() => {
    if (!entry) return false;
    return [
      entry.observations,
      entry.athlete_feedback,
      entry.performance_notes,
      entry.injury_concerns,
    ].some((s) => (s || "").trim().length > 0);
  }, [entry]);

  const handleSave = () => {
    if (!entry) return;
    Journal.upsert(entry);
    toast.success("Journal entry saved");
    setOpen(false);
  };

  const handleDelete = () => {
    if (entry?.id) {
      Journal.remove(entry.id);
      toast.success("Journal entry removed");
    }
    setOpen(false);
  };

  return (
    <>
      <Button
        onClick={() => setOpen((v) => !v)}
        data-testid="notes-button"
        className="h-11 rounded-sm bg-white/10 hover:bg-white/20 text-white border border-white/30 font-display font-bold tracking-wide"
      >
        <NotebookPen className="h-4 w-4 mr-2" /> Notes
        <ChevronDown
          className={`h-4 w-4 ml-1 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>

      {open && entry && (
        <div
          className="col-span-full bg-white text-[#0F172A] border-t border-white/30 -mx-5 sm:-mx-6 mt-4 px-5 sm:px-6 py-5 rounded-b-sm"
          data-testid="journal-panel"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-eyebrow">Training journal</div>
              <h4 className="font-display text-lg font-bold tracking-tight">
                Notes for this session
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#475569] hover:text-[#003366]"
              aria-label="Close notes"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Observations">
              <textarea
                value={entry.observations}
                onChange={set("observations")}
                rows={3}
                data-testid="journal-observations"
                className="w-full rounded-sm border border-[#CBD5E1] p-3 text-sm"
                placeholder="What did you see in the water?"
              />
            </Field>
            <Field label="Athlete feedback">
              <textarea
                value={entry.athlete_feedback}
                onChange={set("athlete_feedback")}
                rows={3}
                data-testid="journal-athlete-feedback"
                className="w-full rounded-sm border border-[#CBD5E1] p-3 text-sm"
                placeholder="What did the swimmer say?"
              />
            </Field>
            <Field label="Performance notes">
              <textarea
                value={entry.performance_notes}
                onChange={set("performance_notes")}
                rows={3}
                data-testid="journal-performance"
                className="w-full rounded-sm border border-[#CBD5E1] p-3 text-sm"
                placeholder="Times, splits, target hits…"
              />
            </Field>
            <Field label="Injury concerns">
              <textarea
                value={entry.injury_concerns}
                onChange={set("injury_concerns")}
                rows={3}
                data-testid="journal-injury"
                className="w-full rounded-sm border border-[#CBD5E1] p-3 text-sm"
                placeholder="Niggles, soreness, anything to monitor"
              />
            </Field>

            <Field label={`Fatigue (1–10): ${entry.fatigue}`}>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={entry.fatigue}
                onChange={(e) =>
                  setEntry((p) => ({ ...p, fatigue: Number(e.target.value) }))
                }
                data-testid="journal-fatigue"
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[#475569] mt-1">
                <span>Fresh</span>
                <span>Wrecked</span>
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2 mt-5">
            <Button
              onClick={handleSave}
              data-testid="journal-save"
              disabled={!hasContent}
              className="h-11 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold tracking-wide disabled:opacity-60"
            >
              <Save className="h-4 w-4 mr-2" /> Save entry
            </Button>
            {entry.id && (
              <Button
                onClick={handleDelete}
                data-testid="journal-delete"
                className="h-11 rounded-sm bg-white border border-[#CBD5E1] text-[#FF3B30] hover:bg-[#FFF1F0] font-display font-bold tracking-wide"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label-eyebrow block mb-2">{label}</span>
      {children}
    </label>
  );
}
