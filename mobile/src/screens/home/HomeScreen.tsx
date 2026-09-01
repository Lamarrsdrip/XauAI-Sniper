import React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Card, Badge, SectionHeader, Stat, PremiumHero } from '../../components';
import { LockedState, Skeleton } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockCurrentOpinion, mockEngine, mockMonitorStatus, mockOutlook, mockPerformance, mockRecentSignals } from '../../state/mockData';
import { asFiniteNumber, formatMoney, formatPercent, formatPrice } from '../../utils/format';
import { presentCode, presentCustomerText } from '../../utils/presentation';

const greet = () => new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
const freshness = (seconds: number | null | undefined) => seconds == null ? 'Awaiting heartbeat' : seconds < 10 ? 'Live now' : `Updated ${seconds}s ago`;

export const HomeScreen: React.FC = () => {
  const { colors, spacing, radius } = useTheme();
  const { user, entitlement, license } = useAppState();
  const nav = useNavigation<any>();
  const name = user?.full_name?.split(' ')[0] || 'Trader';
  const outlookQ = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);
  const engineQ = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);
  const signalsQ = useCloudData(cloud.recentSignals, mockRecentSignals, [entitlement?.signals_access]);
  const performanceQ = useCloudData(cloud.performanceAnalytics, mockPerformance, [entitlement?.performance_access]);
  const monitorQ = useCloudData(cloud.monitorStatus, mockMonitorStatus, [entitlement?.bot_activity, license?.linked]);
  const opinionQ = useCloudData(cloud.currentOpinion, mockCurrentOpinion, [entitlement?.bot_activity]);
  const outlook = outlookQ.data?.signal;
  const engine = engineQ.data?.signal;
  const latest = signalsQ.data?.signals?.[0];
  const heartbeat = monitorQ.data?.heartbeat;
  const botLive = !!monitorQ.data && !monitorQ.data.offline && heartbeat?.mt5_connected !== false;

  return <Screen>
    <View style={{ paddingTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View><Text variant="caption" color="secondary">{greet()}</Text><Text variant="h1">{name}</Text></View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => nav.navigate('MoreTab', { screen: 'Notifications' })} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="notifications-outline" size={21} color={colors.textPrimary} /></Pressable>
        <Pressable onPress={() => nav.navigate('MoreTab', { screen: 'Profile' })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodyMedium" style={{ color: colors.brandOn }}>{name[0]}</Text></Pressable>
      </View>
    </View>

    {entitlement?.bot_activity ? monitorQ.loading && !monitorQ.data ? <Skeleton height={238} style={{ marginTop: spacing.xl }} /> : <PremiumHero tone={botLive ? (Number(heartbeat?.daily_pnl) < 0 ? 'sell' : 'buy') : 'graphite'} style={{ marginTop: spacing.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text variant="micro" style={{ color: colors.brand, letterSpacing: 1.8 }}>LIVE TRADING ACCOUNT</Text><Text variant="caption" style={{ color: colors.bg, opacity: .68, marginTop: 4 }}>{heartbeat?.broker_server || 'MT5 connection'}</Text></View><Badge label={botLive ? 'LIVE' : 'CHECK MT5'} tone={botLive ? 'buy' : 'warn'} dot /></View>
      <Text variant="numeric" style={{ color: colors.bg, marginTop: spacing.lg }}>{formatMoney(heartbeat?.equity)}</Text>
      <Text variant="caption" style={{ color: colors.bg, opacity: .68, marginTop: 2 }}>Equity · {freshness(monitorQ.data?.heartbeat_age_sec)}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}><View style={{ flex: 1 }}><Text variant="caption" style={{ color: colors.bg, opacity: .62 }}>Balance</Text><Text variant="numericSm" style={{ color: colors.bg, marginTop: 3 }}>{formatMoney(heartbeat?.balance)}</Text></View><View style={{ flex: 1 }}><Text variant="caption" style={{ color: colors.bg, opacity: .62 }}>Today</Text><Text variant="numericSm" style={{ color: colors.bg, marginTop: 3 }}>{formatMoney(heartbeat?.daily_pnl, 2, true)}</Text></View><View style={{ flex: 1 }}><Text variant="caption" style={{ color: colors.bg, opacity: .62 }}>Open</Text><Text variant="numericSm" style={{ color: colors.bg, marginTop: 3 }}>{heartbeat?.open_positions ?? monitorQ.data?.open_trades ?? 0}</Text></View></View>
      <Pressable onPress={() => nav.navigate('MoreTab', { screen: 'BotLicense' })} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}><Text variant="captionMedium" style={{ color: colors.brand }}>View bot health →</Text></Pressable>
    </PremiumHero> : <PremiumHero tone="brand" style={{ marginTop: spacing.xl }}>
      <Text variant="micro" style={{ color: colors.brand, letterSpacing: 1.8 }}>XAUCLOUD COMMAND</Text><Text variant="display" style={{ color: colors.bg, marginTop: 12 }}>Gold, without the noise.</Text><Text variant="body" style={{ color: colors.bg, opacity: .72, marginTop: 8, maxWidth: 300 }}>Premium market intelligence, learning, and customer-safe automation when you are ready.</Text>
      <Pressable onPress={() => nav.navigate('MoreTab', { screen: 'BotLicense' })} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}><Text variant="captionMedium" style={{ color: colors.brand }}>Link an existing license →</Text></Pressable>
    </PremiumHero>}

    {entitlement?.bot_activity ? <>
      <SectionHeader title="POSITION NOW" />
      {opinionQ.loading && !opinionQ.data ? <Skeleton height={132} /> : opinionQ.data?.open ? <Card onPress={() => nav.navigate('PositionDetails')}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text variant="caption" color="secondary">CURRENT XAUUSD POSITION</Text><Text variant="h2" style={{ marginTop: 4 }}>{opinionQ.data.symbol ?? 'XAUUSD'} · {formatMoney(opinionQ.data.floating_pl, 2, true)}</Text></View><Badge label={opinionQ.data.direction ?? 'OPEN'} tone={opinionQ.data.direction === 'SELL' ? 'sell' : 'buy'} /></View><View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}><Stat label="Entry" value={formatPrice(opinionQ.data.entry_price)} /><Stat label="Current" value={formatPrice(opinionQ.data.current_price)} /><Stat label="SL" value={formatPrice(opinionQ.data.sl)} /><Stat label={asFiniteNumber(opinionQ.data.tp) && asFiniteNumber(opinionQ.data.tp)! > 0 ? 'Target' : 'Exit plan'} value={asFiniteNumber(opinionQ.data.tp) && asFiniteNumber(opinionQ.data.tp)! > 0 ? formatPrice(opinionQ.data.tp) : 'No fixed target'} /></View><Text variant="caption" color="secondary" style={{ marginTop: spacing.md }}>{opinionQ.data.current_reason ? presentCustomerText(opinionQ.data.current_reason) : 'Your position is being monitored against its risk plan.'}</Text><Text variant="captionMedium" color="brand" style={{ marginTop: spacing.sm }}>Open position detail →</Text></Card> : <Card onPress={() => nav.navigate('ActivityTab')}><Text variant="caption" color="secondary">POSITION STATUS</Text><Text variant="h3" style={{ marginTop: 4 }}>No live XAUUSD position</Text><Text variant="caption" color="secondary" style={{ marginTop: 6 }}>The bot is watching verified conditions and will only act when its risk plan allows it.</Text></Card>}
    </> : <><SectionHeader title="AUTOMATION" /><LockedState title={license?.linked ? 'Connect MT5 to begin' : 'Your live bot desk is ready'} message={license?.linked ? 'Your license is linked. Connect MT5 to unlock your real account, positions, and verified analytics.' : 'Connect XauCloud Bot to unlock your live equity, trades, and account analytics.'} onUpgrade={() => nav.navigate('MoreTab', { screen: 'Billing' })} onLinkLicense={() => nav.navigate('MoreTab', { screen: 'BotLicense' })} /></>}

    <SectionHeader title="MARKET PULSE" />
    {!entitlement?.outlook_access ? <LockedState title="Unlock Gold Outlook" message="Daily XAUUSD bias, context and key levels." onUpgrade={() => nav.navigate('MoreTab', { screen: 'Billing' })} /> : outlookQ.loading ? <Skeleton height={150} /> : <Card onPress={() => nav.navigate('TradingTab', { screen: 'MarketOutlook' })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text variant="micro" color="tertiary" style={{ letterSpacing: 1 }}>TODAY'S OUTLOOK</Text><Text variant="h1" style={{ marginTop: 5 }}>{outlook?.direction || 'Watching'}</Text></View><Badge label={outlook?.confidence != null ? `${outlook.confidence}% CONFIDENCE` : 'LIVE'} tone={outlook?.direction === 'BUY' ? 'buy' : outlook?.direction === 'SELL' ? 'sell' : 'neutral'} /></View>
      {(outlook?.entry != null || outlook?.stop != null || outlook?.tp1 != null) ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Stat label="Entry" value={formatPrice(outlook?.entry ?? outlook?.entry_zone_low)} />
          <Stat label="Stop" value={formatPrice(outlook?.stop)} tone="sell" />
          <Stat label="Target 1" value={formatPrice(outlook?.tp1)} tone="buy" />
        </View>
      ) : null}
      <Text variant="body" color="secondary" style={{ marginTop: 14 }}>{outlook?.rationale ? presentCustomerText(outlook.rationale) : 'XauCloud is monitoring Gold. No actionable outlook has been published yet.'}</Text>
    </Card>}

    <SectionHeader title="LIVE INTELLIGENCE" />
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <Card onPress={() => nav.navigate('TradingTab', { screen: 'TenMinuteEngine' })} style={{ flex: 1, minHeight: 150 }}><Ionicons name="pulse" size={22} color={colors.brand} /><Text variant="micro" color="tertiary" style={{ marginTop: 18, letterSpacing: 1 }}>10-MIN ENGINE</Text><Text variant="h2" style={{ marginTop: 4 }}>{presentCode(engine?.status, 'Watching')}</Text><Text variant="caption" color="secondary" style={{ marginTop: 5 }}>{engine?.confidence != null ? `${formatPercent(engine.confidence)} setup strength` : 'Scanning live structure'}</Text></Card>
      <Card onPress={() => nav.navigate('TradingTab', { screen: 'Signals' })} style={{ flex: 1, minHeight: 150 }}><Ionicons name="flash" size={22} color={colors.brand} /><Text variant="micro" color="tertiary" style={{ marginTop: 18, letterSpacing: 1 }}>LATEST SIGNAL</Text><Text variant="h2" style={{ marginTop: 4 }}>{latest?.direction || 'None'}</Text><Text variant="caption" color="secondary" style={{ marginTop: 5 }}>{latest?.entry != null ? `${latest.symbol ?? 'XAUUSD'} · ${formatPrice(latest.entry)}` : 'Waiting for quality'}</Text></Card>
    </View>

    <SectionHeader title="PERFORMANCE" />
    <Card onPress={() => nav.navigate('ActivityTab')}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text variant="caption" color="secondary">Verified account performance</Text><Text variant="h2" style={{ marginTop: 4 }}>{performanceQ.data?.sufficient_data ? `${formatPercent(performanceQ.data.win_rate)} win rate` : 'Building verified history'}</Text></View><View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="analytics" size={20} color={colors.brand} /></View></View></Card>
  </Screen>;
};
