import React from "react";

interface StatCardProps {
  label: string;
  value: number | string;
  subtext?: string;
}

export function StatCard({ label, value, subtext }: StatCardProps) {
  return (
    <div className="bg-surface border border-line rounded-lg p-4 flex flex-col justify-between h-[105px]">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div>
        <div className="text-2xl font-semibold text-ink tracking-tight">
          {value}
        </div>
        {subtext && (
          <div className="text-[11px] text-ink-faint mt-0.5">{subtext}</div>
        )}
      </div>
    </div>
  );
}
