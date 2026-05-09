import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTabContentBottomPadding } from '../../src/lib/tabBarInsets';
import { useFocusEffect } from '@react-navigation/native';
import { consumeProfileJustSaved } from '../../src/lib/profileSaveFeedback';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { listingAPI, purchaseAPI } from '../../src/services/api';
import { Listing, PendingPurchaseRequest, BuyerSaleNotification, BuyerPurchaseHistoryItem } from '../../src/types';
import { requestBuyerSaleNotificationsRefresh } from '../../src/lib/buyerSaleNotificationEvents';
import { ListingCard } from '../../src/components/ListingCard';
import { editListingHref } from '../../src/lib/expoHref';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [favorites, setFavorites] = useState<Listing[]>([]);
  const [buyerHistory, setBuyerHistory] = useState<BuyerPurchaseHistoryItem[]>([]);
  const [buyerHistoryCount, setBuyerHistoryCount] = useState(0);
  const [buyerHistoryLoading, setBuyerHistoryLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'listings' | 'favorites' | 'purchases'>('listings');
  const [myListingsFilter, setMyListingsFilter] = useState<'active' | 'sold' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileUpdatedBanner, setProfileUpdatedBanner] = useState(false);
  const [pendingPurchases, setPendingPurchases] = useState<PendingPurchaseRequest[]>([]);
  const [buyerSaleNotifications, setBuyerSaleNotifications] = useState<BuyerSaleNotification[]>([]);
  const [buyerSaleActionId, setBuyerSaleActionId] = useState<string | null>(null);
  const router = useRouter();
  const tabBottomPad = useTabContentBottomPadding();

  const fetchPendingPurchases = useCallback(async () => {
    if (!user) {
      setPendingPurchases([]);
      return;
    }
    try {
      const res = await purchaseAPI.getSellerPending();
      setPendingPurchases(res.data);
    } catch {
      setPendingPurchases([]);
    }
  }, [user]);

  const fetchBuyerSaleNotifications = useCallback(async () => {
    if (!user) {
      setBuyerSaleNotifications([]);
      return;
    }
    try {
      const res = await purchaseAPI.getBuyerPendingConfirmations();
      setBuyerSaleNotifications(res.data ?? []);
    } catch {
      setBuyerSaleNotifications([]);
    } finally {
      requestBuyerSaleNotificationsRefresh();
    }
  }, [user]);

  const fetchBuyerHistory = useCallback(async () => {
    if (!user) {
      setBuyerHistory([]);
      setBuyerHistoryCount(0);
      return;
    }
    setBuyerHistoryLoading(true);
    try {
      const response = await purchaseAPI.getBuyerHistory();
      const list = Array.isArray(response.data) ? (response.data as BuyerPurchaseHistoryItem[]) : [];
      setBuyerHistory(list);
      setBuyerHistoryCount(list.length);
    } catch {
      setBuyerHistory([]);
      setBuyerHistoryCount(0);
    } finally {
      setBuyerHistoryLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void fetchPendingPurchases();
      void fetchBuyerSaleNotifications();
      void fetchBuyerHistory();
      void fetchDataRef.current();
      if (!consumeProfileJustSaved()) return undefined;
      setProfileUpdatedBanner(true);
      void fetchDataRef.current();
      const t = setTimeout(() => setProfileUpdatedBanner(false), 4000);
      return () => clearTimeout(t);
    }, [fetchPendingPurchases, fetchBuyerSaleNotifications, fetchBuyerHistory])
  );

  useEffect(() => {
    void fetchDataRef.current();
  }, [selectedTab]);

  const fetchData = async () => {
    try {
      if (selectedTab === 'listings') {
        const response = await listingAPI.getMyListings();
        setMyListings(response.data);
      } else {
        if (selectedTab === 'favorites') {
          const response = await listingAPI.getFavorites();
          setFavorites(response.data);
        } else {
          await fetchBuyerHistory();
        }
      }
    } catch (error) {
      console.error('Fetch data error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  const onRefresh = () => {
    setRefreshing(true);
    void fetchPendingPurchases();
    void fetchBuyerSaleNotifications();
    void fetchBuyerHistory();
    fetchData();
  };

  const refreshAfterBuyerSaleAction = async () => {
    await fetchBuyerSaleNotifications();
  };

  const confirmBuyerSale = (n: BuyerSaleNotification) => {
    const run = async () => {
      setBuyerSaleActionId(n.id);
      try {
        await purchaseAPI.buyerConfirmSold(n.id);
        await refreshAfterBuyerSaleAction();
        fetchData();
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Satış onaylandı.');
        } else {
          Alert.alert('Tamam', 'Satış onaylandı.');
        }
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('İşlem başarısız');
        } else {
          Alert.alert('Hata', 'İşlem başarısız');
        }
      } finally {
        setBuyerSaleActionId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(`"${n.listingTitle}" satışını onaylıyor musunuz? İlan satıldı olarak işaretlenecek.`)
      ) {
        void run();
      }
      return;
    }
    Alert.alert('Satışı onayla', `"${n.listingTitle}" ürününü satın aldığınızı onaylıyor musunuz?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Onayla', onPress: () => void run() },
    ]);
  };

  const rejectBuyerSale = (n: BuyerSaleNotification) => {
    const run = async () => {
      setBuyerSaleActionId(n.id);
      try {
        await purchaseAPI.buyerRejectSold(n.id);
        await refreshAfterBuyerSaleAction();
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Satış bildirimi reddedildi.');
        } else {
          Alert.alert('Tamam', 'Satış bildirimi reddedildi.');
        }
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('İşlem başarısız');
        } else {
          Alert.alert('Hata', 'İşlem başarısız');
        }
      } finally {
        setBuyerSaleActionId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu satış bildirimini reddetmek istiyor musunuz?')) {
        void run();
      }
      return;
    }
    Alert.alert('Reddet', 'Satıcı bildirimini reddetmek istiyor musunuz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Reddet', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const confirmPurchase = (request: PendingPurchaseRequest) => {
    const run = async () => {
      try {
        await purchaseAPI.confirm(request.id);
        await fetchPendingPurchases();
        fetchData();
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Satış onaylandı, ilan satıldı olarak işaretlendi');
        } else {
          Alert.alert('Tamam', 'Satış onaylandı, ilan satıldı olarak işaretlendi');
        }
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('İşlem başarısız');
        } else {
          Alert.alert('Hata', 'İşlem başarısız');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          `"${request.listingTitle}" ilanını bu alıcıya satıldı olarak onaylıyor musunuz? Diğer bekleyen talepler reddedilir.`
        )
      ) {
        void run();
      }
      return;
    }

    Alert.alert(
      'Satışı onayla',
      `"${request.listingTitle}" ilanını bu alıcıya satıldı olarak onaylıyor musunuz? Diğer bekleyen talepler reddedilir.`,
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Onayla', onPress: () => void run() },
      ]
    );
  };

  const declinePurchase = (request: PendingPurchaseRequest) => {
    const run = async () => {
      try {
        await purchaseAPI.decline(request.id);
        await fetchPendingPurchases();
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Talep reddedildi');
        } else {
          Alert.alert('Tamam', 'Talep reddedildi');
        }
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('İşlem başarısız');
        } else {
          Alert.alert('Hata', 'İşlem başarısız');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu talebi reddetmek istiyor musunuz?')) {
        void run();
      }
      return;
    }

    Alert.alert('Talebi reddet', 'Bu talebi reddetmek istiyor musunuz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Reddet', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const handleLogout = () => {
    const doLogout = () => {
      void logout();
      /* Kök _layout: user null olunca /auth/login */
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
        doLogout();
      }
      return;
    }

    Alert.alert('Çıkış', 'Çıkış yapmak istediğinizden emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: doLogout },
    ]);
  };

  const handleFavorite = async (listingId: string, isFavorited: boolean) => {
    try {
      if (isFavorited) {
        await listingAPI.removeFavorite(listingId);
      } else {
        await listingAPI.addFavorite(listingId);
      }
      // Refresh the list
      fetchData();
    } catch (error) {
      console.error('Favorite error:', error);
    }
  };

  const handleDeleteListing = (listingId: string) => {
    const runDelete = async () => {
      try {
        await listingAPI.delete(listingId);
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('İlan silindi');
        } else {
          Alert.alert('Başarılı', 'İlan silindi');
        }
        fetchData();
      } catch {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert('Bir hata oluştu');
        } else {
          Alert.alert('Hata', 'Bir hata oluştu');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu ilanı silmek istediğinizden emin misiniz?')) {
        void runDelete();
      }
      return;
    }

    Alert.alert('İlanı Sil', 'Bu ilanı silmek istediğinizden emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void runDelete() },
    ]);
  };

  const activeCount = myListings.filter((x) => x.status === 'aktif').length;
  const soldCount = myListings.filter((x) => x.status === 'satıldı').length;

  const listings =
    selectedTab === 'listings'
      ? myListingsFilter === 'active'
        ? myListings.filter((x) => x.status === 'aktif')
        : myListingsFilter === 'sold'
          ? myListings.filter((x) => x.status === 'satıldı')
          : myListings
      : favorites;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {profileUpdatedBanner ? (
        <View style={styles.updatedBanner}>
          <Ionicons name="checkmark-circle" size={20} color="#2e7d32" />
          <Text style={styles.updatedBannerText}>Profiliniz güncellendi.</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profil</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push('/edit-profile')} style={styles.editButton}>
            <Ionicons name="create-outline" size={22} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={24} color="#ff3b30" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: tabBottomPad }}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={40} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={16} color="#ffc107" />
            <Text style={styles.rating}>
              {user?.rating.average.toFixed(1)} ({user?.rating.count} değerlendirme)
            </Text>
          </View>
        </View>

        {buyerSaleNotifications.length > 0 ? (
          <View style={styles.notifySection}>
            <View style={styles.notifySectionHeader}>
              <Ionicons name="notifications" size={22} color="#ff3b30" />
              <Text style={styles.notifySectionTitle}>Bildirimler</Text>
            </View>
            <Text style={styles.notifySectionSubtitle}>
              Satıcı bu ürünleri size sattığını bildirdi — onaylayınca satış tamamlanır.
            </Text>
            {buyerSaleNotifications.map((n) => (
              <View key={n.id} style={styles.notifyCard}>
                <View style={styles.notifyCardTop}>
                  {n.listingImage ? (
                    <Image source={{ uri: n.listingImage }} style={styles.notifyThumb} />
                  ) : (
                    <View style={[styles.notifyThumb, styles.notifyThumbPlaceholder]}>
                      <Ionicons name="image-outline" size={28} color="#ccc" />
                    </View>
                  )}
                  <View style={styles.notifyCardBody}>
                    <TouchableOpacity onPress={() => router.push(`/listing/${n.listingId}`)}>
                      <Text style={styles.notifyListingTitle} numberOfLines={2}>
                        {n.listingTitle}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.notifySeller}>Satıcı: {n.sellerName}</Text>
                    <Text style={styles.notifyTime}>
                      {new Date(n.createdAt).toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
                <View style={styles.notifyActions}>
                  <TouchableOpacity
                    style={styles.notifyOpenBtn}
                    onPress={() => router.push(`/listing/${n.listingId}`)}
                  >
                    <Text style={styles.notifyOpenBtnText}>İlana git</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.notifyConfirmBtn,
                      buyerSaleActionId === n.id && styles.buttonMuted,
                    ]}
                    onPress={() => confirmBuyerSale(n)}
                    disabled={buyerSaleActionId !== null}
                  >
                    {buyerSaleActionId === n.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.notifyConfirmBtnText}>Onayla</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.notifyRejectBtn}
                    onPress={() => rejectBuyerSale(n)}
                    disabled={buyerSaleActionId !== null}
                  >
                    <Text style={styles.notifyRejectBtnText}>Reddet</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {pendingPurchases.length > 0 ? (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingSectionTitle}>Satın alma talepleri</Text>
            {pendingPurchases.map((req) => (
              <View key={req.id} style={styles.pendingCard}>
                <TouchableOpacity onPress={() => router.push(`/listing/${req.listingId}`)}>
                  <Text style={styles.pendingListingTitle}>{req.listingTitle}</Text>
                </TouchableOpacity>
                <Text style={styles.pendingBuyer}>Alıcı: {req.buyerName}</Text>
                <View style={styles.pendingActions}>
                  <TouchableOpacity
                    style={styles.pendingConfirmBtn}
                    onPress={() => confirmPurchase(req)}
                  >
                    <Text style={styles.pendingConfirmText}>Onayla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pendingDeclineBtn}
                    onPress={() => declinePurchase(req)}
                  >
                    <Text style={styles.pendingDeclineText}>Reddet</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'listings' && styles.tabActive]}
            onPress={() => setSelectedTab('listings')}
          >
            <Text style={[styles.tabText, selectedTab === 'listings' && styles.tabTextActive]}>
              İlanlarım ({myListings.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'favorites' && styles.tabActive]}
            onPress={() => setSelectedTab('favorites')}
          >
            <Text style={[styles.tabText, selectedTab === 'favorites' && styles.tabTextActive]}>
              Favorilerim ({favorites.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'purchases' && styles.tabActive]}
            onPress={() => setSelectedTab('purchases')}
          >
            <Text style={[styles.tabText, selectedTab === 'purchases' && styles.tabTextActive]}>
              Aldıklarım ({buyerHistoryCount})
            </Text>
          </TouchableOpacity>
        </View>

        {selectedTab === 'listings' ? (
          <View style={styles.subFilterRow}>
            <TouchableOpacity
              style={[styles.subFilterChip, myListingsFilter === 'active' && styles.subFilterChipActive]}
              onPress={() => setMyListingsFilter('active')}
              activeOpacity={0.85}
            >
              <Text style={[styles.subFilterText, myListingsFilter === 'active' && styles.subFilterTextActive]}>
                Aktif ({activeCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subFilterChip, myListingsFilter === 'sold' && styles.subFilterChipActive]}
              onPress={() => setMyListingsFilter('sold')}
              activeOpacity={0.85}
            >
              <Text style={[styles.subFilterText, myListingsFilter === 'sold' && styles.subFilterTextActive]}>
                Satildi ({soldCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subFilterChip, myListingsFilter === 'all' && styles.subFilterChipActive]}
              onPress={() => setMyListingsFilter('all')}
              activeOpacity={0.85}
            >
              <Text style={[styles.subFilterText, myListingsFilter === 'all' && styles.subFilterTextActive]}>Hepsi</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#ff3b30" />
          </View>
        ) : selectedTab === 'purchases' ? (
          buyerHistoryLoading && buyerHistory.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#ff3b30" />
            </View>
          ) : buyerHistory.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="bag-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>Henüz satın alım yok</Text>
            </View>
          ) : (
            <View style={styles.purchaseList}>
              {buyerHistory.map((it) => (
                <TouchableOpacity
                  key={it.id}
                  style={styles.purchaseRow}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/listing/${it.listingId}`)}
                >
                  <View style={styles.purchaseThumbWrap}>
                    {it.listingImage ? (
                      <Image source={{ uri: it.listingImage }} style={styles.purchaseThumb} />
                    ) : (
                      <View style={[styles.purchaseThumb, styles.purchaseThumbPlaceholder]}>
                        <Ionicons name="image-outline" size={24} color="#ccc" />
                      </View>
                    )}
                  </View>
                  <View style={styles.purchaseBody}>
                    <Text style={styles.purchaseTitle} numberOfLines={2}>
                      {it.listingTitle}
                    </Text>
                    <Text style={styles.purchaseSub} numberOfLines={1}>
                      Satıcı: {it.sellerName}
                    </Text>
                    <Text style={styles.purchaseTime}>
                      {new Date(it.confirmedAt).toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </TouchableOpacity>
              ))}
            </View>
          )
        ) : listings.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons
              name={selectedTab === 'listings' ? 'list-outline' : 'heart-outline'}
              size={64}
              color="#ccc"
            />
            <Text style={styles.emptyText}>
              {selectedTab === 'listings' ? 'Henüz ilanınız yok' : 'Henüz favori ilanınız yok'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={listings}
            renderItem={({ item, index }) => (
              <View style={{ flex: 1, marginLeft: index % 2 === 0 ? 0 : 8, marginRight: index % 2 === 0 ? 8 : 0, marginBottom: 16 }}>
                <ListingCard
                  listing={item}
                  onPress={() => router.push(`/listing/${item.id}`)}
                  onFavoritePress={
                    selectedTab === 'favorites'
                      ? () => handleFavorite(item.id, item.isFavorited)
                      : undefined
                  }
                  statusBadge={
                    selectedTab === 'listings' && item.status === 'satıldı'
                      ? 'Satıldı'
                      : undefined
                  }
                />
                {selectedTab === 'listings' && (
                  <View style={styles.listingActions}>
                    {item.status === 'aktif' ? (
                      <TouchableOpacity
                        style={styles.editListingButton}
                        onPress={() => router.push(editListingHref(item.id))}
                      >
                        <Ionicons name="create-outline" size={16} color="#333" />
                        <Text style={styles.editListingText}>Düzenle</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.editListingButtonDisabled}>
                        <Ionicons name="lock-closed-outline" size={16} color="#999" />
                        <Text style={styles.editListingTextDisabled}>Düzenleme kapalı</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteListing(item.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#ff3b30" />
                      <Text style={styles.deleteText}>Sil</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.listingsGrid}
            scrollEnabled={false}
          />
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  updatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e8f5e9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#c8e6c9',
  },
  updatedBannerText: {
    color: '#2e7d32',
    fontSize: 15,
    fontWeight: '600',
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
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  editButton: {
    marginRight: 8,
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
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
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
  notifySection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaf0',
    backgroundColor: '#fafbff',
  },
  notifySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  notifySectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#333',
  },
  notifySectionSubtitle: {
    fontSize: 13,
    color: '#5c6bc0',
    marginBottom: 14,
    lineHeight: 18,
  },
  notifyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e3e7f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  notifyCardTop: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  notifyThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  notifyThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifyCardBody: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  notifyListingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ff3b30',
    marginBottom: 4,
  },
  notifySeller: {
    fontSize: 14,
    color: '#444',
    marginBottom: 2,
  },
  notifyTime: {
    fontSize: 12,
    color: '#999',
  },
  notifyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  notifyOpenBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  notifyOpenBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  notifyConfirmBtn: {
    flex: 1,
    minWidth: 88,
    backgroundColor: '#ff3b30',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifyConfirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  notifyRejectBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  notifyRejectBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  buttonMuted: {
    opacity: 0.7,
  },
  pendingSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  pendingSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  pendingCard: {
    backgroundColor: '#fafafa',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  pendingListingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ff3b30',
    marginBottom: 4,
  },
  pendingBuyer: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: 10,
  },
  pendingConfirmBtn: {
    flex: 1,
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pendingConfirmText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  pendingDeclineBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  pendingDeclineText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 15,
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
  subFilterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  subFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f3f5',
    borderWidth: 1,
    borderColor: '#e7e7ea',
  },
  subFilterChipActive: {
    backgroundColor: '#fff3f2',
    borderColor: '#ff3b30',
  },
  subFilterText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '700',
  },
  subFilterTextActive: {
    color: '#ff3b30',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
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
  listingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 4,
    width: '100%',
  },
  editListingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    flexShrink: 1,
  },
  editListingButtonDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    flexShrink: 1,
    opacity: 0.8,
    gap: 6,
  },
  editListingText: {
    color: '#333',
    fontSize: 14,
    marginLeft: 4,
    fontWeight: '500',
  },
  editListingTextDisabled: {
    color: '#999',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    marginLeft: 'auto',
  },
  deleteText: {
    color: '#ff3b30',
    fontSize: 14,
    marginLeft: 4,
    fontWeight: '500',
  },
  purchaseList: {
    padding: 16,
    gap: 10,
  },
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  purchaseThumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  purchaseThumb: {
    width: '100%',
    height: '100%',
  },
  purchaseThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  purchaseBody: {
    flex: 1,
    minWidth: 0,
  },
  purchaseTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#333',
  },
  purchaseSub: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  purchaseTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
});
