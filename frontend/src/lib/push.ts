import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getExpoPushTokenSafe(): Promise<string | null> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== 'granted') return null;
    }
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data || null;
  } catch {
    return null;
  }
}

export function getPlatformLabel(): string {
  return Platform.OS;
}

