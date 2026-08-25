import React, { useState } from 'react';
import { TextInput, TextInputProps, View, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  secureToggle?: boolean;
}

export const Input: React.FC<Props> = ({ label, error, secureToggle, secureTextEntry, style, ...rest }) => {
  const { colors, spacing, radius } = useTheme();
  const [hidden, setHidden] = useState(!!secureTextEntry);

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="captionMedium" color="secondary">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.inputBg,
          borderWidth: 1,
          borderColor: error ? colors.sell : colors.inputBorder,
          borderRadius: radius.md,
          paddingHorizontal: spacing.sm,
        }}
      >
        <TextInput
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          style={[
            {
              flex: 1,
              paddingVertical: 12,
              fontSize: 15,
              color: colors.textPrimary,
            },
            style,
          ]}
          {...rest}
        />
        {secureToggle && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>
      {error ? <Text variant="caption" color="sell">{error}</Text> : null}
    </View>
  );
};
