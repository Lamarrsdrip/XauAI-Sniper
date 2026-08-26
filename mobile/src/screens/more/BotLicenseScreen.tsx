import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button, Input, Sheet } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { cloud } from '../../api/cloud';
import { ApiError } from '../../api/client';
import { USE_MOCK_DATA } from '../../api/config';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<MoreStackParamList, 'BotLicense'>;

export const BotLicenseScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { license, refreshEntitlement } = useAppState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = !!license?.linked;
  const lic = license?.license;
  const connected = linked && !!lic?.mt5_account && lic.mt5_account !== 'Not bound yet';

  const title = !linked ? 'No License' : connected ? 'Bot Connected' : 'Licensed — MT5 Not Connected';
  const body = !linked
    ? (license?.message ?? "You don't have a XauCloud Bot license yet.")
    : connected
    ? 'Your XauCloud Bot is licensed and connected to MT5.'
    : 'Your license is active. Connect MT5 to start automated trading.';
  const tone: 'buy' | 'warn' | 'neutral' = !linked ? 'neutral' : connected ? 'buy' : 'warn';

  const submitLink = async () => {
    if (!licenseKey.trim()) return;
    setLinking(true);
    setError(null);
    try {
      if (!USE_MOCK_DATA) await cloud.linkLicense(licenseKey.trim());
      setSheetOpen(false);
      setLicenseKey('');
      await refreshEntitlement();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not link that license key.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <Screen>
      <Header title="Bot / License" onBack={() => navigation.goBack()} />

      <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
          <Ionicons name="hardware-chip" size={26} color={colors.brand} />
        </View>
        <Text variant="h2">XauCloud Bot</Text>
        <View style={{ marginTop: spacing.xs }}>
          <Badge label={title} tone={tone} dot />
        </View>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.sm, maxWidth: 280 }}>
          {body}
        </Text>

        {lic?.mt5_account && lic.mt5_account !== 'Not bound yet' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}>
            <Ionicons name="link" size={14} color={colors.textSecondary} />
            <Text variant="caption" color="secondary">MT5 {lic.mt5_account}</Text>
          </View>
        )}
        {lic?.ea_version && (
          <Text variant="caption" color="tertiary" style={{ marginTop: 4 }}>EA v{lic.ea_version}</Text>
        )}

        <View style={{ marginTop: spacing.lg, gap: spacing.sm, width: '100%' }}>
          {linked && <Button label="Manage License" variant="secondary" fullWidth />}
          {!linked && <Button label="Get XauCloud Bot" fullWidth />}
          {!linked && <Button label="Already own it? Link License" variant="secondary" fullWidth onPress={() => setSheetOpen(true)} />}
        </View>
      </Card>

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
        <Text variant="captionMedium" color="brand">WHAT YOU GET</Text>
        <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
          Automated MT5 execution of XauCloud's Gold strategy, personal position tracking, and live performance
          analytics from your own trading account.
        </Text>
      </Card>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Link License">
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color="secondary">Enter the activation key from your XauCloud purchase.</Text>
          <Input value={licenseKey} onChangeText={setLicenseKey} placeholder="ASE-XXXX-XXXX" autoCapitalize="characters" />
          {error && <Text variant="caption" color="sell">{error}</Text>}
          <Button label="Link License" fullWidth loading={linking} onPress={submitLink} />
        </View>
      </Sheet>
    </Screen>
  );
};
