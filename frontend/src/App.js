import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import ArchitectureSection from "@/components/ArchitectureSection";
import PerformanceSection from "@/components/PerformanceSection";
import ConfiguratorSection from "@/components/ConfiguratorSection";
import DownloadSection from "@/components/DownloadSection";
import InstallationSection from "@/components/InstallationSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import PinManagerSection from "@/components/PinManagerSection";
import Footer from "@/components/Footer";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [activeSection, setActiveSection] = useState("overview");
  const [performance, setPerformance] = useState(null);
  const [architecture, setArchitecture] = useState(null);
  const [installation, setInstallation] = useState(null);
  const [howItWorks, setHowItWorks] = useState(null);
  const [goldPrice, setGoldPrice] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [perfRes, archRes, installRes, hiwRes] = await Promise.all([
        axios.get(`${API}/performance/summary`),
        axios.get(`${API}/architecture`),
        axios.get(`${API}/docs/installation`),
        axios.get(`${API}/docs/how-it-works`),
      ]);
      setPerformance(perfRes.data);
      setArchitecture(archRes.data);
      setInstallation(installRes.data);
      setHowItWorks(hiwRes.data);
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch gold price every 5 seconds
  const fetchGoldPrice = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/gold/price`);
      setGoldPrice(res.data);
    } catch (e) {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchGoldPrice();
    const interval = setInterval(fetchGoldPrice, 5000);
    return () => clearInterval(interval);
  }, [fetchData, fetchGoldPrice]);

  const scrollToSection = (id) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div data-testid="loading-screen" className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-sm text-muted-foreground mb-2">INITIALIZING</div>
          <div className="w-48 h-[2px] bg-muted overflow-hidden">
            <div className="h-full bg-primary gold-shimmer w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="app-root">
      <Header activeSection={activeSection} onNavigate={scrollToSection} goldPrice={goldPrice} />
      <main>
        <section id="overview"><HeroSection performance={performance} /></section>
        <section id="how-it-works"><HowItWorksSection data={howItWorks} /></section>
        <section id="architecture"><ArchitectureSection data={architecture} /></section>
        <section id="performance"><PerformanceSection data={performance} /></section>
        <section id="configurator"><ConfiguratorSection api={API} /></section>
        <section id="pins"><PinManagerSection api={API} /></section>
        <section id="download"><DownloadSection api={API} /></section>
        <section id="installation"><InstallationSection data={installation} /></section>
      </main>
      <Footer />
    </div>
  );
}

export default App;
