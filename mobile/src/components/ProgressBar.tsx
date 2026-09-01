import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const ProgressBar: React.FC<{ pct: number; height?: number }> = ({ pct, height = 6 }) => {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: colors.disabledBg, overflow: 'hidden' }}>
      <View style={{ height, borderRadius: height / 2, width: `${clamped}%`, backgroundColor: colors.brand }} />
    </View>
  );
};
