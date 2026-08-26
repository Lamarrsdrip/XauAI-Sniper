import React, { useEffect } from 'react';
import { View, ActivityIndicator, Image } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { AuthNavigator } from './AuthNavigator';
import { MainTabs } from './MainTabs';
import { linking } from './linking';
import { registerForPushNotificationsAsync, routeForNotification } from '../services/push';

export const navigationRef = createNavigationContainerRef();

const BootstrapSplash: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Image source={require('../../assets/icon.png')} style={{ width: 64, height: 64, borderRadius: 16 }} resizeMode="contain" />
      <ActivityIndicator color={colors.brand} />
    </View>
  );
};

export const RootNavigator: React.FC = () => {
  const { colors, scheme } = useTheme();
  const { signedIn, bootstrapping } = useAppState();

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

  if (bootstrapping) return <BootstrapSplash />;

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={signedIn ? linking : undefined}>
      {signedIn ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
};
