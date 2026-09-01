import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeProvider';
import { cloud } from '../api/cloud';
import { ApiError } from '../api/client';
import { BankTransferOrder, BankTransferStatusResponse } from '../api/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Starts a fresh order -- caller decides signal-plan vs bot-lifetime. */
  initiate: () => Promise<BankTransferOrder>;
  /** Called once the transfer is confirmed FULFILLED, so the caller can refresh entitlement/billing. */
  onFulfilled: () => void;
}

const POLL_MS = 5000;

/**
 * Nigeria Bank Transfer is XauCloud's owner-configured DEFAULT checkout
 * method (backend_node/src/services/paymentMethods.ts), not a fallback --
 * mobile only ever wired up Paystack, which silently left the primary
 * payment path unreachable from the app. This mirrors the full backend flow:
 * initiate -> show account details -> customer confirms they sent it
 * (+ optional proof photo) -> poll for admin confirmation.
 */
export const BankTransferSheet: React.FC<Props> = ({ visible, onClose, initiate, onFulfilled }) => {
  const { colors, spacing } = useTheme();
  const [order, setOrder] = useState<BankTransferOrder | null>(null);
  const [status, setStatus] = useState<BankTransferStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const start = async () => {
    setLoading(true); setError(null); setOrder(null); setStatus(null); setSubmitted(false);
    try {
      setOrder(await initiate());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start a bank transfer order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      void start();
    } else {
      stopPolling();
      setOrder(null); setStatus(null); setError(null); setCopied(false); setSubmitted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => () => stopPolling(), []);

  const pollOnce = async (reference: string) => {
    try {
      const s = await cloud.bankTransferStatus(reference);
      setStatus(s);
      if (s.status === 'FULFILLED' || s.status === 'BANK_TRANSFER_EXPIRED' || s.status === 'REJECTED') stopPolling();
      if (s.status === 'FULFILLED') onFulfilled();
    } catch {
      // A single failed poll shouldn't interrupt the wait -- next tick retries.
    }
  };

  const markSubmitted = async () => {
    if (!order) return;
    setSubmitting(true); setError(null);
    try {
      await cloud.submitBankTransfer(order.reference);
      setSubmitted(true);
      await pollOnce(order.reference);
      stopPolling();
      pollRef.current = setInterval(() => void pollOnce(order.reference), POLL_MS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm your transfer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const attachProof = async () => {
    if (!order) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError('Photo access is needed to attach proof of payment.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 });
    if (result.canceled || !result.assets[0]?.base64) return;
    setUploadingProof(true); setError(null);
    try {
      await cloud.uploadBankTransferProof(order.reference, `data:image/jpeg;base64,${result.assets[0].base64}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not upload proof. Please try again.');
    } finally {
      setUploadingProof(false);
    }
  };

  const copyAccount = async () => {
    if (!order) return;
    await Clipboard.setStringAsync(order.account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const effectiveStatus = status?.status ?? (submitted ? 'BANK_TRANSFER_SUBMITTED' : null);

  return (
    <Sheet visible={visible} onClose={onClose} title="Pay by Bank Transfer">
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
            <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>Setting up your transfer order…</Text>
          </View>
        ) : error && !order ? (
          <View style={{ paddingVertical: spacing.md }}>
            <Text variant="body" color="sell">{error}</Text>
            <Button label="Try again" fullWidth onPress={start} style={{ marginTop: spacing.md }} />
          </View>
        ) : order ? (
          <View>
            {effectiveStatus === 'FULFILLED' ? (
              <Card style={{ backgroundColor: colors.buyBg, borderColor: 'transparent' }}>
                <Text variant="h3" color="buy">Payment confirmed</Text>
                <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>Your access is now active. You're all set.</Text>
                <Button label="Done" fullWidth onPress={onClose} style={{ marginTop: spacing.md }} />
              </Card>
            ) : effectiveStatus === 'BANK_TRANSFER_EXPIRED' ? (
              <Card style={{ backgroundColor: colors.sellBg, borderColor: 'transparent' }}>
                <Text variant="h3" color="sell">This order expired</Text>
                <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>Start a new bank transfer order to continue.</Text>
                <Button label="Start a new order" fullWidth onPress={start} style={{ marginTop: spacing.md }} />
              </Card>
            ) : effectiveStatus === 'REJECTED' ? (
              <Card style={{ backgroundColor: colors.sellBg, borderColor: 'transparent' }}>
                <Text variant="h3" color="sell">Transfer could not be confirmed</Text>
                <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>{status?.rejection_reason || `Contact support: ${order.support_contact}`}</Text>
                <Button label="Start a new order" fullWidth onPress={start} style={{ marginTop: spacing.md }} />
              </Card>
            ) : (
              <>
                <Card>
                  <Text variant="micro" color="tertiary" style={{ letterSpacing: 1 }}>TRANSFER THIS AMOUNT</Text>
                  <Text variant="h1" style={{ marginTop: 4 }}>{order.amount_formatted}</Text>
                  <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
                    <Text variant="caption" color="secondary">Bank</Text>
                    <Text variant="bodyMedium">{order.bank_name}</Text>
                    <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>Account name</Text>
                    <Text variant="bodyMedium">{order.account_name}</Text>
                    <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>Account number</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="h3">{order.account_number}</Text>
                      <Button label={copied ? 'Copied' : 'Copy'} variant="secondary" size="sm" icon={<Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={colors.textPrimary} />} onPress={copyAccount} />
                    </View>
                  </View>
                  <Text variant="caption" color="tertiary" style={{ marginTop: spacing.md }}>Reference: {order.reference} · Complete within {order.timeout_minutes} minutes</Text>
                  {order.instructions ? <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>{order.instructions}</Text> : null}
                </Card>

                {submitted ? (
                  <Card style={{ marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <ActivityIndicator color={colors.brand} />
                      <Text variant="body" color="secondary" style={{ flex: 1 }}>Waiting for confirmation. This is verified by our team and is usually quick, but can take longer outside business hours.</Text>
                    </View>
                  </Card>
                ) : (
                  <Button label="I've sent the transfer" fullWidth loading={submitting} onPress={markSubmitted} style={{ marginTop: spacing.md }} />
                )}

                {order.proof_required || submitted ? (
                  <Button
                    label={status?.has_proof ? 'Proof attached — replace' : 'Attach proof of payment'}
                    variant="secondary"
                    fullWidth
                    loading={uploadingProof}
                    onPress={attachProof}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : null}

                {error ? <Text variant="caption" color="sell" style={{ marginTop: spacing.sm }}>{error}</Text> : null}
                <Text variant="caption" color="tertiary" style={{ marginTop: spacing.md }}>Need help? {order.support_contact}</Text>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
};
