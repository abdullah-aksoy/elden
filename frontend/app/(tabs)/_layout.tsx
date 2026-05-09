import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, DeviceEventEmitter } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTabBarStyleProps } from '../../src/lib/tabBarInsets';
import { messageAPI, purchaseAPI } from '../../src/services/api';
import { MESSAGE_UNREAD_REFRESH } from '../../src/lib/messageUnreadEvents';
import { BUYER_SALE_NOTIFICATIONS_REFRESH } from '../../src/lib/buyerSaleNotificationEvents';
import { wsClient } from '../../src/services/ws';
import { showInAppBanner } from '../../src/components/InAppBanner';

export default function TabLayout() {
  const tabBarStyle = useTabBarStyleProps();
  const router = useRouter();
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [buyerSaleNotifyCount, setBuyerSaleNotifyCount] = useState(0);
  const [sellerOfferCount, setSellerOfferCount] = useState(0);
  const unreadFetchRef = useRef<{ lastAt: number; timer: any | null; inFlight: boolean }>({
    lastAt: 0,
    timer: null,
    inFlight: false,
  });

  useEffect(() => {
    let cancelled = false;
    const ref = unreadFetchRef.current;
    const fetchUnreadNow = async () => {
      if (ref.inFlight) return;
      ref.inFlight = true;
      try {
        const { data } = await messageAPI.getUnreadCount();
        if (!cancelled) setUnreadTotal(typeof data?.total === 'number' ? data.total : 0);
      } catch {
        if (!cancelled) setUnreadTotal(0);
      } finally {
        ref.inFlight = false;
      }
    };
    const fetchUnread = () => {
      const now = Date.now();
      const minGapMs = 1500;
      const dt = now - ref.lastAt;
      if (dt >= minGapMs) {
        ref.lastAt = now;
        void fetchUnreadNow();
        return;
      }
      if (ref.timer) return;
      ref.timer = setTimeout(() => {
        ref.timer = null;
        ref.lastAt = Date.now();
        void fetchUnreadNow();
      }, Math.max(0, minGapMs - dt));
    };

    fetchUnread();
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') fetchUnread();
    };
    const sub = AppState.addEventListener('change', onAppState);
    const ev = DeviceEventEmitter.addListener(MESSAGE_UNREAD_REFRESH, fetchUnread);
    const offWs = wsClient.on((evt) => {
      if (evt.type === 'refresh_unread') fetchUnread();
    });
    void wsClient.connect();
    return () => {
      cancelled = true;
      if (ref.timer) {
        clearTimeout(ref.timer);
        ref.timer = null;
      }
      sub.remove();
      ev.remove();
      offWs();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchBuyerSaleCount = async () => {
      try {
        const { data } = await purchaseAPI.getBuyerPendingConfirmations();
        const n = Array.isArray(data) ? data.length : 0;
        if (!cancelled) setBuyerSaleNotifyCount(n);
      } catch {
        if (!cancelled) setBuyerSaleNotifyCount(0);
      }
    };

    void fetchBuyerSaleCount();
    const fetchSellerOfferCount = async () => {
      try {
        const { data } = await purchaseAPI.getSellerPending();
        const n = Array.isArray(data) ? data.length : 0;
        if (!cancelled) setSellerOfferCount(n);
      } catch {
        if (!cancelled) setSellerOfferCount(0);
      }
    };
    void fetchSellerOfferCount();
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        void fetchBuyerSaleCount();
        void fetchSellerOfferCount();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    const ev = DeviceEventEmitter.addListener(BUYER_SALE_NOTIFICATIONS_REFRESH, fetchBuyerSaleCount);
    const offWs = wsClient.on((evt) => {
      if (evt.type === 'refresh_buyer_sales') void fetchBuyerSaleCount();
      if (evt.type === 'seller_offer_new') void fetchSellerOfferCount();
    });
    void wsClient.connect();
    return () => {
      cancelled = true;
      sub.remove();
      ev.remove();
      offWs();
    };
  }, []);

  useEffect(() => {
    const off = wsClient.on((evt) => {
      if (evt.type === 'message_new') {
        const m = (evt as any).message;
        const listingId = String(m?.listingId || '');
        const otherUserId = String(m?.senderId || '');
        const title = 'New message';
        const body = String(m?.text || '').trim() || (m?.image ? 'Photo' : 'New message');
        showInAppBanner({
          title,
          body,
          onPress: () => {
            if (listingId && otherUserId) router.push(`/chat/${listingId}/${otherUserId}`);
            else router.push('/(tabs)/messages');
          },
        });
      }
      if (evt.type === 'seller_offer_new') {
        const listingId = String((evt as any).listingId || '');
        showInAppBanner({
          title: 'New offer',
          body: 'You received a new offer.',
          onPress: () => {
            if (listingId) router.push(`/listing/${listingId}`);
            else router.push('/(tabs)/profile');
          },
        });
      }
    });
    return () => off();
  }, [router]);

  const messagesBadge =
    unreadTotal > 0 ? (unreadTotal > 99 ? '99+' : unreadTotal) : undefined;

  const profileBadge =
    buyerSaleNotifyCount + sellerOfferCount > 0
      ? buyerSaleNotifyCount + sellerOfferCount > 99
        ? '99+'
        : buyerSaleNotifyCount + sellerOfferCount
      : undefined;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: '#ff3b30',
        tabBarInactiveTintColor: '#999',
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Ana Sayfa',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Ara',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="add-listing"
        options={{
          title: 'İlan Ekle',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mesajlar',
          tabBarBadge: messagesBadge,
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarBadge: profileBadge,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
