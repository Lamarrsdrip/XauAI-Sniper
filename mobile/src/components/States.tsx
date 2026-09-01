import React, { useEffect, useRef } from 'react';
import { View, Animated, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Button } from './Button';
import { Ionicons } from '@expo/vector-icons';

export const Skeleton: React.FC<{ width?: number | `${number}%`; height?: number; style?: ViewStyle }> = ({
  width = '100%',
  height = 14,
  style,
}) => {
  const { colors, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.skeleton, opacity }, style]}
    />
  );
};

interface StateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<StateProps> = ({ icon = 'file-tray-outline', title, message, actionLabel, onAction }) => {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg }}>
      <Ionicons name={icon} size={32} color={colors.textTertiary} />
      <Text variant="h3" align="center" style={{ marginTop: spacing.sm }}>
        {title}
      </Text>
      {message ? (
        <Text variant="caption" color="secondary" align="center" style={{ marginTop: 4 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
};

export const ErrorState: React.FC<StateProps> = (props) => (
  <EmptyState icon="alert-circle-outline" actionLabel={props.actionLabel ?? 'Try again'} {...props} />
);

export const OfflineState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <EmptyState
    icon="cloud-offline-outline"
    title="You're offline"
    message="Check your connection. Showing the last data we loaded."
    actionLabel={onRetry ? 'Retry' : undefined}
    onAction={onRetry}
  />
);

/** Bot-required feature, shown in place with a professional locked state instead of hiding the feature. */
export const LockedState: React.FC<{
  title: string;
  message: string;
  onUpgrade?: () => void;
  onLinkLicense?: () => void;
}> = ({ title, message, onUpgrade, onLinkLicense }) => {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.brandMuted,
        borderRadius: radius.lg,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.card,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.sm,
        }}
      >
        <Ionicons name="lock-closed" size={18} color={colors.brand} />
      </View>
      <Text variant="h3" align="center">{title}</Text>
      <Text variant="caption" color="secondary" align="center" style={{ marginTop: 4, marginBottom: spacing.md }}>
        {message}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {onUpgrade && <Button label="Get XauCloud Bot" onPress={onUpgrade} />}
        {onLinkLicense && <Button label="Link License" variant="secondary" onPress={onLinkLicense} />}
      </View>
    </View>
  );
};
