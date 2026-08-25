import React, { useState } from 'react';
import { View, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { Screen, Text, Button, Input, Header } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';

type Props = NativeStackScreenProps<AuthStackParamList, 'CreateAccount'>;

export const CreateAccountScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing, colors } = useTheme();
  const { signUp, loading, error } = useAppState();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen scroll={false}>
      <Header title="Create Account" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ gap: spacing.sm }}>
          <Input label="Full name" value={name} onChangeText={setName} placeholder="Jordan Smith" />
          <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <Input label="Password" secureToggle value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
          {error ? <Text variant="caption" color="sell">{error}</Text> : null}
          <Text variant="caption" color="tertiary">
            By creating an account you agree to XauCloud's Terms and Privacy Policy.
          </Text>
        </View>
        <Button label="Create Account" fullWidth loading={loading} onPress={() => signUp(email, password, name)} />
      </KeyboardAvoidingView>
    </Screen>
  );
};
