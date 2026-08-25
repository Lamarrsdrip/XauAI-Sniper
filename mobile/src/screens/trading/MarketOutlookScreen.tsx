import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, SegmentedTabs } from '../../components';
import { LockedState, Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockOutlook } from '../../state/mockData';

type Props = NativeStackScreenProps<TradingStackParamList, 'MarketOutlook'>;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export const MarketOutlookScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement } = useAppState();
  const [tab, setTab] = useState('Overview');
  const q = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);

  if (!entitlement?.outlook_access) {
    return (
      <Screen>
        <Header title="Market Outlook" onBack={() => navigation.goBack()} />
        <LockedState title="Market Outlook is locked" message="Get a signal subscription or XauCloud Bot license to see XauCloud's daily Gold bias and key levels." />
      </Screen>
    );
  }

  const s = q.data?.signal;
  const biasTone = s?.direction === 'BUY' ? 'buy' : s?.direction === 'SELL' ? 'sell' : 'neutral';
  const biasLabel = s?.direction === 'BUY' ? 'BULLISH' : s?.direction === 'SELL' ? 'BEARISH' : 'NEUTRAL';

  return (
    <Screen onRefresh={q.refetch} refreshing={q.loading}>
      <Header title="Market Outlook" onBack={() => navigation.goBack()} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load Market Outlook" message={q.error} onAction={q.refetch} />
      ) : !q.data?.available ? (
        <Card><Text variant="body" color="secondary">{q.data?.reason ?? 'Market Outlook is temporarily unavailable.'}</Text></Card>
      ) : !s ? (
        <Card><Text variant="body" color="secondary">XauCloud hasn't published an Outlook yet.</Text></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Badge label={biasLabel} tone={biasTone} dot />
              <Text variant="caption" color="tertiary">Updated {timeAgo(s.updated_at)}</Text>
            </View>
            <Text variant="display" style={{ marginTop: spacing.sm }}>
              {s.direction === 'BUY' ? 'Gold currently has bullish momentum.' : s.direction === 'SELL' ? 'Gold currently has bearish momentum.' : 'Gold is in a neutral range right now.'}
            </Text>
            {s.rationale && <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>{s.rationale}</Text>}
            {s.confidence != null && (
              <View style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text variant="caption" color="secondary">Confidence</Text>
                  <Text variant="captionMedium">{s.confidence}%</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.disabledBg }}>
                  <View style={{ height: 6, borderRadius: 3, width: `${s.confidence}%`, backgroundColor: colors.buy }} />
                </View>
              </View>
            )}
          </Card>

          <View style={{ marginTop: spacing.md }}>
            <SegmentedTabs options={['Overview', 'Levels', 'Market Context']} value={tab} onChange={setTab} />
          </View>

          {tab === 'Overview' && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Scenario</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>
                {s.entry != null && s.stop != null
                  ? `While price holds relative to ${s.stop.toFixed(2)}, XauCloud favors continuation toward ${s.tp1?.toFixed(2) ?? 'target'}. A move back through the stop level would invalidate this bias.`
                  : 'XauCloud is tracking Gold; no explicit trade scenario is attached to this Outlook update.'}
              </Text>
            </Card>
          )}

          {tab === 'Levels' && (
            <Card style={{ marginTop: spacing.md }}>
              {s.tp1 != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs }}>
                  <Text variant="bodyMedium" color={s.direction === 'BUY' ? 'buy' : 'sell'}>Target</Text>
                  <Text variant="numericSm">{s.tp1.toFixed(2)}</Text>
                </View>
              )}
              {s.entry != null && (
                <>
                  <View style={{ height: 1, backgroundColor: colors.divider }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs }}>
                    <Text variant="bodyMedium">Entry reference</Text>
                    <Text variant="numericSm">{s.entry.toFixed(2)}</Text>
                  </View>
                </>
              )}
              {s.stop != null && (
                <>
                  <View style={{ height: 1, backgroundColor: colors.divider }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs }}>
                    <Text variant="bodyMedium" color={s.direction === 'BUY' ? 'sell' : 'buy'}>Invalidation</Text>
                    <Text variant="numericSm">{s.stop.toFixed(2)}</Text>
                  </View>
                </>
              )}
              {s.entry == null && s.stop == null && s.tp1 == null && (
                <Text variant="body" color="secondary">No specific levels attached to this update.</Text>
              )}
            </Card>
          )}

          {tab === 'Market Context' && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Source</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>
                {q.data.health.online ? 'Live feed connected.' : 'Feed offline — showing the last update received.'}
                {s.expires_at ? ` This read is valid until ${new Date(s.expires_at).toLocaleTimeString()}.` : ''}
              </Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
};
