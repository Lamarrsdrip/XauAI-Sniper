import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, StatusBadge, Header } from '../../components';
import { Skeleton, ErrorState, EmptyState, LockedState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockRecentSignals } from '../../state/mockData';
import { formatDateTime, formatPrice } from '../../utils/format';
import { presentCode, presentCustomerText, signalProgressLabel, signalStatusLabel, signalStatusTone } from '../../utils/presentation';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<TradingStackParamList, 'SignalDetails'>;

export const SignalDetailsScreen: React.FC<Props> = ({ route, navigation }) => {
  const { colors, spacing } = useTheme();
  const q = useCloudData(
    () => cloud.signalDetail(route.params.id),
    { signal: mockRecentSignals.signals.find((s) => s.signal_id === route.params.id) ?? null },
    [route.params.id],
  );
  const signal = q.data?.signal;

  return (
    <Screen>
      <Header title="Signal Details" onBack={() => goBackOrNavigate(navigation, 'Signals')} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load this signal" message={q.error} onAction={q.refetch} />
      ) : q.locked ? (
        // Real bug: this screen had no entitlement gate at all -- a signal
        // opened just before a trial/subscription lapsed (or via a stale
        // deep link) fell straight into the generic "not found" message
        // below, which reads as "this signal doesn't exist" rather than
        // "you need to subscribe." The backend already correctly 403s this
        // (routes/cloud/signals.ts's requireCapability), this was purely a
        // mobile presentation gap.
        <LockedState title="Signal details are locked" message="Subscribe to see full entry, stop, and target detail for XauCloud's signals." onUpgrade={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Billing' })} />
      ) : !signal ? (
        <EmptyState icon="flash-outline" title="Signal not found" message="This signal may have expired or is no longer available." />
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="h1">{signal.symbol}</Text>
              {signal.direction ? <Badge label={signal.direction} tone={signal.direction === 'BUY' ? 'buy' : 'sell'} /> : null}
            </View>
            <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
              {formatDateTime(signal.effective_at)}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <StatusBadge label={signalStatusLabel(signal)} tone={signalStatusTone(signal)} />
            </View>

            <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Entry</Text>
                <Text variant="numericSm" style={{ marginTop: 2 }}>{formatPrice(signal.entry)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Stop Loss</Text>
                <Text variant="numericSm" color="sell" style={{ marginTop: 2 }}>{formatPrice(signal.stop)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Take Profit</Text>
                <Text variant="numericSm" color="buy" style={{ marginTop: 2 }}>{formatPrice(signal.tp1)}</Text>
              </View>
            </View>

            {(signal.tp2 || signal.tp3) && (
              <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }}>
                {signal.tp2 != null && <Text variant="caption" color="secondary">TP2 {formatPrice(signal.tp2)}</Text>}
                {signal.tp3 != null && <Text variant="caption" color="secondary">TP3 {formatPrice(signal.tp3)}</Text>}
              </View>
            )}
          </Card>

          {signal.rationale && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Why XauCloud took this trade</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>{presentCustomerText(signal.rationale)}</Text>
            </Card>
          )}

          {signal.outcome_timeline?.length ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Signal updates</Text>
              {signal.outcome_timeline.map((event, index) => (
                <View key={`${event.event}-${event.at}-${index}`} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                  <Text variant="bodyMedium">{presentCode(event.event)}</Text>
                  <Text variant="caption" color="tertiary">{formatDateTime(event.at)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          <Card style={{ marginTop: spacing.md }}>
            <Text variant="caption" color="tertiary">LIFECYCLE</Text>
            <Text variant="body" color="secondary" style={{ marginTop: 5 }}>{signalProgressLabel(signal)}</Text>
          </Card>
        </>
      )}
    </Screen>
  );
};
