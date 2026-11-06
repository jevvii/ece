export type ModuleStatus = "active" | "shared" | "planned";

export type ErpModule = {
  slug: string;
  name: string;
  index: string;
  description: string;
  status: ModuleStatus;
  statusNote: string;
  icon: IconName;
};

export type IconName =
  | "cash"
  | "billing"
  | "purchases"
  | "assets"
  | "admin"
  | "reports"
  | "payroll"
  | "inventory"
  | "others";

export const erpModules: ErpModule[] = [
  {
    slug: "cash-management",
    name: "Cash Management",
    index: "01",
    description: "Receipts, disbursements, and bank reconciliation.",
    status: "planned",
    statusNote: "Planned",
    icon: "cash",
  },
  {
    slug: "billing-and-collection",
    name: "Billing and Collection",
    index: "02",
    description: "Invoices, statements of account, and receivables.",
    status: "planned",
    statusNote: "Planned",
    icon: "billing",
  },
  {
    slug: "purchases-and-disbursement",
    name: "Purchases and Disbursement",
    index: "03",
    description: "Purchase orders, supplier bills, and payments.",
    status: "planned",
    statusNote: "Planned",
    icon: "purchases",
  },
  {
    slug: "fixed-assets",
    name: "Fixed Assets",
    index: "04",
    description: "Registers, depreciation schedules, and disposals.",
    status: "planned",
    statusNote: "Planned",
    icon: "assets",
  },
  {
    slug: "admin",
    name: "Admin",
    index: "05",
    description: "Company setup, employees, ranks, access, numbering.",
    status: "shared",
    statusNote: "Shared area",
    icon: "admin",
  },
  {
    slug: "reports",
    name: "Reports",
    index: "06",
    description: "Financial statements, tax reports, cross-module analysis.",
    status: "shared",
    statusNote: "Shared area",
    icon: "reports",
  },
  {
    slug: "payroll",
    name: "Payroll",
    index: "07",
    description: "Time, computation, payslips, leaves, annualization.",
    status: "active",
    statusNote: "Cutoff 2 open",
    icon: "payroll",
  },
  {
    slug: "inventory",
    name: "Inventory",
    index: "08",
    description: "Items, stock movements, and valuation.",
    status: "planned",
    statusNote: "Planned",
    icon: "inventory",
  },
  {
    slug: "others",
    name: "Others",
    index: "09",
    description: "Journals, periods, tax register, audit trail.",
    status: "planned",
    statusNote: "Planned",
    icon: "others",
  },
];

export type PayrollApp = {
  slug: string;
  name: string;
  index: string;
  description: string;
  status: string;
  tone: "active" | "idle" | "locked";
  wide?: boolean;
};

export const payrollApps: PayrollApp[] = [
  {
    slug: "time-report",
    name: "Time Report",
    index: "01",
    description: "Import attendance, map columns, review the cutoff day by day.",
    status: "No imports yet",
    tone: "idle",
  },
  {
    slug: "computation",
    name: "Payroll Computation",
    index: "02",
    description: "Run the cutoff, read the register, resolve exceptions, approve.",
    status: "No runs yet",
    tone: "idle",
  },
  {
    slug: "payslip",
    name: "Payslip",
    index: "03",
    description: "Issue individual or batch payslips from the approved run.",
    status: "No payslips issued",
    tone: "idle",
  },
  {
    slug: "annualization",
    name: "Annualization",
    index: "04",
    description: "Reconcile year-to-date pay and propose the tax adjustment.",
    status: "Awaiting year-end",
    tone: "idle",
  },
  {
    slug: "2316",
    name: "2316",
    index: "05",
    description: "Certificate of compensation payment and tax withheld.",
    status: "Unlocks after December",
    tone: "locked",
  },
  {
    slug: "leaves",
    name: "Leaves",
    index: "06",
    description: "Policies by rank, grants, carry-over, and live balances.",
    status: "No leave policies",
    tone: "idle",
  },
  {
    slug: "journal",
    name: "Payroll Journal",
    index: "07",
    description: "Balanced totals, employer contributions, and settlement.",
    status: "No journals posted",
    tone: "idle",
    wide: true,
  },
];
