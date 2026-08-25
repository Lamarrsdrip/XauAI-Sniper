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
  Lesson: { id: string; title: string };
};

export type MoreStackParamList = {
  More: undefined;
  Notifications: undefined;
  Support: undefined;
  TicketThread: { id: string; subject: string };
  Billing: undefined;
  BotLicense: undefined;
  Settings: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
};
