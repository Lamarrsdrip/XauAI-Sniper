import { LinkingOptions } from '@react-navigation/native';

/**
 * Deep link map for xaucloud:// (custom scheme) and https://xaucloud.io/app/*
 * (universal/app links — requires the standard apple-app-site-association
 * and assetlinks.json to be published on xaucloud.io before iOS/Android will
 * honor the https form; the custom scheme works immediately with no server
 * config). Screen names mirror navigation/stacks.tsx exactly.
 */
export const linking: LinkingOptions<any> = {
  prefixes: ['xaucloud://', 'https://xaucloud.io/app'],
  config: {
    screens: {
      HomeTab: { screens: { Home: 'home' } },
      TradingTab: {
        screens: {
          TradingHome: 'trading',
          MarketOutlook: 'trading/outlook',
          TenMinuteEngine: 'trading/engine',
          Signals: 'trading/signals',
          SignalDetails: 'trading/signals/:id',
        },
      },
      ActivityTab: { screens: { Activity: 'activity' } },
      LearnTab: {
        screens: {
          Academy: 'academy',
          Lesson: 'academy/lesson/:id',
        },
      },
      MoreTab: {
        screens: {
          More: 'more',
          Notifications: 'notifications',
          Support: 'support',
          TicketThread: 'support/ticket/:id',
          Billing: 'billing',
          BotLicense: 'bot',
          Settings: 'settings',
        },
      },
    },
  },
};
