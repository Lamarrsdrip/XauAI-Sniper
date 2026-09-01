import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, StatusBadge, Header, PremiumHero, Stat } from '../../components';
import { LockedState, Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { BotActivityEvent } from '../../api/types';
import { mockBotActivity, mockMonitorStatus } from '../../state/mockData';
import { formatDateTime, formatPercent } from '../../utils/format';
import { presentCode, presentCustomerText } from '../../utils/presentation';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'AIBrain'>;

const AI_PATTERN = /AI|DIRECTOR|CLAUDE|GPT|CONFIDENCE/i;
const ML_PATTERN = /\bML\b|HIVE|MODEL/i;

function eventText(e: BotActivityEvent): string {
  return `${e.title ?? ''} ${e.message ?? ''} ${e.kind ?? ''}`;
}

function numField(e: BotActivityEvent, key: string): number | null {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const EventRow: React.FC<{ e: BotActivityEvent }> = ({ e }) => {
  const { spacing } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.sm }}>
      <Text variant="bodyMedium">{presentCode(e.title ?? e.kind, 'Bot event')}</Text>
      {e.message ? <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>{presentCustomerText(e.message)}</Text> : null}
      <Text variant="micro" color="tertiary" style={{ marginTop: 3 }}>{formatDateTime(e.created_at ?? e.ts)}</Text>
    </View>
  );
};

export const AIBrainScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing, colors } = useTheme();
  const { entitlement } = useAppState();
  const gated = Boolean(entitlement?.bot_activity || entitlement?.signals_access || entitlement?.outlook_access);

  const statusQ = useCloudData(cloud.monitorStatus, mockMonitorStatus, [gated]);
  const activityQ = useCloudData(() => cloud.monitorActivity('all', 60), mockBotActivity, [gated]);

  if (!gated) {
    return (
      <Screen>
        <Header title="AI Brain" onBack={() => goBackOrNavigate(navigation, 'More')} />
        <LockedState title="AI Brain is locked" message="Subscribe to signals or connect XauCloud Bot to see what XauCloud's AI is currently thinking." onUpgrade={() => navigation.navigate('Billing')} />
      </Screen>
    );
  }

  const refetchAll = () => { statusQ.refetch(); activityQ.refetch(); };
  if (activityQ.loading && !activityQ.data) {
    return (<Screen><Header title="AI Brain" onBack={() => goBackOrNavigate(navigation, 'More')} /><Skeleton height={180} /><Skeleton height={220} style={{ marginTop: spacing.md }} /></Screen>);
  }
  if (activityQ.error && !activityQ.data) {
    return (<Screen><Header title="AI Brain" onBack={() => goBackOrNavigate(navigation, 'More')} /><ErrorState title="Couldn't load AI Brain" message={activityQ.error} onAction={refetchAll} /></Screen>);
  }
  if (activityQ.locked || statusQ.locked) {
    return (<Screen><Header title="AI Brain" onBack={() => goBackOrNavigate(navigation, 'More')} /><LockedState title="AI Brain is locked" message="Subscribe to signals or connect XauCloud Bot to see what XauCloud's AI is currently thinking." onUpgrade={() => navigation.navigate('Billing')} /></Screen>);
  }

  const events = activityQ.data?.events ?? [];
  const status = statusQ.data;
  const heartbeat = status?.heartbeat;

  // The single most recent event that actually carries a decision/confidence
  // field -- these are only present on AI-director events, not heartbeats.
  const latestAiEvent = events.find((e) => numField(e, 'ai_confidence') != null || typeof e['decision'] === 'string') ?? null;
  const confidence = latestAiEvent ? numField(latestAiEvent, 'ai_confidence') : null;
  const decision = latestAiEvent ? (latestAiEvent['decision'] as string | undefined) : undefined;
  const blockReason = latestAiEvent ? (latestAiEvent['reason'] as string | undefined) : undefined;

  const aiEvents = events.filter((e) => AI_PATTERN.test(eventText(e))).slice(0, 15);
  const mlEvents = events.filter((e) => ML_PATTERN.test(eventText(e))).slice(0, 15);
  const dayAgo = Date.now() - 24 * 3600_000;
  const blockedCount = events.filter((e) => {
    const t = new Date(String(e.created_at ?? e.ts ?? 0)).getTime();
    return Number.isFinite(t) && t >= dayAgo && /block/i.test(eventText(e));
  }).length;

  return (
    <Screen onRefresh={refetchAll} refreshing={statusQ.loading || activityQ.loading}>
      <Header title="AI Brain" onBack={() => goBackOrNavigate(navigation, 'More')} />
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.md }}>
        A customer-safe read of what XauCloud's decision engine is doing right now — not an internal model console.
      </Text>

      <PremiumHero tone={decision && /block/i.test(decision) ? 'sell' : decision ? 'buy' : 'graphite'}>
        <Text variant="micro" color="inverse" style={{ opacity: 0.7, letterSpacing: 1.1 }}>WHAT XAUCLOUD IS THINKING</Text>
        <Text variant="h1" color="inverse" style={{ marginTop: spacing.sm }}>
          {decision ? presentCode(decision) : 'Monitoring the market'}
        </Text>
        {blockReason ? <Text variant="body" color="inverse" style={{ marginTop: 4, opacity: 0.86 }}>{presentCustomerText(blockReason)}</Text> : null}
        {confidence != null && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text variant="micro" color="inverse" style={{ opacity: 0.72 }}>CONFIDENCE</Text>
              <Text variant="captionMedium" color="inverse">{formatPercent(confidence)}</Text>
            </View>
            <View style={{ height: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <View style={{ height: 7, borderRadius: 99, width: `${Math.min(Math.max(confidence, 0), 100)}%`, backgroundColor: '#FFFFFF' }} />
            </View>
          </View>
        )}
        {!latestAiEvent && <Text variant="caption" color="inverse" style={{ marginTop: spacing.sm, opacity: 0.7 }}>No AI decision event has been published yet for your account.</Text>}
      </PremiumHero>

      <Card style={{ marginTop: spacing.md }}>
        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>SYSTEM STATE</Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
          <Stat label="Spread" value={heartbeat?.spread != null ? String(heartbeat.spread) : '—'} />
          <Stat label="Algo trading" value={heartbeat?.algo_trading ? 'On' : heartbeat?.algo_trading === false ? 'Off' : '—'} />
          <Stat label="Blocks (24h)" value={String(blockedCount)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md }}>
          <Text variant="caption" color="secondary">Equity protection</Text>
          <StatusBadge label={status?.equity_protection_state ? presentCode(status.equity_protection_state) : 'Unknown'} tone={status?.equity_protection_state === 'PROTECTED' ? 'buy' : 'neutral'} maxWidth="60%" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs }}>
          <Text variant="caption" color="secondary">Intelligence sync</Text>
          <StatusBadge label={status?.intelligence_sync_state ? presentCode(status.intelligence_sync_state) : 'Unknown'} tone={status?.intelligence_sync_state === 'synced' ? 'buy' : 'neutral'} maxWidth="60%" />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginTop: spacing.xl, marginBottom: spacing.sm }}>AI DIRECTOR EVENTS</Text>
      <Card padded={aiEvents.length > 0}>
        {aiEvents.length ? aiEvents.map((e, i) => (
          <React.Fragment key={e.id ?? i}>
            <EventRow e={e} />
            {i < aiEvents.length - 1 && <View style={{ height: 1, backgroundColor: colors.divider }} />}
          </React.Fragment>
        )) : <EmptyState icon="sparkles-outline" title="No AI Director events yet" message="Decisions the AI Director publishes for your account will appear here." />}
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginTop: spacing.xl, marginBottom: spacing.sm }}>ML + HIVE EVENTS</Text>
      <Card padded={mlEvents.length > 0}>
        {mlEvents.length ? mlEvents.map((e, i) => (
          <React.Fragment key={e.id ?? i}>
            <EventRow e={e} />
            {i < mlEvents.length - 1 && <View style={{ height: 1, backgroundColor: colors.divider }} />}
          </React.Fragment>
        )) : <EmptyState icon="git-network-outline" title="No ML / Hive events yet" message="Machine-learning and Hive-model events will appear here once published." />}
      </Card>
      <Text variant="caption" color="tertiary" style={{ marginTop: spacing.sm }}>
        Detailed ML sample counts and Hive verdict telemetry are not wired into the customer view yet — this screen only shows real, published events, never estimated numbers.
      </Text>
    </Screen>
  );
};
