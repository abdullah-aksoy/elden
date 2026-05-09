import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type InAppBannerPayload = {
  title: string;
  body: string;
  onPress?: () => void;
};

let _emit: ((p: InAppBannerPayload) => void) | null = null;

export function showInAppBanner(p: InAppBannerPayload) {
  _emit?.(p);
}

export function InAppBannerHost() {
  const [payload, setPayload] = useState<InAppBannerPayload | null>(null);
  const y = useRef(new Animated.Value(-120)).current;
  const hideTimer = useRef<any>(null);

  useEffect(() => {
    _emit = (p) => {
      setPayload(p);
    };
    return () => {
      _emit = null;
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(y, { toValue: -120, duration: 220, useNativeDriver: true }).start(() => {
        setPayload(null);
      });
    }, 4000);
  }, [payload, y]);

  if (!payload) return null;

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: y }] }]}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          payload.onPress?.();
          Animated.timing(y, { toValue: -120, duration: 180, useNativeDriver: true }).start(() => {
            setPayload(null);
          });
        }}
      >
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={1}>
            {payload.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {payload.body}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 1000,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  body: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500' },
});

