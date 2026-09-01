import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { USE_MOCK_DATA } from '../api/config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let lastRegisteredToken: string | null = null;

/**
 * Registers this device for native push (APNs via FCM on iOS, FCM directly
 * on Android — both surface as a single Expo push token) and hands the
 * token to the backend's `POST /cloud/notifications/device-token`, which
 * feeds `sendUserPush()`'s native-push branch (services/expoPush.ts) — the
 * same fan-out point as the existing VAPID web push. Requires an EAS
 * project id in app.json (`expo build:configure` / `eas init`) before
 * `getExpoPushTokenAsync()` can mint a real token — the one remaining
 * owner-account step, not a code gap.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators/emulators have no push token

  // Expo Go (including a free-provisioned SDK-matched build) may not carry
  // the APS entitlement needed to mint a token. Notification preview must
  // never block login or crash the whole customer shell in that container.
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#BF8F26',
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    lastRegisteredToken = token;

    if (!USE_MOCK_DATA) {
      await api
        .post('/cloud/notifications/device-token', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
        .catch(() => {
          // best-effort: a failed registration should never block app usage
        });
    }

    return token;
  } catch {
    return null;
  }
}

/** Called on sign-out so a discarded session's device stops receiving native push. */
export async function unregisterCurrentPushToken(): Promise<void> {
  if (USE_MOCK_DATA || !lastRegisteredToken) return;
  await api.post('/cloud/notifications/device-token/remove', { token: lastRegisteredToken }).catch(() => {});
  lastRegisteredToken = null;
}

/**
 * Deep-link target derived from a notification's data payload. Categories
 * mirror backend_node's NOTIFICATION_CATEGORIES exactly (notifications.ts);
 * screen names mirror navigation/linking.ts.
 */
export interface NotificationRoute {
  tab: 'TradingTab' | 'MoreTab';
  screen: string;
  params?: Record<string, unknown>;
}

export function routeForNotification(data: Record<string, unknown>): NotificationRoute | null {
  const category = data.category as string | undefined;
  switch (category) {
    case 'SIGNALS':
    case 'TRADES':
      return data.signal_id
        ? { tab: 'TradingTab', screen: 'SignalDetails', params: { id: data.signal_id } }
        : { tab: 'TradingTab', screen: 'Signals' };
    case 'MARKET_OUTLOOK':
      return { tab: 'TradingTab', screen: 'MarketOutlook' };
    case 'SUPPORT':
      return data.ticket_id
        ? { tab: 'MoreTab', screen: 'TicketThread', params: { id: data.ticket_id, subject: data.subject ?? 'Support' } }
        : { tab: 'MoreTab', screen: 'Support' };
    case 'LICENSE':
    case 'BOT_UPDATES':
      return { tab: 'MoreTab', screen: 'BotLicense' };
    case 'PAYMENTS':
      return { tab: 'MoreTab', screen: 'Billing' };
    default:
      return null;
  }
}
