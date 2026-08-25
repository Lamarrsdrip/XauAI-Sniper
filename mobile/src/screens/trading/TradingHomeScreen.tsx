import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockOutlook, mockEngine } from '../../state/mockData';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<TradingStackParamList, 'TradingHome'>;

const Item: React.FC<{ icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; badge?: React.ReactNode; onPress: () => void }> = ({
  icon,
  title,
  subtitle,
  badge,
  onPress,
}) => {
  const { colors, spacing, radius } = useTheme();
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{title}</Text>
          <Text variant="caption" color="secondary">{subtitle}</Text>
        </View>
        {badge}
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
    </Card>
  );
};

export const TradingHomeScreen: React.FC<Props> = ({ navigation }) => {
  const { entitlement } = useAppState();
  const outlookQ = useCloudData(cloud.outlook, mockOutlook, [entitlement?.outlook_access]);
  const engineQ = useCloudData(cloud.engine, mockEngine, [entitlement?.engine_10m_access]);
  const outlookDir = outlookQ.data?.signal?.direction;
  const engineStatus = engineQ.data?.signal?.status;

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Trading" large />
      <View style={{ paddingHorizontal: 16 }}>
        <Item
          icon="compass-outline"
          title="Market Outlook"
          subtitle="Daily bias, key levels, market context"
          badge={entitlement?.outlook_access && outlookDir ? <Badge label={outlookDir} tone={outlookDir === 'BUY' ? 'buy' : outlookDir === 'SELL' ? 'sell' : 'neutral'} /> : undefined}
          onPress={() => navigation.navigate('MarketOutlook')}
        />
        <Item
          icon="pulse-outline"
          title="10-Minute Engine"
          subtitle="Live setup detection, updated every 10 min"
          badge={entitlement?.engine_10m_access && engineStatus ? <Badge label={engineStatus.replace('_', ' ')} tone="info" /> : undefined}
          onPress={() => navigation.navigate('TenMinuteEngine')}
        />
        <Item
          icon="flash-outline"
          title="Signals"
          subtitle="Recent XAUUSD entries and results"
          onPress={() => navigation.navigate('Signals')}
        />
        {!entitlement?.bot_license && (
          <Item
            icon="hardware-chip-outline"
            title="XauCloud Bot"
            subtitle="Automated MT5 execution"
            badge={<Badge label="Locked" tone="neutral" />}
            onPress={() => navigation.getParent()?.navigate('MoreTab', { screen: 'BotLicense' })}
          />
        )}
      </View>
    </Screen>
  );
};
