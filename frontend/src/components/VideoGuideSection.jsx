import React, { useState, useEffect } from "react";
import axios from "axios";
import { Play, MonitorPlay, CaretRight, Timer, Desktop, Globe } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function VideoGuideSection() {
  const [data, setData] = useState(null);
  const [activeScene, setActiveScene] = useState(0);

  useEffect(() => {
    axios.get(`${API}/docs/video-guide`).then(r => setData(r.data)).catch((err) => { console.error("Video guide load failed:", err); });
  }, []);

  if (!data) return null;

  const scene = data.scenes[activeScene];

  return (
    <div className="bg-[hsl(0,0%,4%)] text-white border-t border-border" data-testid="video-guide-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 mb-4">
            <MonitorPlay size={12} weight="bold" className="text-[hsl(43,74%,49%)]" />
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-white/70">VISUAL WALKTHROUGH</span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight" data-testid="video-guide-title">
            {data.title}
          </h2>
          <p className="text-white/50 mt-2 max-w-2xl">{data.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Scene selector */}
          <div className="lg:col-span-4">
            <div className="border border-white/10 divide-y divide-white/10">
              {data.scenes.map((s, i) => (
                <button key={`scene-${s.title}`} onClick={() => setActiveScene(i)} data-testid={`scene-btn-${i}`}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors duration-150 ${
                    i === activeScene ? "bg-white/10 border-l-2 border-l-[hsl(43,74%,49%)]" : "hover:bg-white/5 border-l-2 border-l-transparent"
                  }`}>
                  <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${i === activeScene ? "bg-[hsl(43,74%,49%)]" : "bg-white/10"}`}>
                    <span className={`font-mono text-xs font-bold ${i === activeScene ? "text-black" : "text-white/60"}`}>{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${i === activeScene ? "text-white" : "text-white/60"}`}>{s.title}</div>
                    <div className="flex items-center gap-1 text-xs text-white/30 mt-0.5">
                      <Timer size={10} /> {s.duration}
                    </div>
                  </div>
                  {i === activeScene && <Play size={14} weight="fill" className="text-[hsl(43,74%,49%)]" />}
                </button>
              ))}
            </div>
          </div>

          {/* Scene content */}
          <div className="lg:col-span-8" data-testid="scene-content">
            <div className="border border-white/10 bg-white/5">
              {/* Scene header */}
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[hsl(43,74%,49%)] flex items-center justify-center">
                    <span className="font-mono text-xs font-bold text-black">{activeScene + 1}</span>
                  </div>
                  <div>
                    <h3 className="font-heading text-lg font-bold">{scene.title}</h3>
                    <span className="text-xs text-white/40 font-mono">{scene.duration}</span>
                  </div>
                </div>
                <Desktop size={20} className="text-white/30" />
              </div>

              {/* Frames */}
              <div className="divide-y divide-white/5">
                {scene.frames.map((frame, i) => (
                  <div key={i} className="px-6 py-4 flex items-start gap-4" data-testid={`frame-${activeScene}-${i}`}>
                    <div className="w-6 h-6 bg-[hsl(43,74%,49%)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CaretRight size={12} weight="bold" className="text-[hsl(43,74%,49%)]" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-bold tracking-[0.1em] text-[hsl(43,74%,49%)] mb-1">{frame.action}</div>
                      <p className="text-sm text-white/80 mb-1">{frame.detail}</p>
                      <p className="text-xs text-white/40 italic flex items-center gap-1">
                        <Globe size={10} /> {frame.visual}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setActiveScene(Math.max(0, activeScene - 1))} disabled={activeScene === 0} data-testid="prev-scene-btn"
                className="px-4 py-2 border border-white/10 text-sm text-white/60 hover:text-white disabled:opacity-30 transition-colors">
                Previous
              </button>
              <span className="text-xs font-mono text-white/30">Scene {activeScene + 1} of {data.scenes.length}</span>
              <button onClick={() => setActiveScene(Math.min(data.scenes.length - 1, activeScene + 1))} disabled={activeScene === data.scenes.length - 1} data-testid="next-scene-btn"
                className="px-4 py-2 bg-[hsl(43,74%,49%)] text-black text-sm font-bold disabled:opacity-30 hover:-translate-y-[1px] transition-transform">
                Next Scene
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
;
}
