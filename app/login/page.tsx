"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  Mail,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || !password) {
      setError("Please enter both your work email and password.");
      setShakeKey((prev) => prev + 1);
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const body = await response.json();
      setBusy(false);

      if (!response.ok || !body.ok) {
        setError(body.error || "Invalid email or password. Please verify your credentials.");
        setShakeKey((prev) => prev + 1);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setBusy(false);
      setError("Unable to connect to the authentication server. Please check your network or try again.");
      setShakeKey((prev) => prev + 1);
    }
  }

  return (
    <div className="ef-signin">
      <div className="ef-signin-brand" aria-hidden="true">
        <span className="ef-signin-brand-orbit ef-signin-brand-orbit-one" />
        <span className="ef-signin-brand-orbit ef-signin-brand-orbit-two" />
      </div>
      <main className="ef-signin-content">
        <a className="ef-signin-logo" href="https://www.easynetpng.com/" target="_blank" rel="noopener noreferrer" aria-label="Easynet IT Solutions website">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/easynet-logo.png" alt="Easynet IT Solutions" />
        </a>
        <section className="ef-signin-panel" aria-labelledby="signin-heading">
          <header className="ef-signin-heading">
            <span className="ef-signin-eyebrow">EASYNET FINANCE</span>
            <h1 id="signin-heading">Sign in to your workspace</h1>
            <p>Secure access to Easynet Finance AI System</p>
          </header>
          {error && <div key={shakeKey} className="ef-signin-alert" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{error}</span></div>}
          <form className="ef-signin-form" onSubmit={submit} noValidate>
            <label htmlFor="login-email">Corporate email</label>
            <div className="ef-signin-input">
              <Mail size={17} aria-hidden="true" />
              <input id="login-email" name="email" type="email" autoComplete="username" placeholder="name@company.com" autoFocus required value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/>
            </div>
            <label htmlFor="login-password">Password</label>
            <div className="ef-signin-input">
              <Lock size={17} aria-hidden="true" />
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/>
              <button className="ef-signin-reveal" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
              </button>
            </div>
            <button id="login-submit-button" className="ef-signin-submit" type="submit" disabled={busy}>
              {busy ? <RefreshCw size={17} className="ef-signin-spin"/> : <ShieldCheck size={17}/>}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="ef-signin-assistance">
            <button type="button" onClick={() => setShowGuide(!showGuide)} aria-expanded={showGuide} aria-controls="signin-guide"><HelpCircle size={15}/> Sign-in help <ChevronDown size={14} className={showGuide ? "ef-signin-flip" : ""}/></button>
            <a href="https://www.easynetpng.com/" target="_blank" rel="noopener noreferrer">Forgot your password?</a>
          </div>
          {showGuide && <div className="ef-signin-guide" id="signin-guide">Use your assigned corporate email and password. For first-time access or a password reset, contact Easynet IT Support. Your access is controlled by ERP roles and permissions.</div>}
          <footer className="ef-signin-panel-footer">Need access? <a href="https://www.easynetpng.com/" target="_blank" rel="noopener noreferrer">Contact Easynet IT Support</a></footer>
        </section>
        <p className="ef-signin-copyright">Powered by <a href="https://www.easynetpng.com/" target="_blank" rel="noopener noreferrer">Easynet IT Solutions</a> · Secure finance workspace</p>
      </main>
    </div>
  );
}
