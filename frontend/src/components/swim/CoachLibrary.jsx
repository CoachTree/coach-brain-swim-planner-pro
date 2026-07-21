import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Star,
  Trash2,
  ListChecks,
  Plus,
  CalendarPlus,
  ChevronRight,
  Download,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Favourites,
  TestSets,
  exportCoachData,
  importCoachData,
} from "@/lib/localStore";

const TABS = [
  { id: "favourites", label: "Favourites" },
  { id: "test-sets", label: "Test sets" },
];

export default function CoachLibrary({ onLoadFavourite }) {
  const [tab, setTab] = useState("favourites");
  const [favourites, setFavourites] = useState([]);
  const [testSets, setTestSets] = useState([]);

  const refresh = () => {
    setFavourites(Favourites.list());
    setTestSets(TestSets.list());
  };
  useEffect(refresh, []);

  const handleExport = () => {
    const payload = exportCoachData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coach-brain-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Backup exported");
  };

  const handleImport = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importCoachData(JSON.parse(String(reader.result || "{}")));
        refresh();
        toast.success("Backup imported", {
          description: `${result.favourites} favourites · ${result.test_sets} test sets · ${result.journal} journal entries`,
        });
      } catch {
        toast.error("Could not import backup");
      }
    };
    reader.readAsText(file);
  };

  return (
    <section className="mt-16" data-testid="coach-library">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
        <div className="label-eyebrow">Coach library</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-9 items-center gap-1 rounded-sm border border-[#CBD5E1] px-3 text-xs font-display font-bold uppercase tracking-wider text-[#003366] hover:border-[#003366]"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-sm border border-[#CBD5E1] px-3 text-xs font-display font-bold uppercase tracking-wider text-[#003366] hover:border-[#003366]">
            <Upload className="h-4 w-4" /> Import
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              className="sr-only"
              aria-label="Import coach library backup"
            />
          </label>
        </div>
      </div>
      <div className="border border-[#CBD5E1] rounded-sm bg-white">
        <div className="flex border-b border-[#CBD5E1]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-active={tab === t.id}
              data-testid={`library-tab-${t.id}`}
              className="px-4 sm:px-5 py-3 font-display text-sm font-bold tracking-wide data-[active=true]:text-[#003366] data-[active=true]:border-b-2 data-[active=true]:border-[#003366] text-[#475569]"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5">
          {tab === "favourites" && (
            <FavouritesList
              items={favourites}
              onLoad={(fav) => {
                onLoadFavourite?.(fav);
                toast.success(`Loaded "${fav.name}"`);
              }}
              onRemove={(id) => {
                Favourites.remove(id);
                refresh();
                toast.success("Removed from favourites");
              }}
            />
          )}
          {tab === "test-sets" && (
            <TestSetsList items={testSets} onChange={refresh} />
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------- Favourites ----------------
function FavouritesList({ items, onLoad, onRemove }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Star className="h-5 w-5" />}
        title="No favourites yet"
        body="Generate a session and tap the star to save it here for reuse."
      />
    );
  }
  return (
    <ul className="divide-y divide-[#CBD5E1]" data-testid="favourites-list">
      {items.map((fav) => (
        <li
          key={fav.id}
          className="flex items-center gap-3 py-3"
          data-testid={`favourite-${fav.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[#0F172A] truncate">
              {fav.name}
            </div>
            <div className="text-xs text-[#475569] mt-0.5 capitalize">
              {fav.profile?.distance} {fav.profile?.unit || "m"} ·{" "}
              {fav.profile?.stroke} · {fav.profile?.intensity} ·{" "}
              {fav.profile?.poolType}
            </div>
          </div>
          <Button
            onClick={() => onLoad(fav)}
            data-testid={`favourite-load-${fav.id}`}
            className="h-9 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold text-sm"
          >
            Load <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <button
            type="button"
            onClick={() => onRemove(fav.id)}
            data-testid={`favourite-remove-${fav.id}`}
            className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"
            aria-label="Remove favourite"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------- Test sets ----------------
const TEST_SET_PRESETS = [
  { name: "8 x 100 pace test", description: "Hold target pace +/- 1s" },
  { name: "Broken 200 test", description: "4 x 50 with 10s rest at race pace" },
  { name: "Threshold set", description: "10 x 100 best avg, 15s rest" },
  { name: "Sprint power set", description: "8 x 15m max @ 95-100% / RPE 9-10" },
];

function TestSetsList({ items, onChange }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    TestSets.upsert({
      name: name.trim(),
      description: description.trim(),
      results: [],
    });
    setName("");
    setDescription("");
    setCreating(false);
    onChange();
    toast.success("Test set saved");
  };

  return (
    <div data-testid="test-sets-pane">
      {items.length === 0 && !creating ? (
        <EmptyState
          icon={<ListChecks className="h-5 w-5" />}
          title="No test sets yet"
          body="Save your benchmark sets here and log results week by week."
        />
      ) : (
        <ul className="divide-y divide-[#CBD5E1]">
          {items.map((ts) => (
            <TestSetRow key={ts.id} testSet={ts} onChange={onChange} />
          ))}
        </ul>
      )}

      {creating ? (
        <div className="mt-4 border border-[#CBD5E1] rounded-sm p-4 space-y-3 bg-[#F1F5F9]">
          <div>
            <span className="label-eyebrow block mb-1">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="test-set-name"
              className="h-11 rounded-sm border-[#CBD5E1] bg-white"
              placeholder="e.g. 8 x 100 pace test"
            />
          </div>
          <div>
            <span className="label-eyebrow block mb-1">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-testid="test-set-description"
              className="w-full rounded-sm border border-[#CBD5E1] p-3 text-sm bg-white"
              placeholder="Brief instructions"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {TEST_SET_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setDescription(p.description);
                }}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 border border-[#CBD5E1] bg-white hover:border-[#003366]"
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={submit}
              data-testid="test-set-save"
              className="h-10 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold"
            >
              Save
            </Button>
            <Button
              onClick={() => setCreating(false)}
              className="h-10 rounded-sm bg-white border border-[#CBD5E1] text-[#0F172A] hover:bg-[#F1F5F9] font-display font-bold"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="test-set-create"
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[#003366] hover:text-[#002244]"
        >
          <Plus className="h-4 w-4" /> Add test set
        </button>
      )}
    </div>
  );
}

function TestSetRow({ testSet, onChange }) {
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");

  const addResult = () => {
    if (!result.trim()) return;
    const next = {
      ...testSet,
      results: [
        ...(testSet.results || []),
        {
          id:
            (typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : String(Date.now())),
          date: new Date().toISOString(),
          result: result.trim(),
          notes: notes.trim(),
        },
      ],
    };
    TestSets.upsert(next);
    setResult("");
    setNotes("");
    setLogging(false);
    onChange();
    toast.success("Result logged");
  };

  const remove = () => {
    TestSets.remove(testSet.id);
    onChange();
    toast.success("Test set removed");
  };

  return (
    <li className="py-3" data-testid={`test-set-${testSet.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[#0F172A]">
            {testSet.name}
          </div>
          {testSet.description && (
            <div className="text-xs text-[#475569] mt-0.5">
              {testSet.description}
            </div>
          )}
          {testSet.results?.length > 0 && (
            <div className="text-xs text-[#003366] mt-1">
              Last:{" "}
              {new Date(
                testSet.results[testSet.results.length - 1].date,
              ).toLocaleDateString()}{" "}
              · {testSet.results[testSet.results.length - 1].result}
            </div>
          )}
        </div>
        <Button
          onClick={() => setLogging((v) => !v)}
          data-testid={`test-set-log-${testSet.id}`}
          className="h-9 rounded-sm bg-[#00E5FF] text-[#003366] hover:bg-white font-display font-bold text-sm"
        >
          <CalendarPlus className="h-4 w-4 mr-1" /> Log
        </Button>
        <button
          type="button"
          onClick={remove}
          data-testid={`test-set-remove-${testSet.id}`}
          className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"
          aria-label="Remove test set"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {logging && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#F1F5F9] p-3 rounded-sm">
          <Input
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Result (e.g. 1:08 avg, 6:42 total)"
            data-testid={`test-set-result-${testSet.id}`}
            className="h-10 rounded-sm border-[#CBD5E1] bg-white text-sm"
          />
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="h-10 rounded-sm border-[#CBD5E1] bg-white text-sm"
          />
          <Button
            onClick={addResult}
            data-testid={`test-set-save-result-${testSet.id}`}
            className="h-10 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold text-sm col-span-full sm:col-span-1"
          >
            Save result
          </Button>
        </div>
      )}

      {testSet.results?.length > 0 && (
        <details className="mt-2 text-xs text-[#475569]">
          <summary className="cursor-pointer">
            History ({testSet.results.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {[...testSet.results].reverse().map((r) => (
              <li key={r.id}>
                {new Date(r.date).toLocaleDateString()} · {r.result}
                {r.notes && ` — ${r.notes}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div className="text-center py-8 text-[#475569]">
      <div className="inline-flex h-10 w-10 items-center justify-center border border-[#CBD5E1] rounded-sm mb-3">
        {icon}
      </div>
      <div className="font-display font-bold text-[#0F172A]">{title}</div>
      <p className="text-sm mt-1">{body}</p>
    </div>
  );
}
