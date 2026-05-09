import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useTabContentBottomPadding } from '../../src/lib/tabBarInsets';
import { Ionicons } from '@expo/vector-icons';
import { listingAPI } from '../../src/services/api';
import { ListingCard } from '../../src/components/ListingCard';
import { ProvinceDistrictPicker } from '../../src/components/ProvinceDistrictPicker';
import { Listing } from '../../src/types';

const CONDITIONS = [
  { id: 'all', name: 'Tümü' },
  { id: 'yeni', name: 'Yeni' },
  { id: 'az kullanılmış', name: 'Az Kullanılmış' },
  { id: 'kullanılmış', name: 'Kullanılmış' },
  { id: 'tamir edilmiş', name: 'Tamir Edilmiş' },
];

export default function SearchScreen() {
  const [searchText, setSearchText] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedCondition, setSelectedCondition] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const router = useRouter();
  const tabBottomPad = useTabContentBottomPadding();

  const handleSearch = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (searchText) params.search = searchText;
      if (selectedCondition !== 'all') params.condition = selectedCondition;
      if (minPrice) params.minPrice = parseFloat(minPrice);
      if (maxPrice) params.maxPrice = parseFloat(maxPrice);
      if (city.trim()) params.city = city.trim();
      if (district.trim()) params.district = district.trim();

      const response = await listingAPI.getAll(params);
      setListings(response.data);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentLocationForSearch = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Mobil gerekli',
        'GPS ile konum seçimi şu an yalnızca telefon uygulamasında çalışır. Web’de il ve ilçeyi listeden seçebilirsiniz.',
      );
      return;
    }
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin gerekli', 'Yakınınızdaki ilanları görmek için konum izni verin.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const geocode = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (!geocode?.length) {
        Alert.alert('Hata', 'Adres bilgisi alınamadı. İl / ilçeyi elle seçin.');
        return;
      }
      const a = geocode[0];
      const nextCity = (a.city || a.region || '').trim();
      const nextDistrict = (a.district || a.subregion || '').trim();
      if (!nextCity) {
        Alert.alert('Hata', 'İl bilgisi çıkarılamadı. Listeden seçim yapın.');
        return;
      }
      setCity(nextCity);
      setDistrict(nextDistrict);
      setLoading(true);
      try {
        const params: Record<string, string | number> = {};
        if (searchText) params.search = searchText;
        if (selectedCondition !== 'all') params.condition = selectedCondition;
        if (minPrice) params.minPrice = parseFloat(minPrice);
        if (maxPrice) params.maxPrice = parseFloat(maxPrice);
        params.city = nextCity;
        if (nextDistrict) params.district = nextDistrict;
        const response = await listingAPI.getAll(params);
        setListings(response.data);
      } catch (e) {
        console.error('Search error:', e);
      } finally {
        setLoading(false);
      }
    } catch (e) {
      console.error('Location search error:', e);
      Alert.alert('Hata', 'Konum alınamadı. İnternet ve GPS’i kontrol edin.');
    } finally {
      setLocationLoading(false);
    }
  };

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

  const renderListing = ({ item, index }: { item: Listing; index: number }) => (
    <View style={{ marginLeft: index % 2 === 0 ? 0 : 16 }}>
      <ListingCard
        listing={item}
        onPress={() => router.push(`/listing/${item.id}`)}
        onFavoritePress={() => handleFavorite(item.id, item.isFavorited)}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ara</Text>
        <TouchableOpacity
          style={styles.headerToggle}
          onPress={() => setFiltersOpen((v) => !v)}
          activeOpacity={0.8}
          hitSlop={10}
        >
          <Ionicons name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={22} color="#333" />
          <Text style={styles.headerToggleText}>{filtersOpen ? 'Kapat' : 'Filtre'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Ne arıyorsunuz?"
            placeholderTextColor="#999"
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>

        {filtersOpen ? (
          <>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Fiyat araligi (TRY)</Text>
              <View style={styles.priceInputs}>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Min"
                  placeholderTextColor="#999"
                  value={minPrice}
                  onChangeText={setMinPrice}
                  keyboardType="numeric"
                />
                <Text style={styles.priceSeparator}>—</Text>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Max"
                  placeholderTextColor="#999"
                  value={maxPrice}
                  onChangeText={setMaxPrice}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={styles.filterLabel}>Ürün durumu</Text>
            <View style={styles.conditionGrid}>
              {CONDITIONS.map((condition) => (
                <TouchableOpacity
                  key={condition.id}
                  style={[
                    styles.conditionChip,
                    selectedCondition === condition.id && styles.conditionChipActive,
                  ]}
                  onPress={() => setSelectedCondition(condition.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.conditionText,
                      selectedCondition === condition.id && styles.conditionTextActive,
                    ]}
                    numberOfLines={2}
                  >
                    {condition.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.filterLabel, { marginTop: 8 }]}>Konum</Text>
            <TouchableOpacity
              style={[styles.locationGpsButton, locationLoading && styles.locationGpsButtonDisabled]}
              onPress={() => void loadCurrentLocationForSearch()}
              disabled={locationLoading}
              activeOpacity={0.8}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color="#ff3b30" />
              ) : (
                <>
                  <Ionicons name="navigate" size={20} color="#ff3b30" />
                  <Text style={styles.locationGpsButtonText}>Mevcut konuma gore ara</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.locationHint}>
              GPS ile il / ilceniz doldurulur ve hemen arama yapilir. Isterseniz asagidan manuel secin.
            </Text>
            <ProvinceDistrictPicker
              compact
              city={city}
              district={district}
              onCityChange={setCity}
              onDistrictChange={setDistrict}
            />

            <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
              <Ionicons name="search" size={20} color="#fff" />
              <Text style={styles.searchButtonText}>Ara</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.searchButtonCompact} onPress={handleSearch}>
            <Ionicons name="search" size={20} color="#fff" />
            <Text style={styles.searchButtonText}>Ara</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ff3b30" />
        </View>
      ) : (
        <FlatList
          data={listings}
          renderItem={renderListing}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBottomPad }]}
          columnWrapperStyle={styles.row}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>
                {searchText ||
                minPrice ||
                maxPrice ||
                selectedCondition !== 'all' ||
                city ||
                district
                  ? 'İlan bulunamadı'
                  : 'Arama yapmak için yukarıdaki filtreleri kullanın'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  headerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#eee',
  },
  headerToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#333',
  },
  searchSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
    marginTop: 4,
  },
  filterRow: {
    marginTop: 12,
  },
  priceInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 16,
    color: '#333',
  },
  priceSeparator: {
    fontSize: 16,
    color: '#999',
    fontWeight: '500',
  },
  conditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    columnGap: 10,
    marginTop: 4,
  },
  conditionChip: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#eee',
  },
  conditionChipActive: {
    backgroundColor: '#ff3b30',
    borderColor: '#ff3b30',
  },
  conditionText: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    fontWeight: '500',
  },
  conditionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  locationGpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ff3b30',
    height: 48,
    paddingHorizontal: 14,
  },
  locationGpsButtonDisabled: {
    opacity: 0.65,
  },
  locationGpsButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ff3b30',
  },
  locationHint: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 17,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 48,
    marginTop: 12,
  },
  searchButtonCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 48,
    marginTop: 12,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
