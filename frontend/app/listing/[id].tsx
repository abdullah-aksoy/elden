import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBackendBaseUrl } from '../../src/lib/backendUrl';
import { consumeListingJustPublished } from '../../src/lib/listingPublishFeedback';
import { editListingHref } from '../../src/lib/expoHref';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Share,
  Platform,
  BackHandler,
  Modal,
  TextInput,
  Keyboard,
  FlatList,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listingAPI, reportAPI, ratingAPI, purchaseAPI, paytrAPI, questionAPI } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';
import { Listing, MessagePartner, MyPurchaseState } from '../../src/types';
import { requestBuyerSaleNotificationsRefresh } from '../../src/lib/buyerSaleNotificationEvents';
import { WebView } from 'react-native-webview';
import { wsClient } from '../../src/services/ws';
import { isAxiosError } from 'axios';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

const { width } = Dimensions.get('window');

function fastApiErrorMessage(err: unknown, fallback: string): string {
  if (!isAxiosError(err)) return fallback;
  const data = err.response?.data as { detail?: unknown } | undefined;
  const d = data?.detail;
  if (typeof d === 'string' && d.trim()) return d.trim();
  if (Array.isArray(d))
    return (
      d
        .map((x: { msg?: string }) => (typeof x?.msg === 'string' ? x.msg : ''))
        .filter(Boolean)
        .join(' ') || fallback
    );
  return fallback;
}

export default function ListingDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(0);
  const [publishedBanner, setPublishedBanner] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [myPurchase, setMyPurchase] = useState<MyPurchaseState | null>(null);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [soldPartnersModalVisible, setSoldPartnersModalVisible] = useState(false);
  const [messagePartners, setMessagePartners] = useState<MessagePartner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [initiateSoldBusy, setInitiateSoldBusy] = useState(false);
  const [rateModalVisible, setRateModalVisible] = useState(false);
  const [rateStars, setRateStars] = useState(5);
  const [rateComment, setRateComment] = useState('');
  const [rateSubmitting, setRateSubmitting] = useState(false);
  const [rateModalKeyboardPad, setRateModalKeyboardPad] = useState(0);
  const [boostModalVisible, setBoostModalVisible] = useState(false);
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostUrl, setBoostUrl] = useState<string | null>(null);
  const boostMerchantOidRef = useRef<string | null>(null);
  const boostPayHandledRef = useRef(false);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaItems, setQaItems] = useState<
    {
      id: string;
      text: string;
      answerText?: string | null;
      createdAt?: string;
      answeredAt?: string | null;
      askerId: string;
      askerName?: string | null;
      askerAvatar?: string | null;
      sellerId: string;
    }[]
  >([]);
  const [askModalVisible, setAskModalVisible] = useState(false);
  const [askText, setAskText] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [answerModalVisible, setAnswerModalVisible] = useState(false);
  const [answerQuestionId, setAnswerQuestionId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerBusy, setAnswerBusy] = useState(false);
  const [qaModalKeyboardPad, setQaModalKeyboardPad] = useState(0);
  const [qaInputH, setQaInputH] = useState(88);

  const loadQuestions = useCallback(async () => {
    if (!listing?.id) return;
    setQaLoading(true);
    try {
      const { data } = await questionAPI.listForListing(listing.id);
      setQaItems(Array.isArray(data) ? (data as any) : []);
    } catch {
      // ignore
    } finally {
      setQaLoading(false);
    }
  }, [listing?.id]);

  useEffect(() => {
    void loadQuestions();
    const off = wsClient.on((evt) => {
      if (evt.type === 'question_new' || evt.type === 'question_update') {
        if (String((evt as any).listingId || '') === String(listing?.id || '')) void loadQuestions();
      }
    });
    return () => {
      off();
    };
  }, [listing?.id, loadQuestions]);

  const submitAsk = async () => {
    if (!user) {
      router.push('/auth/login');
      return;
    }
    const t = String(askText || '').trim();
    if (t.length < 2) {
      Alert.alert('Hata', 'Soru çok kısa.');
      return;
    }
    if (!listing?.id) return;
    setAskBusy(true);
    try {
      await questionAPI.ask(listing.id, t);
      setAskModalVisible(false);
      setAskText('');
      void loadQuestions();
      Alert.alert('Başarılı', 'Soru gönderildi.');
    } catch (e) {
      Alert.alert('Hata', fastApiErrorMessage(e, 'Soru gönderilemedi.'));
    } finally {
      setAskBusy(false);
    }
  };

  const submitAnswer = async () => {
    const qid = answerQuestionId;
    const t = String(answerText || '').trim();
    if (!qid) return;
    if (t.length < 1) {
      Alert.alert('Hata', 'Cevap boş.');
      return;
    }
    setAnswerBusy(true);
    try {
      await questionAPI.answer(qid, t);
      setAnswerModalVisible(false);
      setAnswerQuestionId(null);
      setAnswerText('');
      void loadQuestions();
      Alert.alert('Başarılı', 'Cevap gönderildi.');
    } catch (e) {
      Alert.alert('Hata', fastApiErrorMessage(e, 'Cevap gönderilemedi.'));
    } finally {
      setAnswerBusy(false);
    }
  };

  const confirmDeleteQuestion = (questionId: string) => {
    const run = async () => {
      try {
        await questionAPI.delete(questionId);
        void loadQuestions();
      } catch (e) {
        Alert.alert('Hata', fastApiErrorMessage(e, 'Soru silinemedi.'));
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu soruyu silmek istiyor musunuz?')) void run();
      return;
    }
    Alert.alert('Soruyu sil', 'Bu soruyu silmek istiyor musunuz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const startBoost = async (packageId: string) => {
    if (!listing) return;
    setBoostBusy(true);
    boostPayHandledRef.current = false;
    try {
      const { data } = await paytrAPI.createToken(listing.id, packageId);
      const token = data.iframeToken;
      boostMerchantOidRef.current = data.merchantOid;
      setBoostUrl(`https://www.paytr.com/odeme/guvenli/${token}`);
    } catch (e) {
      Alert.alert('Hata', fastApiErrorMessage(e, 'Ödeme başlatılamadı.'));
    } finally {
      setBoostBusy(false);
    }
  };

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home');
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [goBack])
  );

  const fetchListing = useCallback(async () => {
    if (!id) return;
    try {
      const response = await listingAPI.getById(id);
      setListing(response.data);
    } catch (error) {
      console.error('Fetch listing error:', error);
      Alert.alert('Hata', 'İlan bulunamadı');
      goBack();
    } finally {
      setLoading(false);
    }
  }, [id, goBack]);

  useEffect(() => {
    void fetchListing();
  }, [fetchListing]);

  useEffect(() => {
    if (!rateModalVisible) {
      setRateModalKeyboardPad(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, (e) => {
      setRateModalKeyboardPad(e.endCoordinates.height);
    });
    const subHide = Keyboard.addListener(hideEvt, () => {
      setRateModalKeyboardPad(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [rateModalVisible]);

  useEffect(() => {
    const open = askModalVisible || answerModalVisible;
    if (!open) {
      setQaModalKeyboardPad(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, (e) => {
      setQaModalKeyboardPad(e.endCoordinates.height);
    });
    const subHide = Keyboard.addListener(hideEvt, () => {
      setQaModalKeyboardPad(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [askModalVisible, answerModalVisible]);

  const fetchMyPurchase = useCallback(async () => {
    if (!id || !user?.id || !listing || listing.sellerId === user.id) {
      setMyPurchase(null);
      return;
    }
    try {
      const res = await listingAPI.getMyPurchase(id);
      setMyPurchase(res.data);
    } catch {
      setMyPurchase(null);
    }
  }, [id, user?.id, listing]);

  useEffect(() => {
    void fetchMyPurchase();
  }, [fetchMyPurchase]);

  useFocusEffect(
    useCallback(() => {
      void fetchMyPurchase();
    }, [fetchMyPurchase])
  );

  useEffect(() => {
    if (!listing) return;
    if (!consumeListingJustPublished(listing.id)) return;
    setPublishedBanner(true);
    const t = setTimeout(() => setPublishedBanner(false), 4500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca ilan id; favori vb. güncellemelerde bandı yeniden gösterme
  }, [listing?.id]);

  const handleFavorite = async () => {
    if (!listing) return;
    try {
      if (listing.isFavorited) {
        await listingAPI.removeFavorite(listing.id);
      } else {
        await listingAPI.addFavorite(listing.id);
      }
      setListing({
        ...listing,
        isFavorited: !listing.isFavorited,
        favoriteCount: listing.favoriteCount + (listing.isFavorited ? -1 : 1),
      });
    } catch (error) {
      console.error('Favorite error:', error);
    }
  };

  const handleContact = () => {
    if (!listing) return;
    if (listing.sellerId === user?.id) {
      Alert.alert('Bilgi', 'Bu sizin ilanınız');
      return;
    }
    router.push(`/chat/${listing.id}/${listing.sellerId}`);
  };

  const openSoldPartnerPicker = async () => {
    if (!listing || !id) return;
    setPartnersLoading(true);
    try {
      const res = await listingAPI.getMessagePartners(id);
      const list: MessagePartner[] = res.data ?? [];
      if (list.length === 0) {
        Alert.alert(
          'Alıcı seçilemiyor',
          'Satıldı işaretlemek için bu ilan kapsamında en az bir kişiyle mesajlaşmış olmalısınız. Önce ilgili kişiyle sohbet edin.',
        );
        return;
      }
      setMessagePartners(list);
      setSoldPartnersModalVisible(true);
    } catch {
      Alert.alert('Hata', 'Mesajlaştığınız kişiler yüklenemedi');
    } finally {
      setPartnersLoading(false);
    }
  };

  const handleMarkSold = () => {
    if (!listing || !id) return;
    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          'Satışı tamamlamak için mesajlaştığınız kişilerden alıcıyı seçeceksiniz. Devam edilsin mi?',
        )
      ) {
        void openSoldPartnerPicker();
      }
      return;
    }
    Alert.alert(
      'Satıldı olarak işaretle',
      'Mesajlaştığınız kişilerden alıcıyı seçeceksiniz; alıcı onayladığında ilan satıldı olur.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Devam', onPress: () => void openSoldPartnerPicker() },
      ],
    );
  };

  const handleInitiateSoldTo = async (buyerId: string) => {
    if (!id) return;
    setInitiateSoldBusy(true);
    try {
      await listingAPI.initiateSoldTo(id, buyerId);
      setSoldPartnersModalVisible(false);
      await fetchListing();
      Alert.alert('Gönderildi', 'Alıcıya satış bildirimi gönderildi. Onayladığında ilan satıldı olarak işaretlenecek.');
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      Alert.alert('Hata', typeof msg === 'string' ? msg : 'İşlem gerçekleştirilemedi');
    } finally {
      setInitiateSoldBusy(false);
    }
  };

  const handleBuyerConfirmSold = async () => {
    if (!myPurchase?.requestId) return;
    setPurchaseBusy(true);
    try {
      await purchaseAPI.buyerConfirmSold(myPurchase.requestId);
      await fetchListing();
      await fetchMyPurchase();
      requestBuyerSaleNotificationsRefresh();
      Alert.alert('Tamam', 'Satışı onayladınız. İlan satıldı olarak işaretlendi.');
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      Alert.alert('Hata', typeof msg === 'string' ? msg : 'Onaylanamadı');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleBuyerRejectSold = async () => {
    const requestId = myPurchase?.requestId;
    if (!requestId) return;
    const run = async () => {
      setPurchaseBusy(true);
      try {
        await purchaseAPI.buyerRejectSold(requestId);
        await fetchMyPurchase();
        requestBuyerSaleNotificationsRefresh();
        Alert.alert('Tamam', 'Satış bildirimi reddedildi.');
      } catch (e: unknown) {
        const msg =
          typeof e === 'object' && e !== null && 'response' in e
            ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
        Alert.alert('Hata', typeof msg === 'string' ? msg : 'Reddedilemedi');
      } finally {
        setPurchaseBusy(false);
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

  const submitRating = async () => {
    if (!listing || !user || !id) return;
    setRateSubmitting(true);
    try {
      await ratingAPI.create({
        userId: listing.sellerId,
        listingId: id,
        rating: rateStars,
        comment: rateComment.trim() || undefined,
      });
      setRateModalVisible(false);
      setRateComment('');
      await fetchMyPurchase();
      Alert.alert('Teşekkürler', 'Değerlendirmeniz kaydedildi');
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      Alert.alert('Hata', typeof msg === 'string' ? msg : 'Değerlendirme gönderilemedi');
    } finally {
      setRateSubmitting(false);
    }
  };

  const handleShare = async () => {
    try {
      const priceText =
        typeof listing?.price === 'number' ? listing.price.toLocaleString('tr-TR') : String(listing?.price ?? '');
      const base = getBackendBaseUrl();
      const url = listing?.id ? `${base}/listing/${listing.id}` : '';
      const title = String(listing?.title || '').trim();
      const msg = `${title ? title + ' - ' : ''}${priceText} TL${url ? `\n${url}` : ''}`.trim();
      await Share.share({
        message: msg,
        ...(url ? { url } : {}),
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleReport = () => {
    Alert.alert('Şikayetiniz', 'Lütfen şikayet nedeninizi seçin', [
      {
        text: 'Yanıltıcı bilgi',
        onPress: () => submitReport('Yanıltıcı bilgi'),
      },
      {
        text: 'Uygunsuz içerik',
        onPress: () => submitReport('Uygunsuz içerik'),
      },
      {
        text: 'Dolandırıcılık',
        onPress: () => submitReport('Dolandırıcılık'),
      },
      { text: 'İptal', style: 'cancel' },
    ]);
  };

  const submitReport = async (reason: string) => {
    try {
      await reportAPI.create({
        listingId: id,
        reason,
      });
      Alert.alert('Teşekkürler', 'Şikayetiniz alındı ve incelenecek');
    } catch {
      Alert.alert('Hata', 'Bir hata oluştu');
    }
  };

  /** Erken return'lerden ÖNCE: hook sırası her render'da aynı olmalı (Rules of Hooks). */
  const scrollBottomPadding = useMemo(() => {
    if (!listing) {
      return 100;
    }
    const owner = listing.sellerId === user?.id;
    const active = listing.status === 'aktif';
    const footerVerticalPadding = 32;
    const bottomInset = 16 + insets.bottom;
    const btn = 52;
    const gap = 10;
    const extra = 32;
    if (owner) {
      const buttonsH = active ? btn + gap + btn : btn;
      return footerVerticalPadding + buttonsH + bottomInset + extra;
    }
    const noteH = !user && active ? 22 : 0;
    const buyerPendingSellerPickH =
      !owner && user && myPurchase?.status === 'pending_buyer_confirmation' ? 44 : 0;
    return footerVerticalPadding + btn + bottomInset + extra + noteH + buyerPendingSellerPickH;
  }, [listing, user, insets.bottom, myPurchase?.status]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#ff3b30" />
      </View>
    );
  }

  if (!listing) {
    return null;
  }

  const isOwner = listing.sellerId === user?.id;
  const isActive = listing.status === 'aktif';

  const listingStatusLabel =
    listing.status === 'satıldı'
      ? 'Satıldı'
      : listing.status === 'kaldırıldı'
        ? 'Kaldırıldı'
        : listing.status !== 'aktif'
          ? listing.status
          : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {publishedBanner ? (
        <View style={styles.publishedBanner}>
          <Ionicons name="checkmark-circle" size={22} color="#2e7d32" />
          <Text style={styles.publishedBannerText}>İlanınız yayınlandı.</Text>
        </View>
      ) : null}
      <View
        style={[
          styles.header,
          { top: insets.top + (publishedBanner ? 50 : 8) },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={24} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleReport}>
            <Ionicons name="flag-outline" size={24} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.imagesContainer}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / width);
              setActiveImageIndex(index);
            }}
            scrollEventThrottle={16}
          >
            {(listing.images ?? []).map((image, index) => (
              <Pressable
                key={index}
                onPress={() => {
                  setImageViewerIndex(index);
                  setImageViewerVisible(true);
                }}
              >
                <Image source={{ uri: image }} style={styles.image} />
              </Pressable>
            ))}
          </ScrollView>
          {(listing.images ?? []).length > 1 && (
            <View style={styles.imagePagination}>
              {(listing.images ?? []).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.paginationDot,
                    index === activeImageIndex && styles.paginationDotActive,
                  ]}
                />
              ))}
            </View>
          )}
          {listing.sellerId !== user?.id ? (
            <TouchableOpacity
              style={[styles.favoriteButton, { top: insets.top + 52 }]}
              onPress={handleFavorite}
            >
              <Ionicons
                name={listing.isFavorited ? 'heart' : 'heart-outline'}
                size={28}
                color={listing.isFavorited ? '#ff3b30' : '#333'}
              />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.infoSection}>
          {listingStatusLabel ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{listingStatusLabel}</Text>
            </View>
          ) : null}
          <Text style={styles.price}>
            {Number(listing.price ?? 0).toLocaleString('tr-TR')} ₺
          </Text>
          <Text style={styles.title}>{listing.title}</Text>
          {!isOwner && user && myPurchase?.status === 'pending' ? (
            <Text style={styles.purchaseHint}>Satın alma talebiniz satıcı onayını bekliyor.</Text>
          ) : null}
          {!isOwner && user && myPurchase?.status === 'confirmed' ? (
            <Text style={styles.purchaseHintPositive}>Satın alma satıcı tarafından onaylandı.</Text>
          ) : null}
          {!isOwner && user && myPurchase?.status === 'declined' ? (
            <Text style={styles.purchaseHintWarn}>Satıcı bu talebi reddetti.</Text>
          ) : null}
          {!isOwner && user && myPurchase?.status === 'pending_buyer_confirmation' ? (
            <Text style={styles.purchaseHintSellerPick}>
              Satıcı bu ürünü size sattığını bildirdi. Onaylarsanız satış tamamlanır ve ilan satıldı olur.
            </Text>
          ) : null}
          {!isOwner && user && myPurchase?.canRate ? (
            <Text style={styles.purchaseHintPositive}>
              Satış tamamlandı. Aşağıdan satıcıyı değerlendirebilirsiniz.
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="pricetag-outline" size={16} color="#666" />
              <Text style={styles.metaText}>{listing.category}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#666" />
              <Text style={styles.metaText}>
                {listing.condition
                  ? listing.condition.charAt(0).toUpperCase() + listing.condition.slice(1)
                  : '—'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="eye-outline" size={16} color="#666" />
              <Text style={styles.metaText}>{listing.views} görüntüleme</Text>
            </View>
          </View>

          {listing.location?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location" size={20} color="#ff3b30" />
              <Text style={styles.locationText}>
                {listing.location.city}
                {listing.location.district && `, ${listing.location.district}`}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.descriptionSection}>
          <Text style={styles.sectionTitle}>Açıklama</Text>
          <Text style={styles.description}>{listing.description}</Text>
        </View>

        {isActive ? (
          <>
            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Soru - Cevap</Text>
                {!isOwner ? (
                  <TouchableOpacity style={styles.sectionBtn} onPress={() => setAskModalVisible(true)} activeOpacity={0.85}>
                    <Text style={styles.sectionBtnText} allowFontScaling={false}>
                      Sor
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {isOwner ? (
                <Text style={[styles.muted, { marginBottom: 8 }]}>Kendi ilanınıza soru soramazsiniz.</Text>
              ) : null}
              {qaLoading ? <ActivityIndicator color="#ff3b30" /> : null}
              {qaItems.length === 0 && !qaLoading ? <Text style={styles.muted}>Henüz soru yok.</Text> : null}
              {qaItems.map((q) => {
                const isMineToAnswer = listing.sellerId === user?.id;
                return (
                  <View key={q.id} style={styles.qaCard}>
                    <View style={styles.qaRow}>
                      {q.askerAvatar ? (
                        <Image source={{ uri: q.askerAvatar }} style={styles.qaAvatar} />
                      ) : (
                        <View style={styles.qaAvatarPlaceholder} />
                      )}
                      <View style={styles.qaBubbleQ}>
                        <Text style={styles.qaName}>{String(q.askerName || 'Kullanici')}</Text>
                        <Text style={styles.qaText}>{String(q.text || '')}</Text>
                      </View>
                    </View>
                    {q.answerText ? (
                      <View style={styles.qaRowRight}>
                        <View style={styles.qaBubbleA}>
                          <Text style={styles.qaName}>{String(listing.sellerName || 'Satıcı')}</Text>
                          <Text style={styles.qaText}>{String(q.answerText)}</Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={[styles.muted, { marginTop: 8 }]}>Henüz cevap yok.</Text>
                    )}
                    {isMineToAnswer && !q.answerText ? (
                      <View style={styles.qaActionsRow}>
                        <TouchableOpacity
                          style={styles.sectionBtn}
                          onPress={() => {
                            setAnswerQuestionId(q.id);
                            setAnswerText('');
                            setAnswerModalVisible(true);
                          }}
                        >
                          <Text style={styles.sectionBtnText} allowFontScaling={false}>
                            Cevapla
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sectionBtn, styles.dangerBtn]}
                          onPress={() => confirmDeleteQuestion(q.id)}
                        >
                          <Text style={[styles.sectionBtnText, styles.dangerBtnText]} allowFontScaling={false}>
                            Sil
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : isMineToAnswer ? (
                      <TouchableOpacity
                        style={[styles.sectionBtn, styles.dangerBtn, styles.qaDeleteOnlyBtn]}
                        onPress={() => confirmDeleteQuestion(q.id)}
                      >
                        <Text style={[styles.sectionBtnText, styles.dangerBtnText]} allowFontScaling={false}>
                          Sil
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.divider} />
          </>
        ) : null}

        <TouchableOpacity
          style={styles.sellerSection}
          onPress={() => router.push(`/user/${listing.sellerId}`)}
        >
          <View style={styles.sellerInfo}>
            {listing.sellerAvatar ? (
              <Image source={{ uri: listing.sellerAvatar }} style={styles.sellerAvatar} />
            ) : (
              <View style={[styles.sellerAvatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={24} color="#fff" />
              </View>
            )}
            <View style={styles.sellerDetails}>
              <Text style={styles.sellerName}>{listing.sellerName}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color="#ffc107" />
                <Text style={styles.ratingText}>
                  {(listing.sellerRating?.average ?? 0).toFixed(1)} ({listing.sellerRating?.count ?? 0})
                </Text>
              </View>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>

        <View style={{ height: 8 }} />
      </ScrollView>

      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <View style={styles.imageViewerBackdrop}>
          <View style={[styles.header, { top: insets.top + 8 }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => setImageViewerVisible(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerActions} />
          </View>
          <FlatList
            data={listing.images ?? []}
            keyExtractor={(uri, idx) => `${idx}:${uri}`}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.max(0, Math.min(imageViewerIndex, (listing.images ?? []).length - 1))}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width, justifyContent: 'center', alignItems: 'center' }}>
                <Image source={{ uri: String(item) }} style={styles.imageViewerImage} resizeMode="contain" />
              </View>
            )}
          />
        </View>
      </Modal>

      {isOwner ? (
        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          {isActive ? (
            <TouchableOpacity
              style={[styles.outlineButton, partnersLoading && styles.buttonDisabled]}
              onPress={handleMarkSold}
              disabled={partnersLoading}
            >
              {partnersLoading ? (
                <ActivityIndicator color="#ff3b30" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={20} color="#ff3b30" />
                  <Text style={styles.outlineButtonText}>Satıldı olarak işaretle</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
          {isActive ? (
            <TouchableOpacity
              style={[styles.contactButton, isActive && styles.contactButtonTightTop]}
              onPress={() => router.push(editListingHref(listing.id))}
            >
              <Ionicons name="create-outline" size={20} color="#fff" />
              <Text style={styles.contactButtonText}>İlanı düzenle</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.footerDisabled, { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#999" />
              <Text style={[styles.footerDisabledText, { marginLeft: 6 }]}>Düzenleme kapalı</Text>
            </View>
          )}
          {isActive ? (
            <TouchableOpacity
              style={[styles.outlineButton, boostBusy && styles.buttonDisabled]}
              onPress={() => {
                boostMerchantOidRef.current = null;
                boostPayHandledRef.current = false;
                setBoostUrl(null);
                setBoostModalVisible(true);
              }}
              disabled={boostBusy}
            >
              <Ionicons name="rocket-outline" size={20} color="#ff3b30" />
              <Text style={styles.outlineButtonText}>Öne çıkar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          {user && (isActive || myPurchase) ? (
            <>
              {myPurchase?.canRate ||
              myPurchase?.status === 'pending_buyer_confirmation' ||
              myPurchase?.status === 'pending' ||
              myPurchase?.status === 'confirmed' ? (
                <View style={styles.footerRow}>
                  <TouchableOpacity style={[styles.footerHalf, styles.contactButton]} onPress={handleContact}>
                    <Ionicons name="chatbubble" size={20} color="#fff" />
                    <Text style={styles.contactButtonText}>Mesaj</Text>
                  </TouchableOpacity>
                  {myPurchase?.canRate ? (
                    <TouchableOpacity
                      style={[styles.footerHalf, styles.secondaryCta]}
                      onPress={() => setRateModalVisible(true)}
                    >
                      <Ionicons name="star-outline" size={20} color="#ff3b30" />
                      <Text style={styles.secondaryCtaText}>Değerlendir</Text>
                    </TouchableOpacity>
                  ) : myPurchase?.status === 'pending_buyer_confirmation' ? (
                    <TouchableOpacity
                      style={[styles.footerHalf, styles.secondaryCta]}
                      onPress={() => void handleBuyerConfirmSold()}
                      disabled={purchaseBusy}
                    >
                      {purchaseBusy ? (
                        <ActivityIndicator color="#ff3b30" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle-outline" size={20} color="#ff3b30" />
                          <Text style={styles.secondaryCtaText}>Satışı onayla</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : myPurchase?.status === 'pending' ? (
                    <View style={[styles.footerHalf, styles.footerDisabled]}>
                      <Ionicons name="time-outline" size={20} color="#999" />
                      <Text style={styles.footerDisabledText}>Onay bekliyor</Text>
                    </View>
                  ) : myPurchase?.status === 'confirmed' ? (
                    <View style={[styles.footerHalf, styles.footerDisabled]}>
                      <Ionicons name="checkmark-circle-outline" size={20} color="#2e7d32" />
                      <Text style={[styles.footerDisabledText, { color: '#2e7d32' }]}>Tamamlandı</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity style={styles.contactButton} onPress={handleContact}>
                  <Ionicons name="chatbubble" size={20} color="#fff" />
                  <Text style={styles.contactButtonText}>Mesaj</Text>
                </TouchableOpacity>
              )}
              {myPurchase?.status === 'pending_buyer_confirmation' ? (
                <TouchableOpacity
                  style={styles.rejectSoldLink}
                  onPress={() => void handleBuyerRejectSold()}
                  disabled={purchaseBusy}
                >
                  <Text style={styles.rejectSoldLinkText}>Satış bildirimini reddet</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <TouchableOpacity style={styles.contactButton} onPress={handleContact}>
              <Ionicons name="chatbubble" size={20} color="#fff" />
              <Text style={styles.contactButtonText}>Mesaj Gönder</Text>
            </TouchableOpacity>
          )}
          {!user && isActive ? (
            <Text style={styles.footerNote}>Satıcıya yazmak için giriş yapın</Text>
          ) : null}
        </View>
      )}

      <Modal visible={askModalVisible} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => Keyboard.dismiss()}>
          <KeyboardAwareScrollView
            enableOnAndroid
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.modalScrollContent,
              qaModalKeyboardPad > 0 && { paddingBottom: qaModalKeyboardPad },
            ]}
            extraScrollHeight={Platform.OS === 'android' ? 96 : 12}
            keyboardOpeningTime={0}
          >
            <Pressable
              onPress={() => undefined}
              style={[
                styles.modalCard,
                {
                  marginBottom: 8 + insets.bottom + qaModalKeyboardPad,
                  alignSelf: 'center',
                  width: '92%',
                  maxWidth: 520,
                },
              ]}
            >
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Soru sor</Text>
              <TouchableOpacity style={styles.modalKeyboardBtn} onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Ionicons name="chevron-down" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.modalInput, { height: qaInputH }]}
              placeholder="Sorunuzu yazın"
              placeholderTextColor="#999"
              value={askText}
                onChangeText={setAskText}
              maxLength={400}
              multiline
              scrollEnabled
              onContentSizeChange={(e) => {
                const h = e?.nativeEvent?.contentSize?.height;
                if (typeof h === 'number' && Number.isFinite(h)) {
                  const next = Math.max(88, Math.min(220, Math.round(h + 24)));
                  setQaInputH(next);
                }
              }}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setAskModalVisible(false)} disabled={askBusy}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, askBusy && styles.buttonDisabled]}
                onPress={() => void submitAsk()}
                disabled={askBusy}
              >
                {askBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Gönder</Text>}
              </TouchableOpacity>
            </View>
            </Pressable>
          </KeyboardAwareScrollView>
        </Pressable>
      </Modal>

      <Modal visible={answerModalVisible} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => Keyboard.dismiss()}>
          <KeyboardAwareScrollView
            enableOnAndroid
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.modalScrollContent,
              qaModalKeyboardPad > 0 && { paddingBottom: qaModalKeyboardPad },
            ]}
            extraScrollHeight={Platform.OS === 'android' ? 96 : 12}
            keyboardOpeningTime={0}
          >
            <Pressable
              onPress={() => undefined}
              style={[
                styles.modalCard,
                {
                  marginBottom: 8 + insets.bottom + qaModalKeyboardPad,
                  alignSelf: 'center',
                  width: '92%',
                  maxWidth: 520,
                },
              ]}
            >
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Cevapla</Text>
              <TouchableOpacity style={styles.modalKeyboardBtn} onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Ionicons name="chevron-down" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.modalInput, { height: qaInputH }]}
              placeholder="Cevabınızı yazın"
              placeholderTextColor="#999"
              value={answerText}
                onChangeText={(t) => setAnswerText(t)}
              maxLength={800}
              multiline
              scrollEnabled
              onContentSizeChange={(e) => {
                const h = e?.nativeEvent?.contentSize?.height;
                if (typeof h === 'number' && Number.isFinite(h)) {
                  const next = Math.max(88, Math.min(220, Math.round(h + 24)));
                  setQaInputH(next);
                }
              }}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setAnswerModalVisible(false);
                  setAnswerQuestionId(null);
                  setAnswerText('');
                }}
                disabled={answerBusy}
              >
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, answerBusy && styles.buttonDisabled]}
                onPress={() => void submitAnswer()}
                disabled={answerBusy}
              >
                {answerBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Gönder</Text>}
              </TouchableOpacity>
            </View>
            </Pressable>
          </KeyboardAwareScrollView>
        </Pressable>
      </Modal>

      <Modal visible={boostModalVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { width: '92%', maxWidth: 520, marginBottom: 8 + insets.bottom, alignSelf: 'center' }]}>
            <Text style={styles.modalTitle}>Öne çıkarma paketi</Text>
            {boostUrl ? (
              <View style={{ height: 520, width: '100%' }}>
                <WebView
                  source={{ uri: boostUrl }}
                  onNavigationStateChange={(nav) => {
                    const u = String(nav.url || '');
                    if (u.includes('/payment/fail')) {
                      if (boostPayHandledRef.current) return;
                      boostPayHandledRef.current = true;
                      setBoostModalVisible(false);
                      setBoostUrl(null);
                      boostMerchantOidRef.current = null;
                      Alert.alert('Hata', 'Ödeme başarısız.');
                      return;
                    }
                    if (!u.includes('/payment/success')) return;
                    if (boostPayHandledRef.current) return;
                    boostPayHandledRef.current = true;
                    void (async () => {
                      const oid = boostMerchantOidRef.current;
                      try {
                        if (oid) {
                          await paytrAPI.confirmPromo(oid);
                        }
                      } catch (e) {
                        if (isAxiosError(e) && e.response?.status === 403) {
                          // Canli modda notify ile aktif olur; test modunda degilse kullanici yine de odemeyi tamamlamis olabilir.
                        } else {
                          Alert.alert('Hata', fastApiErrorMessage(e, 'Öne çıkarma onaylanamadı.'));
                          boostPayHandledRef.current = false;
                          return;
                        }
                      }
                      setBoostModalVisible(false);
                      setBoostUrl(null);
                      boostMerchantOidRef.current = null;
                      void fetchListing();
                      Alert.alert('Başarılı', 'Ödeme tamamlandı. İlanınız öne çıkarıldı.');
                    })();
                  }}
                />
              </View>
            ) : (
              <>
                <View style={styles.boostOptions}>
                  <TouchableOpacity
                    style={[styles.boostOption, boostBusy && styles.buttonDisabled]}
                    onPress={() => void startBoost('boost_1h_category')}
                    disabled={boostBusy}
                    activeOpacity={0.85}
                  >
                    <View style={styles.boostOptionTop}>
                      <Ionicons name="time-outline" size={18} color="#ff3b30" />
                      <Text style={styles.boostOptionTitle}>1 saat</Text>
                    </View>
                    <Text style={styles.boostOptionSub}>Kategoride öne çık</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.boostOption, boostBusy && styles.buttonDisabled]}
                    onPress={() => void startBoost('boost_24h_city')}
                    disabled={boostBusy}
                    activeOpacity={0.85}
                  >
                    <View style={styles.boostOptionTop}>
                      <Ionicons name="location-outline" size={18} color="#ff3b30" />
                      <Text style={styles.boostOptionTitle}>24 saat</Text>
                    </View>
                    <Text style={styles.boostOptionSub}>Şehirde öne çık</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.boostOption, boostBusy && styles.buttonDisabled]}
                    onPress={() => void startBoost('boost_7d_global')}
                    disabled={boostBusy}
                    activeOpacity={0.85}
                  >
                    <View style={styles.boostOptionTop}>
                      <Ionicons name="globe-outline" size={18} color="#ff3b30" />
                      <Text style={styles.boostOptionTitle}>7 gün</Text>
                    </View>
                    <Text style={styles.boostOptionSub}>{"Tüm Türkiye'de öne çık"}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setBoostModalVisible(false);
                  setBoostUrl(null);
                  boostMerchantOidRef.current = null;
                  boostPayHandledRef.current = false;
                }}
              >
                <Text style={styles.modalCancelText}>Kapat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={rateModalVisible} animationType="slide" transparent>
        <View
          style={[
            styles.modalBackdrop,
            rateModalKeyboardPad > 0 && { paddingBottom: rateModalKeyboardPad },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.rateModalScroll}
            contentContainerStyle={styles.rateModalScrollContent}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Satıcıyı değerlendirin</Text>
              <Text style={styles.modalSubtitle}>{listing.sellerName}</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setRateStars(n)} hitSlop={8}>
                    <Ionicons
                      name={n <= rateStars ? 'star' : 'star-outline'}
                      size={36}
                      color="#ffc107"
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.modalInput}
                placeholder="Yorum (isteğe bağlı)"
                placeholderTextColor="#999"
                multiline
                value={rateComment}
                onChangeText={setRateComment}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setRateModalVisible(false)}>
                  <Text style={styles.modalCancelText}>İptal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalSubmit, rateSubmitting && styles.buttonDisabled]}
                  onPress={() => void submitRating()}
                  disabled={rateSubmitting}
                >
                  {rateSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalSubmitText}>Gönder</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={soldPartnersModalVisible} animationType="slide" transparent>
        <View style={styles.partnersModalBackdrop}>
          <View style={styles.partnersModalCard}>
            <Text style={styles.partnersModalTitle}>Alıcıyı seçin</Text>
            <Text style={styles.partnersModalSubtitle}>
              Bu ilan için mesajlaştığınız kişiler. Satışı onaylaması için birini seçin.
            </Text>
            <FlatList
              data={messagePartners}
              keyExtractor={(item) => item.userId}
              style={styles.partnersList}
              renderItem={({ item }) => (
                <View style={styles.partnerRow}>
                  {item.avatar ? (
                    <Image source={{ uri: item.avatar }} style={styles.partnerAvatar} />
                  ) : (
                    <View style={[styles.partnerAvatar, styles.avatarPlaceholder]}>
                      <Ionicons name="person" size={22} color="#fff" />
                    </View>
                  )}
                  <View style={styles.partnerRowText}>
                    <Text style={styles.partnerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.partnerSub} numberOfLines={1}>
                      Son mesaj: {new Date(item.lastMessageAt).toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.partnerSelectBtn, initiateSoldBusy && styles.buttonDisabled]}
                    onPress={() => void handleInitiateSoldTo(item.userId)}
                    disabled={initiateSoldBusy}
                  >
                    <Text style={styles.partnerSelectBtnText}>Seç</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
            <TouchableOpacity
              style={styles.partnersModalClose}
              onPress={() => setSoldPartnersModalVisible(false)}
              disabled={initiateSoldBusy}
            >
              <Text style={styles.partnersModalCloseText}>İptal</Text>
            </TouchableOpacity>
          </View>
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
  publishedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#c8e6c9',
    gap: 8,
  },
  publishedBannerText: {
    color: '#2e7d32',
    fontSize: 15,
    fontWeight: '600',
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
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  content: {
    flex: 1,
  },
  imagesContainer: {
    position: 'relative',
  },
  image: {
    width,
    height: width,
    backgroundColor: '#f5f5f5',
  },
  imagePagination: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: '#fff',
  },
  favoriteButton: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoSection: {
    padding: 16,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 8,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  purchaseHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  purchaseHintPositive: {
    fontSize: 14,
    color: '#2e7d32',
    marginBottom: 8,
    fontWeight: '500',
  },
  purchaseHintWarn: {
    fontSize: 14,
    color: '#c62828',
    marginBottom: 8,
  },
  purchaseHintSellerPick: {
    fontSize: 14,
    color: '#1565c0',
    marginBottom: 8,
    lineHeight: 20,
  },
  rejectSoldLink: {
    alignSelf: 'center',
    marginTop: 10,
    paddingVertical: 6,
  },
  rejectSoldLinkText: {
    fontSize: 14,
    color: '#999',
    textDecorationLine: 'underline',
  },
  partnersModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  partnersModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  partnersModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  partnersModalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  partnersList: {
    maxHeight: 360,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  partnerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  partnerRowText: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  partnerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  partnerSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  partnerSelectBtn: {
    backgroundColor: '#ff3b30',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  partnerSelectBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  partnersModalClose: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
  },
  partnersModalCloseText: {
    fontSize: 16,
    color: '#666',
  },
  price: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ff3b30',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    fontSize: 15,
    color: '#333',
    marginLeft: 4,
    fontWeight: '500',
  },
  divider: {
    height: 8,
    backgroundColor: '#f5f5f5',
  },
  descriptionSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionBtn: {
    borderWidth: 1,
    borderColor: '#ff3b30',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  dangerBtn: {
    borderColor: '#e53935',
  },
  dangerBtnText: {
    color: '#e53935',
  },
  sectionBtnText: {
    color: '#ff3b30',
    fontSize: 12,
    fontWeight: '700',
  },
  muted: {
    color: '#777',
    fontSize: 13,
  },
  qaCard: {
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  qaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  qaRowRight: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  qaAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eee',
  },
  qaAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eee',
  },
  qaBubbleQ: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    borderRadius: 12,
    padding: 10,
  },
  qaBubbleA: {
    maxWidth: '92%',
    borderWidth: 1,
    borderColor: '#ffd7d5',
    backgroundColor: '#fff5f5',
    borderRadius: 12,
    padding: 10,
  },
  qaText: {
    color: '#222',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  description: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  sellerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  sellerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sellerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellerDetails: {
    justifyContent: 'center',
  },
  sellerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 10,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  footerHalf: {
    width: '48%',
    borderRadius: 12,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ff3b30',
    borderRadius: 12,
    height: 52,
    gap: 8,
  },
  outlineButtonText: {
    color: '#ff3b30',
    fontSize: 16,
    fontWeight: '600',
  },
  contactButtonTightTop: {
    marginTop: 0,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 52,
  },
  secondaryCta: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ff3b30',
    gap: 6,
  },
  secondaryCtaText: {
    color: '#ff3b30',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 4,
  },
  footerDisabled: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 6,
  },
  footerDisabledText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  footerNote: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  contactButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  boostOptions: {
    marginTop: 16,
    gap: 12,
  },
  boostOption: {
    borderWidth: 1,
    borderColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boostOptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  boostOptionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  boostOptionSub: {
    fontSize: 13,
    color: '#666',
    marginTop: 6,
    textAlign: 'center',
  },
  qaName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#333',
    marginBottom: 6,
  },
  qaDivider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 10,
  },
  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageViewerImage: {
    width: width,
    height: '100%',
  },
  qaDeleteOnlyBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  rateModalScroll: {
    flex: 1,
  },
  rateModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 28,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalKeyboardBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 15,
    color: '#666',
    marginTop: 4,
    marginBottom: 16,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 12,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: 15,
    color: '#333',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  modalSubmit: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
