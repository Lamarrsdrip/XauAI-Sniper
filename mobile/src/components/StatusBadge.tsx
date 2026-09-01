import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { BadgeTone } from './Badge';

interface Props {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
  /** Caps how wide the badge may grow before wrapping — pass when it sits next to other content in a row. Omit to let it use all available width (e.g. its own row). */
  maxWidth?: number | `${number}%`;
}

/**
 * Real bug this exists to fix: a plain pill Badge next to other fixed-width
 * content (see SignalsScreen's old header row) has no flex/shrink bounds, so
 * a long lifecycle string like "Second target hit · remainder stopped" was
 * measured at its full intrinsic width and rendered straight through the
 * card edge instead of wrapping.
 *
 * This component always takes flexShrink+minWidth:0 so it can be placed in a
 * row and still shrink, and it never clips: text splits on the label's own
 * " · " separator into a headline + substatus so long lifecycle text reads
 * as two short lines instead of one that must either overflow or shrink to
 * unreadable size.
 */
export const StatusBadge: React.FC<Props> = ({ label, tone = 'neutral', style, maxWidth }) => {
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
  const clean = (label ?? '').trim();
  const sepIndex = clean.indexOf(' · ');
  const headline = sepIndex === -1 ? clean : clean.slice(0, sepIndex);
  const sub = sepIndex === -1 ? '' : clean.slice(sepIndex + 3);

  return (
    <View
      style={[
        {
          flexShrink: 1,
          minWidth: 0,
          maxWidth,
          alignSelf: 'flex-start',
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
        },
        style,
      ]}
    >
      <Text variant="micro" numberOfLines={2} style={{ color: fg, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {headline}
      </Text>
      {sub ? (
        <Text variant="micro" numberOfLines={2} style={{ color: fg, opacity: 0.78, marginTop: 1, textTransform: 'none', letterSpacing: 0 }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
};
