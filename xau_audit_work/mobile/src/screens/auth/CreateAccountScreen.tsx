import React, { useState } from 'react';
import { View, KeyboardAvoidingView, Keyboard, Platform, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { Screen, Text, Button, Input, Header } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<AuthStackParamList, 'CreateAccount'>;

export const CreateAccountScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing, colors } = useTheme();
  const { signUp, loading, error } = useAppState();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']}>
      <Header title="Create Account" onBack={() => goBackOrNavigate(navigation, 'SignIn')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, gap: spacing.lg, justifyContent: 'center', paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: spacing.sm }}>
          <Input label="Full name" value={name} onChangeText={setName} placeholder="Jordan Smith" />
          <Input label="Email" autoCapitalize="none" autoComplete="email" textContentType="username" keyboardType="email-address" returnKeyType="next" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <Input label="Password" secureToggle autoComplete="new-password" textContentType="newPassword" returnKeyType="go" value={password} onChangeText={setPassword} onSubmitEditing={() => { Keyboard.dismiss(); void signUp(email, password, name).catch(() => {}); }} placeholder="At least 8 characters" />
          {error ? <Text variant="caption" color="sell">{error}</Text> : null}
          <Text variant="caption" color="tertiary">
            By creating an account you agree to XauCloud's Terms and Privacy Policy.
          </Text>
        </View>
        <Button label="Create Account" fullWidth loading={loading} onPress={() => { Keyboard.dismiss(); void signUp(email, password, name).catch(() => {}); }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
};
