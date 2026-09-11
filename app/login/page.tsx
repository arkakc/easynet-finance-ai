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
  ChevronUp,
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

  function handleQuickFillAdmin() {
    setEmail("admin@easynet.local");
    setPassword("Admin123!");
    setError("");
  }

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
    <div className="login-wrap">
      <main className="login-card-simple">
        {/* Header with official Easynet Logo & Title */}
        <div className="login-header">
          <a
            href="https://www.easynetpng.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/easynet-logo.png"
              alt="Easynet IT Solutions"
              className="login-logo-img"
            />
          </a>

          <h1 className="login-title">Easynet Finance AI System</h1>
          <p className="login-powered">
            Powered by{" "}
            <a
              href="https://www.easynetpng.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Easynet IT Solutions
            </a>
          </p>
        </div>

        {/* User Navigation: How to Log In */}
        <div className="login-guide-toggle">
          <button
            type="button"
            className="login-guide-btn"
            onClick={() => setShowGuide(!showGuide)}
            aria-expanded={showGuide}
            aria-controls="login-instructions"
          >
            <span className="login-guide-btn-left">
              <HelpCircle size={15} color="#0052cc" />
              <span>How to Sign In (First-time user or Demo?)</span>
            </span>
            {showGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showGuide && (
            <div id="login-instructions" className="login-guide-content">
              <ol className="login-guide-steps">
                <li>Sign in using your assigned corporate email address (e.g. <code>admin@easynet.local</code>).</li>
                <li>Enter your role-assigned secure password.</li>
                <li>Access is strictly governed by ERP security policies and audit trails.</li>
              </ol>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", paddingTop: "4px" }}>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Testing environment credentials:</span>
                <button
                  type="button"
                  className="login-quickfill-pill"
                  onClick={handleQuickFillAdmin}
                  title="Auto-fill default System Admin credentials"
                >
                  ⚡ Auto-fill Demo Admin Login
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Failed Login Error Banner */}
        {error && (
          <div key={shakeKey} className="login-error-banner" role="alert">
            <AlertCircle size={18} className="login-error-icon" />
            <div className="login-error-body">
              <div className="login-error-title">Login Failed</div>
              <div className="login-error-msg">{error}</div>
              <button
                type="button"
                className="login-error-recovery"
                onClick={handleQuickFillAdmin}
              >
                Auto-fill working Admin credentials &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="login-field">
            <label htmlFor="login-email">
              <span>Corporate Email</span>
            </label>
            <div className="login-input-wrapper">
              <Mail size={16} className="login-input-icon" />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="admin@easynet.local"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="login-password">
              <span>Password</span>
            </label>
            <div className="login-input-wrapper">
              <Lock size={16} className="login-input-icon" />
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            disabled={busy}
            type="submit"
            className="login-submit-btn"
            id="login-submit-button"
          >
            {busy ? (
              <>
                <RefreshCw size={17} style={{ animation: "spin 1s linear infinite" }} />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <ShieldCheck size={17} />
                <span>Sign in</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Support Link requested by user */}
        <div className="login-footer-support">
          Need access or forgot your password?{" "}
          <a
            href="https://www.easynetpng.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contact Easynet PNG IT Support
          </a>
        </div>
      </main>
    </div>
  );
}
