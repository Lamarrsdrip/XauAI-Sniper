import React, { useState } from "react";
import axios from "axios";
import { GearSix, FloppyDisk, ArrowCounterClockwise } from "@phosphor-icons/react";

const DEFAULT_CONFIG = {
  name: "Default Configuration",
  risk_percent: 1.0,
  daily_loss_limit: 3.0,
  weekly_drawdown_limit: 10.0,
  weekly_profit_target: 35.0,
  max_open_trades: 2,
  max_trades_per_day: 3,
  max_spread: 40.0,
  enable_trend_mode: true,
  enable_range_mode: true,
  enable_breakout_mode: true,
  confidence_threshold: 75,
  ema_fast: 50,
  ema_slow: 200,
  rsi_period: 14,
  atr_period: 14,
  min_rr_ratio: 1.5,
  max_rr_ratio: 3.0,
  partial_close_percent: 50.0,
  trailing_atr_multi: 1.5,
  sl_atr_multiplier: 2.0,
  cooldown_minutes: 30,
  trade_london: true,
  trade_new_york: true,
  equity_protection: 70.0,
  consecutive_loss_max: 3,
};

export default function ConfiguratorSection({ api }) {
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateField = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${api}/configs`, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_CONFIG });
    setSaved(false);
  };

  return (
    <div className="bg-background border-t border-border" data-testid="configurator-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <GearSix size={12} weight="bold" />
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              PARAMETER CONFIGURATOR
            </span>
          </div>
          <h2
            className="font-heading text-2xl sm:text-3xl font-bold tracking-tight"
            data-testid="configurator-title"
          >
            Configure Your EA
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Customize the Expert Advisor parameters to match your risk tolerance
            and trading style. Save configurations for quick deployment.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Risk Management */}
          <div className="border border-border bg-card" data-testid="config-risk">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                RISK MANAGEMENT
              </h4>
            </div>
            <div className="p-5 space-y-5">
              <SliderField
                label="Risk Per Trade"
                value={config.risk_percent}
                min={0.1}
                max={3}
                step={0.1}
                suffix="%"
                onChange={(v) => updateField("risk_percent", v)}
                testId="slider-risk-percent"
              />
              <SliderField
                label="Daily Loss Limit"
                value={config.daily_loss_limit}
                min={1}
                max={10}
                step={0.5}
                suffix="%"
                onChange={(v) => updateField("daily_loss_limit", v)}
                testId="slider-daily-loss"
              />
              <SliderField
                label="Weekly Drawdown Limit"
                value={config.weekly_drawdown_limit}
                min={5}
                max={20}
                step={1}
                suffix="%"
                onChange={(v) => updateField("weekly_drawdown_limit", v)}
                testId="slider-weekly-dd"
              />
              <SliderField
                label="Weekly Profit Target"
                value={config.weekly_profit_target}
                min={10}
                max={100}
                step={5}
                suffix="%"
                onChange={(v) => updateField("weekly_profit_target", v)}
                testId="slider-weekly-target"
              />
              <NumberField
                label="Max Open Trades"
                value={config.max_open_trades}
                min={1}
                max={5}
                onChange={(v) => updateField("max_open_trades", v)}
                testId="input-max-open"
              />
              <NumberField
                label="Max Trades/Day"
                value={config.max_trades_per_day}
                min={1}
                max={10}
                onChange={(v) => updateField("max_trades_per_day", v)}
                testId="input-max-daily"
              />
            </div>
          </div>

          {/* Strategy Settings */}
          <div className="border border-border bg-card" data-testid="config-strategy">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                STRATEGY SETTINGS
              </h4>
            </div>
            <div className="p-5 space-y-5">
              <ToggleField
                label="Trend Mode"
                value={config.enable_trend_mode}
                onChange={(v) => updateField("enable_trend_mode", v)}
                testId="toggle-trend"
              />
              <ToggleField
                label="Range Mode"
                value={config.enable_range_mode}
                onChange={(v) => updateField("enable_range_mode", v)}
                testId="toggle-range"
              />
              <ToggleField
                label="Breakout Mode"
                value={config.enable_breakout_mode}
                onChange={(v) => updateField("enable_breakout_mode", v)}
                testId="toggle-breakout"
              />
              <SliderField
                label="Confidence Threshold"
                value={config.confidence_threshold}
                min={50}
                max={95}
                step={5}
                suffix=""
                onChange={(v) => updateField("confidence_threshold", v)}
                testId="slider-confidence"
              />
              <NumberField
                label="EMA Fast Period"
                value={config.ema_fast}
                min={10}
                max={100}
                onChange={(v) => updateField("ema_fast", v)}
                testId="input-ema-fast"
              />
              <NumberField
                label="EMA Slow Period"
                value={config.ema_slow}
                min={100}
                max={500}
                onChange={(v) => updateField("ema_slow", v)}
                testId="input-ema-slow"
              />
            </div>
          </div>

          {/* Trade Management */}
          <div className="border border-border bg-card" data-testid="config-trade">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                TRADE MANAGEMENT
              </h4>
            </div>
            <div className="p-5 space-y-5">
              <SliderField
                label="Min R:R Ratio"
                value={config.min_rr_ratio}
                min={1}
                max={5}
                step={0.1}
                suffix=":1"
                onChange={(v) => updateField("min_rr_ratio", v)}
                testId="slider-min-rr"
              />
              <SliderField
                label="Partial Close"
                value={config.partial_close_percent}
                min={30}
                max={80}
                step={5}
                suffix="%"
                onChange={(v) => updateField("partial_close_percent", v)}
                testId="slider-partial-close"
              />
              <SliderField
                label="Trailing ATR Multi"
                value={config.trailing_atr_multi}
                min={0.5}
                max={3}
                step={0.1}
                suffix="x"
                onChange={(v) => updateField("trailing_atr_multi", v)}
                testId="slider-trailing"
              />
              <SliderField
                label="SL ATR Multiplier"
                value={config.sl_atr_multiplier}
                min={1}
                max={4}
                step={0.1}
                suffix="x"
                onChange={(v) => updateField("sl_atr_multiplier", v)}
                testId="slider-sl-atr"
              />
              <ToggleField
                label="London Session"
                value={config.trade_london}
                onChange={(v) => updateField("trade_london", v)}
                testId="toggle-london"
              />
              <ToggleField
                label="New York Session"
                value={config.trade_new_york}
                onChange={(v) => updateField("trade_new_york", v)}
                testId="toggle-newyork"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6">
          <button
            data-testid="save-config-btn"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[2px_2px_0px_hsl(0,0%,4%)] disabled:opacity-50"
          >
            <FloppyDisk size={16} weight="bold" />
            {saving ? "SAVING..." : saved ? "SAVED" : "SAVE CONFIGURATION"}
          </button>
          <button
            data-testid="reset-config-btn"
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-6 py-3 border border-border text-foreground font-medium text-sm tracking-wide hover:border-foreground transition-colors duration-150"
          >
            <ArrowCounterClockwise size={16} />
            RESET DEFAULTS
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SliderField({ label, value, min, max, step, suffix, onChange, testId }) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <span className="font-mono text-sm font-bold text-foreground" data-testid={`${testId}-value`}>
          {typeof value === "number" ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}
          {suffix}
        </span>
      </div>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-muted appearance-none cursor-pointer accent-[hsl(43,74%,49%)]"
        style={{
          background: `linear-gradient(to right, hsl(43,74%,49%) 0%, hsl(43,74%,49%) ${percentage}%, hsl(0,0%,90%) ${percentage}%, hsl(0,0%,90%) 100%)`,
        }}
      />
    </div>
  );
}

function NumberField({ label, value, min, max, onChange, testId }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground block mb-2">
        {label}
      </label>
      <input
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="w-full px-3 py-2 border border-border bg-background font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

function ToggleField({ label, value, onChange, testId }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <button
        data-testid={testId}
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 transition-colors duration-150 ${
          value ? "bg-primary" : "bg-muted"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-card border border-border transition-transform duration-150 ${
            value ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
