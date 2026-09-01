// Extracted verbatim from frontend/src/components/cloud/CloudDashboard.jsx FOREX_CURRICULUM
// (backend_node/src/services/academyCurriculum.ts REQUIRED_LESSON_IDS is the id list this must match)
// so the mobile Academy uses the SAME real lesson content as the website, not invented copy.

export interface LessonSection {
  heading: string;
  body: string;
}

export interface LessonDef {
  id: string;
  title: string;
  level: string;
  sub: string;
  sections: LessonSection[];
}

export interface CourseDef {
  id: string;
  title: string;
  lessons: LessonDef[];
}

export const LESSONS: LessonDef[] = [
  {
    "id": "foundation",
    "title": "Forex Foundations",
    "level": "01 · Beginner",
    "sub": "What the market is, who trades it, and why prices move",
    "sections": [
      {
        "heading": "What forex actually is",
        "body": "Foreign exchange is the global market where one currency is exchanged for another. Prices move because banks, funds, companies, governments and traders continuously change what they are willing to buy and sell."
      },
      {
        "heading": "Currency pairs",
        "body": "A pair compares two currencies. In EURUSD, EUR is the base and USD is the quote. If EURUSD rises, one euro buys more dollars. Gold is commonly quoted as XAUUSD — the value of one ounce of gold in US dollars."
      },
      {
        "heading": "Why markets move",
        "body": "Price responds to changing expectations about interest rates, inflation, growth, risk, liquidity and positioning. Technical patterns matter because they summarize what buyers and sellers are doing — not because a shape magically predicts the future."
      },
      {
        "heading": "Your first rule",
        "body": "Treat trading as risk management first and prediction second. You can be wrong often and still survive if losses are small; one oversized loss can erase weeks of good decisions."
      }
    ]
  },
  {
    "id": "quotes",
    "title": "Quotes, Pips & Lots",
    "level": "02 · Beginner",
    "sub": "Read price correctly before risking money",
    "sections": [
      {
        "heading": "Bid and ask",
        "body": "You sell at the bid and buy at the ask. The difference is the spread — an immediate transaction cost. Fast markets and illiquid periods can widen it."
      },
      {
        "heading": "Pips and points",
        "body": "A pip is a standardized unit of price movement. Brokers may display extra decimal points, so always learn your symbol's contract specification instead of assuming every instrument uses the same point value."
      },
      {
        "heading": "Lot size",
        "body": "Position size controls how much money each price movement is worth. A stop distance means nothing without lot size; risk comes from both together."
      },
      {
        "heading": "Contract specs matter",
        "body": "Gold contract size, tick value, minimum lot and margin can differ by broker. Check MT5 Symbol Specification before translating a setup into money risk."
      }
    ]
  },
  {
    "id": "orders",
    "title": "Orders & Execution",
    "level": "03 · Beginner",
    "sub": "Market, limit, stop, stop-loss and take-profit",
    "sections": [
      {
        "heading": "Market orders",
        "body": "A market order asks to trade now at the best available price. During volatility the fill can differ from the price you saw — this is slippage."
      },
      {
        "heading": "Limit orders",
        "body": "A buy limit sits below current price and a sell limit above. Limits seek a better price but may never fill."
      },
      {
        "heading": "Stop orders",
        "body": "A buy stop sits above current price and a sell stop below. They are often used for breakout participation, but false breaks and slippage are real risks."
      },
      {
        "heading": "SL and TP",
        "body": "A stop-loss defines where the trade thesis is invalidated. A take-profit is a planned exit. Place them because the market structure requires them, then size the trade to that distance — not the other way around."
      }
    ]
  },
  {
    "id": "margin",
    "title": "Leverage, Margin & Liquidation Risk",
    "level": "04 · Beginner",
    "sub": "Understand the amplifier before using it",
    "sections": [
      {
        "heading": "Leverage",
        "body": "Leverage lets you control more market exposure than your deposited cash. It magnifies both gains and losses; it does not improve the quality of a setup."
      },
      {
        "heading": "Margin",
        "body": "Margin is collateral reserved to keep leveraged positions open. Free margin falls as positions lose or as you add exposure."
      },
      {
        "heading": "Margin calls",
        "body": "If equity falls too far, a broker can restrict or close positions. Never build a strategy that depends on being allowed unlimited room to recover."
      },
      {
        "heading": "Professional mindset",
        "body": "Choose position size from your acceptable loss at the stop, then check margin. Never choose the biggest lot your broker permits."
      }
    ]
  },
  {
    "id": "risk",
    "title": "Risk Management",
    "level": "05 · Core Skill",
    "sub": "The skill that keeps you in the game",
    "sections": [
      {
        "heading": "Risk per trade",
        "body": "Define the maximum account percentage or cash amount you can lose if the stop is hit. Consistency matters more than chasing a large win."
      },
      {
        "heading": "R-multiples",
        "body": "1R is the amount you planned to risk. A +2R winner makes twice that risk; a -1R loss loses the planned risk. R lets you compare trades independent of lot size."
      },
      {
        "heading": "Drawdown",
        "body": "Drawdown measures decline from a previous equity peak. Recovery gets mathematically harder as drawdown deepens, which is why preventing large losses matters."
      },
      {
        "heading": "Correlated risk",
        "body": "Several trades can be one hidden bet. If instruments respond to the same USD move, total portfolio risk can be much larger than the sum of labels suggests."
      },
      {
        "heading": "Risk of ruin",
        "body": "No setup has a 100% win rate. A position size that cannot survive a normal losing streak is too large, even if the recent backtest looked excellent."
      }
    ]
  },
  {
    "id": "structure",
    "title": "Market Structure",
    "level": "06 · Core Skill",
    "sub": "Higher highs, lower lows, breaks and transitions",
    "sections": [
      {
        "heading": "Trend structure",
        "body": "Uptrends tend to print higher highs and higher lows; downtrends lower highs and lower lows. Structure is evidence, not a guarantee."
      },
      {
        "heading": "Break of structure",
        "body": "A meaningful break occurs when price decisively moves through a structural swing. A wick alone can be a liquidity probe rather than confirmation."
      },
      {
        "heading": "Change of character",
        "body": "When the market stops behaving like its prior trend, a transition may be starting. Wait for follow-through before treating every countertrend move as a reversal."
      },
      {
        "heading": "Context beats labels",
        "body": "A bullish structure break directly into major resistance is different from the same break after a clean base with room to move."
      }
    ]
  },
  {
    "id": "sr",
    "title": "Support, Resistance & Liquidity",
    "level": "07 · Core Skill",
    "sub": "Where reactions become more likely",
    "sections": [
      {
        "heading": "Zones, not laser lines",
        "body": "Support and resistance are usually areas where order flow changed before. Treat them as zones with tolerance, not exact prices that must hold to the pip."
      },
      {
        "heading": "Liquidity",
        "body": "Stops and pending orders cluster around obvious highs, lows and range edges. Price can sweep these areas before choosing direction."
      },
      {
        "heading": "Role reversal",
        "body": "Broken resistance can become support and broken support can become resistance, especially when a retest is accepted."
      },
      {
        "heading": "Confluence",
        "body": "A level becomes more useful when structure, trend, session timing and risk-to-reward also support the trade."
      }
    ]
  },
  {
    "id": "candles",
    "title": "Candlesticks & Price Action",
    "level": "08 · Core Skill",
    "sub": "Read what happened inside each bar",
    "sections": [
      {
        "heading": "Body and wick",
        "body": "The body shows the open-to-close move; wicks show extremes rejected or revisited. A long wick is meaningful only relative to nearby structure and recent volatility."
      },
      {
        "heading": "Engulfing bars",
        "body": "An engulfing candle can signal decisive order flow when it appears at a meaningful location. In the middle of random chop, it is just another candle."
      },
      {
        "heading": "Pin bars",
        "body": "A pin bar shows rejection: price explored one side and closed away from it. Confirmation and location determine whether that rejection is useful."
      },
      {
        "heading": "Inside bars",
        "body": "An inside bar represents compression. Breakouts can expand quickly, but both sides may be swept first, so define invalidation before entry."
      }
    ]
  },
  {
    "id": "patterns",
    "title": "Chart Patterns",
    "level": "09 · Core Skill",
    "sub": "Reversals, continuations and failed patterns",
    "sections": [
      {
        "heading": "Patterns are behavior",
        "body": "A pattern is a visual shorthand for repeated order-flow behavior. The best question is not 'what shape is this?' but 'who is trapped, who is defending, and where is invalidation?'"
      },
      {
        "heading": "Reversal families",
        "body": "Double tops/bottoms, head-and-shoulders and failed breakouts matter most after an extended move and near a meaningful level."
      },
      {
        "heading": "Continuation families",
        "body": "Flags, pennants and tight consolidations can pause a strong move before continuation. Quality falls when the impulse into the pattern was weak."
      },
      {
        "heading": "Failure is information",
        "body": "A textbook pattern that breaks the wrong way can create an even stronger move because traders positioned for the obvious outcome are forced to exit."
      }
    ]
  },
  {
    "id": "indicators",
    "title": "Indicators Without Indicator Addiction",
    "level": "10 · Intermediate",
    "sub": "Trend, momentum and volatility tools",
    "sections": [
      {
        "heading": "Moving averages",
        "body": "Moving averages smooth price and can describe trend direction or dynamic zones. They lag by design and should not replace price structure."
      },
      {
        "heading": "RSI",
        "body": "RSI measures momentum, not automatic reversal. 'Overbought' can stay overbought through a strong trend."
      },
      {
        "heading": "ATR",
        "body": "Average True Range estimates recent volatility. It is useful for comparing stop distance and expected movement across different market regimes."
      },
      {
        "heading": "Use fewer tools",
        "body": "Several indicators derived from the same price data can create fake confluence. Know what each tool measures and avoid counting the same evidence multiple times."
      }
    ]
  },
  {
    "id": "timeframes",
    "title": "Multi-Timeframe Analysis",
    "level": "11 · Intermediate",
    "sub": "Align context, setup and execution",
    "sections": [
      {
        "heading": "Top-down thinking",
        "body": "Use a higher timeframe for broad structure, a working timeframe for the setup, and a lower timeframe only when it genuinely improves execution."
      },
      {
        "heading": "Avoid timeframe shopping",
        "body": "If you keep switching charts until one agrees with your bias, you are not doing multi-timeframe analysis — you are searching for confirmation."
      },
      {
        "heading": "Conflict is normal",
        "body": "A lower-timeframe uptrend can exist inside a higher-timeframe downtrend. Decide which timeframe defines your trade thesis before entering."
      }
    ]
  },
  {
    "id": "sessions",
    "title": "Sessions, News & Volatility",
    "level": "12 · Intermediate",
    "sub": "When liquidity and event risk change",
    "sections": [
      {
        "heading": "Trading sessions",
        "body": "London and New York typically bring deeper liquidity to major FX pairs and gold. Session opens can create both genuine expansion and stop-clearing volatility."
      },
      {
        "heading": "Economic news",
        "body": "Rate decisions, CPI, jobs data and central-bank communication can move markets violently. Technical levels may slip or gap during high-impact releases."
      },
      {
        "heading": "Gold drivers",
        "body": "Gold often responds to real yields, USD direction, inflation expectations, risk sentiment and geopolitics. Relationships can weaken or reverse in different regimes."
      },
      {
        "heading": "Do not predict headlines",
        "body": "Your edge should not depend on correctly guessing a number before release. Decide whether your system trades, reduces risk or stands aside around scheduled news."
      }
    ]
  },
  {
    "id": "xau",
    "title": "Trading Gold (XAUUSD)",
    "level": "13 · Intermediate",
    "sub": "Why gold behaves differently from major FX pairs",
    "sections": [
      {
        "heading": "Gold moves fast",
        "body": "XAUUSD can travel large distances quickly and can reverse sharply. Stops, lot size and broker tick values deserve extra attention."
      },
      {
        "heading": "Liquidity sweeps",
        "body": "Gold frequently probes obvious highs and lows before expanding. Entering purely because a level was touched can be expensive."
      },
      {
        "heading": "Macro sensitivity",
        "body": "USD moves, yields, inflation expectations and risk events can dominate technical setups. Context can change in minutes."
      },
      {
        "heading": "Respect the spread",
        "body": "Around rollover and major news, gold spreads can widen significantly. A strategy tested on ideal fills may perform very differently live."
      }
    ]
  },
  {
    "id": "strategy",
    "title": "Building a Trading Strategy",
    "level": "14 · Intermediate",
    "sub": "Turn ideas into explicit rules",
    "sections": [
      {
        "heading": "Define the setup",
        "body": "Write down market condition, location, trigger, invalidation and target. If two traders cannot apply the rule consistently, it is not defined enough."
      },
      {
        "heading": "Separate signal and sizing",
        "body": "The setup decides whether a trade exists. Risk management decides how large it may be. Do not increase size because you 'feel' more confident."
      },
      {
        "heading": "Define no-trade conditions",
        "body": "Knowing when not to trade is part of the strategy: late entries, poor liquidity, excessive spread, news risk, weak structure or insufficient reward."
      },
      {
        "heading": "Measure expectancy",
        "body": "Expectancy combines win rate and average win/loss. A high win rate with occasional huge losses can still be a bad system."
      }
    ]
  },
  {
    "id": "execution",
    "title": "Entries, Stops & Targets",
    "level": "15 · Intermediate",
    "sub": "Translate an idea into an executable plan",
    "sections": [
      {
        "heading": "Entry location",
        "body": "Good entries balance confirmation with remaining room. Waiting too long can turn a correct idea into poor risk-to-reward."
      },
      {
        "heading": "Stop placement",
        "body": "Place the stop where the thesis is invalid, then size down if the stop is wide. Tightening a stop only to fit a larger lot is backwards."
      },
      {
        "heading": "Targets",
        "body": "Targets can use structure, liquidity, volatility or R-multiples. A target should have a reason, not just a round profit number."
      },
      {
        "heading": "Partial exits",
        "body": "Scaling out can reduce variance but also reduce average winner size. Test the rule instead of assuming partial profit is always superior."
      }
    ]
  },
  {
    "id": "management",
    "title": "Trade Management",
    "level": "16 · Advanced",
    "sub": "Break-even, trailing, scaling and exits",
    "sections": [
      {
        "heading": "Break-even is not free",
        "body": "Moving a stop to entry removes downside on that trade but can also convert normal retests into premature exits."
      },
      {
        "heading": "Trailing stops",
        "body": "A trailing method should match market structure or volatility. A trail that is too tight can destroy a trend-following edge."
      },
      {
        "heading": "Let winners breathe",
        "body": "The goal is not to protect every floating dollar. The goal is to protect the strategy's long-term expectancy."
      },
      {
        "heading": "Exit reasons",
        "body": "Log whether exits were planned, structural, protective or emotional. Mixing discretionary exits with rule-based exits makes performance hard to diagnose."
      }
    ]
  },
  {
    "id": "psychology",
    "title": "Trading Psychology",
    "level": "17 · Advanced",
    "sub": "Process, discipline and emotional control",
    "sections": [
      {
        "heading": "FOMO",
        "body": "Fear of missing out usually appears after price has already moved. Missing a trade is cheaper than entering a bad one."
      },
      {
        "heading": "Revenge trading",
        "body": "After a loss, the desire to immediately win it back changes decision quality. A predefined cooldown rule can protect you from yourself."
      },
      {
        "heading": "Outcome bias",
        "body": "A good trade can lose and a bad trade can win. Judge whether you followed your process before judging the P&L."
      },
      {
        "heading": "Boredom",
        "body": "Many trading mistakes happen because nothing is happening. Professional behavior includes doing nothing when there is no edge."
      }
    ]
  },
  {
    "id": "journal",
    "title": "Journaling & Statistics",
    "level": "18 · Advanced",
    "sub": "Learn from your own evidence",
    "sections": [
      {
        "heading": "What to record",
        "body": "Capture setup type, market regime, entry reason, stop, target, result, screenshot and whether every rule was followed."
      },
      {
        "heading": "Sample size",
        "body": "Five wins are not proof of an edge and five losses are not proof a strategy is broken. Evaluate enough trades to include normal variance."
      },
      {
        "heading": "Key metrics",
        "body": "Track expectancy, average R, win rate, profit factor, drawdown, losing streaks and performance by setup or regime."
      },
      {
        "heading": "Review mistakes separately",
        "body": "Separate strategy losses from execution mistakes. Otherwise you may change a good system to solve a discipline problem."
      }
    ]
  },
  {
    "id": "backtest",
    "title": "Backtesting & Forward Testing",
    "level": "19 · Advanced",
    "sub": "Prove an idea before trusting it",
    "sections": [
      {
        "heading": "Avoid hindsight",
        "body": "Define rules before scrolling through history. If the rule changes every time a losing example appears, the test is not valid."
      },
      {
        "heading": "Include costs",
        "body": "Spread, commission, slippage and realistic fill assumptions matter. Tiny theoretical edges can disappear after costs."
      },
      {
        "heading": "Out-of-sample",
        "body": "Build on one period and validate on another. If performance exists only in the data used to invent the rules, it may be overfit."
      },
      {
        "heading": "Forward test",
        "body": "Demo or very small live testing shows how the system behaves with real-time decisions, latency and emotions."
      }
    ]
  },
  {
    "id": "prop",
    "title": "Prop Firm Risk",
    "level": "20 · Advanced",
    "sub": "Daily loss, total drawdown and rule-aware trading",
    "sections": [
      {
        "heading": "Read the actual rules",
        "body": "Different firms calculate daily drawdown, trailing loss and equity limits differently. Never rely on a generic interpretation."
      },
      {
        "heading": "Use a buffer",
        "body": "Do not trade exactly against the firm's loss threshold. Fees, floating P&L and calculation timing can create accidental breaches."
      },
      {
        "heading": "Consistency",
        "body": "A challenge is a risk-management exercise before it is a profit target. Oversizing to finish faster often reduces the probability of completion."
      }
    ]
  },
  {
    "id": "xaucloud",
    "title": "Using XauCloud Professionally",
    "level": "21 · XauCloud",
    "sub": "Understand what automation can — and cannot — do",
    "sections": [
      {
        "heading": "Automation is not certainty",
        "body": "XauCloud can execute a defined process consistently, but no trading system can guarantee profit or eliminate market risk."
      },
      {
        "heading": "Bot On / Off",
        "body": "Bot Off stops new automatic entries while existing positions remain managed. Turning Bot On allows normal qualified entries again; it never forces an immediate trade."
      },
      {
        "heading": "Market Outlook",
        "body": "Outlook is evidence and context, not permission to abandon risk rules. Execution still follows XauCloud's blockers and configured risk controls."
      },
      {
        "heading": "Use the data",
        "body": "Review Analytics, Activity, AI Brain and the Pattern Scanner to understand what the system is seeing rather than judging it from one trade."
      }
    ]
  }
];

function bandFor(level: string): string {
  if (level.includes("Beginner")) return "Beginner";
  if (level.includes("Core Skill")) return "Beginner";
  if (level.includes("Intermediate")) return "Intermediate";
  if (level.includes("XauCloud")) return "Advanced";
  return "Advanced";
}

/** Groups the flat 21-lesson curriculum into course bands for the Academy list screen — grouping only, same lessons/ids as REQUIRED_LESSON_IDS. */
export const CURRICULUM: CourseDef[] = (() => {
  const bands: Record<string, LessonDef[]> = { Beginner: [], Intermediate: [], Advanced: [] };
  for (const lesson of LESSONS) bands[bandFor(lesson.level)].push(lesson);
  return [
    { id: "beginner", title: "Forex \u0026 Market Basics", lessons: bands.Beginner },
    { id: "intermediate", title: "Technical \u0026 Strategy", lessons: bands.Intermediate },
    { id: "advanced", title: "Advanced \u0026 XauCloud", lessons: bands.Advanced },
  ];
})();

export function findLesson(id: string): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id);
}
