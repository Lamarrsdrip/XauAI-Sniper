import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Deliberately dependency-free (plain Views, no react-native-svg/chart-kit)
 * so it never requires a new native module or a fresh dev-client build —
 * every other chart-like visual in this app already respects that
 * constraint (see ProgressBar), and adding a native charting dependency
 * here would be exactly the kind of change that silently breaks "just
 * reload the JS bundle" for everyone testing this build.
 */
export const Sparkline: React.FC<{ points: number[]; height?: number; positiveTone?: boolean }> = ({ points, height = 44, positiveTone }) => {
  const { colors } = useTheme();
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const trendingUp = positiveTone ?? points[points.length - 1] >= points[0];
  const tone = trendingUp ? colors.buy : colors.sell;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
      {points.map((value, index) => {
        const ratio = (value - min) / span;
        const barHeight = Math.max(2, ratio * height);
        return <View key={index} style={{ flex: 1, height: barHeight, borderRadius: 1.5, backgroundColor: tone, opacity: 0.35 + ratio * 0.65 }} />;
      })}
    </View>
  );
};
