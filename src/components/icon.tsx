import type { ReactNode } from "react";
import type { IconName } from "@/lib/navigation";

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

/**
 * Hand-drawn geometric marks, one stroke weight, no icon library.
 * 20x20 grid, 1.2 stroke, square-ish joins to match the ledger rules.
 */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, ReactNode> = {
  cash: (
    <>
      <rect x="2.5" y="5.5" width="15" height="9" rx="0.5" />
      <circle cx="10" cy="10" r="2.25" />
      <path d="M5 10h.01M15 10h.01" />
    </>
  ),
  billing: (
    <>
      <path d="M5 2.75h6.5L15 6.25v11H5z" />
      <path d="M11.5 2.75v3.5H15" />
      <path d="M7.25 10.25h5.5M7.25 13h3.5" />
    </>
  ),
  purchases: (
    <>
      <path d="M3.25 4.25h1.9l1.35 8.4h8.5l1.45-6.4H5.5" />
      <circle cx="8" cy="15.4" r="1" />
      <circle cx="13.2" cy="15.4" r="1" />
    </>
  ),
  assets: (
    <>
      <rect x="4.5" y="2.75" width="11" height="14.5" rx="0.5" />
      <path d="M4.5 17.25h11" />
      <path d="M7.5 6h2M10.5 6h2M7.5 9h2M10.5 9h2M7.5 12h2M10.5 12h2" />
      <path d="M8.75 17.25v-2.5h2.5v2.5" />
    </>
  ),
  admin: (
    <>
      <path d="M3 6.5h5.1M11.4 6.5H17" />
      <circle cx="9.7" cy="6.5" r="1.6" />
      <path d="M3 13.5h6.4M12.7 13.5H17" />
      <circle cx="11" cy="13.5" r="1.6" />
    </>
  ),
  reports: (
    <>
      <path d="M3 17.25h14" />
      <path d="M5 17v-4M8.5 17V8M12 17v-6.5M15.5 17V4.5" />
    </>
  ),
  payroll: (
    <>
      <rect x="5" y="2.75" width="10" height="14.5" rx="0.5" />
      <circle cx="10" cy="7.75" r="2" />
      <path d="M6.75 14.5c0-1.6 1.45-2.6 3.25-2.6s3.25 1 3.25 2.6" />
    </>
  ),
  inventory: (
    <>
      <path d="M10 2.75l7 3.6v7.3l-7 3.6-7-3.6v-7.3z" />
      <path d="M3 6.35l7 3.6 7-3.6" />
      <path d="M10 9.95v7.3" />
    </>
  ),
  others: (
    <>
      <rect x="3.5" y="3.5" width="4.5" height="4.5" rx="0.4" />
      <rect x="12" y="3.5" width="4.5" height="4.5" rx="0.4" />
      <rect x="3.5" y="12" width="4.5" height="4.5" rx="0.4" />
      <rect x="12" y="12" width="4.5" height="4.5" rx="0.4" />
    </>
  ),
};

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="0.5" y="0.5" width="21" height="21" stroke="currentColor" strokeOpacity="0.35" />
      <rect x="4.5" y="4.5" width="5.5" height="5.5" fill="currentColor" />
      <rect x="12" y="4.5" width="5.5" height="5.5" stroke="currentColor" strokeOpacity="0.5" />
      <rect x="4.5" y="12" width="5.5" height="5.5" stroke="currentColor" strokeOpacity="0.5" />
      <rect x="12" y="12" width="5.5" height="5.5" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}
