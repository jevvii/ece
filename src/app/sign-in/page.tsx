import Link from "next/link";
import { signInAction } from "@/app/actions/auth";


const errors: Record<string, string> = {
  invalid: "That email and password do not match a seat on this workspace.",
  missing: "Enter both your email and password.",
  "no-company": "This account has no company membership yet.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center px-5 sm:px-6">
        <Link href="/sign-in" className="flex items-center gap-2" aria-label="ECE Accounting">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          <span className="text-[14.5px] font-bold tracking-[-0.01em]">ECE</span>
          <span className="hidden text-[13px] font-normal text-muted sm:inline">Accounting</span>
        </Link>
      </div>

      <div className="flex flex-1 items-start justify-center px-5 pb-24 pt-16 sm:pt-24">
        <div className="w-full max-w-[420px]">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Bureau access
          </p>
          <h1 className="mt-4 font-serif text-[clamp(2.5rem,6vw,3.25rem)] leading-[1.02] tracking-[-0.03em]">
            Welcome back.
          </h1>
          <p className="mt-4 text-[14px] leading-[1.65] text-ink-2">
            One login per person. Your seats and companies are managed in Admin.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]"
            >
              {errors[error] ?? "Sign-in failed. Try again."}
            </div>
          ) : null}

          <form action={signInAction} className="mt-8 rounded-[14px] border border-rule bg-surface p-6">
            <input type="hidden" name="next" value={next ?? "/"} />

            <label htmlFor="email" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue="maria@tala.ph"
              className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />

            <label
              htmlFor="password"
              className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              defaultValue="payroll123"
              className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />

            <button
              type="submit"
              className="mt-6 h-11 w-full rounded-full bg-accent text-[14px] font-semibold text-white transition hover:brightness-95 active:scale-[0.995]"
            >
              Sign in
            </button>
          </form>

          <div className="mt-5 rounded-[12px] border border-rule bg-surface-2 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-warn" aria-hidden="true" />
              <p className="text-[12.5px] font-semibold text-ink-2">Demo accounts</p>
              <p className="ml-auto font-mono text-[11.5px] text-muted">payroll123</p>
            </div>
            <ul className="mt-2.5 grid gap-1.5 text-[12px] text-muted">
              {[
                ["maria@tala.ph", "Bureau admin"],
                ["jose@bayanihan.ph", "Payroll officer"],
                ["ana@tala.ph", "Approver"],
              ].map(([email, role]) => (
                <li key={email} className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[11.5px] text-ink-2">{email}</span>
                  <span>{role}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
