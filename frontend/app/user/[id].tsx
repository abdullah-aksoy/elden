import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Keyboard,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { userAPI, listingAPI, ratingAPI } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';
import { User, Listing, Rating } from '../../src/types';
import { ListingCard } from '../../src/components/ListingCard';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [selectedTab, setSelectedTab] = useState<'listings' | 'ratings'>('listings');
  const [loading, setLoading] = useState(true);
  const [replyModalRatingId, setReplyModalRatingId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyModalKeyboardPad, setReplyModalKeyboardPad] = useState(0);
  const router = useRouter();
  const { user: authUser } = useAuth();

  const fetchUserData = useCallback(async () => {
    if (!id) return;
    const userId = Array.isArray(id) ? id[0] : id;
    try {
      const [userRes, ratingsRes] = await Promise.all([
        userAPI.getUser(userId),
        ratingAPI.getRatings(userId),
      ]);
      setUser(userRes.data);
      setRatings(ratingsRes.data);

      let userListings: Listing[];
      if (authUser?.id === userId) {
        const myRes = await listingAPI.getMyListings();
        userListings = myRes.data.filter(
          (listing: Listing) => listing.status !== 'kaldırıldı'
        );
      } else {
        const listingsRes = await listingAPI.getAll();
        userListings = listingsRes.data.filter(
          (listing: Listing) => listing.sellerId === userId && listing.status === 'aktif'
        );
      }
      setListings(userListings);
    } catch (error) {
      console.error('Fetch user data error:', error);
    } finally {
      setLoading(false);
    }
  }, [id, authUser?.id]);

  useEffect(() => {
    void fetchUserData();
  }, [fetchUserData]);

  useEffect(() => {
    if (!replyModalRatingId) {
      setReplyModalKeyboardPad(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, (e) => {
      setReplyModalKeyboardPad(e.endCoordinates.height);
    });
    const subHide = Keyboard.addListener(hideEvt, () => {
      setReplyModalKeyboardPad(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [replyModalRatingId]);

  const handleFavorite = async (listingId: string, isFavorited: boolean) => {
    try {
      if (isFavorited) {
        await listingAPI.removeFavorite(listingId);
      } else {
        await listingAPI.addFavorite(listingId);
      }
      setListings((prev) =>
        prev.map((item) =>
          item.id === listingId
            ? { ...item, isFavorited: !isFavorited, favoriteCount: item.favoriteCount + (isFavorited ? -1 : 1) }
            : item
        )
      );
    } catch (error) {
      console.error('Favorite error:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#ff3b30" />
      </View>
    );
  }

  if (!user) {
    return null;
  }

  const isOwnProfile = !!authUser?.id && authUser.id === user.id;

  const submitReply = async () => {
    if (!replyModalRatingId) return;
    const text = replyDraft.trim();
    if (!text) {
      Alert.alert('Bilgi', 'Lütfen bir cevap yazın');
      return;
    }
    setReplySubmitting(true);
    try {
      await ratingAPI.reply(replyModalRatingId, text);
      setReplyModalRatingId(null);
      setReplyDraft('');
      await fetchUserData();
      Alert.alert('Tamam', 'Cevabınız kaydedildi');
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      Alert.alert('Hata', typeof msg === 'string' ? msg : 'Cevap gönderilemedi');
    } finally {
      setReplySubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Kullanıcı Profili</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView>
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {user.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={40} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.name}>{user.name}</Text>
          {user.location?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color="#666" />
              <Text style={styles.location}>
                {user.location.city}
                {user.location.district && `, ${user.location.district}`}
              </Text>
            </View>
          )}
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={16} color="#ffc107" />
            <Text style={styles.rating}>
              {user.rating.average.toFixed(1)} ({user.rating.count} değerlendirme)
            </Text>
          </View>
        </View>

        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'listings' && styles.tabActive]}
            onPress={() => setSelectedTab('listings')}
          >
            <Text style={[styles.tabText, selectedTab === 'listings' && styles.tabTextActive]}>
              İlanlar ({listings.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'ratings' && styles.tabActive]}
            onPress={() => setSelectedTab('ratings')}
          >
            <Text style={[styles.tabText, selectedTab === 'ratings' && styles.tabTextActive]}>
              Değerlendirmeler ({ratings.length})
            </Text>
          </TouchableOpacity>
        </View>

        {selectedTab === 'listings' ? (
          listings.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="list-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>Henüz ilan yok</Text>
            </View>
          ) : (
            <FlatList
              data={listings}
              renderItem={({ item, index }) => (
                <View style={{ flex: 1, marginLeft: index % 2 === 0 ? 0 : 8, marginRight: index % 2 === 0 ? 8 : 0, marginBottom: 16 }}>
                  <ListingCard
                    listing={item}
                    onPress={() => router.push(`/listing/${item.id}`)}
                    onFavoritePress={() => handleFavorite(item.id, item.isFavorited)}
                    statusBadge={item.status === 'satıldı' ? 'Satıldı' : undefined}
                  />
                </View>
              )}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={styles.listingsGrid}
              scrollEnabled={false}
            />
          )
        ) : (
          <View style={styles.ratingsContainer}>
            {ratings.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="star-outline" size={64} color="#ccc" />
                <Text style={styles.emptyText}>Henüz değerlendirme yok</Text>
              </View>
            ) : (
              ratings.map((rating) => (
                <View key={rating.id} style={styles.ratingItem}>
                  <View style={styles.ratingHeader}>
                    <Text style={styles.reviewerName}>{rating.reviewerName}</Text>
                    <View style={styles.starsRow}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                          key={star}
                          name={star <= rating.rating ? 'star' : 'star-outline'}
                          size={16}
                          color="#ffc107"
                        />
                      ))}
                    </View>
                  </View>
                  {rating.comment && (
                    <Text style={styles.ratingComment}>{rating.comment}</Text>
                  )}
                  {rating.replyText ? (
                    <View style={styles.sellerReplyBox}>
                      <Text style={styles.sellerReplyLabel}>Satıcı cevabı</Text>
                      <Text style={styles.sellerReplyText}>{rating.replyText}</Text>
                      {rating.replyAt ? (
                        <Text style={styles.sellerReplyDate}>
                          {new Date(rating.replyAt).toLocaleDateString('tr-TR')}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {isOwnProfile && !rating.replyText ? (
                    <TouchableOpacity
                      style={styles.replyCta}
                      onPress={() => {
                        setReplyModalRatingId(rating.id);
                        setReplyDraft('');
                      }}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="#ff3b30" />
                      <Text style={styles.replyCtaText}>Cevap yaz</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={styles.ratingDate}>
                    {new Date(rating.createdAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={!!replyModalRatingId} animationType="slide" transparent>
        <View
          style={[
            styles.replyModalBackdrop,
            replyModalKeyboardPad > 0 && {
              paddingBottom: 24 + replyModalKeyboardPad,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.replyModalScroll}
            contentContainerStyle={styles.replyModalScrollContent}
          >
            <View style={styles.replyModalCard}>
              <Text style={styles.replyModalTitle}>Değerlendirmeye cevap</Text>
              <Text style={styles.replyModalHint}>Yalnızca bir kez cevap verebilirsiniz.</Text>
              <TextInput
                style={styles.replyModalInput}
                placeholder="Cevabınızı yazın"
                placeholderTextColor="#999"
                multiline
                value={replyDraft}
                onChangeText={setReplyDraft}
              />
              <View style={styles.replyModalActions}>
                <TouchableOpacity
                  style={styles.replyModalCancel}
                  onPress={() => {
                    setReplyModalRatingId(null);
                    setReplyDraft('');
                  }}
                  disabled={replySubmitting}
                >
                  <Text style={styles.replyModalCancelText}>İptal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.replyModalSubmit, replySubmitting && styles.replyModalSubmitDisabled]}
                  onPress={() => void submitReply()}
                  disabled={replySubmitting}
                >
                  {replySubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.replyModalSubmitText}>Gönder</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  location: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#ff3b30',
  },
  tabText: {
    fontSize: 16,
    color: '#666',
  },
  tabTextActive: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  listingsGrid: {
    padding: 16,
  },
  ratingsContainer: {
    padding: 16,
  },
  ratingItem: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  starsRow: {
    flexDirection: 'row',
  },
  ratingComment: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20,
  },
  ratingDate: {
    fontSize: 12,
    color: '#999',
  },
  sellerReplyBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff3b30',
  },
  sellerReplyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ff3b30',
    marginBottom: 4,
  },
  sellerReplyText: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
  },
  sellerReplyDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 6,
  },
  replyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  replyCtaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff3b30',
  },
  replyModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 24,
  },
  replyModalScroll: {
    flex: 1,
  },
  replyModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  replyModalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
  },
  replyModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  replyModalHint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  replyModalInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 15,
    color: '#333',
    marginBottom: 16,
  },
  replyModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  replyModalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  replyModalCancelText: {
    fontSize: 16,
    color: '#666',
  },
  replyModalSubmit: {
    backgroundColor: '#ff3b30',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  replyModalSubmitDisabled: {
    opacity: 0.6,
  },
  replyModalSubmitText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
