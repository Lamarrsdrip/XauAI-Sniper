import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { HomeNavigator, TradingNavigator, ActivityNavigator, AcademyNavigator, MoreNavigator } from './stacks';

const Tab = createBottomTabNavigator();

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  HomeTab: 'home',
  TradingTab: 'trending-up',
  ActivityTab: 'bar-chart',
  LearnTab: 'school',
  MoreTab: 'ellipsis-horizontal',
};
const ICONS_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  HomeTab: 'home-outline',
  TradingTab: 'trending-up-outline',
  ActivityTab: 'bar-chart-outline',
  LearnTab: 'school-outline',
  MoreTab: 'ellipsis-horizontal-outline',
};
const LABELS: Record<string, string> = {
  HomeTab: 'Home',
  TradingTab: 'Trading',
  ActivityTab: 'Activity',
  LearnTab: 'Learn',
  MoreTab: 'More',
};

export const MainTabs: React.FC = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.tabBarBg, borderTopColor: colors.tabBarBorder },
        tabBarLabel: LABELS[route.name],
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={focused ? ICONS[route.name] : ICONS_OUTLINE[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeNavigator} />
      <Tab.Screen name="TradingTab" component={TradingNavigator} />
      <Tab.Screen name="ActivityTab" component={ActivityNavigator} />
      <Tab.Screen name="LearnTab" component={AcademyNavigator} />
      <Tab.Screen name="MoreTab" component={MoreNavigator} />
    </Tab.Navigator>
  );
};
