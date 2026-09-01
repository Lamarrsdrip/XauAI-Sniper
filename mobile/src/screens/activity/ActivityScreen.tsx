import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Text, Card, StatusBadge, Header, Stat, PremiumHero, Sparkline } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { LockedState, EmptyState, Skeleton, ErrorState } from '../../components/States';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockBotActivity, mockPerformance, mockRecentSignals, mockTickets } from '../../state/mockData';
import { BotActivityEvent } from '../../api/types';
import { formatMoney, formatNumber, formatPercent, formatPrice } from '../../utils/format';
import { presentCode, signalEngineLabel, signalProgressLabel, signalStatusLabel, signalStatusTone } from '../../utils/presentation';

const FILTERS = [
  ['all', 'All'], ['trades', 'Trades'], ['signals', 'Signals'], ['outlook', 'Outlook'],
  ['m10', 'M10'], ['bot', 'Bot'], ['risk', 'Risk'], ['account', 'Account'], ['support', 'Support'],
] as const;
type Filter = (typeof FILTERS)[number][0];
type TimelineBucket = Exclude<Filter, 'all'>;
type TimelineEvent = BotActivityEvent & { bucket: TimelineBucket; title: string; detail: string | null; at: string | null };

function raw(event: BotActivityEvent): string {
  return [event.kind, event.title, event.message, event.reason, event.event_type, event.event_category, event.severity, event.module]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}

function eventBucket(event: BotActivityEvent): TimelineBucket {
  const text = raw(event);
  if (/SUPPORT|TICKET/.test(text)) return 'support';
  if (/OUTLOOK|PRIMARY_BAR|BIAS/.test(text)) return 'outlook';
  if (/M10|10[_ -]?MIN|ENGINE/.test(text)) return 'm10';
  if (/ENTRY|EXIT|CLOSE|PARTIAL|TP[123]|SL[_ -]?HIT|TRADE/.test(text)) return 'trades';
  if (/SIGNAL|WATCHING|ACTIONABLE|INVALIDAT|EXPIRED/.test(text)) return 'signals';
  if (/RISK|DRAWDOWN|MARGIN|LOCK|LOT|PROTECT/.test(text)) return 'risk';
  if (/ACCOUNT|LICENSE|MT5|BROKER|HEARTBEAT|CONNECT/.test(text)) return 'account';
  return 'bot';
}

function isRoutineTelemetry(event: BotActivityEvent): boolean {
  const text = raw(event);
  return /BOT_STATUS_HEARTBEAT|MANAGING\s+\d+\s+OPEN\s+POSITION|SCANNING(?:\s|$)|WAITING_FOR_NEW_PRIMARY_BAR/.test(text);
}

function plainTitle(event: BotActivityEvent): string {
  const text = raw(event);
  if (/TP3/.test(text)) return 'Final target reached';
  if (/TP2/.test(text)) return 'Second target reached';
  if (/TP1/.test(text)) return 'First target reached';
  if (/SL[_ -]?HIT|STOP[_ -]?LOSS/.test(text)) return 'Risk limit reached';
  if (/PARTIAL/.test(text)) return 'Position partially closed';
  if (/ENTRY|TRADE_EXECUTED|POSITION_OPEN/.test(text)) return 'Position opened';
  if (/EXIT|CLOSE/.test(text)) return 'Position closed';
  if (/INVALIDAT/.test(text)) return 'Setup invalidated';
  if (/EXPIRED/.test(text)) return 'Signal expired';
  if (/MARGIN|DRAWDOWN|RISK/.test(text)) return 'Risk protection update';
  if (/MT5.*(?:DISCONNECT|LOST|OFFLINE)/.test(text)) return 'MT5 connection needs attention';
  if (/MT5.*(?:CONNECT|ONLINE)/.test(text)) return 'MT5 connection restored';
  if (/LICENSE/.test(text)) return 'License account update';
  if (/OUTLOOK/.test(text)) return 'Market Outlook updated';
  if (/M10/.test(text)) return 'M10 evaluation updated';
  if (/SIGNAL/.test(text)) return 'Signal update';
  return presentCode(event.title, 'Bot update');
}

function eventTime(event: BotActivityEvent): string | null {
  const value = event.created_at ?? event.ts;
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function relativeTime(value: string | null): string {
  if (!value) return 'Recently';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function compactTimeline(events: BotActivityEvent[]): { events: TimelineEvent[]; collapsed: number } {
  const seen = new Set<string>();
  let collapsed = 0;
  const meaningful = events.flatMap((event) => {
    if (isRoutineTelemetry(event)) {
      collapsed += 1;
      return [];
    }
    const title = plainTitle(event);
    const bucket = eventBucket(event);
    const at = eventTime(event);
    const timeWindow = at ? Math.floor(new Date(at).getTime() / (5 * 60_000)) : 'unknown-time';
    const identity = event.id ? `id:${event.id}` : `${bucket}:${title}:${event.symbol ?? ''}:${event.direction ?? ''}:${timeWindow}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const symbolLine = [event.symbol, event.direction].filter(Boolean).join(' · ');
    const message = event.message && event.message !== event.title && !isRoutineTelemetry({ ...event, title: event.message, message: null })
      ? event.message
      : null;
    return [{ ...event, bucket, title, detail: symbolLine || (message ? presentCode(message) : null), at }];
  });
  return { events: meaningful, collapsed };
}

function tradeOutcome(event: TimelineEvent): string {
  const text = raw(event);
  if (/TP3/.test(text)) return 'Final target hit';
  if (/TP2/.test(text)) return 'Second target hit';
  if (/TP1/.test(text)) return 'First target hit';
  if (/SL[_ -]?HIT|STOP[_ -]?LOSS/.test(text)) return 'Stop loss hit';
  if (/PARTIAL/.test(text)) return 'Partially closed';
  if (/CLOSE|EXIT/.test(text)) return 'Trade closed';
  return event.title;
}

function eventNumber(event: BotActivityEvent, keys: string[]): number | null {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export const ActivityScreen: React.FC = () => {
  const { colors, spacing, radius } = useTheme();
  const { entitlement } = useAppState();
  const navigation = useNavigation<any>();
  const [filter, setFilter] = useState<Filter>('all');
  const perfQ = useCloudData(cloud.performanceAnalytics, mockPerformance, [entitlement?.performance_access]);
  const signalsQ = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);
  const activityQ = useCloudData(() => cloud.monitorActivity('all', 100), mockBotActivity, [entitlement?.bot_activity]);
  const ticketsQ = useCloudData(() => cloud.supportTickets().then((r) => r.tickets), mockTickets, []);
  const compact = useMemo(() => compactTimeline(activityQ.data?.events ?? []), [activityQ.data]);
  const timeline = filter === 'all' ? compact.events : compact.events.filter((event) => event.bucket === filter);
  const recentTrades = compact.events.filter((event) => event.bucket === 'trades').slice(0, 8);
  const signals = (signalsQ.data?.signals ?? []).filter((signal) => filter === 'all' || filter === 'signals' || filter === 'outlook' && signal.engine === 'OUTLOOK' || filter === 'm10' && signal.engine === 'M10_ENGINE');
  const supportTickets = filter === 'all' || filter === 'support' ? ticketsQ.data ?? [] : [];
  const refresh = () => { activityQ.refetch(); signalsQ.refetch(); perfQ.refetch(); ticketsQ.refetch(); };

  return (
    <Screen refreshing={activityQ.loading || signalsQ.loading || ticketsQ.loading} onRefresh={refresh}>
      <Header title="Activity" large />
      <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>Meaningful account events, signal outcomes, and support—not a raw heartbeat log.</Text>

      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.lg, marginBottom: spacing.sm }}>
        {FILTERS.map(([key, label]) => <Pressable key={key} onPress={() => setFilter(key)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: filter === key ? colors.brand : colors.card, borderWidth: 1, borderColor: filter === key ? colors.brand : colors.cardBorder }}><Text variant="micro" style={{ color: filter === key ? colors.brandOn : colors.textSecondary }}>{label}</Text></Pressable>)}
      </View>

      {(filter === 'all' || filter === 'trades') && <>
        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.md, marginBottom: spacing.sm }}>PERFORMANCE SUMMARY</Text>
        {!entitlement?.performance_access || perfQ.locked ? <LockedState title="Personal performance is a Bot feature" message="Connect XauCloud Bot to see verified results from your own MT5 account." onLinkLicense={() => navigation.getParent()?.navigate('MoreTab', { screen: 'BotLicense' })} />
          : perfQ.loading && !perfQ.data ? <Skeleton height={220} />
            : perfQ.error ? <ErrorState title="Couldn't load performance" message={perfQ.error} onAction={perfQ.refetch} />
              : perfQ.data?.sufficient_data ? <>
                <PremiumHero tone={Number(perfQ.data.realized_pnl) >= 0 ? 'buy' : 'sell'}>
                  <Text variant="micro" color="inverse" style={{ opacity: 0.72, letterSpacing: 1.2 }}>VERIFIED CLOSED-TRADE LEDGER</Text>
                  <Text variant="display" color="inverse" style={{ marginTop: 4 }}>{formatMoney(perfQ.data.realized_pnl, 2, true)}</Text>
                  <Text variant="caption" color="inverse" style={{ opacity: 0.68, marginTop: 2 }}>Realized P/L · {perfQ.data.verified_trade_count} verified trades</Text>
                  {Array.isArray(perfQ.data.equity_curve) && perfQ.data.equity_curve.length > 1 && (
                    <View style={{ marginTop: spacing.lg }}>
                      <Sparkline points={perfQ.data.equity_curve.map((p) => p.cumulative_profit)} positiveTone={Number(perfQ.data.realized_pnl) >= 0} />
                    </View>
                  )}
                </PremiumHero>
                <Card style={{ marginTop: spacing.sm }}>
                  <Text variant="captionMedium" color="brand">TRADE QUALITY</Text>
                  <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
                    <Stat label="Win rate" value={formatPercent(perfQ.data.win_rate)} tone={perfQ.data.win_rate >= 50 ? 'buy' : 'neutral'} />
                    <Stat label="Profit factor" value={formatNumber(perfQ.data.profit_factor, 2)} tone={perfQ.data.profit_factor >= 1 ? 'buy' : 'sell'} />
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
                    <Stat label="Avg result" value={perfQ.data.avg_pips != null ? `${formatNumber(perfQ.data.avg_pips, 1)} pips` : '—'} />
                    <Stat label="Max drawdown" value={formatMoney(perfQ.data.max_drawdown, 0)} tone="sell" />
                  </View>
                </Card>
              </> : <EmptyState icon="time-outline" title="Building verified history" message={perfQ.data?.message ?? `${perfQ.data?.verified_trade_count ?? 0} of ${perfQ.data?.minimum_required ?? 5} closed trades reported. Fills in automatically as your EA reports real closes.`} />}

        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>RECENT TRADES</Text>
        {!entitlement?.bot_activity ? <EmptyState icon="swap-horizontal-outline" title="Your trades will appear here" message="Live trade history appears after XauCloud Bot is connected." />
          : activityQ.locked ? <LockedState title="Trade history is a Bot feature" message="Connect XauCloud Bot to see your live trade history." onLinkLicense={() => navigation.getParent()?.navigate('MoreTab', { screen: 'BotLicense' })} />
            : activityQ.loading && !activityQ.data ? <Skeleton height={104} />
              : recentTrades.length ? recentTrades.map((event) => {
              const pnl = eventNumber(event, ['profit', 'pnl', 'realized_pnl', 'net_profit']);
              const lots = eventNumber(event, ['lot', 'lot_size', 'volume']);
              return <Card key={`trade-${event.id}`} style={{ marginBottom: spacing.sm }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}><View style={{ flex: 1 }}><Text variant="bodyMedium">{[event.symbol ?? 'Trade', event.direction].filter(Boolean).join(' · ')}</Text><Text variant="caption" color="secondary" style={{ marginTop: 3 }}>{tradeOutcome(event)}{lots != null ? ` · ${lots} lot${lots === 1 ? '' : 's'}` : ''}</Text></View><View style={{ alignItems: 'flex-end' }}>{pnl != null ? <Text variant="bodyMedium" color={pnl >= 0 ? 'buy' : 'sell'}>{formatMoney(pnl, 2, true)}</Text> : null}<Text variant="caption" color="tertiary">{relativeTime(event.at)}</Text></View></View></Card>;
            }) : <EmptyState icon="time-outline" title="No verified trade events yet" message="New opens, exits and target outcomes will appear here once reported by MT5." />}
      </>}

      {(filter === 'all' || filter === 'trades' || filter === 'bot' || filter === 'account' || filter === 'risk') && <>
        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>IMPORTANT ACTIVITY</Text>
        {!entitlement?.bot_activity ? <LockedState title="Bot activity is a Bot feature" message="Connect XauCloud Bot to see live trade, account, and risk events." onLinkLicense={() => navigation.getParent()?.navigate('MoreTab', { screen: 'BotLicense' })} />
          : activityQ.loading && !activityQ.data ? <Skeleton height={124} />
            : activityQ.error ? <ErrorState title="Couldn't load activity" message={activityQ.error} onAction={activityQ.refetch} />
              : activityQ.locked ? <LockedState title="Activity is locked" message="Your current access does not include live bot activity." />
                : timeline.length ? timeline.map((event) => <Card key={event.id} style={{ marginBottom: spacing.sm }}><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: event.bucket === 'trades' ? colors.buy : event.bucket === 'risk' ? colors.warn : event.bucket === 'account' ? colors.info : colors.brand, marginTop: 5 }} /><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}><Text variant="bodyMedium" style={{ flex: 1 }}>{event.title}</Text><Text variant="caption" color="tertiary">{relativeTime(event.at)}</Text></View>{event.detail ? <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>{event.detail}</Text> : null}</View></View></Card>) : <EmptyState icon="pulse-outline" title="No meaningful events yet" message="Routine monitoring is kept in the live bot state rather than filling your timeline." />}
        {entitlement?.bot_activity && compact.collapsed > 0 && <Text variant="caption" color="tertiary" align="center" style={{ marginTop: spacing.xs }}>{compact.collapsed} routine monitoring update{compact.collapsed === 1 ? '' : 's'} collapsed</Text>}
      </>}

      {(filter === 'all' || filter === 'signals' || filter === 'outlook' || filter === 'm10') && <>
        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>SIGNAL LIFECYCLE</Text>
        {!entitlement?.signals_access || signalsQ.locked ? <LockedState title="Signals are locked" message="Subscribe to see XauCloud Outlook, M10, targets, and outcomes." onUpgrade={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Billing' })} />
          : signalsQ.loading && !signalsQ.data ? <Skeleton height={92} />
            : signalsQ.error ? <ErrorState title="Couldn't load signal history" message={signalsQ.error} onAction={signalsQ.refetch} />
              : signals.length ? signals.map((signal) => <Card key={signal.signal_id} onPress={() => navigation.getParent()?.navigate('TradingTab', { screen: 'SignalDetails', params: { id: signal.signal_id } })} style={{ marginBottom: spacing.sm }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}><View style={{ flexShrink: 1, minWidth: 0 }}><Text variant="bodyMedium" numberOfLines={1}>{signal.symbol} · {signal.direction || 'WATCHING'}</Text><Text variant="caption" color="secondary" numberOfLines={1} style={{ marginTop: 3 }}>{signalEngineLabel(signal.engine)}{signal.entry != null ? ` · Entry ${formatPrice(signal.entry)}` : ''}</Text></View><StatusBadge label={signalStatusLabel(signal)} tone={signalStatusTone(signal)} maxWidth="46%" /></View>{signal.tp1 || signal.tp2 || signal.tp3 ? <Text variant="caption" color="tertiary" style={{ marginTop: spacing.sm }}>{signalProgressLabel(signal)}</Text> : null}</Card>) : <EmptyState icon="time-outline" title="No matching signal events" message="New server-published signals and outcomes will appear here." />}
      </>}

      {(filter === 'all' || filter === 'support') && <>
        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>SUPPORT</Text>
        {ticketsQ.loading && !ticketsQ.data ? <Skeleton height={74} /> : supportTickets.length ? supportTickets.slice(0, 3).map((ticket) => <Card key={ticket.id} onPress={() => navigation.getParent()?.navigate('MoreTab', { screen: 'TicketThread', params: { id: ticket.id, subject: ticket.subject } })} style={{ marginBottom: spacing.sm }}><Text variant="bodyMedium">{ticket.subject}</Text><Text variant="caption" color="secondary" style={{ marginTop: 4 }}>{ticket.status === 'closed' ? 'Closed' : (ticket.messages ?? []).at(-1)?.author_type === 'customer' ? 'Waiting for reply' : 'Reply received'}</Text></Card>) : <EmptyState icon="chatbubble-ellipses-outline" title="No support updates" message="Your open support conversations will appear here." />}
      </>}
    </Screen>
  );
};
