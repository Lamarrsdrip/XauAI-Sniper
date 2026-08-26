/**
 * XauCloud Academy course catalog -- the SINGLE backend-authoritative source
 * for every course/module/lesson/quiz beyond the original 21-lesson v1
 * curriculum (academyCurriculum.ts, untouched by this file and its own
 * certificate/progress system left completely alone -- see
 * academyCourseCertificates.ts and academyCourseProgress.ts for why the two
 * systems deliberately don't share collections or unique-index keys).
 *
 * Web and mobile both read this same catalog via GET /cloud/academy/catalog
 * -- there is exactly one course catalog, never a per-client copy.
 *
 * Content-writing status (2026-08-26): course 1 below is the original
 * 21-lesson curriculum, regrouped into modules for navigation only --
 * content and lesson ids are byte-identical to FOREX_CURRICULUM in
 * CloudDashboard.jsx, and completion for those 21 ids continues to flow
 * through the original v1 academy_progress/academy_certificates system,
 * completely unaffected by anything in this file. Course 2 (Gold/XAUUSD
 * Masterclass) is newly written in full for this expansion. The remaining
 * 15 planned major learning areas (Complete Forex, Chart Reading & Market
 * Structure, Price Action Mastery, Technical Analysis, Fundamental & Macro
 * Analysis, Cryptocurrency & Digital Assets, Risk & Money Management,
 * Trading Psychology, Strategy Development & Trading Systems, Backtesting/
 * Journaling/Performance Analysis, Brokers/Execution/MT5, Algorithmic &
 * Automated Trading, AI & Machine Learning in Trading, Trading Security/
 * Fraud/Professional Practice) are queued -- this catalog format and the
 * whole quiz/progress/certificate pipeline below already supports adding
 * them course-by-course without any further infrastructure work.
 */

export type QuizQuestionType = "single" | "multi" | "true_false";

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options: QuizOption[];
  /** Never sent to the client until after grading -- see academyCourseQuiz.ts. */
  correctOptionIds: string[];
  explanation: string;
}

export interface Quiz {
  id: string;
  title: string;
  passingScorePct: number;
  questions: QuizQuestion[];
}

export type CourseLevel = "beginner" | "intermediate" | "advanced" | "specialist";

export interface Lesson {
  id: string;
  title: string;
  estimatedMinutes: number;
  objectives: string[];
  /** [heading, body][] -- matches the existing FOREX_CURRICULUM lesson-viewer shape so both course systems reuse one frontend component. */
  sections: Array<[string, string]>;
  commonMistakes: string[];
  keyTakeaways: string[];
  /** 1-3 short, ungraded, immediate-feedback checks shown inline at the end of the lesson -- not attempt-tracked like a module/final quiz. */
  knowledgeCheck?: QuizQuestion[];
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
  quiz?: Quiz;
}

export interface Course {
  id: string;
  title: string;
  level: CourseLevel;
  summary: string;
  tags: string[];
  modules: Module[];
  finalAssessment?: Quiz;
  /** True only for a course that issues its own certificate on completion (module quizzes passed + final assessment passed). */
  certificateEligible: boolean;
}

function q(
  id: string,
  type: QuizQuestionType,
  prompt: string,
  options: QuizOption[],
  correctOptionIds: string[],
  explanation: string,
): QuizQuestion {
  return { id, type, prompt, options, correctOptionIds, explanation };
}

const tf = (id: string, prompt: string, correct: boolean, explanation: string): QuizQuestion => q(
  id, "true_false", prompt,
  [{ id: "true", text: "True" }, { id: "false", text: "False" }],
  [correct ? "true" : "false"], explanation,
);

// ============================================================================
// COURSE 2: Gold / XAUUSD Masterclass (new, full-depth, flagship course)
// ============================================================================

const xauModule1Understanding: Module = {
  id: "xau-m1-understanding",
  title: "Understanding Gold",
  lessons: [
    {
      id: "xau-l1-what-is-xauusd",
      title: "What Is XAUUSD?",
      estimatedMinutes: 6,
      objectives: [
        "Explain what the XAUUSD symbol actually represents",
        "Distinguish spot gold trading from owning physical gold or a gold-mining stock",
      ],
      sections: [
        ["A price, not a coin", "XAUUSD is a quote: how many US dollars one troy ounce of gold currently costs. Trading XAUUSD through a broker means speculating on that price -- you are not buying, storing, or insuring physical metal. XAU is gold's ISO 4217-style currency code (from the Latin aurum), the same convention used for XAG (silver) and XPT (platinum)."],
        ["Spot vs. futures vs. physical", "Spot gold (what most retail brokers, including XauCloud's supported brokers, quote) settles against a continuously updated market price with no fixed expiry. Gold futures are exchange-traded contracts with a specific delivery month and their own roll-date mechanics. Physical gold (coins, bars, jewelry) carries storage, insurance, and a dealer premium/discount on top of the spot price. Retail CFD-style XAUUSD trading is closest to spot -- it never involves taking delivery of metal."],
        ["Why gold gets its own market structure course", "Gold behaves differently from a currency pair. It has no central bank setting its own interest rate, no single government issuing it, and it responds to a distinct mix of drivers -- real yields, the US dollar, inflation expectations, and safe-haven demand -- covered in the next module. Chart mechanics you already know from the Forex Foundations course (structure, support/resistance, sessions) still apply; this course focuses on what makes gold's version of those mechanics distinct."],
      ],
      commonMistakes: [
        "Assuming a XAUUSD position behaves like owning physical gold (it doesn't -- no delivery, no storage, and your broker's contract specification, not a bullion dealer's premium, sets your actual cost)",
        "Confusing gold futures roll dynamics with spot XAUUSD pricing when reading news or analysis written for a different market",
      ],
      keyTakeaways: [
        "XAUUSD is a price quote (USD per troy ounce), not physical ownership",
        "Retail XAUUSD trading is closest to the spot gold market, not futures or physical bullion",
      ],
      knowledgeCheck: [
        tf("xau-l1-kc1", "Trading XAUUSD through a retail broker means you can request physical delivery of gold bars.", false, "Retail XAUUSD CFD-style trading never involves physical delivery -- it is a cash-settled price speculation on the spot gold market."),
      ],
    },
    {
      id: "xau-l2-how-gold-is-priced",
      title: "How Gold Is Priced",
      estimatedMinutes: 7,
      objectives: [
        "Describe how the global spot gold price forms",
        "Understand what a broker's XAUUSD quote is actually built from",
      ],
      sections: [
        ["A genuinely global, near-continuous market", "Unlike a stock with one primary exchange, gold trades nearly around the clock across interbank dealers, bullion banks, and exchanges in London, Zurich, New York, and Asia. The price you see quoted is an aggregate of that interbank activity, not a single exchange's order book."],
        ["What sets your broker's bid/ask", "Your broker sources a reference price from liquidity providers and adds its own spread (and sometimes a markup) to produce the bid/ask you actually trade on. Two brokers can show slightly different XAUUSD prices at the same instant -- this is normal, not a sign either one is wrong."],
        ["Contract specification governs the money math", "Point value, minimum lot, and margin requirement for XAUUSD are set by your specific broker's contract specification -- check it in MT5 (Market Watch → right-click XAUUSD → Specification) rather than assuming every broker uses the same tick value. This is the same principle the Quotes, Pips & Lots lesson introduced generally, applied specifically to gold."],
      ],
      commonMistakes: [
        "Assuming every broker's XAUUSD tick/point value is identical without checking the actual contract specification",
        "Treating a small quote difference between two brokers as evidence one platform is manipulating price",
      ],
      keyTakeaways: [
        "Gold's price is an aggregate of continuous global interbank activity, not one exchange's order book",
        "Your actual tradable price and position sizing math both come from your broker's specific contract specification",
      ],
    },
    {
      id: "xau-l3-market-participants",
      title: "Gold Market Participants",
      estimatedMinutes: 6,
      objectives: [
        "Identify the major categories of participant in the gold market",
        "Explain why their motives differ from a typical retail forex trader's",
      ],
      sections: [
        ["Central banks", "Central banks hold gold as a reserve asset and periodically buy or sell in large size for reserve-diversification reasons, not short-term speculation. Their activity is disclosed with a lag (via bodies like the World Gold Council) and moves the long-term supply/demand backdrop rather than any single day's price."],
        ["Bullion banks and ETFs", "Bullion banks facilitate physical and derivative gold flow between clients; large gold-backed ETFs (like GLD) let institutional and retail investors gain exposure without holding metal directly. ETF flow data is a commonly watched sentiment gauge."],
        ["Jewelry and industrial demand", "Physical demand, especially seasonal jewelry buying in markets like India and China, adds a structural demand layer separate from financial speculation."],
        ["Retail and institutional speculators", "This is the layer XauCloud's signals and your own trading sit in -- shorter-horizon participants responding to price action, macro data, and risk sentiment. Their flow is a smaller share of total gold market activity than the categories above, which is exactly why gold can move on data releases (covered in Module 2) even without any change in physical demand."],
      ],
      commonMistakes: [
        "Treating gold's short-term chart moves as driven mainly by the same participants who set its multi-year trend",
        "Ignoring that a large share of gold market size is structurally different from currency-pair participants",
      ],
      keyTakeaways: [
        "Gold's participant base spans central banks, bullion banks/ETFs, physical/jewelry demand, and speculators -- each on a different time horizon",
        "Short-term trading (this course's focus) sits mostly within the speculator layer, on top of a much larger structural backdrop",
      ],
    },
    {
      id: "xau-l4-gold-sessions",
      title: "Gold Trading Sessions",
      estimatedMinutes: 6,
      objectives: [
        "Identify when gold's liquidity is highest and lowest through the trading day",
        "Explain why the London/New York overlap matters specifically for gold",
      ],
      sections: [
        ["Asia session", "Generally the quietest period for gold, though it can carry real direction around Chinese/Indian physical demand headlines or regional data. Ranges are typically tighter than during London/New York."],
        ["London session", "London is a historic center of the physical gold market (home to the London Bullion Market Association) and where a large share of daily gold volume concentrates. Volatility and range tend to expand meaningfully at the London open."],
        ["New York session and the London/NY overlap", "The London/New York overlap is typically gold's highest-liquidity window, coinciding with major US economic releases (many scheduled for 8:30am/13:30 and 10:00am/14:00 ET -- see Module 2 for exactly which ones move gold most). This is also when spreads are usually tightest and when the sharpest, most tradeable moves tend to occur."],
        ["Why this matters for XauCloud's own signals", "The 10-Minute Engine and Market Outlook you use elsewhere in Command Center are evaluating live evidence continuously, but the SAME evidence quality is not uniform through the day -- a setup during a thin Asia range carries different context than the identical-looking setup during the London/NY overlap. This course teaches you to read that context; it does not change how the engine itself decides."],
      ],
      commonMistakes: [
        "Expecting London/New York-session volatility during a thin Asia range and being surprised by weak follow-through",
        "Ignoring session context entirely and treating every hour of the day as equally reliable for reading a setup",
      ],
      keyTakeaways: [
        "London and the London/New York overlap are typically gold's highest-liquidity, highest-volatility windows",
        "Session context should inform how much weight you give a setup, not just its shape on the chart",
      ],
      knowledgeCheck: [
        q("xau-l4-kc1", "single", "Which window is typically gold's highest-liquidity period?", [
          { id: "a", text: "The Asia session alone" },
          { id: "b", text: "The London/New York overlap" },
          { id: "c", text: "Weekends" },
        ], ["b"], "The London/New York overlap combines London's deep physical gold market with New York's major US data releases, typically producing the day's highest liquidity and volatility."),
      ],
    },
  ],
  quiz: {
    id: "xau-m1-quiz",
    title: "Module 1 Quiz: Understanding Gold",
    passingScorePct: 70,
    questions: [
      q("xau-m1-q1", "single", "A XAUUSD position through a retail broker most closely resembles:", [
        { id: "a", text: "Owning a physical gold bar in a vault" },
        { id: "b", text: "A cash-settled speculation on the spot gold price" },
        { id: "c", text: "A guaranteed-delivery futures contract" },
      ], ["b"], "Retail XAUUSD trading is a cash-settled price speculation on spot gold -- there is no physical delivery, storage, or futures roll mechanics involved."),
      q("xau-m1-q2", "single", "Two brokers show slightly different XAUUSD bid/ask prices at the same instant. This most likely means:", [
        { id: "a", text: "One of the brokers is manipulating its price feed" },
        { id: "b", text: "Each broker sources its own reference price and adds its own spread/markup" },
        { id: "c", text: "Gold does not have a single global price" },
      ], ["b"], "Small quote differences between brokers are normal -- each sources liquidity and applies its own spread to build its tradable price."),
      q("xau-m1-q3", "multi", "Which of the following are genuine categories of gold market participant? (Select all that apply)", [
        { id: "a", text: "Central banks" },
        { id: "b", text: "Jewelry/industrial physical demand" },
        { id: "c", text: "Retail and institutional speculators" },
        { id: "d", text: "A single global gold exchange that sets the only official price" },
      ], ["a", "b", "c"], "Central banks, physical/jewelry demand, and speculators are all real participant categories. There is no single exchange that sets \"the\" official gold price -- it forms from continuous global interbank activity."),
      tf("xau-m1-q4", "Session context (e.g. thin Asia range vs. the London/New York overlap) should inform how much weight you give an otherwise identical-looking chart setup.", true, "The same-shaped setup carries different reliability depending on the liquidity backdrop it forms in -- this course teaches you to read that context."),
    ],
  },
};

const xauModule2WhatMovesGold: Module = {
  id: "xau-m2-what-moves-gold",
  title: "What Moves Gold",
  lessons: [
    {
      id: "xau-l5-usd-relationship",
      title: "The US Dollar Relationship",
      estimatedMinutes: 7,
      objectives: [
        "Explain why gold and the US dollar are usually, but not always, inversely related",
        "Recognize when the relationship can temporarily break down"],
      sections: [
        ["Priced in dollars, so dollar strength is a headwind by default", "Since gold is quoted in USD, a stronger dollar makes gold more expensive for holders of other currencies, which tends to weigh on demand -- and vice versa for a weaker dollar. This is why gold and a broad dollar index (like DXY) often move inversely."],
        ["The relationship is a tendency, not a law", "Both gold and the dollar can rise together during acute risk-off events, when investors simultaneously seek dollar liquidity AND gold as separate safe havens. Treat the USD relationship as one important input, not a mechanical rule that always predicts direction."],
        ["Practical takeaway", "When gold moves against the 'expected' USD direction, that is itself useful evidence -- it often signals a different driver (real yields, geopolitical risk, or physical demand) is currently dominant. Module 4 (Safe-Haven Behavior) builds directly on this."],
      ],
      commonMistakes: [
        "Trading every dollar-index move as an automatic, same-size, opposite gold trade",
        "Being confused when gold and the dollar rise together, instead of recognizing it as a risk-off signal worth investigating",
      ],
      keyTakeaways: [
        "Gold and the US dollar are usually inversely related because gold is dollar-priced",
        "The relationship can break down during acute risk-off events -- treat it as one input among several",
      ],
    },
    {
      id: "xau-l6-interest-rates",
      title: "Interest Rates and Gold",
      estimatedMinutes: 7,
      objectives: [
        "Explain the opportunity-cost relationship between interest rates and gold",
        "Connect Fed policy expectations to gold price behavior"],
      sections: [
        ["Gold pays no yield", "Unlike a bond or a savings account, gold generates no interest or dividend. Holding it has an opportunity cost equal to the yield you give up by not holding an interest-bearing asset instead."],
        ["Higher rates, higher opportunity cost", "When interest rates rise (or are expected to rise), the opportunity cost of holding non-yielding gold increases, which tends to pressure gold lower, all else equal. When rates fall or are expected to fall, that pressure eases and gold tends to find support."],
        ["Expectations move price before the actual decision", "Markets are forward-looking -- gold typically reacts to shifting expectations about future central bank policy (priced in via statements, data, and rate-futures markets) well before any actual rate decision is announced. This is why a single strong or weak economic data point can move gold sharply: it changes the market's rate-path expectations."],
      ],
      commonMistakes: [
        "Waiting for an actual central bank rate announcement to \"see what gold does,\" missing that the move already happened on the expectations shift",
        "Treating interest rates as the only driver and ignoring inflation expectations, which the next lesson shows can point the opposite way"],
      keyTakeaways: [
        "Gold pays no yield, so rising rate expectations raise its opportunity cost and typically pressure it lower",
        "Gold moves on shifting rate expectations, often ahead of the actual policy decision"],
      knowledgeCheck: [
        tf("xau-l6-kc1", "Gold generates no interest or dividend, which is why rising interest rates typically create a headwind for its price.", true, "Because gold pays no yield, higher rates raise the opportunity cost of holding it instead of an interest-bearing asset -- a genuine headwind, all else equal."),
      ],
    },
    {
      id: "xau-l7-real-yields",
      title: "Real Yields: The Sharper Tool",
      estimatedMinutes: 8,
      objectives: [
        "Define real yield and distinguish it from the nominal interest rate",
        "Explain why real yields track gold more tightly than nominal rates alone"],
      sections: [
        ["Nominal rate minus inflation", "The real yield on a bond is approximately its nominal interest rate minus expected inflation. It represents the actual purchasing-power return an investor earns after inflation erodes it."],
        ["Why real yields matter more than nominal rates for gold", "A high nominal rate alongside even higher inflation can mean a NEGATIVE real yield -- in that environment, holding gold (which pays no yield but also doesn't lose purchasing power the way cash under high inflation does) can look relatively attractive despite nominal rates being high. This is why gold has sometimes rallied even while nominal rates were elevated: real yields were falling or negative."],
        ["A more precise lens, not a replacement", "Real yields (often tracked via inflation-protected bond yields, e.g. TIPS in the US) are a sharper analytical tool than nominal rates alone, but they are still one input among the drivers in this module -- combine with USD direction and risk sentiment rather than trading real yields in isolation."],
      ],
      commonMistakes: [
        "Assuming high nominal interest rates always mean bad news for gold, without checking whether inflation is rising even faster (making real yields fall)",
        "Treating real yields as the single deterministic driver and ignoring simultaneous USD or risk-sentiment moves"],
      keyTakeaways: [
        "Real yield ≈ nominal rate minus expected inflation, and it tracks gold more tightly than the nominal rate alone",
        "Falling or negative real yields are typically supportive for gold, even if nominal rates are high"],
    },
    {
      id: "xau-l8-inflation",
      title: "Inflation Expectations",
      estimatedMinutes: 6,
      objectives: [
        "Explain gold's traditional role as an inflation hedge",
        "Recognize why that relationship is inconsistent over shorter horizons"],
      sections: [
        ["The traditional hedge narrative", "Gold is widely viewed as a long-run store of value that can preserve purchasing power when a currency's value is being eroded by inflation, since gold's supply cannot be expanded by a central bank the way currency can."],
        ["Why short-term correlation is unreliable", "Over short and even medium horizons, gold's correlation with realized inflation is inconsistent -- it is influenced simultaneously by real yields, USD strength, and risk sentiment, which can offset or reinforce an inflation-driven move in either direction. Treat 'gold is an inflation hedge' as a long-run structural idea, not a short-term trading signal on its own."],
        ["What actually matters day to day", "Shifts in inflation EXPECTATIONS (not the realized inflation print itself) that change the real-yield picture (Lesson 7) are usually the more direct short-term transmission mechanism into gold price action."],
      ],
      commonMistakes: [
        "Buying gold immediately after any high inflation print expecting an automatic rally, without checking what it did to real yields and rate expectations",
        "Discarding the inflation-hedge idea entirely just because it doesn't hold reliably on a day-to-day basis"],
      keyTakeaways: [
        "Gold's inflation-hedge role is a long-run structural idea, not a reliable short-term trading signal by itself",
        "Inflation's short-term impact on gold usually flows through its effect on real yields and rate expectations"],
    },
    {
      id: "xau-l9-geopolitical-risk",
      title: "Geopolitical Risk and Safe-Haven Demand",
      estimatedMinutes: 6,
      objectives: [
        "Explain why gold often rallies during acute geopolitical stress",
        "Recognize the difference between a durable and a fading safe-haven move"],
      sections: [
        ["The safe-haven mechanism", "During acute geopolitical stress (conflict, sanctions shocks, sudden political instability), investors often reduce exposure to riskier assets and rotate into perceived safe havens -- gold among them, alongside instruments like the US dollar, Japanese yen, and government bonds."],
        ["Durable vs. fading moves", "A safe-haven spike driven by a single headline can reverse quickly once the immediate shock passes ('buy the rumor, sell the news' behavior), while a move backed by a genuine, sustained shift in the macro backdrop (e.g. an extended period of elevated uncertainty) tends to hold up better. Distinguishing the two in real time is difficult -- this is exactly why XauCloud's evidence-based engines (freshness, structure, location, confirmation) exist rather than trading headlines directly."],
        ["News-driven spread and slippage risk", "Geopolitical headlines can widen spreads and increase slippage risk sharply and without warning. Review the Risk Management course's news-risk material and this Academy's Broker/Execution course before trading directly around known event risk."],
      ],
      commonMistakes: [
        "Chasing a headline-driven spike without checking whether it fits the durable-vs-fading distinction",
        "Ignoring the execution risk (spread widening, slippage) that comes with genuine geopolitical shock events"],
      keyTakeaways: [
        "Gold often benefits from safe-haven rotation during acute geopolitical stress, alongside other traditional havens",
        "Headline-driven spikes can fade quickly -- durability depends on whether the underlying uncertainty actually persists"],
      knowledgeCheck: [
        q("xau-l9-kc1", "single", "A gold spike driven by a single geopolitical headline is most likely to:", [
          { id: "a", text: "Always continue in the same direction indefinitely" },
          { id: "b", text: "Potentially fade quickly if the underlying uncertainty doesn't persist" },
          { id: "c", text: "Have no effect on spreads or execution risk" },
        ], ["b"], "Headline-driven spikes often reverse once the immediate shock passes -- durability depends on whether the underlying situation genuinely persists, and such events frequently widen spreads and slippage risk."),
      ],
    },
  ],
  quiz: {
    id: "xau-m2-quiz",
    title: "Module 2 Quiz: What Moves Gold",
    passingScorePct: 70,
    questions: [
      q("xau-m2-q1", "single", "Why does gold usually move inversely to the US dollar?", [
        { id: "a", text: "Gold and the dollar are legally pegged to move opposite each other" },
        { id: "b", text: "Gold is priced in dollars, so a stronger dollar makes it more expensive for non-dollar holders" },
        { id: "c", text: "There is no real relationship between the two" },
      ], ["b"], "Because gold is quoted in USD, dollar strength raises gold's cost for holders of other currencies, which tends to weigh on demand -- producing the usual inverse relationship."),
      q("xau-m2-q2", "single", "Real yield is best described as:", [
        { id: "a", text: "The nominal interest rate alone" },
        { id: "b", text: "The nominal interest rate minus expected inflation" },
        { id: "c", text: "The gold price divided by the dollar index" },
      ], ["b"], "Real yield approximates the nominal rate minus expected inflation -- the actual purchasing-power return, and the metric that tracks gold more tightly than nominal rates alone."),
      tf("xau-m2-q3", "Gold can sometimes rally even while nominal interest rates are elevated, if inflation is rising even faster and pushing real yields lower or negative.", true, "This is exactly the real-yield mechanism from Lesson 7 -- falling or negative real yields are typically supportive for gold regardless of the nominal rate level."),
      q("xau-m2-q4", "single", "A gold price spike driven by a single geopolitical headline, with no lasting change in the underlying situation, is best described as:", [
        { id: "a", text: "Guaranteed to be a durable, sustained trend" },
        { id: "b", text: "A potentially fading move that can reverse once the immediate shock passes" },
        { id: "c", text: "Impossible to distinguish from a structural trend under any circumstances" },
      ], ["b"], "A single-headline spike often fades once the immediate shock passes; durability depends on whether the underlying uncertainty genuinely persists over time."),
      q("xau-m2-q5", "multi", "Which of the following are genuine short/medium-term drivers of gold price action covered in this module? (Select all that apply)", [
        { id: "a", text: "US dollar strength/weakness" },
        { id: "b", text: "Real yields and interest-rate expectations" },
        { id: "c", text: "Geopolitical risk and safe-haven demand" },
        { id: "d", text: "The exact phase of the moon" },
      ], ["a", "b", "c"], "USD direction, real yields/rate expectations, and geopolitical/safe-haven demand are all genuine, evidence-based drivers covered in this module."),
    ],
  },
};

const xauModule3TradingGold: Module = {
  id: "xau-m3-trading-gold",
  title: "Trading Gold in Practice",
  lessons: [
    {
      id: "xau-l10-volatility-liquidity",
      title: "Gold's Volatility and Liquidity Profile",
      estimatedMinutes: 7,
      objectives: [
        "Compare gold's typical volatility to a major currency pair",
        "Explain how ATR-based sizing applies specifically to gold"],
      sections: [
        ["Gold moves in larger absolute terms than most currency pairs", "A $2,000+ instrument with genuine daily ranges often measured in tens of dollars produces larger absolute point moves than a typical EURUSD-style pair. Comparing raw pip/point counts across instruments without normalizing for this is a common beginner error -- always translate to actual account risk in currency terms, not raw point counts."],
        ["ATR as the normalizer", "Average True Range (introduced in the Indicators lesson of the Forex Foundations course) is especially useful for gold: comparing your intended stop distance to current ATR tells you whether a stop is realistically placed for the current volatility regime, rather than copied from a strategy built in a different environment."],
        ["Liquidity is not constant", "Combine this lesson with Module 1's session material: the same stop distance that is reasonable during the London/New York overlap can be unrealistically tight during a thin Asia range, and vice versa."],
      ],
      commonMistakes: [
        "Applying a fixed dollar or pip stop-loss size across every session and volatility regime without checking current ATR",
        "Comparing gold's raw point moves directly to a currency pair's pip moves without normalizing for instrument scale"],
      keyTakeaways: [
        "Gold's absolute point moves are typically larger than a major currency pair's -- always translate to real account risk, not raw point counts",
        "ATR-based sizing keeps stop distance realistic across gold's changing volatility regimes"],
    },
    {
      id: "xau-l11-gold-specific-risk",
      title: "Gold-Specific Risk Management",
      estimatedMinutes: 7,
      objectives: [
        "Apply the general risk-management principles from the Risk Management lesson specifically to gold",
        "Identify gold-specific risk events to plan around"],
      sections: [
        ["The same core rules, applied to a faster instrument", "Everything from the Risk Management lesson (risk per trade, R-multiples, drawdown, risk of ruin) applies directly to gold -- the difference is that gold's larger absolute moves mean position-size math errors are amplified faster. Recompute position size for XAUUSD specifically; never reuse a lot size calculated for a currency pair."],
        ["Plan around known event risk", "US CPI, the Fed rate decision and press conference, and Non-Farm Payrolls (all covered in the Fundamental & Macro Analysis course) are historically among the highest-impact scheduled events for gold specifically, given the drivers covered in Module 2. Many traders deliberately reduce size or stand aside heading into these releases rather than holding a full-size position through the initial spike."],
        ["Weekend and low-liquidity gaps", "Gold can gap at the weekly open after weekend news, and spreads can widen materially during holidays or very thin liquidity windows. A stop-loss order does not guarantee your exact exit price during a genuine gap -- position size with that possibility in mind, don't assume execution is guaranteed at your stop."],
      ],
      commonMistakes: [
        "Reusing a forex-pair position size formula for gold without re-deriving it from gold's own contract specification and stop distance",
        "Holding full position size through a known high-impact release without a deliberate decision to accept that risk"],
      keyTakeaways: [
        "Recompute position size specifically for gold -- never reuse a currency-pair lot size",
        "Known high-impact events and low-liquidity windows (weekends, holidays) carry real gap and slippage risk a stop-loss does not fully protect against"],
      knowledgeCheck: [
        tf("xau-l11-kc1", "A stop-loss order guarantees you will be filled at exactly your stop price during a genuine price gap.", false, "A stop-loss triggers an exit but does not guarantee the fill price during a genuine gap -- execution can occur at a worse price when liquidity is thin."),
      ],
    },
    {
      id: "xau-l12-intraday-vs-swing",
      title: "Intraday vs. Swing Approaches to Gold",
      estimatedMinutes: 7,
      objectives: [
        "Compare intraday and swing time horizons on gold",
        "Explain how XauCloud's own M10 Engine and Market Outlook map to these horizons"],
      sections: [
        ["Intraday", "Intraday gold trading works within a single session's range, typically favoring the higher-liquidity London/New York window from Module 1, with tighter stops sized to shorter-term ATR and a focus on session-specific structure. This is the closer analogue to XauCloud's 10-Minute Engine, which evaluates near-term, execution-focused evidence continuously."],
        ["Swing", "Swing approaches hold across multiple sessions or days, sizing stops to a wider ATR window and weighting the macro drivers from Module 2 more heavily relative to any single session's noise. This is the closer analogue to XauCloud's hourly Market Outlook, which frames a longer advisory context rather than an immediate execution trigger."],
        ["They are complementary lenses, not competing predictions", "Recall from the Forex Foundations material on multi-timeframe context: a near-term intraday reading and a longer swing-level reading can validly disagree without either being 'wrong' -- they are answering different questions over different horizons. XauCloud deliberately keeps M10 execution-authoritative and the Outlook advisory-only rather than forcing them to always agree."],
      ],
      commonMistakes: [
        "Applying an intraday-sized stop to a swing-horizon thesis (or vice versa) and getting stopped out by normal noise",
        "Treating a disagreement between a short-term and longer-term reading as a system malfunction rather than two valid horizons"],
      keyTakeaways: [
        "Intraday gold trading favors tighter stops and session-specific structure; swing trading weights macro drivers and wider stops",
        "A near-term and longer-term reading can validly disagree -- they answer different-horizon questions, which is exactly how XauCloud's own M10 (execution) and Outlook (advisory) are designed to relate"],
    },
    {
      id: "xau-l13-multi-timeframe-gold",
      title: "Multi-Timeframe Analysis on Gold",
      estimatedMinutes: 6,
      objectives: [
        "Apply top-down multi-timeframe analysis specifically to XAUUSD",
        "Avoid the most common multi-timeframe mistake"],
      sections: [
        ["Top-down, not bottom-up", "Establish higher-timeframe context (daily/H4 trend and structure) before refining entries on a lower timeframe (M15/M10). Reading only the lowest timeframe in isolation is a common source of trading against the larger trend without realizing it."],
        ["Applying it to gold specifically", "Given gold's driver set (Module 2), a higher-timeframe view should also account for the current macro backdrop -- a daily structure reading taken the day before a major Fed decision carries different context than the same structure a week after one, even if the chart shape looks identical."],
        ["What XauCloud does with this for you", "The platform's own M10 Engine and hourly Outlook already encode a version of this top-down relationship server-side (near-term execution evidence vs. broader advisory context) -- this lesson is about you being able to read and sanity-check that relationship, not about replacing it with manual multi-timeframe charting."],
      ],
      commonMistakes: [
        "Reading only the lowest timeframe and missing that it is counter-trend against the higher-timeframe structure",
        "Treating a higher-timeframe read from before a major event as still current after that event has passed"],
      keyTakeaways: [
        "Establish higher-timeframe trend/structure first, then refine entries on a lower timeframe -- not the reverse",
        "For gold specifically, factor the current macro backdrop into how much weight a higher-timeframe read still deserves"],
    },
  ],
  quiz: {
    id: "xau-m3-quiz",
    title: "Module 3 Quiz: Trading Gold in Practice",
    passingScorePct: 70,
    questions: [
      q("xau-m3-q1", "single", "Why is comparing gold's raw point moves directly to a currency pair's pip moves misleading?", [
        { id: "a", text: "Gold doesn't have pips or points at all" },
        { id: "b", text: "Gold's larger absolute scale means point counts must be translated into real account risk, not compared raw" },
        { id: "c", text: "Currency pairs never move as much as gold under any circumstances" },
      ], ["b"], "Gold's larger absolute price scale means raw point comparisons are misleading -- always translate to actual account-currency risk using the correct contract specification."),
      tf("xau-m3-q2", "You should reuse the same position-size formula and lot size you use for a currency pair when trading XAUUSD.", false, "Position size must be recomputed specifically for gold, using gold's own contract specification and current ATR-based stop distance -- never reused from a currency pair calculation."),
      q("xau-m3-q3", "single", "Which XauCloud feature is the closer analogue to an intraday, execution-focused trading horizon?", [
        { id: "a", text: "The hourly Market Outlook" },
        { id: "b", text: "The 10-Minute Engine" },
        { id: "c", text: "The Academy certificate" },
      ], ["b"], "The 10-Minute Engine evaluates near-term, execution-focused evidence continuously, making it the closer analogue to an intraday trading horizon; the hourly Outlook is the swing-horizon, advisory analogue."),
      q("xau-m3-q4", "single", "In top-down multi-timeframe analysis, the correct order is:", [
        { id: "a", text: "Refine an entry on a low timeframe first, then check if it happens to agree with the higher timeframe" },
        { id: "b", text: "Establish higher-timeframe trend/structure first, then refine entries on a lower timeframe" },
        { id: "c", text: "Only ever look at one timeframe, since using more than one is always contradictory" },
      ], ["b"], "Top-down analysis establishes higher-timeframe context first, then uses a lower timeframe to refine entries within that context -- reversing the order is a common source of accidentally trading against the larger trend."),
    ],
  },
};

const xauModule4RiskAndSynthesis: Module = {
  id: "xau-m4-risk-and-synthesis",
  title: "Gold Risk Management & Synthesis",
  lessons: [
    {
      id: "xau-l14-position-sizing-example",
      title: "Worked Example: Position Sizing a Gold Trade",
      estimatedMinutes: 8,
      objectives: [
        "Walk through a complete, realistic gold position-sizing calculation",
        "Apply the ATR-based stop-distance check from Lesson 10"],
      sections: [
        ["The scenario", "A $5,000 account owner is willing to risk 1% ($50) on a trade. Their broker's XAUUSD contract specifies that a 0.01 lot (micro lot) moves approximately $0.01 per $0.01 price change in gold's quote (this ratio varies by broker -- always confirm your own broker's exact contract specification before using this pattern for real). Current 14-period ATR on their chosen timeframe reads $3.20, and structure supports placing a stop $4.00 beyond the entry."],
        ["Step 1 -- sanity-check the stop against ATR", "A $4.00 stop against a $3.20 ATR is roughly 1.25x ATR -- a reasonable, not unrealistically tight, distance for the current volatility regime (compare against Lesson 10's ATR-normalizer principle)."],
        ["Step 2 -- compute position size from risk, not from a preferred lot size", "Risk amount ÷ stop distance in price = size before contract conversion: $50 ÷ $4.00 = 12.5 'units' of $1-per-point exposure. The trader then converts that into their broker's actual lot increments using the contract specification (this step is broker-specific -- MT5's built-in margin/point-value calculator or the broker's own sizing tool should be used for the real conversion, never estimated by eye)."],
        ["Step 3 -- confirm the final numbers before submitting the order", "Multiply the resulting lot size back out against the $4.00 stop to confirm the actual dollar risk still equals approximately $50, not more -- broker rounding to the nearest allowed lot increment can shift the real risk slightly, and that final number is what should be checked against the account's 1% rule, not the original target."],
      ],
      commonMistakes: [
        "Choosing a lot size first (because it 'feels right') and only checking the resulting dollar risk afterward",
        "Skipping the ATR sanity-check on the stop distance and sizing a trade around an unrealistically tight or wide stop"],
      keyTakeaways: [
        "Always size FROM your risk amount and stop distance, not from a preferred lot size",
        "Confirm the final dollar risk after broker lot-increment rounding, not just the pre-rounding target"],
      knowledgeCheck: [
        tf("xau-l14-kc1", "The correct order for sizing a trade is to choose a lot size that feels right, then check what dollar risk it happens to produce.", false, "Sizing should start FROM the intended dollar risk and stop distance, converting into lot size afterward -- not the reverse."),
      ],
    },
    {
      id: "xau-l15-common-gold-mistakes",
      title: "Common Gold Trading Mistakes",
      estimatedMinutes: 6,
      objectives: [
        "Recognize the recurring mistakes specific to trading gold",
        "Connect each mistake back to the lesson that addresses it"],
      sections: [
        ["Chasing news spikes without a plan", "Entering immediately on a geopolitical or data-driven spike, without the durable-vs-fading distinction from Lesson 9 or the event-risk planning from Lesson 11, is one of the most common ways new gold traders take oversized, poorly timed risk."],
        ["Ignoring the USD/real-yield backdrop", "Trading gold purely off its own chart pattern while ignoring a simultaneous, contradicting move in the dollar or real yields (Module 2) means missing genuinely useful context that is available for free."],
        ["Treating every session as equal", "Placing the same stop distance and expecting the same follow-through at 2am in a thin Asia range as during the London/New York overlap (Lesson 4 and 10) leads to both mistimed entries and misjudged stop placement."],
        ["Reusing forex-pair risk math unchanged", "Lesson 11's core warning bears repeating as a standalone mistake pattern: never carry a position-size formula or fixed stop distance over from currency-pair trading without re-deriving it for gold's own scale and volatility."],
      ],
      commonMistakes: [
        "Reading this lesson and nodding along without going back to fix the specific habit it names",
      ],
      keyTakeaways: [
        "Most recurring gold trading mistakes trace back to skipping one of this course's earlier lessons under real-money pressure",
        "Reviewing this list periodically against your own trade journal (see the Backtesting/Journaling course) is more useful than reading it once"],
    },
    {
      id: "xau-l16-synthesis",
      title: "Putting It Together: A Gold Trading Checklist",
      estimatedMinutes: 6,
      objectives: [
        "Synthesize the course into a practical pre-trade checklist",
        "Understand how this checklist relates to XauCloud's own signal evidence"],
      sections: [
        ["The checklist", "Before acting on a gold setup: (1) What session is this, and does liquidity support the move (Module 1)? (2) What are USD, real yields, and risk sentiment currently doing, and does the setup agree or disagree with them (Module 2)? (3) Is the stop distance realistic against current ATR (Module 3)? (4) Is there known event risk in the next few hours I should size around or avoid (Module 3)? (5) Have I sized this from my risk amount, not a preferred lot size (Module 4)?"],
        ["How this relates to XauCloud's own engines", "XauCloud's Market Outlook and 10-Minute Engine already evaluate a version of several of these factors as part of their own evidence (freshness, structure, location, confirmation) -- this checklist is not a replacement for those engines, and does not change how they decide anything. It is a way for you to understand and sanity-check what you are looking at, and to apply the same discipline manually if you are also trading gold ideas outside of XauCloud's signals."],
        ["This is education, not a guarantee", "Working through this checklist does not guarantee a profitable outcome on any individual trade -- markets remain uncertain, and drawdown is a normal part of any real trading approach (see the Risk Management course). The goal is a more disciplined process, not a higher win rate promise."],
      ],
      commonMistakes: [
        "Treating this checklist as a strategy that guarantees profit rather than a discipline aid",
      ],
      keyTakeaways: [
        "A five-point session/macro/volatility/event/sizing checklist synthesizes this entire course into a practical pre-trade habit",
        "This checklist supports understanding XauCloud's own engines and disciplined manual analysis -- it does not replace either, and it does not guarantee outcomes"],
    },
  ],
};

export const XAUUSD_MASTERCLASS: Course = {
  id: "xauusd-masterclass",
  title: "Gold / XAUUSD Masterclass",
  level: "advanced",
  summary: "A focused, evidence-based course on what actually moves gold, how to read its sessions and volatility, and how to size and manage risk specifically for XAUUSD.",
  tags: ["gold", "xauusd", "advanced", "risk", "technical"],
  modules: [xauModule1Understanding, xauModule2WhatMovesGold, xauModule3TradingGold, xauModule4RiskAndSynthesis],
  finalAssessment: {
    id: "xauusd-masterclass-final",
    title: "Gold / XAUUSD Masterclass -- Final Assessment",
    passingScorePct: 75,
    questions: [
      q("xau-final-q1", "single", "A stronger US dollar typically has what effect on gold, all else equal?", [
        { id: "a", text: "No effect, since gold and USD are unrelated" },
        { id: "b", text: "A headwind, since gold is priced in dollars and becomes more expensive for non-dollar holders" },
        { id: "c", text: "Always a tailwind, since gold and USD always move together" },
      ], ["b"], "Gold is quoted in USD, so a stronger dollar raises its cost for holders of other currencies -- typically a headwind, though this can temporarily break down during acute risk-off events."),
      q("xau-final-q2", "single", "Falling or negative real yields are typically:", [
        { id: "a", text: "Irrelevant to gold" },
        { id: "b", text: "A headwind for gold" },
        { id: "c", text: "Supportive for gold, since holding non-yielding gold becomes relatively more attractive" },
      ], ["c"], "Falling or negative real yields lower the opportunity cost of holding non-yielding gold, which is typically supportive -- this can happen even when nominal rates are elevated, if inflation is rising faster."),
      tf("xau-final-q3", "Gold's inflation-hedge reputation is a reliable, consistent short-term day-to-day trading signal.", false, "It's a long-run structural idea, not a reliable short-term signal -- short-term gold price action is more directly driven by shifts in real yields, USD, and risk sentiment."),
      q("xau-final-q4", "single", "The London/New York session overlap is significant for gold trading primarily because:", [
        { id: "a", text: "It is when most brokers are closed" },
        { id: "b", text: "It combines London's deep physical gold market with major US data releases, typically producing the highest liquidity and volatility" },
        { id: "c", text: "Gold cannot be traded at any other time" },
      ], ["b"], "The overlap combines London's historic physical gold market depth with major scheduled US releases, typically making it the highest-liquidity, highest-volatility window."),
      q("xau-final-q5", "single", "Why should you recompute position size specifically for XAUUSD rather than reusing a forex-pair formula?", [
        { id: "a", text: "Gold has no contract specification" },
        { id: "b", text: "Gold's larger absolute price scale and different contract specification mean a reused formula misrepresents real risk" },
        { id: "c", text: "It doesn't matter -- lot sizing works identically across every instrument" },
      ], ["b"], "Gold's scale and contract specification differ from a currency pair's -- reusing an unadjusted formula can significantly misrepresent your actual dollar risk."),
      q("xau-final-q6", "multi", "Which of these are part of the course's pre-trade gold checklist? (Select all that apply)", [
        { id: "a", text: "Checking current session liquidity" },
        { id: "b", text: "Checking whether the setup agrees or disagrees with USD/real-yield/risk-sentiment context" },
        { id: "c", text: "Sizing the position from risk amount and stop distance, not a preferred lot size" },
        { id: "d", text: "Guaranteeing the trade will be profitable" },
      ], ["a", "b", "c"], "The checklist covers session context, macro-driver agreement, and risk-based sizing -- it explicitly does not and cannot guarantee any individual trade's outcome."),
      tf("xau-final-q7", "A stop-loss order guarantees your exact exit price during a genuine weekend gap or major news spike.", false, "A stop-loss triggers an exit but the actual fill can occur at a worse price during a genuine gap or extreme volatility -- execution is not guaranteed at the stop price."),
      q("xau-final-q8", "single", "XauCloud's 10-Minute Engine and hourly Market Outlook are best understood as:", [
        { id: "a", text: "Two systems that must always agree, or one of them is broken" },
        { id: "b", text: "Complementary lenses over different time horizons -- near-term execution evidence vs. broader advisory context" },
        { id: "c", text: "Unrelated features with no connection to each other" },
      ], ["b"], "M10 is execution-focused, near-term evidence; the Outlook is advisory, longer-horizon context -- they can validly disagree, the same way an intraday and swing reading can, without either being wrong."),
    ],
  },
  certificateEligible: true,
};

export const ACADEMY_COURSES: Course[] = [XAUUSD_MASTERCLASS];

export function findCourse(courseId: string): Course | undefined {
  return ACADEMY_COURSES.find((c) => c.id === courseId);
}

export function findLesson(courseId: string, lessonId: string): { course: Course; module: Module; lesson: Lesson } | undefined {
  const course = findCourse(courseId);
  if (!course) return undefined;
  for (const module of course.modules) {
    const lesson = module.lessons.find((l) => l.id === lessonId);
    if (lesson) return { course, module, lesson };
  }
  return undefined;
}

export function findQuiz(courseId: string, quizId: string): { course: Course; quiz: Quiz } | undefined {
  const course = findCourse(courseId);
  if (!course) return undefined;
  if (course.finalAssessment?.id === quizId) return { course, quiz: course.finalAssessment };
  for (const module of course.modules) {
    if (module.quiz?.id === quizId) return { course, quiz: module.quiz };
  }
  return undefined;
}

export function courseLessonIds(course: Course): string[] {
  return course.modules.flatMap((m) => m.lessons.map((l) => l.id));
}

export function courseQuizIds(course: Course): string[] {
  const moduleQuizzes = course.modules.map((m) => m.quiz?.id).filter((id): id is string => Boolean(id));
  return course.finalAssessment ? [...moduleQuizzes, course.finalAssessment.id] : moduleQuizzes;
}

/** Public/catalog view -- never includes correctOptionIds or explanation ahead of grading. */
export function publicQuizQuestion(question: QuizQuestion): Omit<QuizQuestion, "correctOptionIds" | "explanation"> {
  const { correctOptionIds: _c, explanation: _e, ...rest } = question;
  return rest;
}

export function publicCatalog(): Array<Omit<Course, "modules" | "finalAssessment"> & {
  modules: Array<Omit<Module, "quiz"> & { quiz?: Omit<Quiz, "questions"> & { questionCount: number } }>;
  finalAssessment?: Omit<Quiz, "questions"> & { questionCount: number };
}> {
  return ACADEMY_COURSES.map((course) => ({
    ...course,
    modules: course.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((l) => ({ ...l, knowledgeCheck: l.knowledgeCheck?.map(publicQuizQuestion) as QuizQuestion[] | undefined })),
      quiz: m.quiz ? { id: m.quiz.id, title: m.quiz.title, passingScorePct: m.quiz.passingScorePct, questionCount: m.quiz.questions.length } : undefined,
    })),
    finalAssessment: course.finalAssessment
      ? { id: course.finalAssessment.id, title: course.finalAssessment.title, passingScorePct: course.finalAssessment.passingScorePct, questionCount: course.finalAssessment.questions.length }
      : undefined,
  }));
}
