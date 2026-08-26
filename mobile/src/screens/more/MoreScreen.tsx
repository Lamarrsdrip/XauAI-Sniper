import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Row, Header, Badge } from '../../components';
import { Divider } from '../../components/Row';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<MoreStackParamList, 'More'>;

export const MoreScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { user, entitlement, signOut } = useAppState();

  const Icon = (name: keyof typeof Ionicons.glyphMap) => <Ionicons name={name} size={19} color={colors.textSecondary} />;

  return (
    <Screen>
      <Header title="More" large />

      <Card onPress={() => navigation.navigate('Profile')} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="h3" color="brand">{(user?.full_name?.[0] ?? user?.email[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">{user?.full_name || 'XauCloud user'}</Text>
            <Text variant="caption" color="secondary">{user?.email}</Text>
          </View>
          <Badge label={entitlement?.bot_license ? 'Bot' : entitlement?.signals_access ? 'Subscriber' : 'Free'} tone={entitlement?.bot_license ? 'buy' : entitlement?.signals_access ? 'brand' : 'neutral'} />
        </View>
      </Card>

      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Notifications" left={Icon('notifications-outline')} showChevron onPress={() => navigation.navigate('Notifications')} />
          <Divider inset />
          <Row title="Bot / License" left={Icon('hardware-chip-outline')} showChevron onPress={() => navigation.navigate('BotLicense')} />
          <Divider inset />
          <Row title="Billing" left={Icon('card-outline')} showChevron onPress={() => navigation.navigate('Billing')} />
          <Divider inset />
          <Row title="Support" left={Icon('help-buoy-outline')} showChevron onPress={() => navigation.navigate('Support')} />
          <Divider inset />
          <Row title="Settings" left={Icon('settings-outline')} showChevron onPress={() => navigation.navigate('Settings')} />
        </View>
      </Card>

      <Card padded={false} style={{ marginTop: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Row title="Sign out" destructive left={<Ionicons name="log-out-outline" size={19} color={colors.sell} />} onPress={signOut} />
        </View>
      </Card>

      <Text variant="caption" color="tertiary" align="center" style={{ marginTop: spacing.lg }}>
        XauCloud · v1.0.0 (prototype)
      </Text>
    </Screen>
  );
};
