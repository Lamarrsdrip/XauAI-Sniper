import React from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { typography } from '../theme/tokens';

type Variant = keyof typeof typography;
type ColorRole = 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'buy' | 'sell' | 'info' | 'warn' | 'brand';

interface Props extends TextProps {
  variant?: Variant;
  color?: ColorRole;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
}

export const Text: React.FC<Props> = ({ variant = 'body', color = 'primary', align, weight, style, ...rest }) => {
  const { colors } = useTheme();
  const colorMap: Record<ColorRole, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    inverse: colors.textInverse,
    buy: colors.buy,
    sell: colors.sell,
    info: colors.info,
    warn: colors.warn,
    brand: colors.brand,
  };
  return (
    <RNText
      style={[typography[variant], { color: colorMap[color] }, align ? { textAlign: align } : null, weight ? { fontWeight: weight } : null, style]}
      {...rest}
    />
  );
};
