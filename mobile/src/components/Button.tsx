import React from 'react';
import { Pressable, ActivityIndicator, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'md' | 'sm';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const Button: React.FC<Props> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  fullWidth,
  icon,
  style,
}) => {
  const { colors, radius, spacing } = useTheme();

  const bgFor: Record<Variant, string> = {
    primary: colors.brand,
    secondary: colors.card,
    ghost: 'transparent',
    destructive: colors.sell,
  };
  const borderFor: Record<Variant, string | undefined> = {
    primary: undefined,
    secondary: colors.cardBorder,
    ghost: undefined,
    destructive: undefined,
  };
  const textColorFor: Record<Variant, string> = {
    primary: colors.brandOn,
    secondary: colors.textPrimary,
    ghost: colors.textPrimary,
    destructive: colors.textInverse,
  };

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bgFor[variant],
          borderWidth: borderFor[variant] ? 1 : 0,
          borderColor: borderFor[variant],
          borderRadius: radius.md,
          paddingVertical: size === 'md' ? spacing.sm + 2 : spacing.xs,
          paddingHorizontal: spacing.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.xxs,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColorFor[variant]} />
      ) : (
        <>
          {icon}
          <Text variant={size === 'md' ? 'bodyMedium' : 'captionMedium'} style={{ color: textColorFor[variant] }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
};
