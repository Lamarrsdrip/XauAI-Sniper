import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeaturesSection from "@/components/FeaturesSection";
import PerformanceSection from "@/components/PerformanceSection";
import PurchaseSection from "@/components/PurchaseSection";
import BrokerSection from "@/components/BrokerSection";
import SupportSection from "@/components/SupportSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import DownloadSection from "@/components/DownloadSection";
import PurchaseSuccessPage from "@/components/PurchaseSuccessPage";
import AdminPortal from "@/components/AdminPortal";
import Footer from "@/components/Footer";
import CloudLanding from "@/components/cloud/CloudLanding";
import { CloudSignup, CloudLogin } from "@/components/cloud/CloudAuth";
import CloudDashboard from "@/components/cloud/CloudDashboard";
import { API } from "@/lib/api";

function MainDashboard() {
  const [activeSection, setActiveSection] = useState("overview");
  const [performance, setPerformance] = useState(null);
  const [goldPrice, setGoldPrice] = useState(null);

  const fetchPerformance = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/performance/summary`);
      setPerformance(r.data);
    } catch (e) {
      process.env.NODE_ENV === "development" && console.error(e);
    }
  }, []);

  const fetchGoldPrice = useCallback(async () => {
    try {
      setGoldPrice((await axios.get(`${API}/gold/price`)).data);
    } catch (e) {
      process.env.NODE_ENV === "development" && console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchPerformance();
    fetchGoldPrice();
    const iv = setInterval(fetchGoldPrice, 10000);
    return () => clearInterval(iv);
  }, [fetchPerformance, fetchGoldPrice]);

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-[#060609]" data-testid="app-root">
      <Header activeSection={activeSection} onNavigate={scrollTo} goldPrice={goldPrice} />
      <main>
        <section id="overview"><HeroSection performance={performance} /></section>
        <section id="features"><FeaturesSection /></section>
        <section id="performance"><PerformanceSection data={performance} /></section>
        <section id="purchase"><PurchaseSection api={API} /></section>
        <section id="broker"><BrokerSection /></section>
        <section id="support"><SupportSection /></section>
        <section id="faq"><HowItWorksSection /></section>
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
      <Routes>
        <Route path="/" element={<MainDashboard />} />
        <Route path="/command" element={<CloudLanding />} />
        <Route path="/command/signup" element={<CloudSignup />} />
        <Route path="/command/login" element={<CloudLogin />} />
        <Route path="/command/dashboard" element={<CloudDashboard />} />
        <Route path="/cloud" element={<Navigate to="/command" replace />} />
        <Route path="/cloud/signup" element={<Navigate to="/command/signup" replace />} />
        <Route path="/cloud/login" element={<Navigate to="/command/login" replace />} />
        <Route path="/cloud/dashboard" element={<Navigate to="/command/dashboard" replace />} />
        <Route path="/purchase/success" element={<PurchaseSuccessPage />} />
        <Route path="/purchase/cancel" element={<PurchaseCancelWrap />} />
        <Route path="/admin" element={<AdminPortal api={API} />} />
        <Route path="/admin/*" element={<AdminPortal api={API} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
