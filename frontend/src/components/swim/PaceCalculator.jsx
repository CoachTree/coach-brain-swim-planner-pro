import React, { useEffect, useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const RACE_DISTANCES = [50, 100, 200, 400, 800, 1500];

function parseTimeToSeconds(value) {
  // Accepts mm:ss or seconds
  if (!value) return null;
  const v = String(value).trim();
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    const mins = Number(m);
    const secs = Number(s);
    if (Number.isFinite(mins) && Number.isFinite(secs) && mins >= 0 && secs >= 0) {
      return mins * 60 + secs;
    }
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmt(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PaceCalculator({ unit = "m", onChange }) {
  const [open, setOpen] = useState(false);
  const [raceDistance, setRaceDistance] = useState(100);
  const [time, setTime] = useState("");

  const seconds = useMemo(() => parseTimeToSeconds(time), [time]);
  const per100 = seconds ? seconds / (raceDistance / 100) : null;
  const per50 = per100 ? per100 / 2 : null;

  useEffect(() => {
    if (open && seconds) {
      onChange?.({ race_distance: raceDistance, target_seconds: seconds });
    } else {
      onChange?.(null);
    }
  }, [open, raceDistance, seconds, onChange]);

  return (
    <div data-testid="pace-calculator-wrapper">
      <div className="flex items-center justify-between mb-3">
        <span className="label-eyebrow">09 · Pace calculator (optional)</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="pace-toggle"
          className="text-sm font-bold text-[#003366] hover:text-[#002244] inline-flex items-center gap-1"
        >
          {open ? (
            <>
              <X className="h-4 w-4" /> Hide
            </>
          ) : (
            <>
              <Calculator className="h-4 w-4" /> Add target
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="border border-[#CBD5E1] rounded-sm p-4 sm:p-5 bg-[#F1F5F9] space-y-4">
          <div>
            <span className="label-eyebrow block mb-2">Race distance</span>
            <div className="grid grid-cols-3 gap-2">
              {RACE_DISTANCES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRaceDistance(d)}
                  data-active={raceDistance === d}
                  data-testid={`pace-race-${d}`}
                  className="tile text-center justify-center font-display text-sm py-3"
                  style={{ minHeight: 44 }}
                >
                  {d} {unit}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label-eyebrow block mb-2">
              Target time (mm:ss)
            </label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 1:05"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              data-testid="pace-time-input"
              className="h-12 rounded-sm border-[#CBD5E1] font-display text-lg font-bold p-3 bg-white"
            />
          </div>

          {per100 && (
            <div
              className="grid grid-cols-3 gap-3 pt-1"
              data-testid="pace-output"
            >
              <PaceCell label={`per 100${unit}`} value={fmt(per100)} />
              <PaceCell label={`per 50${unit}`} value={fmt(per50)} />
              <PaceCell label="send-off" value={`+5 / +10 / +15s`} small />
            </div>
          )}
          {!per100 && time && (
            <p className="text-sm text-[#FF3B30]">
              Enter time as mm:ss (e.g. 1:05).
            </p>
          )}
          <p className="text-xs text-[#475569] leading-relaxed">
            Send-offs: <strong>+5s</strong> for hard / threshold,{" "}
            <strong>+10s</strong> aerobic, <strong>+15s</strong> easy.
          </p>
        </div>
      )}
    </div>
  );
}

function PaceCell({ label, value, small = false }) {
  return (
    <div className="border border-[#CBD5E1] bg-white rounded-sm p-3 text-center">
      <div className="label-eyebrow">{label}</div>
      <div
        className={`font-display font-black text-[#003366] mt-1 ${small ? "text-base" : "text-2xl"}`}
      >
        {value}
      </div>
    </div>
  );
}
