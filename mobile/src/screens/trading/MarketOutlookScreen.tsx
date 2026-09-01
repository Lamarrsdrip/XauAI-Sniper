import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, SegmentedTabs, PremiumHero } from '../../components';
import { LockedState, Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockOutlook } from '../../state/mockData';
import { formatDateTime, formatPercent, formatPrice, formatTime } from '../../utils/format';
import { goBackOrNavigate } from '../../navigation/safeBack';
import { presentCode, presentCustomerText } from '../../utils/presentation';
import { mockOutlookCurrent } from '../../state/mockData';
import { MarketOutlookDoc } from '../../api/types';

type Props = NativeStackScreenProps<TradingStackParamList, 'MarketOutlook'>;

function timeAgo(iso: unknown): string {
  if (typeof iso !== 'string' || !Number.isFinite(new Date(iso).getTime())) return 'recently';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function unavailableCopy(): string {
  return "No confirmed Gold outlook yet. XauCloud is still monitoring the market and hasn't confirmed a high-quality direction.";
}

/** Formats a result already expressed in R plus its already-converted pips, matching web's resultText(). */
function resultText(r: unknown, pips: unknown): string {
  const rNum = typeof r === 'number' && Number.isFinite(r) ? r : null;
  if (rNum == null) return '—';
  const sign = rNum >= 0 ? '+' : '';
  const pipsNum = typeof pips === 'number' && Number.isFinite(pips) ? pips : null;
  return pipsNum != null ? `${sign}${rNum.toFixed(2)}R (${sign}${pipsNum.toFixed(1)} pips)` : `${sign}${rNum.toFixed(2)}R`;
}

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
    <Text variant="caption" color="secondary" style={{ flexShrink: 1 }}>{label}</Text>
    <Text variant="captionMedium" align="right" style={{ flexShrink: 1 }}>{value}</Text>
  </View>
);

const LevelRow: React.FC<{ label: string; value: unknown; tone: 'buy' | 'sell' | 'brand' | 'secondary' }> = ({ label, value, tone }) => {
  const { colors, spacing, radius } = useTheme();
  const dot = tone === 'buy' ? colors.buy : tone === 'sell' ? colors.sell : tone === 'brand' ? colors.brand : colors.textTertiary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
      <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: dot }} />
      <Text variant="bodyMedium" style={{ flex: 1 }}>{label}</Text>
      <Text variant="numericSm">{formatPrice(value)}</Text>
    </View>
  );
};

export const MarketOutlookScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement } = useAppState();
  const [tab, setTab] = useState('Overview');
  const q = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);
  // Full-parity data source -- see api/types.ts MarketOutlookDoc for why this
  // is a superset of `q.data.signal` above: the lighter /cloud/signals/outlook
  // shape doesn't carry structure/risk-policy/milestone/history fields at all.
  const detailQ = useCloudData(cloud.outlookCurrent, mockOutlookCurrent, [entitlement?.outlook_access]);
  const historyQ = useCloudData(() => cloud.outlookHistory(20), { outlooks: [], timeline: [], signal_events: [], stats: {}, reason: '' }, [entitlement?.outlook_access]);

  // Checked two ways on purpose -- see SignalsScreen for why: the cached
  // entitlement flag alone isn't enough to guarantee a lapsed trial/sub
  // stops showing content, only what the server just said for this fetch is.
  if (!entitlement?.outlook_access || q.locked) {
    return (
      <Screen>
        <Header title="Market Outlook" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />
        <LockedState
          title="Market Outlook is locked"
          message="Get a signal subscription or XauCloud Bot license to see XauCloud's daily Gold bias and key levels."
          onUpgrade={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Billing' })}
        />
      </Screen>
    );
  }

  const s = q.data?.signal;
  const biasLabel = s?.direction === 'BUY' || s?.direction === 'SELL' ? s.direction : 'NEUTRAL';
  const directionTone = s?.direction === 'BUY' ? 'buy' : s?.direction === 'SELL' ? 'sell' : 'graphite';
  const directionCopy = s?.direction === 'BUY' ? 'Gold currently has bullish momentum.' : s?.direction === 'SELL' ? 'Gold currently has bearish momentum.' : 'Gold is waiting for a clearer direction.';

  return (
    <Screen onRefresh={q.refetch} refreshing={q.loading}>
      <Header title="Market Outlook" onBack={() => goBackOrNavigate(navigation, 'TradingHome')} />

      {q.loading && !q.data ? (
        <Skeleton height={220} />
      ) : q.error ? (
        <ErrorState title="Couldn't load Market Outlook" message={q.error} onAction={q.refetch} />
      ) : !q.data?.available ? (
        <Card><Text variant="body" color="secondary">{unavailableCopy()}</Text></Card>
      ) : !s ? (
        <Card><Text variant="body" color="secondary">XauCloud hasn't published an Outlook yet.</Text></Card>
      ) : (
        <>
          <PremiumHero tone={directionTone}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: '#58D68D' }} /><Text variant="micro" color="inverse" style={{ opacity: 0.74, letterSpacing: 1.1 }}>XAUUSD OUTLOOK</Text></View>
              <Text variant="micro" color="inverse" style={{ opacity: 0.7 }}>Updated {timeAgo(s.updated_at)}</Text>
            </View>
            <Text variant="display" color="inverse" style={{ marginTop: spacing.sm }}>{biasLabel}</Text>
            <Text variant="body" color="inverse" style={{ marginTop: 2, opacity: 0.86 }}>{directionCopy}</Text>
            {s.confidence != null && (
              <View style={{ marginTop: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text variant="micro" color="inverse" style={{ opacity: 0.72 }}>MODEL CONFIDENCE</Text>
                  <Text variant="captionMedium" color="inverse">{formatPercent(s.confidence)}</Text>
                </View>
                <View style={{ height: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)' }}>
                <View style={{ height: 7, borderRadius: 99, width: `${Math.min(Math.max(Number(s.confidence) || 0, 0), 100)}%`, backgroundColor: '#FFFFFF' }} />
                </View>
              </View>
            )}
          </PremiumHero>

          <Card style={{ marginTop: spacing.md }}>
            <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>TRADE PLAN</Text>
            {s.entry_zone_low != null || s.entry_zone_high != null ? <LevelRow label="Entry zone" value={s.entry_zone_low ?? s.entry_zone_high} tone="brand" /> : null}
            {s.entry != null ? <LevelRow label="Entry" value={s.entry} tone="brand" /> : null}
            {s.stop != null ? <LevelRow label="Stop loss" value={s.stop} tone="sell" /> : null}
            {s.tp1 != null ? <LevelRow label="Take profit 1" value={s.tp1} tone="buy" /> : null}
            {s.tp2 != null ? <LevelRow label="Take profit 2" value={s.tp2} tone="buy" /> : null}
            {s.tp3 != null ? <LevelRow label="Take profit 3" value={s.tp3} tone="buy" /> : null}
            {s.entry == null && s.stop == null && s.tp1 == null && s.entry_zone_low == null && s.entry_zone_high == null ? <Text variant="body" color="secondary" style={{ marginTop: 7 }}>No trade levels are confirmed for this outlook yet.</Text> : null}
          </Card>

          {s.rationale ? <Card style={{ marginTop: spacing.md }}><Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>WHY XAUCLOUD SEES THIS</Text><Text variant="body" color="secondary" style={{ marginTop: 7 }}>{presentCustomerText(s.rationale)}</Text></Card> : null}

          <View style={{ marginTop: spacing.md }}>
            <SegmentedTabs options={['Overview', 'Levels', 'Details', 'History']} value={tab} onChange={setTab} />
          </View>

          {tab === 'Overview' && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="h3">Scenario</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 6 }}>{typeof s.expected_path === 'string' && s.expected_path.trim() ? presentCustomerText(s.expected_path) : s.entry != null && s.stop != null ? `If Gold holds above the stop level at ${formatPrice(s.stop)}, XauCloud favors a move toward ${s.tp1 != null ? formatPrice(s.tp1) : 'the first target'}. A move through the stop invalidates this plan.` : 'XauCloud is monitoring Gold and will publish a complete trade plan when levels are confirmed.'}</Text>
            </Card>
          )}

          {tab === 'Levels' && (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>PRICE LADDER</Text>
              {s.tp3 != null && <LevelRow label="Target 3" value={s.tp3} tone={s.direction === 'BUY' ? 'buy' : 'sell'} />}
              {s.tp2 != null && <LevelRow label="Target 2" value={s.tp2} tone={s.direction === 'BUY' ? 'buy' : 'sell'} />}
              {s.tp1 != null && <LevelRow label="Target 1" value={s.tp1} tone={s.direction === 'BUY' ? 'buy' : 'sell'} />}
              {s.entry != null && <LevelRow label="Entry reference" value={s.entry} tone="brand" />}
              {s.stop != null && <LevelRow label="Invalidation" value={s.stop} tone={s.direction === 'BUY' ? 'sell' : 'buy'} />}
              {s.entry == null && s.stop == null && s.tp1 == null && (
                <Text variant="body" color="secondary">No specific levels attached to this update.</Text>
              )}
            </Card>
          )}

          {tab === 'Details' && (() => {
            const od: MarketOutlookDoc | null = detailQ.data?.outlook ?? null;
            return (
              <>
                <Card style={{ marginTop: spacing.md }}>
                  <Text variant="h3">Source</Text>
                  <Text variant="body" color="secondary" style={{ marginTop: 6 }}>
                    {q.data.health.online ? 'Live feed connected.' : 'Feed offline — showing the last update received.'}
                    {s.expires_at ? ` This read is valid until ${formatTime(s.expires_at)}.` : ''}
                  </Text>
                </Card>

                {detailQ.loading && !detailQ.data ? (
                  <Skeleton height={120} style={{ marginTop: spacing.md }} />
                ) : !od ? (
                  <Card style={{ marginTop: spacing.md }}>
                    <Text variant="body" color="secondary">Deeper structure and risk-plan detail will appear once XauCloud publishes a full outlook document for your linked account.</Text>
                  </Card>
                ) : (
                  <>
                    {(od.structure_state || od.trend_state || od.market_regime) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>STRUCTURE & CONTEXT</Text>
                        {od.structure_state ? <DetailRow label="Structure" value={presentCode(od.structure_state)} /> : null}
                        {od.trend_state ? <DetailRow label="Trend" value={presentCode(od.trend_state)} /> : null}
                        {od.market_regime ? <DetailRow label="Market regime" value={presentCode(od.market_regime)} /> : null}
                        {od.setup_type ? <DetailRow label="Setup type" value={presentCode(od.setup_type)} /> : null}
                        {od.expected_path ? <DetailRow label="Expected path" value={presentCode(od.expected_path)} /> : null}
                      </Card>
                    )}

                    {(od.buy_pressure != null || od.sell_pressure != null || od.exhaustion_pct != null || od.remaining_room_r != null) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>PRESSURE & ROOM</Text>
                        {od.buy_pressure != null ? <DetailRow label="Buy pressure" value={String(od.buy_pressure)} /> : null}
                        {od.sell_pressure != null ? <DetailRow label="Sell pressure" value={String(od.sell_pressure)} /> : null}
                        {od.exhaustion_pct != null ? <DetailRow label="Exhaustion" value={formatPercent(od.exhaustion_pct)} /> : null}
                        {od.movement_consumed_pct != null ? <DetailRow label="Movement consumed" value={formatPercent(od.movement_consumed_pct)} /> : null}
                        {od.remaining_room_r != null ? <DetailRow label="Remaining room" value={resultText(od.remaining_room_r, null)} /> : null}
                      </Card>
                    )}

                    {(od.uncertainty || od.directional_conflict) && (
                      <Card style={{ marginTop: spacing.md, backgroundColor: colors.warnBg, borderColor: 'transparent' }}>
                        <Text variant="captionMedium" color="warn">WHAT WOULD INVALIDATE THIS</Text>
                        {od.uncertainty ? <Text variant="body" color="secondary" style={{ marginTop: 4 }}>{presentCustomerText(od.uncertainty)}</Text> : null}
                        {od.directional_conflict ? <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>Downgraded to transition: {presentCustomerText(od.directional_conflict)}</Text> : null}
                      </Card>
                    )}

                    {(od.final_structural_sl != null || od.configured_risk_pct != null) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>RISK PLAN</Text>
                        {od.raw_structural_sl != null ? <DetailRow label="Raw structural SL" value={formatPrice(od.raw_structural_sl)} /> : null}
                        {od.sl_widening_factor != null ? <DetailRow label="Widening factor" value={`×${od.sl_widening_factor}`} /> : null}
                        {od.final_structural_sl != null ? <DetailRow label="Final SL" value={formatPrice(od.final_structural_sl)} /> : null}
                        {od.configured_risk_pct != null ? <DetailRow label="Target risk" value={formatPercent(od.configured_risk_pct)} /> : null}
                      </Card>
                    )}

                    {(od.current_r != null || od.mfe_r != null || od.mae_r != null) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>RESULT SO FAR</Text>
                        {od.current_r != null ? <DetailRow label="Current" value={resultText(od.current_r, od.current_pips)} /> : null}
                        {od.mfe_r != null ? <DetailRow label="Best (MFE)" value={resultText(od.mfe_r, od.mfe_pips)} /> : null}
                        {od.mae_r != null ? <DetailRow label="Worst (MAE)" value={resultText(od.mae_r, od.mae_pips)} /> : null}
                      </Card>
                    )}

                    {(od.tp1_hit_at || od.tp2_hit_at || od.tp3_hit_at || od.sl_hit_at || od.first_half_r_at) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>MILESTONES</Text>
                        {od.first_half_r_at ? <DetailRow label="+0.5R" value={formatDateTime(od.first_half_r_at)} /> : null}
                        {od.tp1_hit_at ? <DetailRow label="TP1 hit" value={formatDateTime(od.tp1_hit_at)} /> : null}
                        {od.tp2_hit_at ? <DetailRow label="TP2 hit" value={formatDateTime(od.tp2_hit_at)} /> : null}
                        {od.tp3_hit_at ? <DetailRow label="TP3 hit" value={formatDateTime(od.tp3_hit_at)} /> : null}
                        {od.sl_hit_at ? <DetailRow label="Stop hit" value={formatDateTime(od.sl_hit_at)} /> : null}
                      </Card>
                    )}

                    {(od.published_at || od.evaluation_deadline || od.last_monitored_at) && (
                      <Card style={{ marginTop: spacing.md }}>
                        <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>TIMING</Text>
                        {od.published_at ? <DetailRow label="Published" value={formatDateTime(od.published_at)} /> : null}
                        {od.evaluation_deadline ? <DetailRow label="Evaluation deadline" value={formatDateTime(od.evaluation_deadline)} /> : null}
                        {od.last_monitored_at ? <DetailRow label="Last monitored" value={formatDateTime(od.last_monitored_at)} /> : null}
                        {od.latest_path_event ? <DetailRow label="Latest path event" value={presentCode(od.latest_path_event)} /> : null}
                      </Card>
                    )}

                    {od.data_integrity_status === 'INVALID_DATA' && (
                      <Card style={{ marginTop: spacing.md, backgroundColor: colors.sellBg, borderColor: 'transparent' }}>
                        <Text variant="captionMedium" color="sell">FLAGGED — EXCLUDED FROM PERFORMANCE STATS</Text>
                        {od.data_integrity_note ? <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>{presentCustomerText(od.data_integrity_note)}</Text> : null}
                      </Card>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {tab === 'History' && (
            historyQ.loading && !historyQ.data ? (
              <Skeleton height={160} style={{ marginTop: spacing.md }} />
            ) : historyQ.error ? (
              <ErrorState title="Couldn't load Outlook history" message={historyQ.error} onAction={historyQ.refetch} />
            ) : !historyQ.data?.outlooks?.length ? (
              <Card style={{ marginTop: spacing.md }}>
                <Text variant="body" color="secondary">No past Outlook history is available for your linked account yet.</Text>
              </Card>
            ) : (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {historyQ.data.outlooks.slice(0, 20).map((row, index) => {
                  const dir = row.primary_direction === 'BUY' || row.primary_direction === 'SELL' ? row.primary_direction : null;
                  const tone = dir === 'BUY' ? 'buy' : dir === 'SELL' ? 'sell' : 'graphite';
                  return (
                    <Card key={row.id ?? index}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                        <View style={{ flexShrink: 1, minWidth: 0 }}>
                          <Text variant="bodyMedium">{dir ?? 'No confirmed direction'}{row.confidence_pct != null ? ` · ${row.confidence_pct}%` : ''}</Text>
                          <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{formatDateTime(row.generated_at ?? row.published_at)}</Text>
                        </View>
                        {row.analytics_outcome ? <Badge label={presentCode(row.analytics_outcome)} tone={tone === 'buy' ? 'buy' : tone === 'sell' ? 'sell' : 'neutral'} /> : null}
                      </View>
                      {dir && (row.current_r != null || row.mfe_r != null) ? (
                        <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
                          Result {resultText(row.current_r ?? row.analytics_r, row.current_pips)} · MFE {resultText(row.mfe_r, row.mfe_pips)}
                        </Text>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            )
          )}
        </>
      )}
    </Screen>
  );
};
