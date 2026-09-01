import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import TrustStrip from "@/components/TrustStrip";
import DailyTradingResultsSection from "@/components/DailyTradingResultsSection";
import GoldReplaySection from "@/components/GoldReplaySection";
import HowItWorksSection from "@/components/HowItWorksSection";
import ReassuranceSection from "@/components/ReassuranceSection";
import PurchaseSection from "@/components/PurchaseSection";
import FaqSection from "@/components/FaqSection";
import FinalCtaSection from "@/components/FinalCtaSection";
import ReleaseStrip from "@/components/ReleaseStrip";
import ComingSoonAppsSection from "@/components/ComingSoonAppsSection";

import PurchaseSuccessPage from "@/components/PurchaseSuccessPage";
import AdminPortal from "@/components/AdminPortal";
import Footer from "@/components/Footer";
import CloudLanding from "@/components/cloud/CloudLanding";
import { CloudSignup, CloudLogin, CloudForgotPassword, CloudResetPassword } from "@/components/cloud/CloudAuth";
import CloudDashboard from "@/components/cloud/CloudDashboard";
import AIMarketOutlookPage from "@/pages/AIMarketOutlookPage";
import LabsPage from "@/pages/LabsPage";
import PerformancePage from "@/pages/PerformancePage";
import CertificateVerifyPage from "@/pages/CertificateVerifyPage";
import PerformanceHistoryPage from "@/pages/PerformanceHistoryPage";
import ErrorBoundary from "@/components/ErrorBoundary";
import { API } from "@/lib/api";
import { CampaignLandingPage, CommandCenterAnnouncements, WebsiteCampaignSlots } from "@/components/MarketingSurfaces";

function MainDashboard() {
  const [activeSection, setActiveSection] = useState("overview");
  const [goldPrice, setGoldPrice] = useState(null);

  const fetchGoldPrice = useCallback(async () => {
    try {
      setGoldPrice((await axios.get(`${API}/gold/price`)).data);
    } catch (e) {
      process.env.NODE_ENV === "development" && console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchGoldPrice();
    const iv = setInterval(fetchGoldPrice, 10000);
    return () => clearInterval(iv);
  }, [fetchGoldPrice]);

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-[#060609]" data-testid="app-root">
      <Header activeSection={activeSection} onNavigate={scrollTo} goldPrice={goldPrice} />
      <WebsiteCampaignSlots />
      <main>
        <section id="overview"><HeroSection /></section>
        <TrustStrip />
        <section id="performance">
          <GoldReplaySection api={API} />
          <DailyTradingResultsSection api={API} />
        </section>
        <section id="how-it-works"><HowItWorksSection /></section>
        <ReassuranceSection />
        <section id="purchase"><PurchaseSection api={API} /></section>
        <ReleaseStrip api={API} />
        <ComingSoonAppsSection />
        <section id="faq"><FaqSection /></section>
        <FinalCtaSection />
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
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainDashboard />} />
          <Route path="/command" element={<CloudLanding />} />
          <Route path="/command/signup" element={<CloudSignup />} />
          <Route path="/command/login" element={<CloudLogin />} />
          <Route path="/command/forgot-password" element={<CloudForgotPassword />} />
          <Route path="/command/reset-password" element={<CloudResetPassword />} />
          <Route path="/command/dashboard" element={<><CommandCenterAnnouncements /><CloudDashboard /></>} />
          <Route path="/campaign/:slug" element={<CampaignLandingPage />} />
          <Route path="/ai-market-outlook" element={<AIMarketOutlookPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/performance/history" element={<PerformanceHistoryPage />} />
          <Route path="/verify-certificate/:certificateId" element={<CertificateVerifyPage />} />
          <Route path="/cloud" element={<Navigate to="/command" replace />} />
          <Route path="/cloud/signup" element={<Navigate to="/command/signup" replace />} />
          <Route path="/cloud/login" element={<Navigate to="/command/login" replace />} />
          <Route path="/cloud/forgot-password" element={<Navigate to="/command/forgot-password" replace />} />
          <Route path="/cloud/reset-password" element={<Navigate to="/command/reset-password" replace />} />
          <Route path="/cloud/dashboard" element={<Navigate to="/command/dashboard" replace />} />
          <Route path="/purchase/success" element={<PurchaseSuccessPage />} />
          <Route path="/purchase/cancel" element={<PurchaseCancelWrap />} />
          <Route path="/admin" element={<AdminPortal api={API} />} />
          <Route path="/admin/*" element={<AdminPortal api={API} />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
