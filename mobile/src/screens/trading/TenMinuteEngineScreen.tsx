import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button } from '../../components';
import { LockedState, Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockEngine } from '../../state/mockData';
import { SubscriberSignalStatus } from '../../api/types';

type Props = NativeStackScreenProps<TradingStackParamList, 'TenMinuteEngine'>;

const STATE_COPY: Record<SubscriberSignalStatus, { label: string; plain: string; tone: 'buy' | 'sell' | 'info' | 'neutral' }> = {
  WATCHING: { label: 'Watching', plain: 'XauCloud is watching a developing area on Gold.', tone: 'info' },
  ACTIONABLE: { label: 'Setup Confirmed', plain: 'A setup has been confirmed on Gold.', tone: 'buy' },
  BLOCKED: { label: 'No Strong Setup Right Now', plain: 'Conditions are not strong enough for a trade at the moment.', tone: 'neutral' },
  EXPIRED: { label: 'Setup Expired', plain: 'The last setup window has expired. XauCloud is watching for the next one.', tone: 'neutral' },
};

export const TenMinuteEngineScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement } = useAppState();
  const [showTechnical, setShowTechnical] = useState(false);
  const q = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);

  if (!entitlement?.engine_10m_access) {
    return (
      <Screen>
        <Header title="10-Minute Engine" onBack={() => navigation.goBack()} />
        <LockedState title="10-Minute Engine is locked" message="Live setup detection for XAUUSD updates every 10 minutes for subscribers and bot owners." />
      </Screen>
    );
  }

  const s = q.data?.signal;
  const copy = s ? STATE_COPY[s.status] : STATE_COPY.BLOCKED;
  const toneForDirection = s?.direction === 'BUY' ? 'buy' : s?.direction === 'SELL' ? 'sell' : copy.tone;

  return (
    <Screen onRefresh={q.refetch} refreshing={q.loading}>
      <Header title="10-Minute Engine" onBack={() => navigation.goBack()} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load the Engine" message={q.error} onAction={q.refetch} />
      ) : !q.data?.available ? (
        <Card><Text variant="body" color="secondary">{q.data?.reason ?? '10-Minute Engine is temporarily unavailable.'}</Text></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: q.data.health.online ? colors.buy : colors.textTertiary }} />
              <Text variant="caption" color="secondary">{q.data.health.online ? 'Live' : 'Offline'} · updated {s ? new Date(s.updated_at).toLocaleTimeString() : '—'}</Text>
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Badge label={copy.label} tone={toneForDirection} />
            </View>
            <Text variant="h1" style={{ marginTop: spacing.sm }}>{copy.plain}</Text>

            {s?.confidence != null && (
              <View style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text variant="caption" color="secondary">Strength</Text>
                  <Text variant="captionMedium">{s.confidence}%</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.disabledBg }}>
                  <View style={{ height: 6, borderRadius: 3, width: `${s.confidence}%`, backgroundColor: colors.buy }} />
                </View>
              </View>
            )}
          </Card>

          {s?.rationale && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Why XauCloud sees this setup</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>{s.rationale}</Text>
            </Card>
          )}

          {s && (
            <>
              <Button
                label={showTechnical ? 'Hide technical details' : 'See technical details'}
                variant="ghost"
                onPress={() => setShowTechnical((v) => !v)}
                style={{ marginTop: spacing.md, alignSelf: 'center' }}
              />
              {showTechnical && (
                <Card style={{ marginTop: spacing.sm }}>
                  <Text variant="caption" color="secondary">
                    Signal ID: {s.signal_id} · Status: {s.status} · Direction: {s.direction || '—'} · Effective: {new Date(s.effective_at).toLocaleString()}
                  </Text>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
};
