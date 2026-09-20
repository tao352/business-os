import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <div className="w-full max-w-[380px] bg-surface border border-line rounded-xl p-8 shadow-sm">
      {/* Brand Header */}
      <div className="text-center mb-6">
        <div className="inline-flex w-8 h-8 rounded-lg bg-accent items-center justify-center text-white font-bold text-sm mb-3">
          B
        </div>
        <h1 className="text-lg font-semibold text-ink tracking-tight">
          Business OS
        </h1>
        <p className="text-xs text-ink-muted mt-1">
          Sign in to your enterprise workspace
        </p>
      </div>

      <LoginForm />

      <div className="mt-6 pt-4 border-t border-line text-center">
        <p className="text-[11px] text-ink-faint">
          Protected enterprise system. Unauthorized access prohibited.
        </p>
      </div>
    </div>
  );
}
