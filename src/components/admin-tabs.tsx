import Link from "next/link";

const tabs = [
  { key: "overview", href: "/admin", label: "Overview" },
  { key: "setup", href: "/admin/setup", label: "Setup" },
  { key: "employees", href: "/admin/employees", label: "Employees" },
];

export function AdminTabs({ current }: { current: string }) {
  return (
    <nav className="mt-6 flex items-center gap-6 border-b border-rule" aria-label="Admin sections">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b pb-3 text-[13px] transition-colors ${
              active
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-muted hover:text-ink-2"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
