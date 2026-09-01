import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HomeStackParamList } from '../../navigation/types';
import { Badge, Button, Card, Header, PremiumHero, Screen, Stat, Text } from '../../components';
import { ErrorState, LockedState, Skeleton } from '../../components/States';
import { cloud } from '../../api/cloud';
import { useCloudData } from '../../api/useCloudData';
import { mockCurrentOpinion } from '../../state/mockData';
import { useAppState } from '../../state/AppState';
import { useTheme } from '../../theme/ThemeProvider';
import { asFiniteNumber, formatMoney, formatPrice } from '../../utils/format';
import { goBackOrNavigate } from '../../navigation/safeBack';
import { presentCustomerText } from '../../utils/presentation';

type Props = NativeStackScreenProps<HomeStackParamList, 'PositionDetails'>;

function positionProgress(direction: string | null | undefined, entry?: number | null, current?: number | null, target?: number | null): number | null {
  if (![entry, current, target].every((value) => typeof value === 'number')) return null;
  const start = entry as number;
  const now = current as number;
  const end = target as number;
  const span = direction === 'SELL' ? start - end : end - start;
  if (!Number.isFinite(span) || span === 0) return null;
  const raw = direction === 'SELL' ? (start - now) / span : (now - start) / span;
  // Clamped so the bar stays meaningful even when price has moved past its planned range.
  return Math.max(0, Math.min(1, raw));
}

export const PositionDetailsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing, radius } = useTheme();
  const { entitlement } = useAppState();
  const q = useCloudData(cloud.currentOpinion, mockCurrentOpinion, [entitlement?.bot_activity]);
  const position = q.data;
  const fixedTarget = asFiniteNumber(position?.tp);
  const hasFixedTarget = fixedTarget != null && fixedTarget > 0;
  // A tp of 0 means "no fixed broker target" (EA-managed dynamic exit), not
  // a real price to progress toward -- never compute a bar against it.
  const progress = hasFixedTarget ? positionProgress(position?.direction, position?.entry_price, position?.current_price, fixedTarget) : null;
  const direction = position?.direction === 'SELL' ? 'sell' : 'buy';

  return (
    <Screen>
      <Header title="Live Position" onBack={() => goBackOrNavigate(navigation, 'Home')} />
      {!entitlement?.bot_activity ? (
        // Real bug: without this gate, a free/subscriber-only user landing
        // here (e.g. a stale nav state) saw "No live position -- your bot
        // is monitoring..." -- which flatly implies they own a connected
        // bot when they don't. The backend is already safely scoped (a
        // deactivated/missing license resolves to no data at the query
        // level, see services/commandLicense.ts), this was purely a
        // misleading mobile message.
        <LockedState title="Live position tracking is a Bot feature" message="Connect XauCloud Bot to see your live MT5 position." onLinkLicense={() => (navigation.getParent() as any)?.navigate('MoreTab', { screen: 'BotLicense' })} />
      ) : q.loading && !position ? <Skeleton height={330} /> : q.error && !position ? (
        <ErrorState title="Couldn't load the position" message={q.error} onAction={q.refetch} />
      ) : !position?.open ? (
        <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl }}>
          <Ionicons name="analytics-outline" size={30} color={colors.brand} />
          <Text variant="h2" style={{ marginTop: spacing.sm }}>No live position</Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: 6, maxWidth: 290 }}>
            Your bot is monitoring verified conditions and will only enter when its risk plan allows it.
          </Text>
          <Button label="Open Bot Health" variant="secondary" style={{ marginTop: spacing.lg }} onPress={() => (navigation.getParent() as any)?.navigate('MoreTab', { screen: 'BotLicense' })} />
        </Card>
      ) : (
        <>
          <PremiumHero tone={direction} style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text variant="micro" color="inverse" style={{ opacity: 0.68, letterSpacing: 1.3 }}>ACTIVE BOT POSITION</Text>
                <Text variant="display" color="inverse" style={{ marginTop: 6 }}>{position.symbol ?? 'XAUUSD'}</Text>
              </View>
              <Badge label={position.direction ?? 'OPEN'} tone={direction} />
            </View>
            <Text variant="numeric" color="inverse" style={{ marginTop: spacing.lg }}>{formatMoney(position.floating_pl, 2, true)}</Text>
            <Text variant="caption" color="inverse" style={{ opacity: 0.68, marginTop: 3 }}>Live floating P/L · {position.lot_size != null ? `${position.lot_size} lots` : 'Lot size unavailable'}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}><Text variant="caption" color="inverse" style={{ opacity: 0.62 }}>POSITION AGE</Text><Text variant="numericSm" color="inverse" style={{ marginTop: 3 }}>{position.trade_age_minutes != null ? `${position.trade_age_minutes}m` : '—'}</Text></View>
              <View style={{ flex: 1 }}><Text variant="caption" color="inverse" style={{ opacity: 0.62 }}>PROTECTED P/L</Text><Text variant="numericSm" color="inverse" style={{ marginTop: 3 }}>{formatMoney(position.protected_profit, 2, true)}</Text></View>
            </View>
          </PremiumHero>

          <Card style={{ marginTop: spacing.md }}>
            <Text variant="captionMedium" color="brand">PRICE PLAN</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Stat label="Entry" value={formatPrice(position.entry_price)} />
              <Stat label="Current" value={formatPrice(position.current_price)} />
              <Stat label="Stop loss" value={formatPrice(position.sl)} />
              <Stat label={hasFixedTarget ? 'Target' : 'Exit plan'} value={hasFixedTarget ? formatPrice(position.tp) : 'No fixed target'} />
            </View>
            {progress != null && (
              <View style={{ marginTop: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="caption" color="secondary">Progress from entry to target</Text>
                  <Text variant="captionMedium" color="brand">{Math.round(progress * 100)}%</Text>
                </View>
                <View style={{ height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.disabledBg, marginTop: 7 }}>
                  <View style={{ width: `${Math.max(4, progress * 100)}%`, height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand }} />
                </View>
              </View>
            )}
          </Card>

          <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
            <Text variant="captionMedium" color="brand">BOT MANAGEMENT</Text>
            <Text variant="h3" style={{ marginTop: 4 }}>{position.current_bot_decision ? presentCustomerText(position.current_bot_decision) : 'Position is being monitored'}</Text>
            <Text variant="body" color="secondary" style={{ marginTop: spacing.xs, lineHeight: 21 }}>
              {position.current_reason ? presentCustomerText(position.current_reason) : 'XauCloud is managing this position against its server-authoritative risk plan.'}
            </Text>
          </Card>

          {!hasFixedTarget && position.what_would_close ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text variant="captionMedium" color="brand">EXIT CONDITIONS</Text>
              <Text variant="body" color="secondary" style={{ marginTop: 5 }}>{presentCustomerText(position.what_would_close)}</Text>
            </Card>
          ) : null}

          <Text variant="caption" color="tertiary" align="center" style={{ marginTop: spacing.lg }}>
            Prices and management state are supplied by your connected XauCloud account. This screen does not place or alter trades.
          </Text>
        </>
      )}
    </Screen>
  );
};
