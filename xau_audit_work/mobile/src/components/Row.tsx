import React from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
}

/** A single tappable list row — used across Signals, Notifications, Settings, Support tickets. */
export const Row: React.FC<Props> = ({ title, subtitle, left, right, onPress, showChevron, destructive }) => {
  const { colors, spacing } = useTheme();

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm + 2,
        gap: spacing.sm,
      }}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" color={destructive ? 'sell' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
        {content}
      </Pressable>
    );
  }
  return content;
};

export const Divider: React.FC<{ inset?: boolean }> = ({ inset }) => {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.divider,
        marginLeft: inset ? spacing.md + 32 : 0,
      }}
    />
  );
};
