import React from 'react';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
}

export const Header: React.FC<Props> = ({ title, onBack, right, large }) => {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: Math.max(insets.top, spacing.sm),
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.bg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 }}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
        )}
        {title ? (
          <Text variant={large ? 'h1' : 'h2'} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
};
