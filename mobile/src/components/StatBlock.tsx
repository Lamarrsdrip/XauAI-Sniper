import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Large hero numeric stat — used for equity, P/L, win rate. */
export const BigStat: React.FC<{ label: string; value: string; delta?: string; tone?: 'buy' | 'sell' | 'neutral' }> = ({
  label,
  value,
  delta,
  tone = 'neutral',
}) => {
  const { spacing } = useTheme();
  return (
    <View>
      <Text variant="caption" color="secondary">{label}</Text>
      <Text variant="numeric" style={{ marginTop: 2 }}>{value}</Text>
      {delta ? (
        <Text variant="captionMedium" color={tone === 'buy' ? 'buy' : tone === 'sell' ? 'sell' : 'secondary'} style={{ marginTop: 2 }}>
          {delta}
        </Text>
      ) : null}
    </View>
  );
};

/** Small stat used in grids — Win rate / Trades / PF etc. */
export const Stat: React.FC<{ label: string; value: string; tone?: 'buy' | 'sell' | 'neutral' }> = ({ label, value, tone = 'neutral' }) => (
  <View style={{ flex: 1 }}>
    <Text variant="caption" color="secondary">{label}</Text>
    <Text variant="numericSm" color={tone === 'buy' ? 'buy' : tone === 'sell' ? 'sell' : 'primary'} style={{ marginTop: 2 }}>
      {value}
    </Text>
  </View>
);
