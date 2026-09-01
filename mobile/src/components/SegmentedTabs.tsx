import React from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

interface Props {
  options: string[];
  value: string;
  onChange: (val: string) => void;
}

export const SegmentedTabs: React.FC<Props> = ({ options, value, onChange }) => {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.disabledBg,
        borderRadius: radius.md,
        padding: 3,
      }}
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              flex: 1,
              paddingVertical: spacing.xs,
              borderRadius: radius.sm,
              alignItems: 'center',
              backgroundColor: active ? colors.card : 'transparent',
              ...(active ? ({ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 } as any) : {}),
            }}
          >
            <Text variant="captionMedium" color={active ? 'primary' : 'secondary'}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};
