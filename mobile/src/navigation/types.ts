export type AuthStackParamList = {
  SignIn: undefined;
  CreateAccount: undefined;
};

export type TradingStackParamList = {
  TradingHome: undefined;
  MarketOutlook: undefined;
  TenMinuteEngine: undefined;
  Signals: undefined;
  SignalDetails: { id: string };
};

export type ActivityStackParamList = {
  Activity: undefined;
};

export type AcademyStackParamList = {
  Academy: undefined;
  Course: { courseId: string };
  Lesson: { courseId: string; lessonId: string };
  Quiz: { courseId: string; quizId: string };
};

export type MoreStackParamList = {
  More: undefined;
  Profile: undefined;
  Notifications: undefined;
  Support: undefined;
  TicketThread: { id: string; subject: string };
  Billing: undefined;
  BotLicense: undefined;
  BotControl: undefined;
  AIBrain: undefined;
  PatternScanner: undefined;
  FAQ: undefined;
  Settings: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  PositionDetails: undefined;
};
