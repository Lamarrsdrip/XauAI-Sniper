import React, { useState } from 'react';
import { View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Card, Text, Button } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { getToken } from '../../api/client';
import { API_BASE_URL, USE_MOCK_DATA } from '../../api/config';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  isComplete: boolean;
}

/**
 * The certificate PDF endpoints (GET /cloud/academy/certificate/download|view)
 * require Bearer auth, so a plain Linking.openURL can't reach them — this
 * fetches the PDF with the real auth header, writes it to the app's local
 * cache, then hands it to the native share sheet (which also offers "Save
 * to Files" / "Save to Photos" style targets on both platforms).
 */
export const CertificateCard: React.FC<Props> = ({ isComplete }) => {
  const { colors, spacing } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isComplete) return null;

  const saveCertificate = async () => {
    setSaving(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        setError('Certificate download requires the real backend (preview build only).');
        return;
      }
      const token = await getToken();
      const dest = new File(Paths.cache, 'xaucloud-academy-certificate.pdf');
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(`${API_BASE_URL}/cloud/academy/certificate/download`, dest, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'XauCloud Academy Certificate' });
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your certificate.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing.xl, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
        <Ionicons name="ribbon" size={24} color={colors.brand} />
      </View>
      <Text variant="h2" align="center">Certificate Earned</Text>
      <Text variant="caption" color="secondary" align="center" style={{ marginTop: 4, marginBottom: spacing.md }}>
        You completed the XauCloud Forex Academy curriculum.
      </Text>
      <Button label="View / Download Certificate" loading={saving} onPress={saveCertificate} />
      {error && <Text variant="caption" color="sell" style={{ marginTop: spacing.sm }}>{error}</Text>}
    </Card>
  );
};
