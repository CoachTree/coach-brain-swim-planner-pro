import { useMemo, useState } from "react";
import { Brain, ChevronRight, MessageSquare, ThumbsDown, ThumbsUp, Users } from "lucide-react";

const SEED_TEST = {
  id: "bill-sweetenham-12",
  name: "Bill Sweetenham Test #12",
  set: "8 × 100 @ 2:00 Best Average",
  purpose: "Assess repeat-speed durability and late-set performance under controlled recovery.",
  evidence: "B",
  evidenceNote: "Strong multi-coach practice evidence. Research mapping and replication are still in progress.",
  replications: 47,
  countries: 12,
  outcomes: [
    ["Sprint", 82], ["Race Pace", 13], ["Aerobic", 5],
  ],
  posts: [
    { name: "M. Tanaka", place: "Japan", text: "Effective with 16-year-old boys. We saw less late-set fade after a six-week block.", tags: "16 y · male · freestyle · 27°C" },
    { name: "S. Miller", place: "Australia", text: "2:15 gave better quality for our developing group. I classify it as lactate tolerance, not VO₂.", tags: "15–17 y · mixed · 50 m pool" },
    { name: "L. Chen", place: "Canada", text: "Stroke count alongside lap time was the useful signal for our female sprinters.", tags: "17–18 y · female · sprint" },
  ],
};

const STORAGE_KEY = "swim:v1:community-contributions";

function readContributions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

function EvidenceBadge({ level }) {
  const styles = { A: "bg-emerald-100 text-emerald-800", B: "bg-sky-100 text-sky-800", C: "bg-amber-100 text-amber-800", D: "bg-slate-100 text-slate-700" };
  return <span className={`inline-flex rounded-sm px-2 py-1 text-xs font-black ${styles[level]}`}>Evidence {level}</span>;
}

export default function CommunityHub() {
  const [active, setActive] = useState("evidence");
  const [votes, setVotes] = useState({ useful: 124, notUseful: 9, mine: null });
  const [contributions, setContributions] = useState(readContributions);
  const [form, setForm] = useState({ age: "16", level: "Competitive", result: "", rpe: "", water: "", note: "" });
  const [debate, setDebate] = useState("Ultra Short Race Pace");

  const allPosts = useMemo(() => [...SEED_TEST.posts, ...contributions], [contributions]);
  const submit = (event) => {
    event.preventDefault();
    if (!form.note.trim()) return;
    const next = [...contributions, { name: "You", place: "Your club", text: form.note.trim(), tags: `${form.age} y · ${form.level} · RPE ${form.rpe || "—"} · ${form.water || "pool temp —"}` }];
    setContributions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The contribution remains visible for this session if browser storage is unavailable.
    }
    setForm({ ...form, result: "", rpe: "", water: "", note: "" });
  };
  const vote = (kind) => setVotes((prev) => {
    if (prev.mine === kind) return prev;
    return {
      mine: kind,
      useful: prev.useful + (kind === "useful" ? 1 : prev.mine === "useful" ? -1 : 0),
      notUseful: prev.notUseful + (kind === "notUseful" ? 1 : prev.mine === "notUseful" ? -1 : 0),
    };
  });

  return (
    <section data-testid="community-hub" className="space-y-8">
      <div className="border-l-4 border-[#00B8D4] bg-[#F0FDFF] p-6 sm:p-8">
        <div className="flex gap-3"><Brain className="mt-1 text-[#003366]" /><div>
          <div className="label-eyebrow">Coach Brain Community · beta</div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-[#0F172A]">Learn what reproduces.</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#475569]">Not a message board: a structured evidence layer connecting test sets, conditions, outcomes, coach interpretation, and research. Community data is stored in this browser in the MVP; cloud sharing requires the planned moderation and consent backend.</p>
        </div></div>
      </div>

      <div className="grid grid-cols-3 border border-[#CBD5E1] rounded-sm overflow-hidden">
        {[['evidence','Evidence'],['contribute','Contribute'],['debate','AI Debate']].map(([key,label]) => <button key={key} onClick={() => setActive(key)} data-active={active === key} className="px-2 py-3 text-xs font-display font-black border-r last:border-r-0 border-[#CBD5E1] data-[active=true]:bg-[#003366] data-[active=true]:text-white text-[#475569]">{label}</button>)}
      </div>

      {active === "evidence" && <>
        <article className="border border-[#CBD5E1] p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><div className="label-eyebrow">Community Test Set</div><h3 className="mt-2 font-display text-2xl font-black text-[#0F172A]">{SEED_TEST.name}</h3><p className="mt-2 font-mono text-sm text-[#003366]">{SEED_TEST.set}</p></div><EvidenceBadge level={SEED_TEST.evidence} /></div>
          <p className="mt-5 text-sm leading-relaxed text-[#475569]">{SEED_TEST.purpose}</p>
          <div className="mt-5 grid grid-cols-2 gap-3"><div className="bg-[#F8FAFC] p-4"><Users className="h-4 w-4 text-[#003366]"/><b className="mt-2 block text-2xl">{SEED_TEST.replications}</b><span className="text-xs text-[#64748B]">documented replications</span></div><div className="bg-[#F8FAFC] p-4"><b className="block text-2xl">{SEED_TEST.countries}</b><span className="text-xs text-[#64748B]">countries represented</span></div></div>
          <div className="mt-6"><div className="label-eyebrow mb-3">AI summary · current community signal</div>{SEED_TEST.outcomes.map(([label,value]) => <div key={label} className="mb-3"><div className="flex justify-between text-sm"><span>{label}</span><b>{value}%</b></div><div className="mt-1 h-2 bg-slate-100"><div className="h-2 bg-[#00B8D4]" style={{ width: `${value}%` }} /></div></div>)}</div>
          <div className="mt-6 border-t border-[#E2E8F0] pt-5"><div className="label-eyebrow">Evidence interpretation</div><p className="mt-2 text-sm text-[#475569]">{SEED_TEST.evidenceNote}</p><p className="mt-3 text-xs text-[#64748B]">Evidence A: replicated research · B: convergent top-coach practice · C: established-club experience · D: individual experience. Levels never imply medical or performance guarantees.</p></div>
        </article>
        <article className="border border-[#CBD5E1] p-6"><div className="flex items-center gap-2"><Brain className="h-5 w-5 text-[#003366]"/><h3 className="font-display font-black">AI-generated next hypothesis</h3></div><p className="mt-3 rounded-sm bg-[#F8FAFC] p-4 font-mono text-sm leading-relaxed">Try 6 × 125, 75 s rest, final 2 at race pace — then compare repeatability and stroke count against the 8 × 100 baseline.</p><p className="mt-3 text-xs text-[#64748B]">Hypothesis only, not a validated prescription. Test with appropriate coach judgment and athlete safeguards.</p></article>
        <div className="flex items-center justify-between border border-[#CBD5E1] p-4"><span className="text-sm font-bold">Was this evidence card useful?</span><div className="flex gap-2"><button onClick={() => vote("useful")} className={`inline-flex gap-1 border px-3 py-2 text-sm ${votes.mine === "useful" ? "border-[#003366] bg-[#003366] text-white" : "border-[#CBD5E1]"}`}><ThumbsUp className="h-4 w-4"/>{votes.useful}</button><button onClick={() => vote("notUseful")} className={`inline-flex gap-1 border px-3 py-2 text-sm ${votes.mine === "notUseful" ? "border-[#003366] bg-[#003366] text-white" : "border-[#CBD5E1]"}`}><ThumbsDown className="h-4 w-4"/>{votes.notUseful}</button></div></div>
      </>}

      {active === "contribute" && <div className="space-y-6"><form onSubmit={submit} className="border border-[#CBD5E1] p-6 space-y-4"><div><div className="label-eyebrow">Add a structured replication</div><p className="mt-2 text-sm text-[#64748B]">Never include athlete names or identifiable health data.</p></div><div className="grid grid-cols-2 gap-3">{[["age","Age"],["level","Level"],["result","Result / change"],["rpe","RPE (1–10)"],["water","Water temperature"]].map(([key,label]) => <label key={key} className="text-xs font-bold text-[#475569]">{label}<input value={form[key]} onChange={(e) => setForm({...form,[key]:e.target.value})} className="mt-1 h-10 w-full border border-[#CBD5E1] px-2 text-sm" /></label>)}</div><label className="block text-xs font-bold text-[#475569]">What did you observe?<textarea required value={form.note} onChange={(e) => setForm({...form,note:e.target.value})} className="mt-1 min-h-24 w-full border border-[#CBD5E1] p-3 text-sm" placeholder="Conditions, outcome, interpretation, and what you would change next time." /></label><button className="bg-[#003366] px-4 py-3 text-sm font-bold text-white">Save local contribution</button></form><div className="space-y-3">{allPosts.map((post, i) => <article key={`${post.name}-${i}`} className="border border-[#CBD5E1] p-5"><div className="flex items-center justify-between"><b>{post.name}</b><span className="text-xs text-[#64748B]">{post.place}</span></div><p className="mt-3 text-sm leading-relaxed">{post.text}</p><p className="mt-3 text-xs text-[#64748B]">{post.tags}</p></article>)}</div></div>}

      {active === "debate" && <article className="border border-[#CBD5E1] p-6 sm:p-7"><div className="label-eyebrow">AI Debate · framework preview</div><h3 className="mt-2 font-display text-2xl font-black">{debate}</h3><select value={debate} onChange={(e) => setDebate(e.target.value)} className="mt-4 w-full border border-[#CBD5E1] bg-white p-3 text-sm"><option>Ultra Short Race Pace</option><option>Best Average versus broken swims</option><option>When should sprint work enter a season?</option></select><div className="mt-6 space-y-4"><p className="text-sm leading-relaxed text-[#475569]">The production debate will distinguish attributable primary sources, published research, structured replications, and opinion. It must not impersonate coaches or invent positions.</p><div className="grid gap-3 sm:grid-cols-2">{[["Practice lens","USRP can protect race-quality repetitions when rest and athlete readiness are explicit."],["Evidence lens","Compare outcomes by event, age, sex, pool course, season phase, adherence, and injury context before claiming transfer."],["Community question","Which outcome changed: pace stability, stroke count, race time, or simply session completion?"],["Decision rule","Show confidence, disagreement, missing data, and conditions where a result did not reproduce."]].map(([title,copy]) => <div key={title} className="bg-[#F8FAFC] p-4"><b className="text-sm">{title}</b><p className="mt-2 text-sm text-[#475569]">{copy}</p></div>)}</div></div><button onClick={() => setActive("contribute")} className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[#003366]">Add evidence to this debate <ChevronRight className="h-4 w-4"/></button></article>}
      <div className="flex items-center gap-2 text-xs text-[#64748B]"><MessageSquare className="h-4 w-4"/> The global layer is deliberately not connected until identity, moderation, consent, and data-quality controls are in place.</div>
    </section>
  );
}
