import { useEffect, useState } from "react";
import { Clock3, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SavedSessions } from "@/lib/localStore";

function sessionLabel(saved) {
  const profile = saved.profile || {};
  return `${saved.session?.total_distance_m || profile.distance || ""} ${profile.unit || "m"} · ${profile.stroke || "session"}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionHistory({ onOpen }) {
  const [sessions, setSessions] = useState([]);

  const refresh = () => setSessions(SavedSessions.list());

  useEffect(() => {
    refresh();
  }, []);

  const rename = (saved) => {
    const name = window.prompt("Rename saved session", saved.name);
    if (!name?.trim()) return;
    SavedSessions.upsert({ id: saved.id, name: name.trim() });
    refresh();
    toast.success("Session renamed");
  };

  const remove = (saved) => {
    if (!window.confirm(`Delete ${saved.name}?`)) return;
    SavedSessions.remove(saved.id);
    refresh();
    toast.success("Session deleted");
  };

  return (
    <section data-testid="session-history-page">
      <div className="mb-10 sm:mb-12">
        <div className="label-eyebrow mb-3">Saved sessions</div>
        <h2 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-[#0F172A] leading-[0.95]">
          Session
          <br />
          <span className="text-[#003366]">history.</span>
        </h2>
        <p className="mt-5 text-base sm:text-lg text-[#475569] max-w-lg leading-relaxed">
          Reopen, rename, or remove sessions saved in this browser.
        </p>
      </div>

      <div className="border border-[#CBD5E1] rounded-sm bg-white">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#475569]">
            <Clock3 className="h-6 w-6 mx-auto mb-2 text-[#003366]" />
            No saved sessions yet. Generate a session and save it here.
          </div>
        ) : (
          <ul className="divide-y divide-[#CBD5E1]" data-testid="session-history-list">
            {sessions.map((saved) => (
              <li key={saved.id} className="p-4 sm:p-5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-[#0F172A] truncate">{saved.name}</div>
                  <div className="text-xs text-[#475569] mt-1">{sessionLabel(saved)}</div>
                  <div className="text-xs text-[#64748B] mt-1">Saved {formatDate(saved.updated_at || saved.created_at)}</div>
                </div>
                <Button onClick={() => onOpen?.(saved)} data-testid={`session-open-${saved.id}`} className="h-9 rounded-sm bg-[#003366] hover:bg-[#002244] text-white font-display font-bold text-sm">Open</Button>
                <button type="button" onClick={() => rename(saved)} data-testid={`session-rename-${saved.id}`} aria-label={`Rename ${saved.name}`} className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#003366]"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(saved)} data-testid={`session-delete-${saved.id}`} aria-label={`Delete ${saved.name}`} className="h-9 w-9 rounded-sm border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:text-[#FF3B30] hover:border-[#FF3B30]"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}