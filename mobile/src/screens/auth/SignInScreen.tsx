import React, { useState } from 'react';
import { View, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { Screen, Text, Button, Input } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { signIn, loading, error } = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
          <Text variant="caption" color="info" style={{ alignSelf: 'flex-end' }}>
            Forgot password?
          </Text>
        </View>

        <Button label="Sign In" fullWidth loading={loading} onPress={() => signIn(email, password)} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
          <Text variant="caption" color="tertiary">or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
        </View>

        <Button
          label="Use Face ID / Biometrics"
          variant="secondary"
          fullWidth
          icon={<Ionicons name="finger-print-outline" size={17} color={colors.textPrimary} />}
          onPress={() => signIn(email || 'demo@xaucloud.io', password || 'demo')}
        />

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
          <Text variant="body" color="secondary">Don't have an account?</Text>
          <Text variant="bodyMedium" color="brand" onPress={() => navigation.navigate('CreateAccount')}>
            Create one
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
};
