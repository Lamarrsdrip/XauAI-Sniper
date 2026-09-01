import React from 'react';
import { View, ScrollView, RefreshControl, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
}

export const Screen: React.FC<Props> = ({
  children,
  scroll = true,
  edges = ['top', 'left', 'right'],
  padded = true,
  refreshing,
  onRefresh,
  contentStyle,
}) => {
  const { colors, spacing } = useTheme();
  const bg = { backgroundColor: colors.bg };

  if (!scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.flex, bg]}>
        <View style={[styles.flex, padded && { paddingHorizontal: spacing.md }, contentStyle]}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={[styles.flex, bg]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[padded && { paddingHorizontal: spacing.md }, { paddingBottom: spacing.xxxl }, contentStyle]}
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
