import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { Cloud, Loader2 } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Scoped axios instance for cloud auth — avoids polluting global axios defaults
// that could leak into the admin portal if the same browser session uses both.
const cloudAxios = axios.create({ baseURL: API, withCredentials: true });
cloudAxios.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("cloud_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col">
      <nav className="border-b border-white/5 backdrop-blur-xl bg-[#050505]/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/cloud" className="flex items-center gap-2" data-testid="auth-logo-link">
            <Cloud className="w-6 h-6 text-[#D4AF37]" />
            <span className="font-bold tracking-tight text-lg">XauAi Cloud</span>
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
      const res = await cloudAxios.post(`/cloud/auth/signup`, form);
      localStorage.setItem("cloud_token", res.data.token);
      nav("/cloud/dashboard");
    } catch (e) { setErr(e.response?.data?.detail || "Signup failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell title="Start your 7-day trial" subtitle="No credit card required. Cancel anytime.">
      <form onSubmit={submit} className="space-y-4" data-testid="signup-form">
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">FULL NAME</label>
          <input type="text" required value={form.full_name} onChange={e=>setForm({...form, full_name: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-name" />
        </div>
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">EMAIL</label>
          <input type="email" required value={form.email} onChange={e=>setForm({...form, email: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-email" />
        </div>
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">PASSWORD</label>
          <input type="password" required minLength={8} value={form.password} onChange={e=>setForm({...form, password: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-password" />
          <div className="text-xs text-white/30 mt-1">At least 8 characters</div>
        </div>
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">COUNTRY</label>
          <input type="text" value={form.country} onChange={e=>setForm({...form, country: e.target.value})} placeholder="e.g. Nigeria"
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="signup-country" />
        </div>
        {err && <div className="text-red-400 text-sm" data-testid="signup-error">{err}</div>}
        <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="signup-submit">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Creating account…" : "Start free trial →"}
        </button>
        <div className="text-sm text-center text-white/50">
          Already have an account? <Link to="/cloud/login" className="text-[#D4AF37] hover:underline" data-testid="signup-go-login">Log in</Link>
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
      const res = await cloudAxios.post(`/cloud/auth/login`, form);
      localStorage.setItem("cloud_token", res.data.token);
      nav("/cloud/dashboard");
    } catch (e) { setErr(e.response?.data?.detail || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your XauAi Cloud dashboard">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">EMAIL</label>
          <input type="email" required value={form.email} onChange={e=>setForm({...form, email: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="login-email" />
        </div>
        <div>
          <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">PASSWORD</label>
          <input type="password" required value={form.password} onChange={e=>setForm({...form, password: e.target.value})}
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="login-password" />
        </div>
        {err && <div className="text-red-400 text-sm" data-testid="login-error">{err}</div>}
        <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="login-submit">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Logging in…" : "Log in →"}
        </button>
        <div className="text-sm text-center text-white/50">
          Don't have an account? <Link to="/cloud/signup" className="text-[#D4AF37] hover:underline" data-testid="login-go-signup">Start free trial</Link>
        </div>
      </form>
    </AuthShell>
  );
}
