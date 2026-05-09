import { DeviceEventEmitter } from 'react-native';

export const CONVERSATION_LOCAL_UPSERT = 'conversationLocalUpsert';

export type ConversationUpsertPayload = {
  listingId: string;
  otherUserId: string;
  lastMessage: string;
  lastMessageTime: string;
  incrementUnread?: boolean;
  listingTitle?: string;
  listingImage?: string | null;
  otherUserName?: string;
  otherUserAvatar?: string | null;
};

export function emitConversationLocalUpsert(p: ConversationUpsertPayload): void {
  DeviceEventEmitter.emit(CONVERSATION_LOCAL_UPSERT, p);
}

