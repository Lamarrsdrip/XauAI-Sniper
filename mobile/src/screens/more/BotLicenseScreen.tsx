import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button, Input, Sheet, Stat } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { cloud } from '../../api/cloud';
import { ApiError } from '../../api/client';
import { USE_MOCK_DATA } from '../../api/config';
import { Ionicons } from '@expo/vector-icons';
import { useCloudData } from '../../api/useCloudData';
import { mockMonitorStatus } from '../../state/mockData';
import { formatMoney } from '../../utils/format';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'BotLicense'>;

export const BotLicenseScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { license, entitlement, refreshEntitlement } = useAppState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = !!license?.linked;
  const lic = license?.license;
  const connected = linked && !!lic?.mt5_account && lic.mt5_account !== 'Not bound yet';
  const monitorQ = useCloudData(cloud.monitorStatus, mockMonitorStatus, [entitlement?.bot_activity, linked]);
  const monitor = monitorQ.data;
  const heartbeat = monitor?.heartbeat;
  const live = !!monitor && !monitor.offline && heartbeat?.mt5_connected !== false;
  const setupChecks = Array.isArray(monitor?.setup_checks) ? monitor.setup_checks : [];
  const passedSetupChecks = setupChecks.filter((check) => check.passed).length;
  const totalSetupChecks = setupChecks.length;

  const title = !linked ? 'No License' : live ? 'Bot Connected' : 'Licensed — MT5 Not Connected';
  const body = !linked
    ? (license?.message ?? "You don't have a XauCloud Bot license yet.")
    : live
    ? 'Your XauCloud Bot is licensed and reporting from MT5.'
    : 'Your license is active. Connect MT5 to start automated trading.';
  const tone: 'buy' | 'warn' | 'neutral' = !linked ? 'neutral' : live ? 'buy' : 'warn';

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
      <Header title="Bot / License" onBack={() => goBackOrNavigate(navigation, 'More')} />

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

        {(heartbeat?.account_number ?? lic?.mt5_account) && (heartbeat?.account_number ?? lic?.mt5_account) !== 'Not bound yet' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}>
            <Ionicons name="link" size={14} color={colors.textSecondary} />
            <Text variant="caption" color="secondary">MT5 {heartbeat?.account_number ?? lic?.mt5_account}</Text>
          </View>
        )}
        {(heartbeat?.ea_version ?? lic?.ea_version) && (
          <Text variant="caption" color="tertiary" style={{ marginTop: 4 }}>EA v{heartbeat?.ea_version ?? lic?.ea_version}</Text>
        )}

        {!linked && (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm, width: '100%' }}>
            <Button label="Get XauCloud Bot" fullWidth onPress={() => navigation.navigate('Billing')} />
            <Button label="Already own it? Link License" variant="secondary" fullWidth onPress={() => setSheetOpen(true)} />
            <Button label="Purchased with another email?" variant="ghost" fullWidth onPress={() => setSheetOpen(true)} />
          </View>
        )}
      </Card>

      {linked && monitor && (
        <Card style={{ marginTop: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text variant="caption" color="secondary">MT5 CONNECTION</Text>
              <Text variant="h3" style={{ marginTop: 3 }}>{live ? 'Live and monitoring' : 'Waiting for MT5'}</Text>
            </View>
            <Badge label={live ? 'LIVE' : 'OFFLINE'} tone={live ? 'buy' : 'warn'} dot />
          </View>
          <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
            <Stat label="Equity" value={formatMoney(heartbeat?.equity)} />
            <Stat label="Today" value={formatMoney(heartbeat?.daily_pnl, 2, true)} tone={heartbeat?.daily_pnl != null && Number(heartbeat.daily_pnl) < 0 ? 'sell' : 'buy'} />
            <Stat label="Open trades" value={`${heartbeat?.open_positions ?? monitor.open_trades ?? 0}`} />
          </View>
          <Text variant="caption" color="tertiary" style={{ marginTop: spacing.sm }}>
            {heartbeat?.broker_server ? `${heartbeat.broker_server} · ` : ''}{monitor.heartbeat_age_sec != null ? `last update ${monitor.heartbeat_age_sec}s ago` : 'Waiting for a fresh account update'}
          </Text>
          {totalSetupChecks > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
              <Ionicons name={passedSetupChecks === totalSetupChecks ? 'checkmark-circle' : 'information-circle'} size={15} color={passedSetupChecks === totalSetupChecks ? colors.buy : colors.warn} />
              <Text variant="caption" color="secondary">Setup health: {passedSetupChecks}/{totalSetupChecks} checks passed</Text>
            </View>
          )}
        </Card>
      )}

      <Card style={{ marginTop: spacing.md }}>
        <Text variant="captionMedium" color="brand">BOT MANAGEMENT</Text>
        <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
          {linked
            ? 'Review your live account, recover an existing purchase, or get help with your MT5 setup.'
            : 'Already own XauCloud Bot? Securely link the purchase to this XauCloud account.'}
        </Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {linked && (
            <Button
              label="View Live Account"
              fullWidth
              onPress={() => navigation.getParent()?.navigate('HomeTab' as never)}
              icon={<Ionicons name="pulse-outline" size={18} color={colors.brandOn} />}
            />
          )}
          <Button
            label="Link Existing License"
            variant={linked ? 'secondary' : 'primary'}
            fullWidth
            onPress={() => setSheetOpen(true)}
            icon={<Ionicons name="key-outline" size={18} color={linked ? colors.textPrimary : colors.brandOn} />}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label={linked && !live ? 'Reconnect MT5' : 'Setup help'}
              variant="ghost"
              style={{ flex: 1 }}
              fullWidth
              onPress={() => navigation.navigate('Support')}
            />
            <Button label="Billing" variant="ghost" style={{ flex: 1 }} fullWidth onPress={() => navigation.navigate('Billing')} />
          </View>
        </View>
      </Card>

      {linked && monitor?.alerts?.length ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.warnBg, borderColor: 'transparent' }}>
          <Text variant="captionMedium" color="warn">ACCOUNT ATTENTION</Text>
          {monitor.alerts.slice(0, 2).map((alert, index) => (
            <Text key={`${alert.title ?? 'alert'}-${index}`} variant="body" color="secondary" style={{ marginTop: spacing.xs }}>
              {alert.title ?? alert.message ?? 'Please review your bot connection.'}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
        <Text variant="captionMedium" color="brand">WHAT YOU GET</Text>
        <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
          Automated MT5 execution of XauCloud's Gold strategy, personal position tracking, and live performance
          analytics from your own trading account.
        </Text>
      </Card>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Link Existing License">
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color="secondary">Enter the activation key from your XauCloud purchase. XauCloud verifies it on the server before linking it to this account.</Text>
          <Input value={licenseKey} onChangeText={setLicenseKey} placeholder="ASE-XXXX-XXXX" autoCapitalize="characters" />
          {error && <Text variant="caption" color="sell">{error}</Text>}
          <Button label="Link License" fullWidth loading={linking} onPress={submitLink} />
          <Button label="I purchased with another email" variant="ghost" fullWidth onPress={() => { setSheetOpen(false); navigation.navigate('Support'); }} />
          <Text variant="caption" color="tertiary" align="center">For a different purchase email or a conflict, Support verifies ownership. The app never transfers a license itself.</Text>
        </View>
      </Sheet>
    </Screen>
  );
};
