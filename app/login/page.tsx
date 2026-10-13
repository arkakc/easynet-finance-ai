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
        <svg className="ef-signin-erp-art" viewBox="0 0 760 760" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
          <defs>
            <linearGradient id="erpWave" x1="150" y1="180" x2="740" y2="750" gradientUnits="userSpaceOnUse"><stop stopColor="#C9F5FF" stopOpacity=".05"/><stop offset=".5" stopColor="#38B9EF" stopOpacity=".38"/><stop offset="1" stopColor="#1260C2" stopOpacity=".76"/></linearGradient>
            <linearGradient id="erpCard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFFFFF" stopOpacity=".94"/><stop offset="1" stopColor="#DEF5FF" stopOpacity=".77"/></linearGradient>
          </defs>
          <path d="M760 110C596 70 514 135 446 217C360 321 240 360 165 470C96 571 65 653 0 760H760V110Z" fill="url(#erpWave)"/>
          <path d="M760 280C611 265 502 351 430 433C351 527 258 537 196 630C160 684 152 715 120 760H760V280Z" fill="#80D9FC" opacity=".29"/>
          <path d="M760 503C617 427 483 468 405 545C323 624 301 676 258 760H760V503Z" fill="#0864C7" opacity=".34"/>
          <path d="M103 707C270 502 421 366 604 282C682 246 728 239 760 237" stroke="#58CFF6" strokeWidth="2" opacity=".8"/>
          <path d="M216 724C345 574 488 506 620 436C682 403 726 406 760 405" stroke="#E6FCFF" strokeWidth="2" opacity=".9"/>
          <path d="M306 592C362 487 452 415 573 364C657 329 717 335 760 344" stroke="#2BA7E9" strokeWidth="1.5" strokeDasharray="7 11" opacity=".65"/>
          <g fill="#3BC4F5" stroke="#D7F8FF" strokeWidth="3"><circle cx="305" cy="510" r="8"/><circle cx="482" cy="368" r="8"/><circle cx="626" cy="292" r="8"/><circle cx="540" cy="478" r="8"/><circle cx="416" cy="633" r="8"/></g>
          <g opacity=".83" stroke="#D1EAF8" strokeWidth="1.5" fill="url(#erpCard)">
            <rect x="483" y="137" width="221" height="142" rx="15"/>
            <rect x="286" y="291" width="177" height="136" rx="14"/>
            <rect x="495" y="329" width="171" height="148" rx="15"/>
            <rect x="274" y="492" width="221" height="154" rx="14"/>
          </g>
          <g fill="#219AE3" opacity=".7"><rect x="505" y="222" width="19" height="38" rx="3"/><rect x="536" y="204" width="19" height="56" rx="3"/><rect x="567" y="187" width="19" height="73" rx="3"/><rect x="598" y="166" width="19" height="94" rx="3"/><rect x="629" y="151" width="19" height="109" rx="3"/><rect x="660" y="140" width="19" height="120" rx="3"/></g>
          <circle cx="352" cy="354" r="38" fill="#C8F3FF"/><path d="M352 316A38 38 0 0 1 390 354H352V316Z" fill="#1682D6"/><path d="M352 354H390A38 38 0 0 1 336 388L352 354Z" fill="#49CAF0"/><path d="M352 354L336 388A38 38 0 0 1 352 316V354Z" fill="#8BE1F7"/>
          <g stroke="#7CBFE7" strokeWidth="6" strokeLinecap="round" opacity=".7"><path d="M405 331h37"/><path d="M405 353h27"/><path d="M405 376h33"/></g>
          <path d="M527 357h81l26 26v66h-107z" fill="#E6F7FF" stroke="#60BCEB" strokeWidth="2"/><path d="M608 357v27h26" stroke="#60BCEB" strokeWidth="2"/><path d="M548 398h64M548 414h56M548 430h45" stroke="#70BDE7" strokeWidth="5" strokeLinecap="round"/>
          <rect x="296" y="513" width="175" height="113" rx="7" fill="#E7F7FF" stroke="#8DD6F2"/><rect x="296" y="513" width="175" height="19" rx="5" fill="#3CACE3"/><path d="M296 552h175M296 574h175M296 596h175M339 532v94M385 532v94M428 532v94" stroke="#A8D7EF" strokeWidth="1.5"/>
          <g fill="#C4EEFC" stroke="#68BBE8" strokeWidth="2"><path d="M550 564l34-16 34 16v42l-34 18-34-18z"/><path d="M584 548v76M550 564l34 19 34-19"/><path d="M631 597l34-16 34 16v42l-34 18-34-18z"/><path d="M665 581v76M631 597l34 19 34-19"/></g>
          <g fill="#95DBF5" opacity=".48">{Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => <circle key={`${row}-${col}`} cx={185 + col * 17} cy={380 + row * 17} r="2.1" />))}</g>
        </svg>
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
