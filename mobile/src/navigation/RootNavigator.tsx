import React, { useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { AuthNavigator } from './AuthNavigator';
import { MainTabs } from './MainTabs';
import { linking } from './linking';
import { registerForPushNotificationsAsync, routeForNotification } from '../services/push';

export const navigationRef = createNavigationContainerRef();

export const RootNavigator: React.FC = () => {
  const { colors, scheme } = useTheme();
  const { signedIn } = useAppState();

  useEffect(() => {
    if (!signedIn) return;
    registerForPushNotificationsAsync();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = routeForNotification(response.notification.request.content.data ?? {});
      if (target && navigationRef.isReady()) {
        (navigationRef as any).navigate(target.screen, target.params);
      }
    });
    return () => sub.remove();
  }, [signedIn]);

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.bg,
      card: colors.bgElevated,
      text: colors.textPrimary,
      border: colors.divider,
      primary: colors.brand,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={signedIn ? linking : undefined}>
      {signedIn ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
};
