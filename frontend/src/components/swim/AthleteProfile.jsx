import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TileGroup from "@/components/swim/TileGroup";
import { Athletes } from "@/lib/localStore";

const STROKES = ["freestyle", "backstroke", "breaststroke", "butterfly", "IM"];
const GENDERS = ["female", "male", "non-binary", "prefer not to say"];

const EMPTY_FORM = {
  name: "",
  age: "",
  gender: "prefer not to say",
  mainStroke: "freestyle",
  bestEvents: "",
  personalBestTimes: "",
  team: "",
  coach: "",
  notes: "",
};

function formFromAthlete(athlete) {
  return athlete ? { ...EMPTY_FORM, ...athlete, age: athlete.age ?? "" } : { ...EMPTY_FORM };
}

export default function AthleteProfile({ onSelectAthlete, onAthletesChange, selectedAthleteId }) {
  const [athletes, setAthletes] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = () => setAthletes(Athletes.list());

  useEffect(() => {
    refresh();
  }, []);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (athlete) => {
    setEditingId(athlete.id);
    setForm(formFromAthlete(athlete));
    setShowForm(true);
  };

  const handleSave = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Please enter an athlete name");
      return;
    }
    const saved = Athletes.upsert({
      ...form,
      id: editingId || undefined,
      name: form.name.trim(),
      age: form.age === "" ? "" : Number(form.age),
    });
    refresh();
    onAthletesChange?.();
    setForm(formFromAthlete(saved));
    setShowForm(false);
    toast.success(editingId ? "Athlete updated" : "Athlete added");
  };

  const handleDelete = (athlete) => {
    if (!window.confirm(`Delete ${athlete.name}?`)) return;
    Athletes.remove(athlete.id);
    refresh();
    onAthletesChange?.();
    if (selectedAthleteId === athlete.id) onSelectAthlete?.(null);
    toast.success("Athlete deleted");
  };

  return (
    <section data-testid="athlete-profile-page">
      <div className="mb-10 sm:mb-12">
        <div className="label-eyebrow mb-3">Manage athletes</div>
        <h2 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-[#0F172A] leading-[0.95]">
          Athlete
          <br />
          <span className="text-[#003366]">profiles.</span>
        </h2>
        <p className="mt-5 text-base sm:text-lg text-[#475569] max-w-lg leading-relaxed">
          Save swimmer details once, then use them when building a training session.
        </p>
      </div>

      <Button onClick={openNew} data-testid="athlete-add-button" className="w-full h-12 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold">
        <Plus className="h-4 w-4" /> Add athlete
      </Button>

      {showForm && (
        <form onSubmit={handleSave} className="mt-6 border border-[#CBD5E1] rounded-sm p-5 sm:p-6 space-y-6 bg-[#F8FAFC]" data-testid="athlete-form">
          <div className="flex items-center justify-between">
            <div className="label-eyebrow">{editingId ? "Edit athlete" : "New athlete"}</div>
            <button type="button" onClick={() => setShowForm(false)} aria-label="Close athlete form" className="text-[#475569] hover:text-[#003366]"><X className="h-5 w-5" /></button>
          </div>
          <Field label="Name" required><Input value={form.name} onChange={update("name")} placeholder="e.g. Hana Sato" required data-testid="athlete-name" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Age"><Input type="number" min="4" max="99" value={form.age} onChange={update("age")} placeholder="e.g. 14" data-testid="athlete-age" /></Field>
            <Field label="Gender"><select value={form.gender} onChange={update("gender")} className="flex h-9 w-full rounded-sm border border-[#CBD5E1] bg-white px-3 py-1 text-sm" data-testid="athlete-gender">{GENDERS.map((gender) => <option key={gender} value={gender}>{gender}</option>)}</select></Field>
          </div>
          <TileGroup label="Main stroke" options={STROKES} value={form.mainStroke} onChange={(value) => setForm((current) => ({ ...current, mainStroke: value }))} testIdPrefix="athlete-stroke" columns={2} renderLabel={(value) => value === "IM" ? "IM (Medley)" : value} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Best events"><Input value={form.bestEvents} onChange={update("bestEvents")} placeholder="e.g. 100 free, 200 IM" data-testid="athlete-best-events" /></Field>
            <Field label="Personal best times"><Input value={form.personalBestTimes} onChange={update("personalBestTimes")} placeholder="e.g. 1:02.30 / 2:18.40" data-testid="athlete-pb-times" /></Field>
            <Field label="Team"><Input value={form.team} onChange={update("team")} placeholder="e.g. Seaside SC" data-testid="athlete-team" /></Field>
            <Field label="Coach"><Input value={form.coach} onChange={update("coach")} placeholder="e.g. Coach Yamada" data-testid="athlete-coach" /></Field>
          </div>
          <Field label="Notes"><textarea value={form.notes} onChange={update("notes")} rows={4} placeholder="Technique, health, or coaching notes" className="w-full rounded-sm border border-[#CBD5E1] bg-white p-3 text-sm" data-testid="athlete-notes" /></Field>
          <div className="flex gap-2"><Button type="submit" data-testid="athlete-save-button" className="rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold">{editingId ? "Save changes" : "Save athlete"}</Button><Button type="button" onClick={() => setShowForm(false)} className="rounded-sm bg-white border border-[#CBD5E1] text-[#0F172A] font-display font-bold">Cancel</Button></div>
        </form>
      )}

      <div className="mt-6 border border-[#CBD5E1] rounded-sm bg-white">
        {athletes.length === 0 ? <div className="p-6 text-sm text-[#475569] text-center"><UserRound className="h-6 w-6 mx-auto mb-2 text-[#003366]" />No athletes yet. Add the first profile above.</div> : <ul className="divide-y divide-[#CBD5E1]" data-testid="athlete-list">{athletes.map((athlete) => <li key={athlete.id} className="p-4 flex items-start gap-3"><div className="flex-1 min-w-0"><div className="font-display font-bold text-[#0F172A]">{athlete.name}</div><div className="text-xs text-[#475569] mt-1">{athlete.age || "Age not set"} · {athlete.mainStroke} · {athlete.team || "No team"}</div>{athlete.bestEvents && <div className="text-xs text-[#475569] mt-1">{athlete.bestEvents}</div>}</div><Button onClick={() => onSelectAthlete?.(athlete)} data-testid={`athlete-select-${athlete.id}`} className="h-9 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold text-sm">Select</Button><button type="button" onClick={() => openEdit(athlete)} aria-label={`Edit ${athlete.name}`} className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#003366]"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => handleDelete(athlete)} aria-label={`Delete ${athlete.name}`} className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"><Trash2 className="h-4 w-4" /></button></li>)}</ul>}
      </div>
    </section>
  );
}

function Field({ label, required = false, children }) {
  return <label className="block"><span className="label-eyebrow block mb-2">{label}{required ? " *" : ""}</span>{children}</label>;
}