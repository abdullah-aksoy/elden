import { DeviceEventEmitter } from 'react-native';

export const MESSAGE_UNREAD_REFRESH = 'messageUnreadRefresh';

export function emitMessageUnreadRefresh() {
  DeviceEventEmitter.emit(MESSAGE_UNREAD_REFRESH);
}
