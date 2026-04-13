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
import Footer from "@/components/Footer";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [activeSection, setActiveSection] = useState("overview");
  const [performance, setPerformance] = useState(null);
  const [architecture, setArchitecture] = useState(null);
  const [installation, setInstallation] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [perfRes, archRes, installRes] = await Promise.all([
        axios.get(`${API}/performance/summary`),
        axios.get(`${API}/architecture`),
        axios.get(`${API}/docs/installation`),
      ]);
      setPerformance(perfRes.data);
      setArchitecture(archRes.data);
      setInstallation(installRes.data);
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const scrollToSection = (id) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div
        data-testid="loading-screen"
        className="min-h-screen bg-background flex items-center justify-center"
      >
        <div className="text-center">
          <div className="font-mono text-sm text-muted-foreground mb-2">
            INITIALIZING
          </div>
          <div className="w-48 h-[2px] bg-muted overflow-hidden">
            <div className="h-full bg-primary gold-shimmer w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="app-root">
      <Header
        activeSection={activeSection}
        onNavigate={scrollToSection}
      />
      <main>
        <section id="overview">
          <HeroSection performance={performance} />
        </section>
        <section id="architecture">
          <ArchitectureSection data={architecture} />
        </section>
        <section id="performance">
          <PerformanceSection data={performance} />
        </section>
        <section id="configurator">
          <ConfiguratorSection api={API} />
        </section>
        <section id="download">
          <DownloadSection api={API} />
        </section>
        <section id="installation">
          <InstallationSection data={installation} />
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default App;
