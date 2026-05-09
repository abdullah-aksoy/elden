import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import { storyAPI } from '../../src/services/api';

type Story = { id: string; videoUrl: string; listingTitle?: string | null };

export default function StoryViewerScreen() {
  const router = useRouter();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<Story | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await storyAPI.getAll();
        const s = (Array.isArray(data) ? data : []).find((x) => x.id === id);
        if (!cancelled) setStory(s ? { id: s.id, videoUrl: s.videoUrl, listingTitle: s.listingTitle } : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color="#ff3b30" />
      </SafeAreaView>
    );
  }

  if (!story) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'left', 'right']}>
        <Text style={styles.error}>Story not found.</Text>
        <TouchableOpacity style={styles.close} onPress={() => router.back()}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.top}>
        <Text style={styles.topTitle} numberOfLines={1}>
          {story.listingTitle || 'Story'}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
      <Video
        source={{ uri: story.videoUrl }}
        style={styles.video}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping
        useNativeControls={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  error: { color: '#fff', fontSize: 14, marginBottom: 12 },
  top: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topTitle: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 10 },
  close: { marginTop: 10 },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  video: { flex: 1 },
});

