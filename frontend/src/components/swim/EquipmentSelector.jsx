import React from "react";
import { Check } from "lucide-react";

const EQUIPMENT = [
  { id: "fins", label: "Fins" },
  { id: "paddles", label: "Paddles" },
  { id: "parachute", label: "Parachute" },
  { id: "tubing", label: "Resistance tubing" },
  { id: "drag-socks", label: "Drag socks" },
  { id: "kickboard-power", label: "Kickboard power" },
];

export default function EquipmentSelector({ label, value = [], onChange }) {
  const toggle = (id) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div data-testid="equipment-selector">
      <div className="label-eyebrow mb-3">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        {EQUIPMENT.map((eq) => {
          const active = value.includes(eq.id);
          return (
            <button
              key={eq.id}
              type="button"
              onClick={() => toggle(eq.id)}
              data-active={active}
              data-testid={`equipment-tile-${eq.id}`}
              className="tile relative"
              aria-pressed={active}
            >
              <span>{eq.label}</span>
              {active && (
                <span
                  aria-hidden
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-sm bg-[#00E5FF] text-[#003366] flex items-center justify-center"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <p className="text-xs text-[#475569] mt-2" data-testid="equipment-summary">
          {value.length} selected
        </p>
      )}
    </div>
  );
}

export const EQUIPMENT_LABELS = EQUIPMENT.reduce(
  (acc, e) => ({ ...acc, [e.id]: e.label }),
  {},
);
