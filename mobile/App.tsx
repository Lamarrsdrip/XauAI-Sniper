import React from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AppStateProvider } from './src/state/AppState';
import { RootNavigator } from './src/navigation/RootNavigator';

const StatusBarBridge: React.FC = () => {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
};

/** Web-preview-only phone frame — mirrors a device viewport so the design review build looks right in a desktop browser. No-op on native iOS/Android. */
const WebPreviewFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
      <View style={{ width: 380, height: 700, overflow: 'hidden', borderRadius: 24, borderWidth: 8, borderColor: '#111' }}>
        {children}
      </View>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppStateProvider>
          <StatusBarBridge />
          <WebPreviewFrame>
            <RootNavigator />
          </WebPreviewFrame>
        </AppStateProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
