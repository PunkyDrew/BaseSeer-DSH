import React from "react";

/** Why a standard notation has nothing to draw, with the way to a view that has. */
export function NotationEmpty({
  reason,
  label,
  onFallback,
}: {
  reason: string;
  label: string;
  onFallback: () => void;
}) {
  return (
    <div className="bpg-empty" role="status">
      <p>{reason}</p>
      <button type="button" onClick={onFallback}>
        {label}
      </button>
    </div>
  );
}
