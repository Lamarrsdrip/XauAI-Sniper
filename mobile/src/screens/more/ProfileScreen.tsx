import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button } from '../../components';
import { Divider } from '../../components/Row';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { getToken } from '../../api/client';
import { API_BASE_URL, USE_MOCK_DATA } from '../../api/config';
import { goBackOrNavigate } from '../../navigation/safeBack';

function memberSince(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '—';
}

type Props = NativeStackScreenProps<MoreStackParamList, 'Profile'>;

export const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { user, entitlement } = useAppState();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportData = async () => {
    setExporting(true);
    setExportError(null);
    try {
      if (USE_MOCK_DATA) {
        setExportError('Data export requires the real backend (preview build only).');
        return;
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/cloud/account/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Could not export your data right now.');
      const json = await res.text();
      const dest = new File(Paths.cache, 'xaucloud-account-data.json');
      if (dest.exists) dest.delete();
      dest.create();
      dest.write(json);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest.uri, { mimeType: 'application/json', dialogTitle: 'Your XauCloud Data' });
      }
    } catch (e: any) {
      setExportError(e?.message ?? 'Could not export your data.');
    } finally {
      setExporting(false);
    }
  };

  const planLabel = entitlement?.bot_license ? 'Bot Owner' : entitlement?.signals_access ? 'Subscriber' : 'Free';

  return (
    <Screen>
      <Header title="Account" onBack={() => goBackOrNavigate(navigation, 'More')} />

      <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
          <Text variant="h1" color="brand">{(user?.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}</Text>
        </View>
        <Text variant="h2">{user?.full_name || 'XauCloud User'}</Text>
        <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>{user?.email}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Badge label={planLabel} tone={entitlement?.bot_license ? 'buy' : entitlement?.signals_access ? 'brand' : 'neutral'} />
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>ACCOUNT DETAILS</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <Text variant="body" color="secondary">Email</Text>
            <Text variant="bodyMedium">{user?.email ?? '—'}</Text>
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <Text variant="body" color="secondary">Email verified</Text>
            <Badge label={user?.email_verified ? 'Verified' : 'Not verified'} tone={user?.email_verified ? 'buy' : 'warn'} />
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <Text variant="body" color="secondary">Country</Text>
            <Text variant="bodyMedium">{user?.country || '—'}</Text>
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <Text variant="body" color="secondary">Member since</Text>
            <Text variant="bodyMedium">{memberSince(user?.created_at)}</Text>
          </View>
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>YOUR DATA</Text>
      <Card>
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
          Download a copy of your account data, linked license, and login history.
        </Text>
        <Button label="Export My Data" variant="secondary" loading={exporting} onPress={exportData} />
        {exportError && <Text variant="caption" color="sell" style={{ marginTop: spacing.sm }}>{exportError}</Text>}
      </Card>
    </Screen>
  );
};
