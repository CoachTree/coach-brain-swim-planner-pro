import React from "react";

const COLUMN_CLASSES = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/**
 * Mobile-friendly large tappable tile selector.
 * Replaces traditional dropdowns per design guidelines.
 */
export default function TileGroup({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
  columns = 2,
  renderLabel,
}) {
  const colsClass = COLUMN_CLASSES[columns] || COLUMN_CLASSES[2];

  return (
    <div data-testid={`field-${testIdPrefix}`}>
      <div className="label-eyebrow mb-3">{label}</div>
      <div className={`grid ${colsClass} gap-3`}>
        {options.map((opt) => {
          const isActive = value === opt;
          const display = renderLabel ? renderLabel(opt) : String(opt);
          return (
            <button
              key={String(opt)}
              type="button"
              data-active={isActive}
              data-testid={`${testIdPrefix}-tile-${String(opt)
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
              onClick={() => onChange(opt)}
              className="tile"
              aria-pressed={isActive}
            >
              {display}
            </button>
          );
        })}
      </div>
    </div>
  );
}
