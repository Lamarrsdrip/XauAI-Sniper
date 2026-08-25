import React from 'react';
import { View, FlatList } from 'react-native';
import { Screen, Text, Card, Badge, Header, Stat } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { LockedState, EmptyState, Skeleton, ErrorState } from '../../components/States';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockPerformance, mockRecentSignals } from '../../state/mockData';

export const ActivityScreen: React.FC = () => {
  const { spacing } = useTheme();
  const { entitlement } = useAppState();
  const perfQ = useCloudData(cloud.performanceAnalytics, mockPerformance, [entitlement?.performance_access]);
  const signalsQ = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);
  const closed = (signalsQ.data?.signals ?? []).filter((s) => s.status === 'EXPIRED' || s.status === 'ACTIONABLE');

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Activity" large />

      {!entitlement?.performance_access ? (
        <View style={{ paddingHorizontal: 16 }}>
          <LockedState
            title="Live P/L tracking is a Bot feature"
            message="Connect your XauCloud Bot to see real P/L, win rate and profit factor from your own MT5 account."
          />
        </View>
      ) : perfQ.loading && !perfQ.data ? (
        <View style={{ paddingHorizontal: 16 }}><Skeleton height={140} /></View>
      ) : perfQ.error ? (
        <View style={{ paddingHorizontal: 16 }}><ErrorState title="Couldn't load performance" message={perfQ.error} onAction={perfQ.refetch} /></View>
      ) : perfQ.data?.sufficient_data ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Card>
            <Text variant="caption" color="secondary">Net P/L (your MT5 account)</Text>
            <Text variant="numeric" color={perfQ.data.net_profit >= 0 ? 'buy' : 'sell'} style={{ marginTop: 2 }}>
              {perfQ.data.net_profit >= 0 ? '+' : ''}${perfQ.data.net_profit.toFixed(2)}
            </Text>
            <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
              <Stat label="Win rate" value={`${perfQ.data.win_rate.toFixed(0)}%`} />
              <Stat label="Trades" value={`${perfQ.data.total_trades}`} />
              <Stat label="Profit factor" value={(perfQ.data.gross_loss > 0 ? perfQ.data.gross_profit / perfQ.data.gross_loss : perfQ.data.gross_profit).toFixed(2)} />
              <Stat label="Max drawdown" value={`$${perfQ.data.max_drawdown.toFixed(0)}`} tone="sell" />
            </View>
          </Card>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16 }}>
          <EmptyState icon="bar-chart-outline" title="Not enough verified data yet" message={perfQ.data?.message ?? `Needs ${perfQ.data && !perfQ.data.sufficient_data ? perfQ.data.minimum_required : 5}+ verified trades before analytics can be shown.`} />
        </View>
      )}

      <Text variant="h3" color="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 16 }}>
        SIGNAL HISTORY
      </Text>
      {!entitlement?.signals_access ? (
        <View style={{ paddingHorizontal: 16 }}>
          <EmptyState icon="flash-outline" title="No signal history yet" message="Start a free trial to build a track record here." />
        </View>
      ) : signalsQ.loading && !signalsQ.data ? (
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}><Skeleton height={60} /><Skeleton height={60} /></View>
      ) : closed.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}><EmptyState icon="time-outline" title="No closed signals yet" /></View>
      ) : (
        <FlatList
          data={closed}
          keyExtractor={(s) => s.signal_id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: spacing.xxxl, gap: spacing.sm }}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="bodyMedium">{item.symbol}</Text>
                  {item.direction ? <Badge label={item.direction} tone={item.direction === 'BUY' ? 'buy' : 'sell'} /> : null}
                </View>
                <Badge label={item.status === 'ACTIONABLE' ? 'Actionable' : 'Expired'} tone={item.status === 'ACTIONABLE' ? 'buy' : 'neutral'} />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
};
