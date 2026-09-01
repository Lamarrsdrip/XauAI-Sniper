import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** Native on/off switch used by Bot Control and Prop Firm Protection's boolean settings. */
export const Toggle: React.FC<Props> = ({ value, onChange, disabled }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{
        width: 50,
        height: 29,
        borderRadius: 15,
        padding: 3,
        backgroundColor: value ? colors.brand : colors.disabledBg,
        opacity: disabled ? 0.5 : 1,
        justifyContent: 'center',
      }}
    >
      <View
        pointerEvents="none"
        style={{
          width: 23,
          height: 23,
          borderRadius: 12,
          backgroundColor: colors.card,
          transform: [{ translateX: value ? 21 : 0 }],
        }}
      />
    </Pressable>
  );
};
