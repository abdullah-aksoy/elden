import { DeviceEventEmitter } from 'react-native';

/** Profil rozetini veya satış bildirimi listesini yenilemek için (tab layout + profil + ilan detay). */
export const BUYER_SALE_NOTIFICATIONS_REFRESH = 'buyerSaleNotificationsRefresh';

export function requestBuyerSaleNotificationsRefresh(): void {
  DeviceEventEmitter.emit(BUYER_SALE_NOTIFICATIONS_REFRESH);
}
