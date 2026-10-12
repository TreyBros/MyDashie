import { friendlyError } from "../lib/store";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { toast } from "sonner";
import type { AccountStatus } from "@shared/types";
import { LiveMascot } from "./LiveMascot";
import { Button, Input } from "./ui";
import { Pic } from "./icons";

/**
 * Sign in or create an account without leaving the app: type an email and open the link we send,
 * or continue in the browser. Either way the website hands the session back and the app signs in
 * by itself (it polls for it), so nothing depends on the browser honouring a custom link.
 */
export function SignInCard({ acct, compact }: { acct: AccountStatus; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"email" | "browser" | "code" | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const waiting = !!acct.loginPending;
  useEffect(() => {
    if (!waiting) setSent(null);
  }, [waiting]);

  const viaEmail = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy("email");
    try {
      await window.dash.account.magicLink({ email: e });
      setSent(e);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const viaCode = async () => {
    if (!sent || code.replace(/\D/g, "").length < 6) return;
    setBusy("code");
    try {
      await window.dash.account.verifyCode({ email: sent, code });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const viaBrowser = async () => {
    setBusy("browser");
    try {
      await window.dash.account.signIn();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={clsx("card overflow-hidden", compact ? "p-4" : "p-6")}>
      <div className={clsx("flex gap-4", compact ? "items-center" : "items-start")}>
        {!compact && <LiveMascot mood={waiting ? "connecting" : "hello"} size={120} interval={3000} />}
        <div className="min-w-0 flex-1">
          <div className={clsx("font-semibold", compact ? "text-[15px]" : "text-[20px] tracking-tight")}>{waiting ? "Finish signing in" : "Sign in to MyDashie"}</div>
          {waiting ? (
            <>
              <p className="mt-1 text-[13px] text-muted">
                {sent ? (
                  <>
                    We emailed <b className="text-ink">{sent}</b>. Open the link on this Mac, or type the code from the email here.
                  </>
                ) : (
                  "Finish in the browser window that just opened. This screen updates by itself."
                )}
              </p>
              {sent && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 8))}
                    onKeyDown={(e) => e.key === "Enter" && void viaCode()}
                    placeholder="8-digit code"
                    className="h-10 w-44 tracking-[0.2em]"
                  />
                  <Button variant="primary" loading={busy === "code"} disabled={code.length < 6} onClick={() => void viaCode()}>
                    Sign in
                  </Button>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
                <span className="inline-block size-2 animate-pulse rounded-full bg-lilac" /> Waiting for you…
                <button className="ml-2 font-medium text-lilac hover:underline dark:text-[#c9c0ff]" onClick={() => void window.dash.account.cancelLogin()}>
                  Start over
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-muted">New here? Your account is created on the spot, with free credits to start. Returning? Use the same email.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void viaEmail()}
                  placeholder="you@company.com"
                  className="h-10 min-w-[220px] flex-1"
                />
                <Button variant="primary" loading={busy === "email"} disabled={!email.includes("@")} onClick={() => void viaEmail()}>
                  Email me a sign-in link
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
                <span>or</span>
                <button className="inline-flex items-center gap-1 font-medium text-lilac hover:underline dark:text-[#c9c0ff]" onClick={() => void viaBrowser()} disabled={busy === "browser"}>
                  <Pic name="browser" size={14} /> continue in your browser
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Full-window gate shown when the build has accounts and nobody is signed in. */
export function SignInScreen({ acct }: { acct: AccountStatus }) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-8 pb-16">
        <div className="mb-5 text-center">
          <img src="dash://brand/dashy.png" width={64} height={64} alt="" className="mx-auto" draggable={false} />
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Welcome to MyDashie</h1>
          <p className="mt-1 text-sm text-muted">Dashboards that build and refresh themselves. Sign in to get started.</p>
        </div>
        <SignInCard acct={acct} />
        <p className="mt-4 text-center text-[12px] text-muted">
          By continuing you agree to the{" "}
          <button className="underline hover:text-ink" onClick={() => void window.dash.app.openExternal(`${acct.webUrl}/terms`)}>Terms</button> and{" "}
          <button className="underline hover:text-ink" onClick={() => void window.dash.app.openExternal(`${acct.webUrl}/privacy`)}>Privacy policy</button>.
        </p>
      </div>
    </div>
  );
}
