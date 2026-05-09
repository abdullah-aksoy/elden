import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTabContentBottomPadding } from '../../src/lib/tabBarInsets';
import { Ionicons } from '@expo/vector-icons';
import { listingAPI, storyAPI } from '../../src/services/api';
import { ListingCard } from '../../src/components/ListingCard';
import { Listing } from '../../src/types';

/** id: API filtre değeri; shortLabel: chip üzerinde gösterim */
const CATEGORIES = [
  { id: 'all', shortLabel: 'Tümü', icon: 'apps' as const },
  { id: 'Elektronik', shortLabel: 'Elektronik', icon: 'laptop' as const },
  { id: 'Ev & Yaşam', shortLabel: 'Ev & Yaşam', icon: 'home' as const },
  { id: 'Moda & Aksesuar', shortLabel: 'Moda', icon: 'shirt' as const },
  { id: 'Araç & Yedek Parça', shortLabel: 'Araç', icon: 'car' as const },
  { id: 'Hobi & Oyun', shortLabel: 'Hobi', icon: 'game-controller' as const },
];

export default function HomeScreen() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stories, setStories] = useState<{ id: string; thumbUrl?: string | null; listingTitle?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const router = useRouter();
  const tabBottomPad = useTabContentBottomPadding();

  const fetchListings = useCallback(async (category?: string) => {
    try {
      const params = category && category !== 'all' ? { category } : {};
      const response = await listingAPI.getAll(params);
      setListings(response.data);
      const s = await storyAPI.getAll();
      setStories(Array.isArray(s.data) ? s.data : []);
    } catch (error) {
      console.error('Fetch listings error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchListings(selectedCategory);
  }, [selectedCategory, fetchListings]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const params = selectedCategory && selectedCategory !== 'all' ? { category: selectedCategory } : {};
          const response = await listingAPI.getAll(params);
          if (active) setListings(response.data);
          const s = await storyAPI.getAll();
          if (active) setStories(Array.isArray(s.data) ? s.data : []);
        } catch (error) {
          console.error('Fetch listings on focus error:', error);
        }
      })();
      return () => {
        active = false;
      };
    }, [selectedCategory])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchListings(selectedCategory);
  }, [selectedCategory, fetchListings]);

  const handleFavorite = async (listingId: string, isFavorited: boolean) => {
    try {
      if (isFavorited) {
        await listingAPI.removeFavorite(listingId);
      } else {
        await listingAPI.addFavorite(listingId);
      }
      // Update local state
      setListings((prev) =>
        prev.map((item) =>
          item.id === listingId
            ? {
                ...item,
                isFavorited: !isFavorited,
                favoriteCount: item.favoriteCount + (isFavorited ? -1 : 1),
              }
            : item
        )
      );
    } catch (error) {
      console.error('Favorite error:', error);
    }
  };

  const renderListing = ({ item, index }: { item: Listing; index: number }) => (
    <View style={{ marginLeft: index % 2 === 0 ? 0 : 16 }}>
      <ListingCard
        listing={item}
        onPress={() => router.push(`/listing/${item.id}`)}
        onFavoritePress={() => handleFavorite(item.id, item.isFavorited)}
      />
    </View>
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
        <View>
          <Text style={styles.headerTitle}>Elden</Text>
          <Text style={styles.headerTagline}>İkinci el alım satım, komşudan güvenle</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/search')}
          style={styles.searchIconBtn}
          hitSlop={8}
        >
          <Ionicons name="search" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.welcomeBanner}>
        <Ionicons name="sparkles" size={18} color="#ff3b30" />
        <Text style={styles.welcomeBannerText}>Bugün ne arıyorsunuz? Kategorilere göz atın veya arayın.</Text>
      </View>

      <View style={styles.storiesWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesRow}>
          {stories.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.storyBubble}
              onPress={() => router.push((`/stories/${s.id}` as unknown) as any)}
              activeOpacity={0.85}
            >
              <View style={styles.storyThumb}>
                {s.thumbUrl ? <Image source={{ uri: s.thumbUrl }} style={styles.storyImg} /> : null}
              </View>
              <Text style={styles.storyLabel} numberOfLines={1}>
                {s.listingTitle || 'Story'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.categoryWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
          style={styles.categoryContainer}
        >
          {CATEGORIES.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.categoryItem,
                selectedCategory === item.id && styles.categoryItemActive,
              ]}
              onPress={() => setSelectedCategory(item.id)}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={selectedCategory === item.id ? '#fff' : '#666'}
              />
              <Text
                style={[
                  styles.categoryText,
                  selectedCategory === item.id && styles.categoryTextActive,
                ]}
                numberOfLines={2}
              >
                {item.shortLabel}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={listings}
        renderItem={renderListing}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBottomPad }]}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff3b30" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="file-tray-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>İlan bulunamadı</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7f8',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  headerTagline: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    maxWidth: 260,
  },
  searchIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  welcomeBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  storiesWrap: {
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  storiesRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  storyBubble: {
    width: 74,
    alignItems: 'center',
    marginRight: 10,
  },
  storyThumb: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ff3b30',
  },
  storyImg: {
    width: 62,
    height: 62,
  },
  storyLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  categoryWrapper: {
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  categoryContainer: {
    maxHeight: 88,
    paddingBottom: 4,
  },
  categoryList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  categoryItem: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
    maxWidth: 84,
    minHeight: 72,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#fff',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  categoryItemActive: {
    backgroundColor: '#ff3b30',
    borderColor: '#ff3b30',
    ...Platform.select({
      ios: {
        shadowColor: '#ff3b30',
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  categoryText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#666',
    marginTop: 4,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  categoryTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  row: {
    justifyContent: 'space-between',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
});
