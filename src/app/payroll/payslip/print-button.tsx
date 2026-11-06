"use client";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print h-9 rounded-full border border-rule-strong px-4 text-[13px] font-semibold transition-colors hover:bg-surface-2"
    >
      {label}
    </button>
  );
}
