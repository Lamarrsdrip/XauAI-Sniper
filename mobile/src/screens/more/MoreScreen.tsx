import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Row, Badge } from '../../components';
import { Divider } from '../../components/Row';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';

type Props = NativeStackScreenProps<MoreStackParamList, 'More'>;

/**
 * Grouped information architecture matching web's More menu shape
 * (ACCOUNT / TRADING / PLAN / LEARN & SUPPORT / APP) instead of the flat
 * two-group list this screen used to have. Rows for bot-only features
 * (Bot Control, Bot & License) stay visible to every persona rather than
 * being hidden -- tapping them as a non-owner lands on that screen's own
 * LockedState with an upgrade path, the same pattern PositionDetails and
 * the Trading tab already use, instead of pretending the capability
 * doesn't exist.
 */
export const MoreScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { user, entitlement, signOut } = useAppState();

  const I = (n: keyof typeof Ionicons.glyphMap) => (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={n} size={18} color={colors.brand} />
    </View>
  );
  const planLabel = entitlement?.bot_license ? 'BOT' : entitlement?.signals_access ? 'PRO' : 'FREE';

  return (
    <Screen>
      <Text variant="micro" color="tertiary" style={{ letterSpacing: 2, marginTop: spacing.sm }}>ACCOUNT & SERVICES</Text>
      <Text variant="display" style={{ marginTop: 6 }}>More</Text>

      <Card onPress={() => navigation.navigate('Profile')} style={{ marginTop: spacing.xl, backgroundColor: colors.textPrimary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="h2" style={{ color: colors.brandOn }}>{(user?.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="h2" style={{ color: colors.bg }}>{user?.full_name || 'XauCloud user'}</Text>
            <Text variant="caption" style={{ color: colors.bg, opacity: 0.65 }}>{user?.email}</Text>
          </View>
          <Badge label={planLabel} tone="brand" />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>ACCOUNT</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Account & Security" subtitle="Sign-in, biometrics and password" left={I('shield-checkmark-outline')} showChevron onPress={() => navigation.navigate('Settings')} />
          <Divider inset />
          <Row title="Profile" subtitle="Name and account details" left={I('person-outline')} showChevron onPress={() => navigation.navigate('Profile')} />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>TRADING</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Bot Control" subtitle="Turn automation on/off, Prop Firm limits" left={I('toggle-outline')} showChevron onPress={() => navigation.navigate('BotControl')} />
          <Divider inset />
          <Row title="Bot & License" subtitle="Connect and manage automation" left={I('hardware-chip-outline')} showChevron onPress={() => navigation.navigate('BotLicense')} />
          <Divider inset />
          <Row title="AI Brain" subtitle="What XauCloud is thinking right now" left={I('sparkles-outline')} showChevron onPress={() => navigation.navigate('AIBrain')} />
          <Divider inset />
          <Row title="Pattern Scanner" subtitle="Live pattern context and playbook" left={I('scan-outline')} showChevron onPress={() => navigation.navigate('PatternScanner')} />
          <Divider inset />
          <Row title="Market Outlook" subtitle="Daily Gold bias and key levels" left={I('compass-outline')} showChevron onPress={() => navigation.getParent()?.navigate('TradingTab', { screen: 'MarketOutlook' } as never)} />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>PLAN</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Plan & Billing" subtitle="Subscription, purchases and access" left={I('wallet-outline')} showChevron onPress={() => navigation.navigate('Billing')} />
          <Divider inset />
          <Row title="Link Existing License" subtitle="Already own XauCloud Bot?" left={I('key-outline')} showChevron onPress={() => navigation.navigate('BotLicense')} />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>LEARN & SUPPORT</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Forex Academy" subtitle="Lessons, quizzes and certificates" left={I('school-outline')} showChevron onPress={() => navigation.getParent()?.navigate('LearnTab' as never)} />
          <Divider inset />
          <Row title="Support Center" subtitle="Get help from XauCloud" left={I('chatbubble-ellipses-outline')} showChevron onPress={() => navigation.navigate('Support')} />
          <Divider inset />
          <Row title="FAQ" subtitle="Common questions and quick help" left={I('help-circle-outline')} showChevron onPress={() => navigation.navigate('FAQ')} />
        </View>
      </Card>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm }}>APP</Text>
      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Notifications" subtitle="Signals, bot and account alerts" left={I('notifications-outline')} showChevron onPress={() => navigation.navigate('Notifications')} />
          <Divider inset />
          <Row title="Settings" subtitle="Appearance and app preferences" left={I('options-outline')} showChevron onPress={() => navigation.navigate('Settings')} />
        </View>
      </Card>

      <Card padded={false} style={{ marginTop: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Sign out" destructive left={<Ionicons name="log-out-outline" size={19} color={colors.sell} />} onPress={signOut} />
        </View>
      </Card>
      <Text variant="micro" color="tertiary" align="center" style={{ marginTop: spacing.xl, letterSpacing: 1 }}>XAUCLOUD · MOBILE 1.0.0</Text>
    </Screen>
  );
};
