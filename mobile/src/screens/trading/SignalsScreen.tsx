import React, { useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, StatusBadge, Header, SegmentedTabs, PremiumHero } from '../../components';
import { LockedState, Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockRecentSignals } from '../../state/mockData';
import { SubscriberSignal } from '../../api/types';
import { formatPrice } from '../../utils/format';
import { signalEngineLabel, signalStatusLabel, signalStatusTone } from '../../utils/presentation';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<TradingStackParamList, 'Signals'>;

function timeAgo(iso: unknown): string {
  if (typeof iso !== 'string' || !Number.isFinite(new Date(iso).getTime())) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const SignalCard: React.FC<{ item: SubscriberSignal; onPress: () => void }> = ({ item, onPress }) => {
  const { colors, spacing, radius } = useTheme();
  const isBuy = item.direction === 'BUY';
  const accent = isBuy ? colors.buy : colors.sell;
  const hit = (timestamp: string | null | undefined) => timestamp ? accent : colors.divider;
  const steps = [
    { label: 'Entry', value: item.entry, reached: true },
    { label: 'TP1', value: item.tp1, reached: !!item.tp1_hit_at },
    { label: 'TP2', value: item.tp2, reached: !!item.tp2_hit_at },
    { label: 'TP3', value: item.tp3, reached: !!item.tp3_hit_at },
  ];
  return (
    <Card onPress={onPress} style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 5, backgroundColor: accent }} />
        <View style={{ flex: 1, padding: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
              <View style={{ width: 30, height: 30, borderRadius: radius.sm, backgroundColor: isBuy ? colors.buyBg : colors.sellBg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={isBuy ? 'trending-up' : 'trending-down'} color={accent} size={16} /></View>
              <View style={{ flexShrink: 1, minWidth: 0 }}><Text variant="h3" numberOfLines={1}>{item.symbol}</Text><Text variant="micro" color="tertiary" numberOfLines={1}>{signalEngineLabel(item.engine)} · {timeAgo(item.effective_at)}</Text></View>
            </View>
            <Text variant="bodyMedium" color={isBuy ? 'buy' : 'sell'} style={{ flexShrink: 0 }}>{item.direction || 'WATCH'}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <View><Text variant="micro" color="tertiary">ENTRY</Text><Text variant="bodyMedium" style={{ marginTop: 3 }}>{formatPrice(item.entry)}</Text></View>
            <View><Text variant="micro" color="tertiary" align="right">STOP LOSS</Text><Text variant="bodyMedium" color="sell" align="right" style={{ marginTop: 3 }}>{formatPrice(item.stop)}</Text></View>
            <View><Text variant="micro" color="tertiary" align="right">TP1</Text><Text variant="bodyMedium" color="buy" align="right" style={{ marginTop: 3 }}>{formatPrice(item.tp1)}</Text></View>
          </View>
          {/* Lifecycle gets its own full-width row -- see StatusBadge for why a
              plain Badge here previously overflowed the card on long text. */}
          <View style={{ marginTop: spacing.md }}>
            <StatusBadge label={signalStatusLabel(item)} tone={signalStatusTone(item)} />
          </View>
          <View style={{ flexDirection: 'row', marginTop: spacing.md, alignItems: 'flex-start' }}>
            {steps.map((step, index) => (
              <React.Fragment key={step.label}>
                {index > 0 ? <View style={{ flex: 1, height: 2, backgroundColor: hit(step.reached ? 'reached' : null), marginTop: 4 }} /> : null}
                <View style={{ alignItems: 'center', gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: step.reached ? accent : colors.divider }} /><Text variant="micro" color="tertiary">{step.label}</Text><Text variant="micro">{formatPrice(step.value)}</Text></View>
              </React.Fragment>
            ))}
          </View>
        </View>
      </View>
    </Card>
  );
};

export const SignalsScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const { entitlement } = useAppState();
  const [filter, setFilter] = useState('All');
  const q = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);
  const filtered = useMemo(() => (q.data?.signals ?? []).filter((s) => filter === 'All' || s.direction === (filter === 'Buy' ? 'BUY' : 'SELL')), [q.data, filter]);

  // Checked two ways on purpose: `entitlement.signals_access` is a locally
  // cached flag (only refreshed at sign-in / foreground-return / a couple
  // of explicit actions), while `q.locked` reflects what the server just
  // said for THIS fetch. A trial/subscription that expired since the last
  // entitlement refresh trips the second check even if the first one is
  // stale, so this screen can never keep showing signals to a customer who
  // has actually lost access.
  if (!entitlement?.signals_access || q.locked) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header title="Signals" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />
        <LockedState
          title="Signals are locked"
          message="Start a free trial or subscribe to see XauCloud's live XAUUSD entries."
          onUpgrade={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Billing' })}
        />
      </Screen>
    );
  }
  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Signals" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.signal_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: spacing.xxxl, gap: spacing.sm }}
        ListHeaderComponent={<><PremiumHero tone="brand" style={{ marginBottom: spacing.md }}><Text variant="micro" color="inverse" style={{ opacity: 0.7, letterSpacing: 1.2 }}>SERVER-PUBLISHED EXECUTION FEED</Text><Text variant="h1" color="inverse" style={{ marginTop: 7 }}>Signals with context.</Text><Text variant="caption" color="inverse" style={{ opacity: 0.72, marginTop: 6 }}>Outcome states are reconciled by XauCloud—not guessed from your phone.</Text></PremiumHero><View style={{ marginBottom: spacing.md }}><SegmentedTabs options={['All', 'Buy', 'Sell']} value={filter} onChange={setFilter} /></View></>}
        onRefresh={q.refetch}
        refreshing={q.loading}
        renderItem={({ item }) => <SignalCard item={item} onPress={() => navigation.navigate('SignalDetails', { id: item.signal_id })} />}
        ListEmptyComponent={q.loading && !q.data ? <View style={{ gap: spacing.sm }}><Skeleton height={180} /><Skeleton height={180} /></View> : q.error ? <ErrorState title="Couldn't load signals" message={q.error} onAction={q.refetch} /> : <EmptyState icon="flash-outline" title="No signals yet" message="Published signals will show up here." />}
      />
    </Screen>
  );
};
