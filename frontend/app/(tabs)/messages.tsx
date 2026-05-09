import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTabContentBottomPadding } from '../../src/lib/tabBarInsets';
import { Ionicons } from '@expo/vector-icons';
import { messageAPI } from '../../src/services/api';
import { emitMessageUnreadRefresh } from '../../src/lib/messageUnreadEvents';
import { wsClient } from '../../src/services/ws';
import { showInAppBanner } from '../../src/components/InAppBanner';
import { Conversation } from '../../src/types';
import { CONVERSATION_LOCAL_UPSERT, type ConversationUpsertPayload } from '../../src/lib/conversationEvents';

export default function MessagesScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const tabBottomPad = useTabContentBottomPadding();

  useEffect(() => {
    fetchConversations();
    const off = wsClient.on((evt) => {
      if (evt.type === 'refresh_conversations') void fetchConversations();
      if (evt.type === 'refresh_unread') emitMessageUnreadRefresh();
      if (evt.type === 'message_new' && evt.message) {
        const m = evt.message as any;
        const listingId = String(m?.listingId || '');
        const senderId = String(m?.senderId || '');
        const receiverId = String(m?.receiverId || '');
        const otherUserId = senderId;
        const preview = (m?.text && String(m.text).trim()) || (m?.image ? 'Photo' : 'Tap to open');
        const createdAt = String(m?.createdAt || new Date().toISOString());

        if (listingId && otherUserId) {
          // Update list locally immediately; backend refresh_conversations can be slow.
          setConversations((prev) => {
            const key = `${listingId}_${otherUserId}`;
            const next = [...prev];
            const idx = next.findIndex((c) => `${c.listingId}_${c.otherUserId}` === key);
            if (idx >= 0) {
              const cur = next[idx];
              const isIncoming = receiverId && senderId && cur.otherUserId === senderId;
              const unread = isIncoming ? cur.unreadCount + 1 : cur.unreadCount;
              next[idx] = {
                ...cur,
                lastMessage: preview,
                lastMessageTime: createdAt,
                unreadCount: unread,
              };
              const [moved] = next.splice(idx, 1);
              next.unshift(moved);
              return next;
            }
            // Conversation not in list yet; fetch in background to populate metadata.
            void fetchConversations();
            return prev;
          });
        }

        const title = 'New message';
        const body = preview;
        showInAppBanner({
          title,
          body,
          onPress: () => {
            if (listingId && senderId) router.push(`/chat/${listingId}/${senderId}`);
          },
        });
      }
    });
    const sub = DeviceEventEmitter.addListener(CONVERSATION_LOCAL_UPSERT, (p: ConversationUpsertPayload) => {
      if (!p?.listingId || !p?.otherUserId) return;
      setConversations((prev) => {
        const key = `${p.listingId}_${p.otherUserId}`;
        const next = [...prev];
        const idx = next.findIndex((c) => `${c.listingId}_${c.otherUserId}` === key);
        if (idx < 0) {
          // First message of a new conversation: insert immediately.
          const inserted: Conversation = {
            listingId: p.listingId,
            otherUserId: p.otherUserId,
            listingTitle: p.listingTitle || '',
            listingImage: p.listingImage || undefined,
            otherUserName: p.otherUserName || '',
            otherUserAvatar: p.otherUserAvatar || undefined,
            lastMessage: p.lastMessage || '',
            lastMessageTime: p.lastMessageTime || new Date().toISOString(),
            unreadCount: p.incrementUnread ? 1 : 0,
          };
          return [inserted, ...prev];
        }
        const cur = next[idx];
        next[idx] = {
          ...cur,
          listingTitle: cur.listingTitle || p.listingTitle || cur.listingTitle,
          listingImage: cur.listingImage || p.listingImage || cur.listingImage,
          otherUserName: cur.otherUserName || p.otherUserName || cur.otherUserName,
          otherUserAvatar: cur.otherUserAvatar || p.otherUserAvatar || cur.otherUserAvatar,
          lastMessage: p.lastMessage || cur.lastMessage,
          lastMessageTime: p.lastMessageTime || cur.lastMessageTime,
          unreadCount: p.incrementUnread ? cur.unreadCount + 1 : cur.unreadCount,
        };
        const [moved] = next.splice(idx, 1);
        next.unshift(moved);
        return next;
      });
    });
    void wsClient.connect();
    return () => {
      off();
      sub.remove();
    };
  }, [router]);

  const fetchConversations = async () => {
    try {
      const response = await messageAPI.getConversations();
      setConversations(response.data);
      emitMessageUnreadRefresh();
    } catch (error) {
      console.error('Fetch conversations error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    }
    if (diffInHours < 48) return 'Dün';
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: 'short',
    }).format(date);
  };

  const confirmDeleteConversation = (item: Conversation) => {
    const run = async () => {
      try {
        await messageAPI.deleteConversation(item.listingId, item.otherUserId);
        setConversations((prev) =>
          prev.filter((c) => !(c.listingId === item.listingId && c.otherUserId === item.otherUserId))
        );
        emitMessageUnreadRefresh();
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Sohbet silinemedi');
        } else {
          Alert.alert('Hata', 'Sohbet silinemedi');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu sohbeti silmek istiyor musunuz?')) void run();
      return;
    }
    Alert.alert('Sohbeti sil', 'Bu sohbeti silmek istiyor musunuz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const renderConversation = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={styles.conversationItem}
      onPress={() => router.push(`/chat/${item.listingId}/${item.otherUserId}`)}
      onLongPress={() => confirmDeleteConversation(item)}
      delayLongPress={350}
    >
      <View style={styles.listingImageContainer}>
        {item.listingImage ? (
          <Image source={{ uri: item.listingImage }} style={styles.listingImage} />
        ) : (
          <View style={[styles.listingImage, styles.noImage]}>
            <Ionicons name="image-outline" size={24} color="#ccc" />
          </View>
        )}
      </View>

      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Text style={styles.otherUserName} numberOfLines={1}>
            {item.otherUserName}
          </Text>
          <Text style={styles.time}>{formatTime(item.lastMessageTime)}</Text>
        </View>
        <Text style={styles.listingTitle} numberOfLines={1}>
          {item.listingTitle}
        </Text>
        <View style={styles.lastMessageRow}>
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.lastMessage}
          </Text>
          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color="#ff3b30" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mesajlar</Text>
      </View>

      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={(item) => `${item.listingId}_${item.otherUserId}`}
        contentContainerStyle={
          conversations.length === 0
            ? [styles.emptyList, { paddingBottom: tabBottomPad }]
            : { paddingBottom: tabBottomPad }
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Henüz mesajınız yok</Text>
            <Text style={styles.emptySubtext}>
              İlanlar üzerinden satıcılarla iletişime geçin
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  conversationItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  listingImageContainer: {
    marginRight: 12,
  },
  listingImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  noImage: {
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  otherUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  time: {
    fontSize: 12,
    color: '#999',
  },
  listingTitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  lastMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    fontSize: 14,
    color: '#999',
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
});
