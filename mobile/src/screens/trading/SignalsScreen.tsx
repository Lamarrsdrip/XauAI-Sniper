import React, { useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, SegmentedTabs } from '../../components';
import { LockedState, Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockRecentSignals } from '../../state/mockData';
import { SubscriberSignal } from '../../api/types';

type Props = NativeStackScreenProps<TradingStackParamList, 'Signals'>;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const statusTone = (s: SubscriberSignal['status']) =>
  s === 'ACTIONABLE' ? 'buy' : s === 'BLOCKED' ? 'sell' : s === 'EXPIRED' ? 'neutral' : 'info';
const statusLabel = (s: SubscriberSignal['status']) =>
  s === 'ACTIONABLE' ? 'Actionable' : s === 'BLOCKED' ? 'Blocked' : s === 'EXPIRED' ? 'Expired' : 'Watching';

export const SignalsScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const { entitlement } = useAppState();
  const [filter, setFilter] = useState('All');
  const q = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);

  const filtered = useMemo(
    () => (q.data?.signals ?? []).filter((s) => filter === 'All' || s.direction === (filter === 'Buy' ? 'BUY' : 'SELL')),
    [q.data, filter]
  );

  if (!entitlement?.signals_access) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header title="Signals" onBack={() => navigation.goBack()} />
        <LockedState title="Signals are locked" message="Start a free trial or subscribe to see XauCloud's live XAUUSD entries." />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Signals" onBack={() => navigation.goBack()} />
      <View style={{ paddingHorizontal: 16, marginBottom: spacing.sm }}>
        <SegmentedTabs options={['All', 'Buy', 'Sell']} value={filter} onChange={setFilter} />
      </View>
      {q.loading && !q.data ? (
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}>
          <Skeleton height={70} /><Skeleton height={70} /><Skeleton height={70} />
        </View>
      ) : q.error ? (
        <View style={{ paddingHorizontal: 16 }}><ErrorState title="Couldn't load signals" message={q.error} onAction={q.refetch} /></View>
      ) : filtered.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}><EmptyState icon="flash-outline" title="No signals yet" message="Published signals will show up here." /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.signal_id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: spacing.xxxl, gap: spacing.sm }}
          onRefresh={q.refetch}
          refreshing={q.loading}
          renderItem={({ item }) => (
            <Card onPress={() => navigation.navigate('SignalDetails', { id: item.signal_id })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="bodyMedium">{item.symbol}</Text>
                  {item.direction ? <Badge label={item.direction} tone={item.direction === 'BUY' ? 'buy' : 'sell'} /> : null}
                </View>
                <Badge label={statusLabel(item.status)} tone={statusTone(item.status)} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                <Text variant="caption" color="secondary">{item.entry != null ? `Entry ${item.entry.toFixed(2)}` : 'No entry level'}</Text>
                <Text variant="caption" color="tertiary">{timeAgo(item.effective_at)}</Text>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
};
