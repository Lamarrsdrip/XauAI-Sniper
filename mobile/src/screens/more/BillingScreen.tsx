import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button } from '../../components';
import { Divider } from '../../components/Row';
import { Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { BillingResponse } from '../../api/types';

type Props = NativeStackScreenProps<MoreStackParamList, 'Billing'>;

const mockBilling: BillingResponse = {
  entitlement: {
    signals_access: true, outlook_access: true, engine_10m_access: true, signal_notifications: true,
    bot_license: false, bot_operations: false, bot_activity: false, performance_access: false, automation_access: false,
    source: 'subscription', trial: null, subscription: { active: true },
  },
  payment_history: [
    { plan_id: 'SIGNALS_MONTHLY', created_at: new Date(Date.now() - 30 * 86400000).toISOString(), amount_kobo: 5_000_000, payment_status: 'SUCCESS', provider: 'PAYSTACK' },
    { plan_id: 'SIGNALS_MONTHLY', created_at: new Date(Date.now() - 60 * 86400000).toISOString(), amount_kobo: 5_000_000, payment_status: 'SUCCESS', provider: 'PAYSTACK' },
  ],
  plans: {
    trial: { plan_id: 'TRIAL', price_kobo: 0 },
    signals_weekly: { plan_id: 'SIGNALS_WEEKLY', price_kobo: 2_000_000 },
    signals_monthly: { plan_id: 'SIGNALS_MONTHLY', price_kobo: 5_000_000 },
    bot_lifetime: { plan_id: 'BOT_LIFETIME', price_kobo: 30_000_000 },
  },
};

function money(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`; // payment_transactions.amount_kobo is NGN kobo (÷100 = Naira) — matches /purchase/plans' currency: "NGN"
}

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Free Signal Trial',
  SIGNALS_WEEKLY: 'Signal Subscription — Weekly',
  SIGNALS_MONTHLY: 'Signal Subscription — Monthly',
  BOT_LIFETIME: 'XauCloud Bot — Lifetime',
};

export const BillingScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const { entitlement } = useAppState();
  const q = useCloudData(cloud.billing, mockBilling, []);

  const planLabel = entitlement?.bot_license ? 'XauCloud Bot — Lifetime' : entitlement?.signals_access ? 'Signal Subscription' : 'Free Account';

  return (
    <Screen>
      <Header title="Billing" onBack={() => navigation.goBack()} />

      <Card>
        <Text variant="caption" color="secondary">CURRENT PLAN</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <Text variant="h2">{planLabel}</Text>
          <Badge label={entitlement?.signals_access || entitlement?.bot_license ? 'Active' : 'Free'} tone={entitlement?.signals_access || entitlement?.bot_license ? 'buy' : 'neutral'} />
        </View>
        {entitlement?.trial && (
          <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
            Trial — {entitlement.trial.days_remaining} day{entitlement.trial.days_remaining === 1 ? '' : 's'} remaining
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          {!entitlement?.signals_access && <Button label="Get Signals" style={{ flex: 1 }} fullWidth />}
          {!entitlement?.bot_license && <Button label="Get XauCloud Bot" variant={entitlement?.signals_access ? 'primary' : 'secondary'} style={{ flex: 1 }} fullWidth />}
        </View>
      </Card>

      <Text variant="h3" color="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>PAYMENT HISTORY</Text>
      {q.loading && !q.data ? (
        <Skeleton height={100} />
      ) : q.error ? (
        <ErrorState title="Couldn't load billing" message={q.error} onAction={q.refetch} />
      ) : !q.data?.payment_history.length ? (
        <EmptyState icon="card-outline" title="No payments yet" />
      ) : (
        <Card padded={false}>
          <View style={{ paddingHorizontal: spacing.md }}>
            {q.data.payment_history.map((row, i, arr) => (
              <React.Fragment key={i}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
                  <View>
                    <Text variant="bodyMedium">{PLAN_LABELS[String(row.plan_id)] ?? String(row.plan_id ?? 'Payment')}</Text>
                    <Text variant="caption" color="tertiary">
                      {row.created_at ? new Date(String(row.created_at)).toLocaleDateString() : ''}
                      {row.payment_status && row.payment_status !== 'SUCCESS' ? ` · ${String(row.payment_status).toLowerCase()}` : ''}
                    </Text>
                  </View>
                  <Text variant="bodyMedium">{typeof row.amount_kobo === 'number' ? money(row.amount_kobo) : ''}</Text>
                </View>
                {i < arr.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
};
