import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { listingAPI } from '../../src/services/api';
import { ProvinceDistrictPicker } from '../../src/components/ProvinceDistrictPicker';
import { useAuth } from '../../src/contexts/AuthContext';
import { Listing } from '../../src/types';
import { uploadImageToR2 } from '../../src/lib/uploads';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'Elektronik', label: 'Elektronik' },
  { value: 'Ev & Yaşam', label: 'Ev & Yaşam' },
  { value: 'Moda & Aksesuar', label: 'Moda' },
  { value: 'Araç & Yedek Parça', label: 'Araç' },
  { value: 'Hobi & Oyun', label: 'Hobi' },
  { value: 'Spor & Outdoor', label: 'Spor' },
  { value: 'Kitap & Müzik', label: 'Kitap' },
  { value: 'Bebek & Çocuk', label: 'Bebek' },
  { value: 'Diğer', label: 'Diğer' },
];

const CONDITIONS = ['yeni', 'az kullanılmış', 'kullanılmış', 'tamir edilmiş', 'tamir gerekli'];
const MAX_PRICE = 1_000_000_000;

function normalizePriceInput(raw: string): string {
  const s = raw.replace(/[^\d.,]/g, '').replace(/^[.,]+/, '');
  const parts = s.replace(',', '.').split('.');
  if (parts.length <= 1) return parts[0];
  return `${parts[0]}.${parts.slice(1).join('')}`;
}

function hasLetter(s: string): boolean {
  return /[A-Za-z\u00C0-\u024F]/.test(s);
}

export default function EditListingScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loadingListing, setLoadingListing] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadListing = useCallback(async () => {
    if (!id) return;
    setLoadingListing(true);
    try {
      const { data } = await listingAPI.getById(id);
      const listing = data as Listing;
      if (user?.id && listing.sellerId !== user.id) {
        Alert.alert('Yetki yok', 'Bu ilanı yalnızca sahibi düzenleyebilir.');
        router.back();
        return;
      }
      setTitle(listing.title);
      setDescription(listing.description);
      setPrice(String(listing.price));
      setCategory(listing.category);
      const cond = listing.condition.toLowerCase();
      setCondition(CONDITIONS.includes(cond) ? cond : listing.condition);
      setImages([...listing.images]);
      setCity(listing.location?.city ?? '');
      setDistrict(listing.location?.district ?? '');
    } catch {
      Alert.alert('Hata', 'İlan yüklenemedi');
      router.back();
    } finally {
      setLoadingListing(false);
    }
  }, [id, user?.id, router]);

  useEffect(() => {
    if (authLoading) return;
    void loadListing();
  }, [authLoading, loadListing]);

  const pickImage = async () => {
    if (images.length >= 10) {
      Alert.alert('Limit', 'Maksimum 10 resim ekleyebilirsiniz');
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('izin Gerekli', 'Galeri erişimi için izin vermeniz gerekiyor');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: false,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      try {
        const url = await uploadImageToR2({
          uri: asset.uri,
          sizeBytes: asset.fileSize,
          mimeType: (asset as any).mimeType,
          fileName: (asset as any).fileName,
        });
        setImages([...images, url]);
      } catch (e: any) {
        const info = e?.info ? ` (${String(e.info)})` : '';
        Alert.alert('Hata', `Resim yuklenemedi${info}`);
      }
    }
  };

  const takePhoto = async () => {
    if (images.length >= 10) {
      Alert.alert('Limit', 'Maksimum 10 resim ekleyebilirsiniz');
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('izin Gerekli', 'Kamera erişimi için izin vermeniz gerekiyor');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: false,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      try {
        const url = await uploadImageToR2({
          uri: asset.uri,
          sizeBytes: asset.fileSize,
          mimeType: (asset as any).mimeType,
          fileName: (asset as any).fileName,
        });
        setImages([...images, url]);
      } catch (e: any) {
        const info = e?.info ? ` (${String(e.info)})` : '';
        Alert.alert('Hata', `Resim yuklenemedi${info}`);
      }
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const getCurrentLocation = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Web Desteği Yok',
        'GPS konumu sadece mobil cihazlarda çalışır. Lütfen manuel olarak girin.'
      );
      return;
    }

    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin Gerekli', 'Konum erişimi için izin vermeniz gerekiyor');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const geocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (geocode && geocode.length > 0) {
        const address = geocode[0];
        setCity(address.city || address.region || '');
        setDistrict(address.district || address.subregion || '');
        Alert.alert('Başarılı', 'Konumunuz alındı');
      } else {
        Alert.alert('Hata', 'Konum bilgisi alınamadı. Manuel olarak girebilirsiniz.');
      }
    } catch (error: any) {
      console.error('Location error:', error);
      Alert.alert('Hata', `Konum alınamadı: ${error.message}. Manuel olarak girebilirsiniz.`);
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleSubmit = async () => {
    if (!id) return;
    if (!title || !description || !price || !category || !condition) {
      Alert.alert('Hata', 'Lütfen tüm gerekli alanları doldurun');
      return;
    }

    const titleTrim = title.trim();
    if (titleTrim.length < 3 || !hasLetter(titleTrim)) {
      Alert.alert('Hata', 'Başlık geçersiz.');
      return;
    }
    const descTrim = description.trim();
    if (descTrim.length > 5000) {
      Alert.alert('Hata', 'Açıklama çok uzun.');
      return;
    }
    const priceNum = Number(String(price).replace(',', '.'));
    if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > MAX_PRICE) {
      Alert.alert('Hata', `Fiyat 0 ile ${MAX_PRICE.toLocaleString('tr-TR')} arasinda olmali.`);
      return;
    }

    if (images.length === 0) {
      Alert.alert('Hata', 'Lütfen en az 1 resim bulunsun');
      return;
    }

    if (loading) return;

    setLoading(true);
    let didNavigate = false;
    try {
      const location = city || district ? { city, district } : undefined;
      await listingAPI.update(id, {
        title: titleTrim,
        description: descTrim,
        price: priceNum,
        category,
        condition,
        images,
        location,
      });
      setLoading(false);
      didNavigate = true;
      router.replace(`/listing/${id}`);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      Alert.alert('Hata', msg || 'Bir hata oluştu');
    } finally {
      if (!didNavigate) {
        setLoading(false);
      }
    }
  };

  if (authLoading || loadingListing || !id) {
    return (
      <SafeAreaView style={styles.centered} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color="#ff3b30" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>İlanı Düzenle</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        >
          <Text style={styles.sectionTitle}>Resimler ({images.length}/10)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
            {images.map((image, index) => (
              <View key={`${index}-${image.slice(0, 32)}`} style={styles.imageContainer}>
                <Image source={{ uri: image }} style={styles.image} />
                <TouchableOpacity
                  style={styles.removeImageButton}
                  onPress={() => removeImage(index)}
                >
                  <Ionicons name="close-circle" size={24} color="#ff3b30" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addImageButton} onPress={pickImage}>
              <Ionicons name="image-outline" size={32} color="#666" />
              <Text style={styles.addImageText}>Galeri</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addImageButton} onPress={takePhoto}>
              <Ionicons name="camera-outline" size={32} color="#666" />
              <Text style={styles.addImageText}>Fotoğraf</Text>
            </TouchableOpacity>
          </ScrollView>

          <Text style={styles.sectionTitle}>Başlık</Text>
          <TextInput
            style={styles.input}
            placeholder="Başlık"
            placeholderTextColor="#999"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.sectionTitle}>Açıklama</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Açıklama"
            placeholderTextColor="#999"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Text style={styles.sectionTitle}>Fiyat (₺)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#999"
            value={price}
            onChangeText={(t) => setPrice(normalizePriceInput(t))}
            keyboardType="decimal-pad"
          />

          <Text style={styles.sectionTitle}>Kategori</Text>
          <View style={styles.optionsGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[styles.optionChip, category === cat.value && styles.optionChipActive]}
                onPress={() => setCategory(cat.value)}
              >
                <Text
                  style={[styles.optionText, category === cat.value && styles.optionTextActive]}
                  numberOfLines={2}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Durum</Text>
          <View style={styles.optionsGrid}>
            {CONDITIONS.map((cond) => (
              <TouchableOpacity
                key={cond}
                style={[styles.optionChip, condition === cond && styles.optionChipActive]}
                onPress={() => setCondition(cond)}
              >
                <Text style={[styles.optionText, condition === cond && styles.optionTextActive]}>
                  {cond.charAt(0).toUpperCase() + cond.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Konum (opsiyonel)</Text>
          <View style={styles.locationSection}>
            <TouchableOpacity
              style={[styles.locationButton, loadingLocation && styles.buttonDisabled]}
              onPress={getCurrentLocation}
              disabled={loadingLocation}
            >
              {loadingLocation ? (
                <ActivityIndicator size="small" color="#ff3b30" />
              ) : (
                <>
                  <Ionicons name="navigate" size={20} color="#ff3b30" />
                  <Text style={styles.locationButtonText}>Mevcut Konumu Al</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.orText}>veya listeden il / ilçe seçin</Text>

            <ProvinceDistrictPicker
              city={city}
              district={district}
              onCityChange={setCity}
              onDistrictChange={setDistrict}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.buttonDisabled]}
            onPress={() => void handleSubmit()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={24} color="#fff" />
                <Text style={styles.submitButtonText}>Değişiklikleri Kaydet</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 12 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  imagesScroll: {
    marginBottom: 8,
  },
  imageContainer: {
    position: 'relative',
    marginRight: 12,
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  addImageButton: {
    width: 120,
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addImageText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    minHeight: 100,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    marginBottom: 4,
    maxWidth: '48%',
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionChipActive: {
    backgroundColor: '#ff3b30',
  },
  optionText: {
    fontSize: 13,
    lineHeight: 17,
    color: '#666',
    textAlign: 'center',
  },
  optionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 56,
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  locationSection: {
    marginTop: 8,
    marginBottom: 4,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    height: 48,
    borderWidth: 2,
    borderColor: '#ff3b30',
    marginBottom: 16,
  },
  locationButtonText: {
    color: '#ff3b30',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  orText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 18,
  },
});
