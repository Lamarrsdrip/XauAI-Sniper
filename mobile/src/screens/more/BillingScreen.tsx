import React, { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button, Sheet, BankTransferSheet } from '../../components';
import { Divider } from '../../components/Row';
import { Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { BillingResponse, PaymentMethodsResponse } from '../../api/types';
import { goBackOrNavigate } from '../../navigation/safeBack';
import { asFiniteNumber } from '../../utils/format';
import { ApiError } from '../../api/client';

type Props = NativeStackScreenProps<MoreStackParamList, 'Billing'>;
type PlanId = 'SIGNALS_WEEKLY' | 'SIGNALS_MONTHLY' | 'BOT_LIFETIME';

const mockBilling: BillingResponse = {
  entitlement: { signals_access: true, outlook_access: true, engine_10m_access: true, signal_notifications: true, bot_license: false, bot_operations: false, bot_activity: false, performance_access: false, automation_access: false, source: 'subscription', trial: null, subscription: { active: true } },
  payment_history: [],
  plans: { trial: { plan_id: 'TRIAL', price_kobo: 0 }, signals_weekly: { plan_id: 'SIGNALS_WEEKLY', price_kobo: 2_000_000 }, signals_monthly: { plan_id: 'SIGNALS_MONTHLY', price_kobo: 5_000_000 }, bot_lifetime: { plan_id: 'BOT_LIFETIME', price_kobo: 30_000_000 } },
};
const mockPaymentMethods: PaymentMethodsResponse = {
  methods: [
    { method: 'bank_transfer', label: 'Nigeria Bank Transfer', description: 'Transfer to our Nigerian bank account.', instant: false, available: true },
    { method: 'paystack', label: 'Pay with Paystack', description: 'Card and supported Paystack payment methods.', instant: true, available: true },
  ],
  default_method: 'bank_transfer',
  detected_country: 'NG',
};

const PLAN_LABELS: Record<string, string> = { TRIAL: 'Free Signal Trial', SIGNALS_WEEKLY: 'Weekly Signals', SIGNALS_MONTHLY: 'Monthly Signals', BOT_LIFETIME: 'XauCloud Bot' };
const PAYMENT_STATUS_COPY: Record<string, string> = { SUCCESS: 'Paid', PAID: 'Paid', PENDING: 'Payment pending', BANK_TRANSFER_PENDING: 'Bank transfer awaiting confirmation', BANK_TRANSFER_SUBMITTED: 'Transfer proof received', UNDER_ADMIN_REVIEW: 'Payment under review', FAILED: 'Payment failed', CANCELLED: 'Payment cancelled', REFUNDED: 'Refunded' };

function money(kobo: unknown): string { const value = asFiniteNumber(kobo); return value == null ? '—' : `₦${(value / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`; }
function paymentStatusLabel(value: unknown): string { return typeof value === 'string' ? PAYMENT_STATUS_COPY[value.trim().toUpperCase()] ?? 'Payment update' : 'Payment update'; }
function paymentDate(value: unknown): string { return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString() : 'Date unavailable'; }

const PlanCard: React.FC<{
  title: string; price: string; period: string; detail: string; cta: string; tone?: 'primary' | 'secondary'; busy: boolean; onPress: () => void;
  secondaryCta?: string; onSecondaryPress?: () => void; secondaryBusy?: boolean;
}> = ({ title, price, period, detail, cta, tone = 'secondary', busy, onPress, secondaryCta, onSecondaryPress, secondaryBusy }) => {
  const { spacing } = useTheme();
  return <Card style={{ marginTop: spacing.sm }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
      <View style={{ flex: 1 }}><Text variant="h3">{title}</Text><Text variant="caption" color="secondary" style={{ marginTop: 4 }}>{detail}</Text></View>
      <View style={{ alignItems: 'flex-end' }}><Text variant="numericSm">{price}</Text><Text variant="caption" color="tertiary">{period}</Text></View>
    </View>
    <Button label={cta} variant={tone} fullWidth loading={busy} onPress={onPress} style={{ marginTop: spacing.md }} />
    {secondaryCta && onSecondaryPress ? <Button label={secondaryCta} variant="ghost" fullWidth loading={secondaryBusy} onPress={onSecondaryPress} style={{ marginTop: spacing.xs }} /> : null}
  </Card>;
};

export const BillingScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement, refreshEntitlement, user } = useAppState();
  const q = useCloudData(cloud.billing, mockBilling, []);
  const methodsQ = useCloudData(cloud.paymentMethods, mockPaymentMethods, []);
  const [startingTrial, setStartingTrial] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [btOpen, setBtOpen] = useState(false);
  const [btPlan, setBtPlan] = useState<PlanId | null>(null);
  const methods = methodsQ.data?.methods ?? mockPaymentMethods.methods;
  const bankTransferAvailable = methods.find((m) => m.method === 'bank_transfer')?.available ?? false;
  const paystackAvailable = methods.find((m) => m.method === 'paystack')?.available ?? false;
  const paymentHistory = Array.isArray(q.data?.payment_history) ? q.data.payment_history : [];
  const plans = q.data?.plans ?? mockBilling.plans;
  const active = Boolean(entitlement?.signals_access || entitlement?.bot_license);

  const refreshBilling = async () => { await Promise.all([refreshEntitlement(), Promise.resolve(q.refetch())]); };
  const startTrial = async () => {
    setStartingTrial(true); setMessage(null); setMessageIsError(false);
    try { await cloud.startSignalsTrial(); await refreshBilling(); setMessage('Your free signal trial is active.'); }
    catch (e) { setMessageIsError(true); setMessage(e instanceof ApiError ? e.message : 'Your trial could not be started right now. Please try again.'); }
    finally { setStartingTrial(false); }
  };
  const startCheckout = async (plan: PlanId) => {
    if (checkoutPlan) return;
    setCheckoutPlan(plan); setMessage(null); setMessageIsError(false);
    try {
      const checkout = plan === 'BOT_LIFETIME'
        ? await cloud.startBotCheckout(user?.full_name?.trim() || 'XauCloud customer', user?.email ?? '')
        : await cloud.startSignalCheckout(plan);
      await WebBrowser.openBrowserAsync(checkout.authorization_url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN });
      await refreshBilling();
      setMessage('We refreshed your access. If payment is still pending, confirmation can take a short moment.');
    } catch (e) {
      // Real bug: this always showed the same generic string regardless of
      // WHY checkout failed, even after api/client.ts started surfacing a
      // real, already-safe backend reason (e.g. "Payment system not
      // configured yet.") -- silently discarding it a second time here. Also
      // rendered in the same neutral gray as a success message, easy to miss
      // entirely -- now flagged as an error so it actually reads as one.
      setMessageIsError(true);
      setMessage(e instanceof ApiError ? e.message : 'Secure checkout could not be started. Please check your connection and try again.');
    }
    finally { setCheckoutPlan(null); }
  };
  const openBankTransfer = (plan: PlanId) => { setBtPlan(plan); setBtOpen(true); };
  const initiateBankTransfer = () => {
    if (!btPlan) return Promise.reject(new Error('No plan selected'));
    return btPlan === 'BOT_LIFETIME'
      ? cloud.startBotBankTransfer(user?.full_name?.trim() || 'XauCloud customer', user?.email ?? '')
      : cloud.startSignalBankTransfer(btPlan);
  };
  const planLabel = entitlement?.bot_license ? 'XauCloud Bot + Signals' : entitlement?.signals_access ? 'Signal Subscription' : 'Free Account';

  return <Screen onRefresh={refreshBilling} refreshing={q.loading}>
    <Header title="Billing & plans" onBack={() => goBackOrNavigate(navigation, 'More')} />
    <Card>
      <Text variant="caption" color="secondary">CURRENT ACCESS</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}><Text variant="h2">{planLabel}</Text><Badge label={active ? 'Active' : 'Free'} tone={active ? 'buy' : 'neutral'} /></View>
      {entitlement?.trial ? <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>Trial · {entitlement.trial.days_remaining} day{entitlement.trial.days_remaining === 1 ? '' : 's'} remaining</Text> : null}
      {!entitlement?.signals_access && <Button label="Start free signal trial" fullWidth loading={startingTrial} onPress={startTrial} style={{ marginTop: spacing.md }} />}
      <Button label="Refresh access" variant="ghost" fullWidth onPress={refreshBilling} style={{ marginTop: spacing.xs }} />
    </Card>

    <Text variant="h3" color="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>AVAILABLE PLANS</Text>
    <PlanCard
      title="Weekly Signals" price={money(plans.signals_weekly?.price_kobo)} period="per week" detail="Market Outlook, M10 engine, signals and notifications."
      cta={entitlement?.signals_access ? 'Renew weekly' : 'Subscribe weekly'}
      busy={checkoutPlan === 'SIGNALS_WEEKLY'}
      onPress={() => bankTransferAvailable ? openBankTransfer('SIGNALS_WEEKLY') : startCheckout('SIGNALS_WEEKLY')}
      secondaryCta={bankTransferAvailable && paystackAvailable ? 'Pay with card instead' : undefined}
      onSecondaryPress={bankTransferAvailable && paystackAvailable ? () => startCheckout('SIGNALS_WEEKLY') : undefined}
      secondaryBusy={checkoutPlan === 'SIGNALS_WEEKLY'}
    />
    <PlanCard
      title="Monthly Signals" price={money(plans.signals_monthly?.price_kobo)} period="per month" detail="The complete signal experience. No automated MT5 execution." tone="primary"
      cta={entitlement?.signals_access ? 'Renew monthly' : 'Subscribe monthly'}
      busy={checkoutPlan === 'SIGNALS_MONTHLY'}
      onPress={() => bankTransferAvailable ? openBankTransfer('SIGNALS_MONTHLY') : startCheckout('SIGNALS_MONTHLY')}
      secondaryCta={bankTransferAvailable && paystackAvailable ? 'Pay with card instead' : undefined}
      onSecondaryPress={bankTransferAvailable && paystackAvailable ? () => startCheckout('SIGNALS_MONTHLY') : undefined}
      secondaryBusy={checkoutPlan === 'SIGNALS_MONTHLY'}
    />
    {!entitlement?.bot_license && <PlanCard
      title="XauCloud Bot" price={money(plans.bot_lifetime?.price_kobo)} period="one-time" detail="Lifetime MT5 automation license, live account monitoring and performance analytics." tone="primary"
      cta="Get XauCloud Bot"
      busy={checkoutPlan === 'BOT_LIFETIME'}
      onPress={() => bankTransferAvailable ? openBankTransfer('BOT_LIFETIME') : startCheckout('BOT_LIFETIME')}
      secondaryCta={bankTransferAvailable && paystackAvailable ? 'Pay with card instead' : undefined}
      onSecondaryPress={bankTransferAvailable && paystackAvailable ? () => startCheckout('BOT_LIFETIME') : undefined}
      secondaryBusy={checkoutPlan === 'BOT_LIFETIME'}
    />}
    <Button label="Link existing license" variant="secondary" fullWidth onPress={() => navigation.navigate('BotLicense')} style={{ marginTop: spacing.md }} />
    <Text variant="caption" color="tertiary" style={{ marginTop: spacing.sm }}>Secure checkout is created by XauCloud’s server with the live price; the app never creates access locally or handles card details.</Text>
    <Text variant="caption" color="tertiary" style={{ marginTop: spacing.xs }}>For an App Store release, these digital purchase products must be connected to approved native store billing before submission.</Text>
    {message ? <Card style={messageIsError ? { marginTop: spacing.md, backgroundColor: colors.sellBg, borderColor: 'transparent' } : { marginTop: spacing.md }}><Text variant="caption" color={messageIsError ? 'sell' : 'secondary'}>{message}</Text></Card> : null}

    <Text variant="h3" color="secondary" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>PAYMENT HISTORY</Text>
    {q.loading && !q.data ? <Skeleton height={100} /> : q.error ? <ErrorState title="Couldn't load billing" message={q.error} onAction={q.refetch} /> : !paymentHistory.length ? <EmptyState icon="card-outline" title="No payments yet" message="Completed and pending payments will appear here." /> : <Card padded={false}><View style={{ paddingHorizontal: spacing.md }}>{paymentHistory.map((row, index) => <React.Fragment key={String(row.reference ?? index)}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm }}><View style={{ flex: 1 }}><Text variant="bodyMedium">{PLAN_LABELS[String(row.plan_id)] ?? 'XauCloud payment'}</Text><Text variant="caption" color="secondary" style={{ marginTop: 3 }}>{paymentDate(row.created_at)} · {paymentStatusLabel(row.payment_status)}</Text></View><Text variant="bodyMedium">{money(row.amount_kobo)}</Text></View>{index < paymentHistory.length - 1 && <Divider />}</React.Fragment>)}</View></Card>}
    <Button label="Need to recover a purchase?" variant="ghost" fullWidth onPress={() => setReceiptOpen(true)} style={{ marginTop: spacing.md }} />
    <Sheet visible={receiptOpen} onClose={() => setReceiptOpen(false)} title="Recover a purchase"><View style={{ gap: spacing.sm }}><Text variant="body" color="secondary">If you bought with another email, use your activation key in Link Existing License. If you do not have the key, Support can verify ownership without exposing payment details.</Text><Button label="Link Existing License" fullWidth onPress={() => { setReceiptOpen(false); navigation.navigate('BotLicense'); }} /><Button label="Contact Support" variant="secondary" fullWidth onPress={() => { setReceiptOpen(false); navigation.navigate('Support'); }} /></View></Sheet>
    <BankTransferSheet visible={btOpen} onClose={() => setBtOpen(false)} initiate={initiateBankTransfer} onFulfilled={refreshBilling} />
  </Screen>;
};
