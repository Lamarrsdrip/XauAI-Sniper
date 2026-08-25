import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header } from '../../components';
import { Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockRecentSignals } from '../../state/mockData';

type Props = NativeStackScreenProps<TradingStackParamList, 'SignalDetails'>;

export const SignalDetailsScreen: React.FC<Props> = ({ route, navigation }) => {
  const { colors, spacing } = useTheme();
  // No dedicated GET /cloud/signals/:id exists — Signal Details is derived from the same recent-signals feed the list screen uses.
  const q = useCloudData(cloud.recentSignals, mockRecentSignals, []);
  const signal = q.data?.signals.find((s) => s.signal_id === route.params.id);

  return (
    <Screen>
      <Header title="Signal Details" onBack={() => navigation.goBack()} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load this signal" message={q.error} onAction={q.refetch} />
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
              {new Date(signal.effective_at).toLocaleString()} · {signal.status}
            </Text>

            <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Entry</Text>
                <Text variant="numericSm" style={{ marginTop: 2 }}>{signal.entry?.toFixed(2) ?? '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Stop Loss</Text>
                <Text variant="numericSm" color="sell" style={{ marginTop: 2 }}>{signal.stop?.toFixed(2) ?? '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="secondary">Take Profit</Text>
                <Text variant="numericSm" color="buy" style={{ marginTop: 2 }}>{signal.tp1?.toFixed(2) ?? '—'}</Text>
              </View>
            </View>

            {(signal.tp2 || signal.tp3) && (
              <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }}>
                {signal.tp2 != null && <Text variant="caption" color="secondary">TP2 {signal.tp2.toFixed(2)}</Text>}
                {signal.tp3 != null && <Text variant="caption" color="secondary">TP3 {signal.tp3.toFixed(2)}</Text>}
              </View>
            )}
          </Card>

          {signal.rationale && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Why XauCloud took this trade</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>{signal.rationale}</Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
};
