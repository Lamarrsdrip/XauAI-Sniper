import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Row, Header, Input, Button, Sheet } from '../../components';
import { Divider } from '../../components/Row';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemePreference } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { PERSONAS, Persona } from '../../state/mockData';
import { cloud } from '../../api/cloud';
import { api, ApiError } from '../../api/client';
import { USE_MOCK_DATA } from '../../api/config';
import { isBiometricAvailable, getBiometricEnabled, setBiometricEnabled, authenticateWithBiometrics } from '../../services/biometrics';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<MoreStackParamList, 'Settings'>;

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const PERSONA_OPTIONS: { key: Persona; label: string }[] = [
  { key: 'free', label: 'Free' },
  { key: 'subscriber', label: 'Subscriber' },
  { key: 'bot_owner', label: 'Bot Owner' },
];

export const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing, radius, preference, setPreference } = useTheme();
  const { persona, setPersona, signOut, user } = useAppState();
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [changePasswordSent, setChangePasswordSent] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
    getBiometricEnabled().then(setBioEnabled);
  }, []);

  const toggleBiometric = async () => {
    if (!bioAvailable) return;
    if (bioEnabled) {
      await setBiometricEnabled(false);
      setBioEnabled(false);
      return;
    }
    const ok = await authenticateWithBiometrics('Confirm to enable Face ID / Biometric sign-in');
    if (ok) {
      await setBiometricEnabled(true);
      setBioEnabled(true);
    }
  };

  const requestPasswordChange = async () => {
    if (!user?.email) return;
    if (!USE_MOCK_DATA) await api.post('/cloud/auth/forgot-password', { email: user.email }).catch(() => {});
    setChangePasswordSent(true);
  };

  const confirmDelete = async () => {
    if (!password) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (!USE_MOCK_DATA) await cloud.deleteAccount(password);
      setDeleteSheetOpen(false);
      await signOut();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not delete your account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen>
      <Header title="Settings" onBack={() => navigation.goBack()} />

      <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>APPEARANCE</Text>
      <Card padded={false} style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', padding: spacing.sm, gap: spacing.xs }}>
          {THEME_OPTIONS.map((opt) => {
            const active = preference === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setPreference(opt.key)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: active ? colors.brand : colors.cardBorder,
                  backgroundColor: active ? colors.brandMuted : 'transparent',
                  gap: 6,
                }}
              >
                <Ionicons name={opt.icon} size={18} color={active ? colors.brand : colors.textSecondary} />
                <Text variant="captionMedium" color={active ? 'brand' : 'secondary'}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>NOTIFICATIONS</Text>
      <Card padded={false} style={{ marginBottom: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Push Notifications" left={<Ionicons name="notifications-outline" size={19} color={colors.textSecondary} />} showChevron />
          <Divider inset />
          <Row title="Signal Alerts" left={<Ionicons name="flash-outline" size={19} color={colors.textSecondary} />} showChevron />
          <Divider inset />
          <Row title="Bot Alerts" left={<Ionicons name="hardware-chip-outline" size={19} color={colors.textSecondary} />} showChevron />
          <Divider inset />
          <Row title="Account & Security Alerts" left={<Ionicons name="shield-checkmark-outline" size={19} color={colors.textSecondary} />} showChevron />
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>SECURITY</Text>
      <Card padded={false} style={{ marginBottom: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row
            title="Face ID / Biometric Sign-in"
            subtitle={!bioAvailable ? 'Not available on this device' : undefined}
            left={<Ionicons name="finger-print-outline" size={19} color={colors.textSecondary} />}
            right={<Text variant="captionMedium" color={bioEnabled ? 'brand' : 'tertiary'}>{bioEnabled ? 'On' : 'Off'}</Text>}
            onPress={bioAvailable ? toggleBiometric : undefined}
          />
          <Divider inset />
          {changePasswordSent ? (
            <Row title="Reset link sent — check your email" left={<Ionicons name="mail-outline" size={19} color={colors.textSecondary} />} />
          ) : (
            <Row title="Change Password" subtitle="Sends a reset link to your email" left={<Ionicons name="key-outline" size={19} color={colors.textSecondary} />} showChevron onPress={requestPasswordChange} />
          )}
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>ACCOUNT</Text>
      <Card padded={false} style={{ marginBottom: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row
            title="Delete Account"
            destructive
            left={<Ionicons name="trash-outline" size={19} color={colors.sell} />}
            showChevron
            onPress={() => setDeleteSheetOpen(true)}
          />
        </View>
      </Card>

      <Sheet visible={deleteSheetOpen} onClose={() => setDeleteSheetOpen(false)} title="Delete Account">
        <View style={{ gap: spacing.sm }}>
          <Text variant="body" color="secondary">
            This permanently deletes your XauCloud account and cannot be undone. Enter your password to confirm.
          </Text>
          <Input label="Password" secureToggle value={password} onChangeText={setPassword} placeholder="••••••••" />
          {deleteError && <Text variant="caption" color="sell">{deleteError}</Text>}
          <Button label="Permanently Delete My Account" variant="destructive" fullWidth loading={deleting} onPress={confirmDelete} />
        </View>
      </Sheet>

      {__DEV__ && (
        <>
          <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>DEV PERSONA PREVIEW</Text>
          <Card>
            <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
              Switches entitlement persona for local development only. Stripped from EAS preview/production builds
              (__DEV__-gated) — never visible in TestFlight or the App/Play Store build.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {PERSONA_OPTIONS.map((opt) => {
                const active = persona === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setPersona(opt.key)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: spacing.xs,
                      borderRadius: radius.md,
                      backgroundColor: active ? colors.brand : colors.disabledBg,
                    }}
                  >
                    <Text variant="captionMedium" style={{ color: active ? colors.brandOn : colors.textSecondary }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
};
