import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import BrokerSection from "@/components/BrokerSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import PerformanceSection from "@/components/PerformanceSection";
import PurchaseSection from "@/components/PurchaseSection";
import SetupGuideSection from "@/components/SetupGuideSection";
import VideoGuideSection from "@/components/VideoGuideSection";
import DownloadSection from "@/components/DownloadSection";
import PurchaseSuccessPage from "@/components/PurchaseSuccessPage";
import AdminPortal from "@/components/AdminPortal";
import Footer from "@/components/Footer";
import CloudLanding from "@/components/cloud/CloudLanding";
import { CloudSignup, CloudLogin } from "@/components/cloud/CloudAuth";
import CloudDashboard from "@/components/cloud/CloudDashboard";
import CloudPromoSection from "@/components/CloudPromoSection";
import CloudFunnelBanner from "@/components/CloudFunnelBanner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function MainDashboard() {
  const [activeSection, setActiveSection] = useState("overview");
  const [performance, setPerformance] = useState(null);
  const [howItWorks, setHowItWorks] = useState(null);
  const [setupGuide, setSetupGuide] = useState(null);
  const [goldPrice, setGoldPrice] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [p, h, s] = await Promise.all([
        axios.get(`${API}/performance/summary`),
        axios.get(`${API}/docs/how-it-works`),
        axios.get(`${API}/docs/setup-guide`),
      ]);
      setPerformance(p.data); setHowItWorks(h.data); setSetupGuide(s.data);
    } catch (e) { process.env.NODE_ENV === 'development' && console.error(e); } finally { setLoading(false); }
  }, []);

  const fetchGoldPrice = useCallback(async () => {
    try { setGoldPrice((await axios.get(`${API}/gold/price`)).data); } catch (err) { process.env.NODE_ENV === 'development' && console.error("Gold price fetch failed:", err); }
  }, []);

  useEffect(() => {
    fetchData(); fetchGoldPrice();
    const iv = setInterval(fetchGoldPrice, 10000);
    return () => clearInterval(iv);
  }, [fetchData, fetchGoldPrice]);

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) return (
    <div data-testid="loading-screen" className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="font-mono text-[10px] text-gray-400 mb-3 tracking-[0.3em]">INITIALIZING</div>
        <div className="w-48 h-[2px] bg-gray-100 overflow-hidden rounded-full"><div className="h-full bg-[#C5A059] w-full rounded-full" style={{animation:'pulse 1.5s infinite'}} /></div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white" data-testid="app-root">
      <Header activeSection={activeSection} onNavigate={scrollTo} goldPrice={goldPrice} />
      <main>
        <section id="overview"><HeroSection performance={performance} /></section>
        <section id="broker"><BrokerSection /></section>
        <section id="cloud-promo"><CloudPromoSection /></section>
        <section id="purchase"><PurchaseSection api={API} /></section>
        <section id="how-it-works"><HowItWorksSection data={howItWorks} /></section>
        <section id="performance"><PerformanceSection data={performance} /></section>
        <section id="setup-guide"><SetupGuideSection data={setupGuide} /></section>
        <section id="video-guide"><VideoGuideSection /></section>
        <section id="download"><DownloadSection api={API} /></section>
      </main>
      <Footer />
    </div>
  );
}

function PurchaseCancelWrap() {
  const nav = useNavigate();
  useEffect(() => { nav("/"); }, [nav]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <CloudFunnelBanner />
      <Routes>
        <Route path="/" element={<MainDashboard />} />
        <Route path="/cloud" element={<CloudLanding />} />
        <Route path="/cloud/signup" element={<CloudSignup />} />
        <Route path="/cloud/login" element={<CloudLogin />} />
        <Route path="/cloud/dashboard" element={<CloudDashboard />} />
        <Route path="/purchase/success" element={<PurchaseSuccessPage />} />
        <Route path="/purchase/cancel" element={<PurchaseCancelWrap />} />
        <Route path="/admin" element={<AdminPortal api={API} />} />
        <Route path="/admin/*" element={<AdminPortal api={API} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
