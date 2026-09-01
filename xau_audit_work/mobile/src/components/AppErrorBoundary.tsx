import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

interface State { failed: boolean }

const RecoveryScreen: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg }}>
      <View style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandMuted }}>
        <Ionicons name="refresh-outline" size={27} color={colors.brand} />
      </View>
      <Text variant="h1" align="center" style={{ marginTop: spacing.lg }}>Let’s refresh XauCloud</Text>
      <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.sm, maxWidth: 300 }}>
        This screen ran into an unexpected issue. Your account and trading data have not been changed.
      </Text>
      <Button label="Try again" fullWidth style={{ marginTop: spacing.xl, maxWidth: 300, alignSelf: 'center' }} onPress={onRetry} />
    </View>
  );
};

/** Keeps an unexpected render failure customer-safe while preserving a retry path. */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    // This is intentionally limited to the device console until a sanctioned
    // crash-reporting provider is configured. Do not transmit customer data.
    console.error('XauCloud render recovery:', error.message);
  }

  render(): React.ReactNode {
    if (this.state.failed) return <RecoveryScreen onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
