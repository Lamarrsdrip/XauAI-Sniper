import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Text, Card, Badge, Button, SectionHeader } from '../../components';
import { LockedState, Skeleton } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockOutlook, mockEngine, mockRecentSignals, mockPerformance } from '../../state/mockData';
import { Ionicons } from '@expo/vector-icons';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const HomeScreen: React.FC = () => {
  const { colors, spacing } = useTheme();
  const { user, entitlement, license } = useAppState();
  const nav = useNavigation<any>();
  const firstName = user?.full_name?.split(' ')[0] || 'there';

  const outlookQ = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);
  const engineQ = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);
  const signalsQ = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);
  const perfQ = useCloudData(cloud.performanceAnalytics, mockPerformance, [entitlement?.performance_access]);

  const latestSignal = signalsQ.data?.signals[0];
  const outlookSignal = outlookQ.data?.signal;
  const engineSignal = engineQ.data?.signal;

  const statusChip = license?.linked && license.license?.mt5_account
    ? { label: 'XauCloud Bot Active', tone: 'buy' as const }
    : entitlement?.signals_access
    ? { label: 'Signals Active', tone: 'brand' as const }
    : { label: 'Free Account', tone: 'neutral' as const };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm }}>
        <View>
          <Text variant="caption" color="secondary">{greeting()},</Text>
          <Text variant="h1">{firstName}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Pressable onPress={() => nav.navigate('MoreTab', { screen: 'Notifications' })} hitSlop={8}>
            <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={() => nav.navigate('MoreTab', { screen: 'Settings' })}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="captionMedium" color="brand">{firstName[0]?.toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <Badge label={statusChip.label} tone={statusChip.tone} dot />
      </View>

      <SectionHeader title="TODAY'S GOLD OUTLOOK" />
      {!entitlement?.outlook_access ? (
        <LockedState
          title="Unlock Gold Outlook"
          message="Get XauCloud's daily bias and key levels for XAUUSD with a signal subscription or bot license."
          onUpgrade={() => nav.navigate('MoreTab', { screen: 'Billing' })}
        />
      ): outlookQ.loading ? (
        <Skeleton height={140} />
      ) : outlookSignal ? (
        <Card onPress={() => nav.navigate('TradingTab', { screen: 'MarketOutlook' })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Badge label={outlookSignal.direction || 'NEUTRAL'} tone={outlookSignal.direction === 'BUY' ? 'buy' : outlookSignal.direction === 'SELL' ? 'sell' : 'neutral'} />
            {outlookSignal.confidence != null && <Text variant="caption" color="tertiary">{outlookSignal.confidence}% confidence</Text>}
          </View>
          <Text variant="body" style={{ marginTop: spacing.xs }}>{outlookSignal.rationale ?? 'XauCloud is tracking Gold — no written summary yet for this update.'}</Text>
          <Text variant="captionMedium" color="brand" style={{ marginTop: spacing.sm }}>View Analysis →</Text>
        </Card>
      ) : (
        <Card>
          <Text variant="body" color="secondary">XauCloud is monitoring Gold — no Outlook published yet.</Text>
        </Card>
      )}

      <SectionHeader title="10-MINUTE ENGINE" />
      {!entitlement?.engine_10m_access ? (
        <LockedState
          title="10-Minute Engine is locked"
          message="Live setup detection for XAUUSD updates every 10 minutes for subscribers and bot owners."
          onUpgrade={() => nav.navigate('MoreTab', { screen: 'Billing' })}
        />
      ) : engineQ.loading ? (
        <Skeleton height={140} />
      ) : engineSignal ? (
        <Card onPress={() => nav.navigate('TradingTab', { screen: 'TenMinuteEngine' })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Badge label={engineSignal.status.replace('_', ' ')} tone={engineSignal.direction === 'BUY' ? 'buy' : engineSignal.direction === 'SELL' ? 'sell' : 'info'} dot />
            {engineSignal.confidence != null && <Text variant="caption" color="tertiary">Strength {engineSignal.confidence}%</Text>}
          </View>
          <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>{engineSignal.rationale ?? 'No setup narrative published for this update yet.'}</Text>
          <Button label="Open Engine" variant="secondary" size="sm" style={{ marginTop: spacing.sm }} onPress={() => nav.navigate('TradingTab', { screen: 'TenMinuteEngine' })} />
        </Card>
      ) : (
        <Card><Text variant="body" color="secondary">No strong setup right now.</Text></Card>
      )}

      <SectionHeader title="LATEST SIGNAL" />
      {!entitlement?.signals_access ? (
        <LockedState
          title="No signals yet"
          message="Start a free trial to see live XAUUSD entries, stop loss and take profit in plain English."
          onUpgrade={() => nav.navigate('MoreTab', { screen: 'Billing' })}
        />
      ) : signalsQ.loading ? (
        <Skeleton height={100} />
      ) : latestSignal ? (
        <Card onPress={() => nav.navigate('TradingTab', { screen: 'SignalDetails', params: { id: latestSignal.signal_id } })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="h3">{latestSignal.symbol}</Text>
            <Badge label={latestSignal.direction} tone={latestSignal.direction === 'BUY' ? 'buy' : 'sell'} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
            <View>
              <Text variant="caption" color="tertiary">Entry</Text>
              <Text variant="captionMedium">{latestSignal.entry?.toFixed(2) ?? '—'}</Text>
            </View>
            <View>
              <Text variant="caption" color="tertiary">SL</Text>
              <Text variant="captionMedium">{latestSignal.stop?.toFixed(2) ?? '—'}</Text>
            </View>
            <View>
              <Text variant="caption" color="tertiary">TP</Text>
              <Text variant="captionMedium">{latestSignal.tp1?.toFixed(2) ?? '—'}</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card><Text variant="body" color="secondary">No signals published yet.</Text></Card>
      )}

      {entitlement?.performance_access && (
        <>
          <SectionHeader title="TODAY'S PERFORMANCE" action={
            <Text variant="captionMedium" color="brand" onPress={() => nav.navigate('ActivityTab')}>See all</Text>
          } />
          {perfQ.loading ? (
            <Skeleton height={90} />
          ) : perfQ.data?.sufficient_data ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View>
                  <Text variant="caption" color="secondary">Net P/L</Text>
                  <Text variant="numericSm" color={perfQ.data.net_profit >= 0 ? 'buy' : 'sell'}>{perfQ.data.net_profit >= 0 ? '+' : ''}${perfQ.data.net_profit.toFixed(2)}</Text>
                </View>
                <View>
                  <Text variant="caption" color="secondary">Win rate</Text>
                  <Text variant="numericSm">{perfQ.data.win_rate.toFixed(0)}%</Text>
                </View>
                <View>
                  <Text variant="caption" color="secondary">Trades</Text>
                  <Text variant="numericSm">{perfQ.data.total_trades}</Text>
                </View>
              </View>
            </Card>
          ) : (
            <Card><Text variant="body" color="secondary">{perfQ.data?.message ?? 'Not enough verified trades yet for performance stats.'}</Text></Card>
          )}
        </>
      )}
    </Screen>
  );
};
