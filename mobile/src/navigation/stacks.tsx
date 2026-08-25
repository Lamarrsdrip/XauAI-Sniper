import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeStackParamList, TradingStackParamList, ActivityStackParamList, AcademyStackParamList, MoreStackParamList } from './types';
import { HomeScreen } from '../screens/home/HomeScreen';
import { TradingHomeScreen } from '../screens/trading/TradingHomeScreen';
import { MarketOutlookScreen } from '../screens/trading/MarketOutlookScreen';
import { TenMinuteEngineScreen } from '../screens/trading/TenMinuteEngineScreen';
import { SignalsScreen } from '../screens/trading/SignalsScreen';
import { SignalDetailsScreen } from '../screens/trading/SignalDetailsScreen';
import { ActivityScreen } from '../screens/activity/ActivityScreen';
import { AcademyScreen } from '../screens/academy/AcademyScreen';
import { LessonScreen } from '../screens/academy/LessonScreen';
import { MoreScreen } from '../screens/more/MoreScreen';
import { NotificationsScreen } from '../screens/more/NotificationsScreen';
import { SupportScreen } from '../screens/more/SupportScreen';
import { TicketThreadScreen } from '../screens/more/TicketThreadScreen';
import { BillingScreen } from '../screens/more/BillingScreen';
import { BotLicenseScreen } from '../screens/more/BotLicenseScreen';
import { SettingsScreen } from '../screens/more/SettingsScreen';

const noHeader = { headerShown: false } as const;

const HomeStack = createNativeStackNavigator<HomeStackParamList>();
export const HomeNavigator: React.FC = () => (
  <HomeStack.Navigator screenOptions={noHeader}>
    <HomeStack.Screen name="Home" component={HomeScreen} />
  </HomeStack.Navigator>
);

const TradingStack = createNativeStackNavigator<TradingStackParamList>();
export const TradingNavigator: React.FC = () => (
  <TradingStack.Navigator screenOptions={noHeader}>
    <TradingStack.Screen name="TradingHome" component={TradingHomeScreen} />
    <TradingStack.Screen name="MarketOutlook" component={MarketOutlookScreen} />
    <TradingStack.Screen name="TenMinuteEngine" component={TenMinuteEngineScreen} />
    <TradingStack.Screen name="Signals" component={SignalsScreen} />
    <TradingStack.Screen name="SignalDetails" component={SignalDetailsScreen} />
  </TradingStack.Navigator>
);

const ActivityStack = createNativeStackNavigator<ActivityStackParamList>();
export const ActivityNavigator: React.FC = () => (
  <ActivityStack.Navigator screenOptions={noHeader}>
    <ActivityStack.Screen name="Activity" component={ActivityScreen} />
  </ActivityStack.Navigator>
);

const AcademyStack = createNativeStackNavigator<AcademyStackParamList>();
export const AcademyNavigator: React.FC = () => (
  <AcademyStack.Navigator screenOptions={noHeader}>
    <AcademyStack.Screen name="Academy" component={AcademyScreen} />
    <AcademyStack.Screen name="Lesson" component={LessonScreen} />
  </AcademyStack.Navigator>
);

const MoreStack = createNativeStackNavigator<MoreStackParamList>();
export const MoreNavigator: React.FC = () => (
  <MoreStack.Navigator screenOptions={noHeader}>
    <MoreStack.Screen name="More" component={MoreScreen} />
    <MoreStack.Screen name="Notifications" component={NotificationsScreen} />
    <MoreStack.Screen name="Support" component={SupportScreen} />
    <MoreStack.Screen name="TicketThread" component={TicketThreadScreen} />
    <MoreStack.Screen name="Billing" component={BillingScreen} />
    <MoreStack.Screen name="BotLicense" component={BotLicenseScreen} />
    <MoreStack.Screen name="Settings" component={SettingsScreen} />
  </MoreStack.Navigator>
);
