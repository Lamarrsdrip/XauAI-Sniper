import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, PremiumHero, SectionHeader } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockOutlook, mockEngine } from '../../state/mockData';
import { formatPercent } from '../../utils/format';
import { presentCode } from '../../utils/presentation';

type Props = NativeStackScreenProps<TradingStackParamList, 'TradingHome'>;
type Icon = keyof typeof Ionicons.glyphMap;

const directionTone = (value?: string | null): 'buy' | 'sell' | 'graphite' => value === 'BUY' ? 'buy' : value === 'SELL' ? 'sell' : 'graphite';

const TradeModule: React.FC<{ icon: Icon; title: string; detail: string; tone: 'brand' | 'buy' | 'sell' | 'info'; badge?: React.ReactNode; onPress: () => void }> = ({ icon, title, detail, tone, badge, onPress }) => {
  const { colors, spacing, radius } = useTheme();
  const fill = tone === 'buy' ? colors.buyBg : tone === 'sell' ? colors.sellBg : tone === 'info' ? colors.infoBg : colors.brandMuted;
  const ink = tone === 'buy' ? colors.buy : tone === 'sell' ? colors.sell : tone === 'info' ? colors.info : colors.brand;
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={21} color={ink} /></View>
        <View style={{ flex: 1, gap: 2 }}><Text variant="h3">{title}</Text><Text variant="caption" color="secondary">{detail}</Text></View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>{badge}<Ionicons name="arrow-forward" size={17} color={colors.textTertiary} /></View>
      </View>
    </Card>
  );
};

export const TradingHomeScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const { entitlement } = useAppState();
  const outlookQ = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);
  const engineQ = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);
  const outlook = outlookQ.data?.signal;
  const engine = engineQ.data?.signal;
  const direction = outlook?.direction;
  const decision = direction === 'BUY' || direction === 'SELL' ? direction : 'MONITORING';

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={{ paddingHorizontal: spacing.md }}>
      <Header title="Trading desk" large />
      <PremiumHero tone={directionTone(direction)} style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View><Text variant="micro" color="inverse" style={{ opacity: 0.7, letterSpacing: 1.3 }}>XAUUSD · LIVE DECISION DESK</Text><Text variant="display" color="inverse" style={{ marginTop: 7 }}>{decision}</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}><View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: direction ? '#58D68D' : '#EFD495' }} /><Text variant="micro" color="inverse">{outlookQ.loading ? 'SYNCING' : 'LIVE'}</Text></View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: spacing.xl, gap: spacing.md }}>
          <View style={{ flex: 1 }}><Text variant="micro" color="inverse" style={{ opacity: 0.62 }}>MARKET OUTLOOK</Text><Text variant="numericSm" color="inverse" style={{ marginTop: 4 }}>{outlook?.confidence != null ? formatPercent(outlook.confidence, 0) : 'Awaiting data'}</Text></View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}><Text variant="micro" color="inverse" style={{ opacity: 0.62 }}>M10 ENGINE</Text><Text variant="numericSm" color="inverse" style={{ marginTop: 4 }}>{presentCode(engine?.status, 'Watching')}</Text></View>
        </View>
      </PremiumHero>

      <SectionHeader title="MARKET INTELLIGENCE" />
      <TradeModule icon="compass-outline" title="Market Outlook" detail="Bias, narrative and institution-grade levels" tone={direction === 'SELL' ? 'sell' : direction === 'BUY' ? 'buy' : 'brand'} badge={entitlement?.outlook_access && direction ? <Badge label={direction} tone={direction === 'BUY' ? 'buy' : 'sell'} /> : undefined} onPress={() => navigation.navigate('MarketOutlook')} />
      <TradeModule icon="pulse-outline" title="10-Minute Engine" detail="Fast setup detection with evidence" tone="info" badge={entitlement?.engine_10m_access && engine?.status ? <Badge label={presentCode(engine.status)} tone="info" /> : undefined} onPress={() => navigation.navigate('TenMinuteEngine')} />
      <SectionHeader title="EXECUTION" />
      <TradeModule icon="flash-outline" title="Signals feed" detail="Server-published entries and outcome timeline" tone="brand" onPress={() => navigation.navigate('Signals')} />
      <TradeModule icon="hardware-chip-outline" title="XauCloud Bot" detail={entitlement?.bot_license ? 'Monitor your linked MT5 automation' : 'Link your purchased MT5 automation licence'} tone="info" badge={entitlement?.bot_license ? <Badge label="Linked" tone="buy" /> : <Badge label="Locked" tone="neutral" />} onPress={() => navigation.getParent()?.navigate('MoreTab', { screen: 'BotLicense' })} />
      <Text variant="caption" color="tertiary" align="center" style={{ marginTop: spacing.sm }}>Decisions and levels are supplied by your XauCloud account. Never treat this view as investment advice.</Text>
    </Screen>
  );
};
