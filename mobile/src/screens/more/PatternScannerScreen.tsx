import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, PremiumHero } from '../../components';
import { LockedState, Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { BotActivityEvent } from '../../api/types';
import { mockBotActivity, mockMonitorStatus } from '../../state/mockData';
import { presentCustomerText } from '../../utils/presentation';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'PatternScanner'>;

type PatternBias = 'bullish' | 'bearish' | 'neutral';
interface PatternDef { name: string; category: string; bias: PatternBias; description: string; checklist: string[]; }

// Same static playbook web's Pattern Scanner ships (CloudDashboard.jsx
// PATTERN_LIBRARY) -- educational content, not trade signals. Kept in sync
// with web's copy rather than reworded.
const PATTERN_LIBRARY: PatternDef[] = [
  { name: 'Double Bottom', category: 'Reversal', bias: 'bullish', description: 'Two defended lows near the same zone after a decline.', checklist: ['Decline or bearish context before pattern', 'Second low rejects instead of accelerating lower', 'Neckline / intervening swing breaks', 'Room exists before major resistance'] },
  { name: 'Double Top', category: 'Reversal', bias: 'bearish', description: 'Two rejected highs near the same zone after an advance.', checklist: ['Advance before pattern', 'Second high fails to continue', 'Intervening swing low breaks', 'Room exists before major support'] },
  { name: 'Head & Shoulders', category: 'Reversal', bias: 'bearish', description: 'Three-peak distribution where the middle peak extends furthest.', checklist: ['Prior uptrend', 'Right shoulder shows weaker continuation', 'Neckline has clear structure', 'Break or retest confirms rather than anticipating'] },
  { name: 'Inverse H&S', category: 'Reversal', bias: 'bullish', description: 'Three-trough accumulation where the middle trough extends furthest.', checklist: ['Prior downtrend', 'Right shoulder holds higher', 'Neckline is identifiable', 'Break/retest confirms'] },
  { name: 'Bull Flag', category: 'Continuation', bias: 'bullish', description: 'Strong impulse up followed by controlled downward/sideways pause.', checklist: ['Impulse is strong', 'Pullback is orderly and smaller than impulse', 'Structure does not fully reverse', 'Breakout has space to continue'] },
  { name: 'Bear Flag', category: 'Continuation', bias: 'bearish', description: 'Strong impulse down followed by controlled upward/sideways pause.', checklist: ['Impulse is strong', 'Retracement is corrective', 'Structure stays broadly bearish', 'Breakdown has room'] },
  { name: 'Ascending Triangle', category: 'Compression', bias: 'bullish', description: 'Flat resistance with progressively higher lows.', checklist: ['Repeated resistance tests', 'Higher lows are genuine', 'Compression does not become random chop', 'Wait for acceptance above resistance'] },
  { name: 'Descending Triangle', category: 'Compression', bias: 'bearish', description: 'Flat support with progressively lower highs.', checklist: ['Repeated support tests', 'Lower highs show pressure', 'Compression remains organized', 'Wait for acceptance below support'] },
  { name: 'Symmetrical Triangle', category: 'Compression', bias: 'neutral', description: 'Lower highs and higher lows compress volatility.', checklist: ['Both boundaries converge', 'Volume/volatility often contracts', 'Direction is not assumed in advance', 'Breakout needs confirmation and invalidation'] },
  { name: 'Rising Wedge', category: 'Exhaustion', bias: 'bearish', description: 'Price rises inside narrowing boundaries while momentum often weakens.', checklist: ['Prior rise or mature rally', 'Both boundaries slope upward', 'Progress is slowing', 'Break of lower boundary confirms'] },
  { name: 'Falling Wedge', category: 'Exhaustion', bias: 'bullish', description: 'Price falls inside narrowing boundaries while downside momentum often weakens.', checklist: ['Prior decline or mature selloff', 'Both boundaries slope downward', 'Downside progress is slowing', 'Upper-boundary break confirms'] },
  { name: 'Break & Retest', category: 'Structure', bias: 'neutral', description: 'Price breaks a meaningful level, returns, then accepts the new side.', checklist: ['Level was meaningful before break', 'Break has conviction', 'Retest holds the new side', 'Entry still has sensible invalidation and reward'] },
  { name: 'Engulfing Rejection', category: 'Candlestick', bias: 'neutral', description: 'A strong candle consumes the prior body at a meaningful level.', checklist: ['Occurs at useful structure', 'Candle closes with intent', 'Not entering after an already exhausted move', 'Risk is defined beyond invalidation'] },
  { name: 'Pin-Bar Rejection', category: 'Candlestick', bias: 'neutral', description: 'Long wick shows an attempted move was rejected.', checklist: ['Wick rejects meaningful liquidity/structure', 'Close returns into accepted area', 'Follow-through supports rejection', 'Do not treat every long wick as a signal'] },
];
const CATEGORIES = ['All', ...Array.from(new Set(PATTERN_LIBRARY.map((p) => p.category)))];
function biasTone(b: PatternBias): 'buy' | 'sell' | 'neutral' {
  return b === 'bullish' ? 'buy' : b === 'bearish' ? 'sell' : 'neutral';
}

function relativeTime(iso: unknown): string {
  if (typeof iso !== 'string' || !Number.isFinite(new Date(iso).getTime())) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function findLivePatternEvent(events: BotActivityEvent[]): BotActivityEvent | null {
  return events.find((e) => {
    const d = (e['details'] as Record<string, unknown>) ?? {};
    return Boolean(d['pattern'] ?? d['pattern_name'] ?? d['setup_pattern'] ?? d['chart_pattern'] ?? e['pattern']);
  }) ?? null;
}

export const PatternScannerScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement } = useAppState();
  const gated = Boolean(entitlement?.bot_activity || entitlement?.signals_access || entitlement?.outlook_access);
  const [selected, setSelected] = useState<PatternDef | null>(null);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');

  const statusQ = useCloudData(cloud.monitorStatus, mockMonitorStatus, [gated]);
  const activityQ = useCloudData(() => cloud.monitorActivity('all', 60), mockBotActivity, [gated]);

  if (!gated) {
    return (
      <Screen>
        <Header title="Pattern Scanner" onBack={() => goBackOrNavigate(navigation, 'More')} />
        <LockedState title="Pattern Scanner is locked" message="Subscribe to signals or connect XauCloud Bot to see live and educational chart patterns." onUpgrade={() => navigation.navigate('Billing')} />
      </Screen>
    );
  }
  if (activityQ.loading && !activityQ.data) {
    return (<Screen><Header title="Pattern Scanner" onBack={() => goBackOrNavigate(navigation, 'More')} /><Skeleton height={160} /></Screen>);
  }
  if (activityQ.error && !activityQ.data) {
    return (<Screen><Header title="Pattern Scanner" onBack={() => goBackOrNavigate(navigation, 'More')} /><ErrorState title="Couldn't load Pattern Scanner" message={activityQ.error} onAction={activityQ.refetch} /></Screen>);
  }
  if (activityQ.locked) {
    return (<Screen><Header title="Pattern Scanner" onBack={() => goBackOrNavigate(navigation, 'More')} /><LockedState title="Pattern Scanner is locked" message="Subscribe to signals or connect XauCloud Bot to see live and educational chart patterns." onUpgrade={() => navigation.navigate('Billing')} /></Screen>);
  }

  const events = activityQ.data?.events ?? [];
  const livePatternEvent = findLivePatternEvent(events);
  const d = (livePatternEvent?.['details'] as Record<string, unknown>) ?? {};
  const livePattern = livePatternEvent ? String(d['pattern'] ?? d['pattern_name'] ?? d['setup_pattern'] ?? d['chart_pattern'] ?? livePatternEvent['pattern'] ?? '') : null;
  const liveDecision = livePatternEvent ? String(d['decision'] ?? livePatternEvent['decision'] ?? livePatternEvent.message ?? '') : '';
  const symbol = statusQ.data?.heartbeat?.symbol ?? 'XAUUSD';

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => PATTERN_LIBRARY.filter((p) => (filter === 'All' || p.category === filter) && (!q || `${p.name} ${p.category} ${p.description} ${p.checklist.join(' ')}`.toLowerCase().includes(q))),
    [filter, q],
  );

  if (selected) {
    return (
      <Screen>
        <Header title={selected.name} onBack={() => setSelected(null)} />
        <PremiumHero tone={biasTone(selected.bias) === 'buy' ? 'buy' : biasTone(selected.bias) === 'sell' ? 'sell' : 'graphite'}>
          <Text variant="micro" color="inverse" style={{ opacity: 0.7, letterSpacing: 1.1 }}>{selected.category.toUpperCase()} PATTERN</Text>
          <Text variant="h1" color="inverse" style={{ marginTop: spacing.sm }}>{selected.name}</Text>
          <Text variant="body" color="inverse" style={{ marginTop: 6, opacity: 0.86 }}>{selected.description}</Text>
        </PremiumHero>
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.1 }}>PROFESSIONAL CHECKLIST</Text>
          {selected.checklist.map((item, i) => (
            <View key={item} style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="micro" color="brand">{i + 1}</Text>
              </View>
              <Text variant="body" color="secondary" style={{ flex: 1, marginTop: 1 }}>{item}</Text>
            </View>
          ))}
        </Card>
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
          <Text variant="captionMedium" color="brand">INVALIDATION MATTERS MORE THAN THE NAME</Text>
          <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
            A pattern is not a guaranteed forecast. Define what would prove the setup wrong, size the position from that invalidation, and demand enough room for the trade to make sense after spread and slippage.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={activityQ.refetch} refreshing={activityQ.loading}>
      <Header title="Pattern Scanner" onBack={() => goBackOrNavigate(navigation, 'More')} />
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.md }}>
        Live XauCloud context when the EA reports a pattern, plus a complete chart-pattern playbook.
      </Text>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text variant="h2">{symbol}</Text>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: livePattern ? colors.buy : colors.disabledBg, marginTop: 4 }} />
        </View>
        <Text variant="micro" color="tertiary" style={{ marginTop: spacing.sm, letterSpacing: 1 }}>EA-CONFIRMED LIVE PATTERN</Text>
        {livePattern ? (
          <>
            <Text variant="h3" color="buy" style={{ marginTop: 4 }}>{livePattern}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 3 }}>{liveDecision ? presentCustomerText(liveDecision) : 'Pattern context reported by the connected EA'} · {relativeTime(livePatternEvent?.created_at ?? livePatternEvent?.ts)}</Text>
          </>
        ) : (
          <>
            <Text variant="bodyMedium" style={{ marginTop: 4 }}>No confirmed pattern right now</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 3, lineHeight: 17 }}>We do not invent detections on your device. A live label appears only when the connected EA/backend reports one.</Text>
          </>
        )}
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.disabledBg, borderRadius: 14, paddingHorizontal: spacing.md, marginTop: spacing.lg }}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search pattern, category, or checklist"
          placeholderTextColor={colors.textTertiary}
          style={{ flex: 1, minHeight: 44, fontSize: 15, color: colors.textPrimary }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => setFilter(c)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: 999, backgroundColor: filter === c ? colors.brand : colors.disabledBg }}>
            <Text variant="captionMedium" style={{ color: filter === c ? colors.brandOn : colors.textSecondary }}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {rows.map((p) => (
        <Card key={p.name} onPress={() => setSelected(p)} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text variant="bodyMedium" numberOfLines={1}>{p.name}</Text>
              <Text variant="caption" color="secondary" numberOfLines={2} style={{ marginTop: 3 }}>{p.description}</Text>
            </View>
            <Badge label={p.bias} tone={biasTone(p.bias)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
};
