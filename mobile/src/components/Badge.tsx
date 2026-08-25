import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type BadgeTone = 'buy' | 'sell' | 'info' | 'warn' | 'brand' | 'neutral';

interface Props {
  label: string;
  tone?: BadgeTone;
  dot?: boolean;
}

export const Badge: React.FC<Props> = ({ label, tone = 'neutral', dot }) => {
  const { colors, spacing, radius } = useTheme();

  const bgFg: Record<BadgeTone, { bg: string; fg: string }> = {
    buy: { bg: colors.buyBg, fg: colors.buy },
    sell: { bg: colors.sellBg, fg: colors.sell },
    info: { bg: colors.infoBg, fg: colors.info },
    warn: { bg: colors.warnBg, fg: colors.warn },
    brand: { bg: colors.brandMuted, fg: colors.brand },
    neutral: { bg: colors.disabledBg, fg: colors.textSecondary },
  };
  const { bg, fg } = bgFg[tone];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.xs,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />}
      <Text variant="micro" style={{ color: fg, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
};

/** Small colored status dot with no label, for inline use in rows. */
export const StatusDot: React.FC<{ tone: BadgeTone; size?: number }> = ({ tone, size = 8 }) => {
  const { colors } = useTheme();
  const fgFor: Record<BadgeTone, string> = {
    buy: colors.buy,
    sell: colors.sell,
    info: colors.info,
    warn: colors.warn,
    brand: colors.brand,
    neutral: colors.textTertiary,
  };
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fgFor[tone] }} />;
};
