import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Card, Text, Button, Input } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { getToken } from '../../api/client';
import { API_BASE_URL, USE_MOCK_DATA } from '../../api/config';
import { Ionicons } from '@expo/vector-icons';

interface CertStatus {
  eligible: boolean;
  issued: boolean;
  needs_name: boolean;
  certificate?: { certificate_id: string; recipient_name: string };
}

interface Props {
  title: string;
  incompleteMessage: string;
  downloadPath: string;
  fileName: string;
  fetchStatus: () => Promise<CertStatus>;
  confirmName: (name: string) => Promise<{ certificate: { certificate_id: string; recipient_name: string } }>;
  /** Bumping this re-checks eligibility (e.g. after the parent refetches progress). */
  refreshKey?: unknown;
}

/**
 * Generic "earn + view/download a certificate" panel shared by the original
 * v1 Foundations certificate and every per-course certificate -- same flow,
 * same server-authoritative eligibility, just pointed at different
 * endpoints so mobile never invents a second certificate system.
 */
export const CertificatePanel: React.FC<Props> = ({ title, incompleteMessage, downloadPath, fileName, fetchStatus, confirmName, refreshKey }) => {
  const { colors, spacing } = useTheme();
  const [status, setStatus] = useState<CertStatus | null>(null);
  const [name, setName] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (USE_MOCK_DATA) return;
    try {
      setStatus(await fetchStatus());
    } catch {
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const issue = async () => {
    setIssuing(true);
    setError(null);
    try {
      const { certificate } = await confirmName(name.trim());
      setStatus({ eligible: true, issued: true, needs_name: false, certificate });
    } catch (e: any) {
      setError(e?.message ?? 'Could not issue certificate.');
    } finally {
      setIssuing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        setError('Certificate download requires the real backend (preview build only).');
        return;
      }
      const token = await getToken();
      const dest = new File(Paths.cache, fileName);
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(`${API_BASE_URL}${downloadPath}`, dest, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title });
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your certificate.');
    } finally {
      setSaving(false);
    }
  };

  if (!status || (!status.eligible && !status.issued)) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.disabledBg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ribbon-outline" size={18} color={colors.textTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" color="secondary">{title}</Text>
          <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{incompleteMessage}</Text>
        </View>
      </Card>
    );
  }

  if (status.issued && status.certificate) {
    return (
      <Card style={{ backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Ionicons name="ribbon" size={18} color={colors.brand} />
          <Text variant="bodyMedium">{title} earned ✓</Text>
        </View>
        <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
          {status.certificate.recipient_name} · {status.certificate.certificate_id}
        </Text>
        <Button label="View / Download Certificate" loading={saving} onPress={save} style={{ marginTop: spacing.sm }} />
        {error && <Text variant="caption" color="sell" style={{ marginTop: spacing.xs }}>{error}</Text>}
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="trophy" size={18} color={colors.brand} />
        <Text variant="bodyMedium">{title} — one step left</Text>
      </View>
      <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
        Enter the name to appear on your certificate. This becomes permanent once issued.
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        <Input placeholder="Full name for certificate" value={name} onChangeText={setName} />
        <Button label={issuing ? 'Issuing…' : 'Get Certificate'} loading={issuing} disabled={name.trim().length < 2} onPress={issue} />
      </View>
      {error && <Text variant="caption" color="sell" style={{ marginTop: spacing.xs }}>{error}</Text>}
    </Card>
  );
};
