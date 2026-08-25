import React from 'react';
import { View, ViewStyle, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  padded?: boolean;
}

export const Card: React.FC<Props> = ({ children, style, onPress, padded = true }) => {
  const { colors, spacing, radius } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: padded ? spacing.md : 0,
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.7 }]}>
        {children}
      </Pressable>
    );
  }

  return <View style={[base, style]}>{children}</View>;
};

/** Section header used above grouped content — label only, no decoration. */
export const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
        marginTop: spacing.lg,
      }}
    >
      <Text variant="h3" color="secondary">{title}</Text>
      {action}
    </View>
  );
};
