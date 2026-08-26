import React, { useState } from 'react';
import { View, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { Screen, Text, Button, Input, Sheet } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { api } from '../../api/client';
import { USE_MOCK_DATA } from '../../api/config';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const { signIn, loading, error } = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const submitForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    setForgotSending(true);
    try {
      if (!USE_MOCK_DATA) await api.post('/cloud/auth/forgot-password', { email: forgotEmail.trim() });
      setForgotSent(true);
    } finally {
      setForgotSending(false);
    }
  };

  return (
    <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: spacing.lg }}>
        <View style={{ alignItems: 'center', marginBottom: spacing.md }}>
          <Image
            source={require('../../../assets/icon.png')}
            style={{ width: 64, height: 64, borderRadius: 16, marginBottom: spacing.sm }}
            resizeMode="contain"
          />
          <Text variant="h1">XauCloud</Text>
          <Text variant="body" color="secondary" style={{ marginTop: 2 }}>
            Sign in to your account
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <Input label="Password" secureToggle value={password} onChangeText={setPassword} placeholder="••••••••" />
          {error ? <Text variant="caption" color="sell">{error}</Text> : null}
          <Text
            variant="caption"
            color="info"
            style={{ alignSelf: 'flex-end' }}
            onPress={() => {
              setForgotEmail(email);
              setForgotSent(false);
              setForgotOpen(true);
            }}
          >
            Forgot password?
          </Text>
        </View>

        <Button label="Sign In" fullWidth loading={loading} onPress={() => signIn(email, password)} />

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
          <Text variant="body" color="secondary">Don't have an account?</Text>
          <Text variant="bodyMedium" color="brand" onPress={() => navigation.navigate('CreateAccount')}>
            Create one
          </Text>
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={forgotOpen} onClose={() => setForgotOpen(false)} title="Reset Password">
        <View style={{ gap: spacing.sm }}>
          {forgotSent ? (
            <Text variant="body" color="secondary">If an account exists for that email, a reset link has been sent.</Text>
          ) : (
            <>
              <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={forgotEmail} onChangeText={setForgotEmail} placeholder="you@example.com" />
              <Button label="Send Reset Link" fullWidth loading={forgotSending} onPress={submitForgotPassword} />
            </>
          )}
        </View>
      </Sheet>
    </Screen>
  );
};
