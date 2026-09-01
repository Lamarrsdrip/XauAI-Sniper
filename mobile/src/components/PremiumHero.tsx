import React from 'react';
import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

type Tone = 'brand' | 'buy' | 'sell' | 'info' | 'graphite';

interface Props {
  children: React.ReactNode;
  tone?: Tone;
  style?: ViewStyle;
}

/** A restrained, high-contrast panel for the live decision surface. */
export const PremiumHero: React.FC<Props> = ({ children, tone = 'graphite', style }) => {
  const { colors, radius, scheme } = useTheme();
  const gradients: Record<Tone, readonly [string, string, string]> = {
    graphite: scheme === 'dark' ? ['#1E2733', '#111821', '#0B0D10'] : ['#243140', '#17212D', '#101820'],
    brand: scheme === 'dark' ? ['#4B3914', '#211A10', '#111418'] : ['#725415', '#3B2C0E', '#16140F'],
    buy: scheme === 'dark' ? ['#1C5138', '#102B20', '#111418'] : ['#197147', '#12422D', '#102018'],
    sell: scheme === 'dark' ? ['#59231F', '#301715', '#111418'] : ['#8E3029', '#4C1C18', '#211312'],
    info: scheme === 'dark' ? ['#1E4074', '#132234', '#111418'] : ['#285DAE', '#183B70', '#111B2D'],
  };

  return (
    <LinearGradient colors={gradients[tone]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius.xl, overflow: 'hidden', padding: 20 }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', width: 170, height: 170, borderRadius: 999, backgroundColor: colors.brand, opacity: 0.12, right: -48, top: -76 }} />
      {children}
    </LinearGradient>
  );
};
