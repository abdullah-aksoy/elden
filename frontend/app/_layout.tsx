import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { getBackendHostname } from '../src/lib/backendUrl';
import { InAppBannerHost } from '../src/components/InAppBanner';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const lastHandledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const handle = (u: string | null | undefined) => {
      if (!u) return;
      if (lastHandledUrlRef.current === u) return;
      lastHandledUrlRef.current = u;
      try {
        const parsed = Linking.parse(u);
        const host = String(parsed?.hostname || '');
        const path = String(parsed?.path || '');
        const apiHost = getBackendHostname();
        // HTTPS App Link: https://<API host>/listing/<id> → ilan ekranı
        if (apiHost && host === apiHost && path.startsWith('listing/')) {
          const id = path.slice('listing/'.length).split(/[/?#]/)[0];
          if (id) router.replace(`/listing/${id}`);
        }
      } catch {
        // ignore
      }
    };

    void Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => handle(e?.url));
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data: any = resp?.notification?.request?.content?.data || {};
      const type = String(data?.type || '');
      if (type === 'chat') {
        const listingId = String(data?.listingId || '');
        const otherUserId = String(data?.otherUserId || '');
        if (listingId && otherUserId) router.push(`/chat/${listingId}/${otherUserId}`);
        return;
      }
      if (type === 'seller_offer' || type === 'buyer_sale_confirmation') {
        const listingId = String(data?.listingId || '');
        if (listingId) router.push(`/listing/${listingId}`);
        else router.push('/(tabs)/profile');
      }
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!user && !inAuthGroup) {
      // Redirect to login if not authenticated
      router.replace('/auth/login');
    } else if (user && inAuthGroup) {
      // Redirect to home if already authenticated
      router.replace('/(tabs)/home');
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return null;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <InAppBannerHost />
        <RootLayoutNav />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
