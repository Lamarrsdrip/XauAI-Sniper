import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { AuthNavigator } from './AuthNavigator';
import { MainTabs } from './MainTabs';
import { linking } from './linking';
import { registerForPushNotificationsAsync, routeForNotification } from '../services/push';
import { LaunchExperience, Text, Button } from '../components';

const LaunchError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <Text variant="h3" align="center" style={{ marginBottom: spacing.sm }}>Can't reach XauCloud</Text>
      <Text variant="body" color="secondary" align="center" style={{ marginBottom: spacing.lg }}>{message}</Text>
      <Button label="Retry" onPress={onRetry} />
    </View>
  );
};

export const navigationRef = createNavigationContainerRef();

export const RootNavigator: React.FC = () => {
  const { colors, scheme } = useTheme();
  const { signedIn, bootstrapping, bootstrapError, retryBootstrap } = useAppState();
  const [launchComplete, setLaunchComplete] = useState(false);
  const finishLaunch = useCallback(() => setLaunchComplete(true), []);

  useEffect(() => {
    if (!signedIn) return;
    void registerForPushNotificationsAsync();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = routeForNotification(response.notification.request.content.data ?? {});
      if (target && navigationRef.isReady()) {
        (navigationRef as any).navigate(target.tab, { screen: target.screen, params: target.params });
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

  if (bootstrapping || !launchComplete) return <LaunchExperience ready={!bootstrapping} onComplete={finishLaunch} />;

  if (bootstrapError && !signedIn) return <LaunchError message={bootstrapError} onRetry={retryBootstrap} />;

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={signedIn ? linking : undefined}>
      {signedIn ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
};
