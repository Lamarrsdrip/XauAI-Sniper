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
import { goBackOrNavigate } from '../../navigation/safeBack';
import { presentCode, presentCustomerText } from '../../utils/presentation';
import { formatDateTime, formatTime } from '../../utils/format';

type Props = NativeStackScreenProps<TradingStackParamList, 'TenMinuteEngine'>;

const STATE_COPY: Record<SubscriberSignalStatus, { label: string; plain: string; tone: 'buy' | 'sell' | 'info' | 'neutral' }> = {
  WATCHING: { label: 'Watching', plain: 'XauCloud is watching a developing area on Gold.', tone: 'info' },
  ACTIONABLE: { label: 'Setup Confirmed', plain: 'A setup has been confirmed on Gold.', tone: 'buy' },
  BLOCKED: { label: 'No Strong Setup Right Now', plain: 'Conditions are not strong enough for a trade at the moment.', tone: 'neutral' },
  EXPIRED: { label: 'Setup Expired', plain: 'The last setup window has expired. XauCloud is watching for the next one.', tone: 'neutral' },
  TP1_HIT: { label: 'First target reached', plain: 'The setup reached its first target. Review the latest signal update for the current plan.', tone: 'buy' },
  TP2_HIT: { label: 'Second target reached', plain: 'The setup reached its second target. Review the latest signal update for the current plan.', tone: 'buy' },
  TP3_HIT: { label: 'Final target reached', plain: 'The setup reached its final target.', tone: 'buy' },
  SL_HIT: { label: 'Risk limit reached', plain: 'The setup reached its defined risk limit. XauCloud is watching for the next qualified setup.', tone: 'sell' },
  INVALIDATED: { label: 'Setup invalidated', plain: 'Conditions changed before the setup could remain valid.', tone: 'neutral' },
  CLOSED: { label: 'Setup closed', plain: 'This setup is complete. XauCloud is watching for the next qualified setup.', tone: 'neutral' },
};

export const TenMinuteEngineScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement } = useAppState();
  const [showTechnical, setShowTechnical] = useState(false);
  const q = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);

  // Checked two ways on purpose -- see SignalsScreen for why.
  if (!entitlement?.engine_10m_access || q.locked) {
    return (
      <Screen>
        <Header title="10-Minute Engine" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />
        <LockedState
          title="10-Minute Engine is locked"
          message="Live setup detection for XAUUSD updates every 10 minutes for subscribers and bot owners."
          onUpgrade={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Billing' })}
        />
      </Screen>
    );
  }

  const s = q.data?.signal;
  const copy = s ? STATE_COPY[s.status] : STATE_COPY.BLOCKED;
  const toneForDirection = s?.direction === 'BUY' ? 'buy' : s?.direction === 'SELL' ? 'sell' : copy.tone;
  const buyEvidence = s?.buy_evidence ?? s?.buy_case_score;
  const sellEvidence = s?.sell_evidence ?? s?.sell_case_score;

  return (
    <Screen onRefresh={q.refetch} refreshing={q.loading}>
      <Header title="10-Minute Engine" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load the Engine" message={q.error} onAction={q.refetch} />
      ) : !q.data?.available ? (
        <Card><Text variant="body" color="secondary">No confirmed 10-minute setup yet. XauCloud is monitoring Gold and will only surface a setup when the evidence is strong enough.</Text></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: q.data.health.online ? colors.buy : colors.textTertiary }} />
              <Text variant="caption" color="secondary">{q.data.health.online ? 'Live' : 'Offline'} · updated {s ? formatTime(s.updated_at) : '—'}</Text>
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
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>{presentCustomerText(s.rationale)}</Text>
            </Card>
          )}

          {(buyEvidence != null || sellEvidence != null) && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">What the Engine is weighing</Text>
              {([
                ['Buying evidence', buyEvidence, colors.buy],
                ['Selling evidence', sellEvidence, colors.sell],
              ] as const).map(([label, score, color]) => score != null ? (
                <View key={label} style={{ marginTop: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text variant="caption" color="secondary">{label}</Text>
                    <Text variant="captionMedium">{Math.round(score)}%</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.disabledBg }}>
                    <View style={{ height: 6, borderRadius: 3, width: `${Math.min(Math.max(score, 0), 100)}%`, backgroundColor: color }} />
                  </View>
                </View>
              ) : null)}
              {s?.trend_state || s?.structure_state || s?.location_state ? (
                <Text variant="caption" color="secondary" style={{ marginTop: spacing.md }}>
                  {[s.trend_state, s.structure_state, s.location_state].filter(Boolean).map((value) => presentCode(value)).join(' · ')}
                </Text>
              ) : null}
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
                    {copy.label} · {s.direction || 'No direction'} · Evaluated {formatDateTime(s.last_evaluated_at ?? s.updated_at)}
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
