import React from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Header } from '../../components';
import { Divider } from '../../components/Row';
import { Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockNotifications } from '../../state/mockData';
import { NotificationLogItem } from '../../api/types';
import { Ionicons } from '@expo/vector-icons';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'Notifications'>;

// Mirrors backend_node/src/services/notifications.ts NOTIFICATION_CATEGORIES exactly.
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  TRADES: 'swap-horizontal-outline',
  MARKET_OUTLOOK: 'compass-outline',
  SIGNALS: 'flash-outline',
  LICENSE: 'hardware-chip-outline',
  BOT_UPDATES: 'hardware-chip-outline',
  PAYMENTS: 'card-outline',
  MARKETING: 'megaphone-outline',
  SYSTEM: 'shield-checkmark-outline',
  SUPPORT: 'help-buoy-outline',
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export const NotificationsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const q = useCloudData(cloud.notifications, mockNotifications, []);

  const onOpen = async (item: NotificationLogItem) => {
    if (!item.read_at) {
      await cloud.markNotificationRead(item.id).catch(() => {});
      q.refetch();
    }
  };

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Notifications" onBack={() => goBackOrNavigate(navigation, 'More')} />
      {q.loading && !q.data ? (
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}><Skeleton height={56} /><Skeleton height={56} /><Skeleton height={56} /></View>
      ) : q.error ? (
        <View style={{ paddingHorizontal: 16 }}><ErrorState title="Couldn't load notifications" message={q.error} onAction={q.refetch} /></View>
      ) : !(q.data?.items ?? []).length ? (
        <View style={{ paddingHorizontal: 16 }}><EmptyState icon="notifications-off-outline" title="No notifications yet" /></View>
      ) : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(n) => n.id}
          ItemSeparatorComponent={() => <Divider inset />}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          onRefresh={q.refetch}
          refreshing={q.loading}
          renderItem={({ item }) => (
            <Pressable onPress={() => onOpen(item)} style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={ICONS[item.category] ?? 'notifications-outline'} size={17} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>{item.title}</Text>
                  <Text variant="caption" color="tertiary">{timeAgo(item.scheduled_time)}</Text>
                </View>
                <Text variant="caption" color="secondary" numberOfLines={2} style={{ marginTop: 2 }}>{item.body}</Text>
              </View>
              {!item.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 }} />}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
};
