import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  Alert,
  Dimensions,
  Pressable,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { messageAPI, listingAPI, userAPI } from '../../../src/services/api';
import { useAuth } from '../../../src/contexts/AuthContext';
import { Message } from '../../../src/types';
import { emitMessageUnreadRefresh } from '../../../src/lib/messageUnreadEvents';
import { wsClient } from '../../../src/services/ws';
import { uploadImageToR2 } from '../../../src/lib/uploads';
import { useFocusEffect } from '@react-navigation/native';
import { emitConversationLocalUpsert } from '../../../src/lib/conversationEvents';

const MAX_MESSAGE_IMAGE_CHARS = 4_500_000;
const ISTANBUL_TZ = 'Europe/Istanbul';

const BUYER_QUICK_MESSAGES = [
  'Ürün hâlâ satılık mı?',
  'Son fiyat nedir?',
  'Yerinde görebilir miyim?',
  'Ne zaman müsait olursunuz?',
];

const SELLER_QUICK_MESSAGES = [
  'Evet, hâlâ satılık.',
  'Maalesef satıldı.',
  'Konumu mesajda paylaşabilirim.',
  'Yarın uygun musunuz?',
];

export default function ChatScreen() {
  const params = useLocalSearchParams<{ listingId: string; userId: string }>();
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] : params.listingId;
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [listingTitle, setListingTitle] = useState('');
  const [listingPrice, setListingPrice] = useState(0);
  const [listingImage, setListingImage] = useState<string | null>(null);
  const [listingSellerId, setListingSellerId] = useState('');
  const [otherUserName, setOtherUserName] = useState('');
  const { user } = useAuth();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);

  const formatClock = (dateString: string) => {
    const d = new Date(dateString);
    if (!Number.isFinite(d.getTime())) return '';
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: ISTANBUL_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  };

  const isSeller = Boolean(user?.id && listingSellerId && user.id === listingSellerId);
  const quickMessages = isSeller ? SELLER_QUICK_MESSAGES : BUYER_QUICK_MESSAGES;

  const fetchData = useCallback(async () => {
    if (!listingId || !userId) return;
    try {
      const [messagesRes, listingRes, userRes] = await Promise.all([
        messageAPI.getChatMessages(listingId, userId),
        listingAPI.getById(listingId),
        userAPI.getUser(userId),
      ]);
      setMessages(messagesRes.data);
      const L = listingRes.data;
      setListingTitle(L.title);
      setListingPrice(L.price);
      setListingImage(L.images?.[0] ?? null);
      setListingSellerId(L.sellerId);
      setOtherUserName(userRes.data.name);
      emitMessageUnreadRefresh();
    } catch (error) {
      console.error('Fetch data error:', error);
    } finally {
      setLoading(false);
    }
  }, [listingId, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!listingId || !userId) return undefined;
      void messageAPI.markRead(listingId, userId).then(() => emitMessageUnreadRefresh()).catch(() => undefined);
      return undefined;
    }, [listingId, userId])
  );

  useEffect(() => {
    if (!listingId || !userId) return;
    void fetchData();
    const off = wsClient.on((evt) => {
      if (evt.type === 'message_new' && evt.message) {
        const m = evt.message as Message;
        if (String(m.listingId) === String(listingId)) {
          const other = String(userId);
          const me = String(user?.id || '');
          const sender = String((m as any).senderId || '');
          const receiver = String((m as any).receiverId || '');
          const isSameChat =
            (sender === other && receiver === me) || (sender === me && receiver === other);
          if (isSameChat) {
            setMessages((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev;
              return [...prev, m];
            });
            emitMessageUnreadRefresh();
            void messageAPI.markRead(listingId, userId).catch(() => undefined);
          }
        }
      }
      if (evt.type === 'message_read') {
        // optional: could update UI per-message; keep simple for now
        emitMessageUnreadRefresh();
      }
      if (evt.type === 'refresh_unread') emitMessageUnreadRefresh();
    });
    void wsClient.connect();
    return () => {
      off();
    };
  }, [listingId, userId, fetchData, user?.id]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates: { height: number } }) => {
      setKeyboardHeight(e.endCoordinates.height);
    };
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardHeight <= 0) return;
    const t = requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(t);
  }, [keyboardHeight, messages.length]);

  const sendMessagePayload = async (payload: { text?: string; image?: string }) => {
    const trimmed = (payload.text ?? '').trim();
    const image = payload.image?.trim();
    if (!trimmed && !image) return;
    if (!listingId || !userId) return;
    if (image && image.length > MAX_MESSAGE_IMAGE_CHARS) {
      Alert.alert('Çok büyük', 'Fotoğraf çok büyük. Daha düşük çözünürlük veya kırpma ile tekrar deneyin.');
      return;
    }

    setSending(true);
    try {
      const res = await messageAPI.send({
        listingId,
        receiverId: userId,
        text: trimmed,
        ...(image ? { image } : {}),
      });
      const sent = res?.data as Message | undefined;
      if (sent && sent.id) {
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        const preview =
          (sent.text && String(sent.text).trim()) || (sent.image ? 'Photo' : '');
        emitConversationLocalUpsert({
          listingId: String(sent.listingId),
          otherUserId: String(userId),
          lastMessage: preview || 'New message',
          lastMessageTime: String(sent.createdAt || new Date().toISOString()),
          incrementUnread: false,
          listingTitle: listingTitle || undefined,
          listingImage: listingImage || null,
          otherUserName: otherUserName || undefined,
          otherUserAvatar: null,
        });
      }
      setNewMessage('');
      emitMessageUnreadRefresh();
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Send message error:', error);
      Alert.alert('Hata', 'Mesaj gönderilemedi. Bağlantınızı kontrol edin.');
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (!newMessage.trim()) return;
    void sendMessagePayload({ text: newMessage.trim() });
  };

  const onQuickPress = (text: string) => {
    if (sending) return;
    void sendMessagePayload({ text });
  };

  const pickAndSendImage = async (fromCamera: boolean) => {
    if (sending || !listingId || !userId) return;
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('İzin gerekli', fromCamera ? 'Kamera izni verin.' : 'Galeri izni verin.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.55,
            base64: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.55,
            base64: false,
          });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      const url = await uploadImageToR2({
        uri: asset.uri,
        sizeBytes: asset.fileSize,
        mimeType: (asset as any).mimeType,
        fileName: (asset as any).fileName,
      });
      const caption = newMessage.trim();
      void sendMessagePayload(caption ? { text: caption, image: url } : { image: url });
    } catch (e) {
      console.error('Image pick error:', e);
      const info = (e as any)?.info ? ` (${String((e as any).info)})` : '';
      Alert.alert('Hata', `Fotoğraf gönderilemedi${info}`);
    }
  };

  const showImageSourcePicker = () => {
    if (sending) return;
    if (Platform.OS === 'web') {
      void pickAndSendImage(false);
      return;
    }
    Alert.alert('Fotoğraf gönder', 'Kaynağı seçin', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Galeri', onPress: () => void pickAndSendImage(false) },
      { text: 'Kamera', onPress: () => void pickAndSendImage(true) },
    ]);
  };

  const bubbleMaxW = Dimensions.get('window').width * 0.72;

  const confirmDeleteMessage = (msg: Message) => {
    if (msg.senderId !== user?.id) return;
    const go = async () => {
      try {
        await messageAPI.deleteMessage(msg.id);
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        emitMessageUnreadRefresh();
      } catch {
        Alert.alert('Hata', 'Mesaj silinemedi');
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu mesajı silmek istiyor musunuz?')) {
        void go();
      }
      return;
    }
    Alert.alert('Mesajı sil', 'Bu mesaj yalnızca sizin ekranınızdan kaldırılır.', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void go() },
    ]);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMyMessage = item.senderId === user?.id;
    const hasImage = Boolean(item.image);
    const hasText = Boolean(item.text?.trim());

    return (
      <View
        style={[
          styles.messageContainer,
          isMyMessage ? styles.myMessageContainer : styles.otherMessageContainer,
        ]}
      >
        <Pressable
          onLongPress={isMyMessage ? () => confirmDeleteMessage(item) : undefined}
          delayLongPress={350}
          style={[
            styles.messageBubble,
            isMyMessage ? styles.myMessageBubble : styles.otherMessageBubble,
            hasImage && styles.messageBubbleWithImage,
          ]}
        >
          {hasImage ? (
            <Pressable
              onPress={() => {
                const uri = String(item.image || '').trim();
                if (!uri) return;
                setImageViewerUri(uri);
                setImageViewerVisible(true);
              }}
            >
              <Image
                source={{ uri: item.image as string }}
                style={[styles.messageImage, { maxWidth: bubbleMaxW }]}
                resizeMode="cover"
              />
            </Pressable>
          ) : null}
          {hasText ? (
            <Text
              style={[
                styles.messageText,
                isMyMessage ? styles.myMessageText : styles.otherMessageText,
                hasImage && styles.messageTextBelowImage,
              ]}
            >
              {item.text}
            </Text>
          ) : null}
          <Text
            style={[
              styles.messageTime,
              isMyMessage ? styles.myMessageTime : styles.otherMessageTime,
            ]}
          >
            {formatClock(String(item.createdAt))}
          </Text>
        </Pressable>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#ff3b30" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{otherUserName}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {listingTitle}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.push(`/listing/${listingId}`)} hitSlop={12}>
          <Ionicons name="information-circle-outline" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.listingCard}
        activeOpacity={0.85}
        onPress={() => router.push(`/listing/${listingId}`)}
      >
        {listingImage ? (
          <Image source={{ uri: listingImage }} style={styles.listingThumb} />
        ) : (
          <View style={[styles.listingThumb, styles.listingThumbPlaceholder]}>
            <Ionicons name="image-outline" size={28} color="#ccc" />
          </View>
        )}
        <View style={styles.listingCardText}>
          <Text style={styles.listingCardTitle} numberOfLines={2}>
            {listingTitle}
          </Text>
          <Text style={styles.listingCardPrice}>{listingPrice.toLocaleString('tr-TR')} ₺</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </TouchableOpacity>

      <View style={[styles.content, { paddingBottom: keyboardHeight }]}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.messagesFlex}
          contentContainerStyle={styles.messagesList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubble-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>Henüz mesaj yok</Text>
              <Text style={styles.emptySubtext}>
                Hazır mesaj, yazı veya soldaki ikonla fotoğraf gönderebilirsiniz
              </Text>
            </View>
          }
        />

        <Modal
          visible={imageViewerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setImageViewerVisible(false)}
        >
          <View style={styles.imageViewerBackdrop}>
            <View style={[styles.imageViewerHeader, { paddingTop: Math.max(insets.top, 10) }]}>
              <TouchableOpacity
                onPress={() => setImageViewerVisible(false)}
                style={styles.imageViewerClose}
                hitSlop={12}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            {imageViewerUri ? (
              <Image source={{ uri: imageViewerUri }} style={styles.imageViewerImage} resizeMode="contain" />
            ) : null}
          </View>
        </Modal>

        <View style={[styles.footerBlock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            keyboardShouldPersistTaps="handled"
          >
            {quickMessages.map((text) => (
              <TouchableOpacity
                key={text}
                style={[styles.chip, sending && styles.chipDisabled]}
                onPress={() => onQuickPress(text)}
                disabled={sending}
              >
                <Text style={styles.chipText} numberOfLines={2}>
                  {text}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.inputContainer}>
            <TouchableOpacity
              style={[styles.attachButton, sending && styles.sendButtonDisabled]}
              onPress={showImageSourcePicker}
              disabled={sending}
              hitSlop={8}
            >
              <Ionicons name="image-outline" size={26} color="#ff3b30" />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="Mesaj veya fotoğraf..."
              placeholderTextColor="#999"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!newMessage.trim() || sending) && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={!newMessage.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 16,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  listingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
    gap: 10,
  },
  listingThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  listingThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  listingCardText: {
    flex: 1,
    minWidth: 0,
  },
  listingCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  listingCardPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ff3b30',
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  messagesFlex: {
    flex: 1,
  },
  messagesList: {
    padding: 16,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    minHeight: 200,
  },
  emptyText: {
    fontSize: 16,
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
  messageContainer: {
    marginBottom: 12,
  },
  myMessageContainer: {
    alignItems: 'flex-end',
  },
  otherMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  myMessageBubble: {
    backgroundColor: '#ff3b30',
    borderBottomRightRadius: 4,
  },
  otherMessageBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
  },
  messageBubbleWithImage: {
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  messageImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginBottom: 4,
  },
  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    zIndex: 2,
    justifyContent: 'center',
  },
  imageViewerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageViewerImage: {
    width: '100%',
    height: '100%',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  myMessageText: {
    color: '#fff',
  },
  otherMessageText: {
    color: '#333',
  },
  messageTextBelowImage: {
    paddingHorizontal: 10,
    paddingBottom: 2,
  },
  messageTime: {
    fontSize: 11,
    marginTop: 4,
  },
  myMessageTime: {
    color: 'rgba(255,255,255,0.8)',
  },
  otherMessageTime: {
    color: '#999',
  },
  footerBlock: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 8,
  },
  chipsRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    maxWidth: 220,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff5f5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 13,
    color: '#c62828',
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 4,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#333',
    maxHeight: 100,
    marginRight: 6,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
