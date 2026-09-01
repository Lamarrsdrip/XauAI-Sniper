import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, Row } from '../../components';
import { Divider } from '../../components/Row';
import { useTheme } from '../../theme/ThemeProvider';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'FAQ'>;

// Same copy as the public marketing FAQ (frontend/src/components/FaqSection.jsx)
// -- XauCloud has no separate authenticated FAQ content; this is the real
// content that exists, just not previously reachable once signed in.
const FAQ: Array<{ q: string; a: string }> = [
  { q: 'What is XauCloud?', a: 'An automated Expert Advisor for MetaTrader 5 that trades Gold (XAUUSD). It analyzes the market, qualifies setups, and manages approved trades on your behalf.' },
  { q: 'Which platform and symbol does it use?', a: "MetaTrader 5, Gold (XAUUSD) only. Use a broker whose exact XAUUSD symbol, spread, and execution you've verified on demo — compatibility is broker-specific." },
  { q: 'Does it use martingale or grid?', a: 'No. Position sizing comes from your account risk settings and a defined stop loss. It never averages down or multiplies lot size to recover a loss.' },
  { q: 'Do I need a VPS?', a: "A VPS keeps MT5 running continuously and is recommended. It isn't required to get started, and free remote VPS activation is included after purchase." },
  { q: 'Are profits guaranteed?', a: 'No. XauCloud is designed to trade with discipline and defined risk, but no trading system can guarantee profit. Start on demo and risk only what you can afford to lose.' },
];

export const FAQScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const I = (n: keyof typeof Ionicons.glyphMap) => (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={n} size={18} color={colors.brand} />
    </View>
  );

  return (
    <Screen>
      <Header title="FAQ & Help" onBack={() => goBackOrNavigate(navigation, 'More')} />

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginBottom: spacing.sm }}>GET HELP BY TOPIC</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Bot Setup Help" subtitle="Connect MT5, licensing and VPS" left={I('hardware-chip-outline')} showChevron onPress={() => navigation.navigate('BotLicense')} />
          <Divider inset />
          <Row title="License Help" subtitle="Activation keys and linking" left={I('key-outline')} showChevron onPress={() => navigation.navigate('BotLicense')} />
          <Divider inset />
          <Row title="Billing Help" subtitle="Plans, payments and receipts" left={I('wallet-outline')} showChevron onPress={() => navigation.navigate('Billing')} />
          <Divider inset />
          <Row title="Trading Help" subtitle="Learn how XauCloud trades" left={I('school-outline')} showChevron onPress={() => navigation.getParent()?.navigate('LearnTab' as never)} />
          <Divider inset />
          <Row title="Contact Support" subtitle="Open a ticket with our team" left={I('chatbubble-ellipses-outline')} showChevron onPress={() => navigation.navigate('Support')} />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginTop: spacing.xl, marginBottom: spacing.sm }}>COMMON QUESTIONS</Text>
      <View style={{ gap: spacing.sm }}>
        {FAQ.map((item, i) => (
          <Card key={item.q} onPress={() => setOpen(open === i ? null : i)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyMedium" style={{ flex: 1 }}>{item.q}</Text>
              <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
            </View>
            {open === i && <Text variant="body" color="secondary" style={{ marginTop: spacing.sm, lineHeight: 21 }}>{item.a}</Text>}
          </Card>
        ))}
      </View>
    </Screen>
  );
};
