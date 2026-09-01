import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { RadioTower, Loader2 } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import { API } from "@/lib/api";

// Scoped axios instance for Command Center auth — avoids polluting global axios defaults
// that could leak into the admin portal if the same browser session uses both.
const cloudAxios = axios.create({ baseURL: API, withCredentials: true });

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-app bg-[#050507] text-white flex flex-col pt-safe-top pb-safe">
      <InstallAppPrompt />
      <nav className="border-b border-white/5 backdrop-blur-xl bg-[#050505]/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/command" className="flex items-center gap-2" data-testid="auth-logo-link">
            <RadioTower className="w-6 h-6 text-[#D4AF37]" />
            <span className="font-bold tracking-tight text-lg">XauCloud Command Center</span>
          </Link>
        </div>
      </nav>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-bold mb-2" data-testid="auth-title">{title}</h1>
          <p className="text-white/50 mb-8">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function CloudSignup() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", country: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      await cloudAxios.post(`/cloud/auth/signup`, form);
      nav("/command/dashboard");
    } catch (e) { setErr(e.response?.data?.detail || "Signup failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell title="Create Command Center account" subtitle="Access your license, setup flow, heartbeat monitor, and PIN-safe controls.">
      <form onSubmit={submit} className="space-y-4" data-testid="signup-form">
        <div>
          <label htmlFor="cloud-signup-name" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">FULL NAME</label>
          <input id="cloud-signup-name" name="name" autoComplete="name" type="text" required value={form.full_name} onChange={e=>setForm({...form, full_name: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-name" />
        </div>
        <div>
          <label htmlFor="cloud-signup-email" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">EMAIL</label>
          <input id="cloud-signup-email" name="email" autoComplete="email" type="email" required value={form.email} onChange={e=>setForm({...form, email: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-email" />
        </div>
        <div>
          <label htmlFor="cloud-signup-password" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">PASSWORD</label>
          <input id="cloud-signup-password" name="password" autoComplete="new-password" type="password" required minLength={8} value={form.password} onChange={e=>setForm({...form, password: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-password" />
          <div className="text-xs text-white/30 mt-1">At least 8 characters</div>
        </div>
        <div>
          <label htmlFor="cloud-signup-country" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">COUNTRY</label>
          <input id="cloud-signup-country" name="country" autoComplete="country-name" type="text" value={form.country} onChange={e=>setForm({...form, country: e.target.value})} placeholder="e.g. Nigeria"
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-country" />
        </div>
        {err && <div className="text-red-400 text-sm" data-testid="signup-error">{err}</div>}
        <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="signup-submit">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Creating account…" : "Create account →"}
        </button>
        <div className="text-sm text-center text-white/50">
          Already have an account? <Link to="/command/login" className="text-[#D4AF37] hover:underline" data-testid="signup-go-login">Log in</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function CloudLogin() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      await cloudAxios.post(`/cloud/auth/login`, form);
      nav("/command/dashboard");
    } catch (e) { setErr(e.response?.data?.detail || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your XauCloud Command Center">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <div>
          <label htmlFor="cloud-login-email" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">EMAIL</label>
          <input id="cloud-login-email" name="email" autoComplete="email" type="email" required value={form.email} onChange={e=>setForm({...form, email: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="login-email" />
        </div>
        <div>
          <label htmlFor="cloud-login-password" className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">PASSWORD</label>
          <input id="cloud-login-password" name="password" autoComplete="current-password" type="password" required value={form.password} onChange={e=>setForm({...form, password: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="login-password" />
        </div>
        {err && <div className="text-red-400 text-sm" data-testid="login-error">{err}</div>}
        <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="login-submit">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Logging in…" : "Log in →"}
        </button>
        <div className="text-sm text-center text-white/50">
          <Link to="/command/forgot-password" className="text-[#D4AF37] hover:underline">Forgot password?</Link><br />
          Don't have an account? <Link to="/command/signup" className="text-[#D4AF37] hover:underline" data-testid="login-go-signup">Create account</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function CloudForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMessage(""); setLoading(true);
    try {
      const result = await cloudAxios.post("/cloud/auth/forgot-password", { email });
      setMessage(result.data?.message || "If an account exists for that email, a reset link has been sent.");
    } catch (e) { setErr(e.response?.data?.detail || "Unable to request a reset link."); }
    finally { setLoading(false); }
  };
  return <AuthShell title="Reset your password" subtitle="Enter your account email and we’ll send a secure reset link.">
    <form onSubmit={submit} className="space-y-4" data-testid="forgot-password-form">
      <div><label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5" htmlFor="forgot-email">EMAIL</label><input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" /></div>
      {err && <div className="text-red-400 text-sm">{err}</div>}
      {message && <div className="text-emerald-300 text-sm">{message}</div>}
      <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50">{loading ? "Sending…" : "Send reset link"}</button>
      <div className="text-sm text-center text-white/50"><Link to="/command/login" className="text-[#D4AF37] hover:underline">Back to login</Link></div>
    </form>
  </AuthShell>;
}

export function CloudResetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMessage("");
    if (!token) return setErr("This reset link is invalid or incomplete.");
    if (password !== confirm) return setErr("Passwords do not match.");
    setLoading(true);
    try {
      const result = await cloudAxios.post("/cloud/auth/reset-password", { token, new_password: password });
      setMessage(result.data?.message || "Password updated. You can now log in.");
      setTimeout(() => nav("/command/login"), 900);
    } catch (e) { setErr(e.response?.data?.detail || "Unable to reset password."); }
    finally { setLoading(false); }
  };
  return <AuthShell title="Choose a new password" subtitle="Use a strong password with at least one letter and one number.">
    <form onSubmit={submit} className="space-y-4" data-testid="reset-password-form">
      <div><label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5" htmlFor="reset-password">NEW PASSWORD</label><input id="reset-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" /></div>
      <div><label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5" htmlFor="reset-confirm">CONFIRM PASSWORD</label><input id="reset-confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" /></div>
      {err && <div className="text-red-400 text-sm">{err}</div>}
      {message && <div className="text-emerald-300 text-sm">{message}</div>}
      <button type="submit" disabled={loading || !token} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50">{loading ? "Updating…" : "Update password"}</button>
    </form>
  </AuthShell>;
}
