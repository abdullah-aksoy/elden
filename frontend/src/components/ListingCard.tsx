import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Listing } from '../types';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

interface ListingCardProps {
  listing: Listing;
  onPress: () => void;
  onFavoritePress?: () => void;
  /** Örn. satıcı profilinde "Satıldı" rozeti */
  statusBadge?: string;
}

export const ListingCard: React.FC<ListingCardProps> = ({
  listing,
  onPress,
  onFavoritePress,
  statusBadge,
}) => {
  const promoted = Boolean((listing as any).isPromoted);
  return (
    <TouchableOpacity style={[styles.card, promoted && styles.promotedCard]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.imageContainer}>
        {listing.images && listing.images.length > 0 ? (
          <Image
            source={{ uri: listing.images[0] }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.image, styles.noImage]}>
            <Ionicons name="image-outline" size={40} color="#ccc" />
          </View>
        )}
        {promoted ? (
          <View style={styles.promotedBadge}>
            <Ionicons name="sparkles" size={12} color="#3a2b00" />
            <Text style={styles.promotedBadgeText}>Öne çıkarıldı</Text>
          </View>
        ) : null}
        {statusBadge ? (
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText} numberOfLines={1}>
              {statusBadge}
            </Text>
          </View>
        ) : null}
        {onFavoritePress && (
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={onFavoritePress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={listing.isFavorited ? 'heart' : 'heart-outline'}
              size={22}
              color={listing.isFavorited ? '#ff3b30' : '#fff'}
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.content}>
        <Text style={styles.price}>{listing.price.toLocaleString('tr-TR')} ₺</Text>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        {listing.location?.city && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color="#666" />
            <Text style={styles.location}>{listing.location.city}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    elevation: 3,
    ...Platform.select({
      web: { boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },
  promotedCard: {
    borderWidth: 2,
    borderColor: '#f6c343',
  },
  imageContainer: {
    position: 'relative',
  },
  image: {
    width: '100%',
    height: CARD_WIDTH,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  noImage: {
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '85%',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  promotedBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    maxWidth: '85%',
    backgroundColor: 'rgba(246, 195, 67, 0.95)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  promotedBadgeText: {
    color: '#3a2b00',
    fontSize: 11,
    fontWeight: '800',
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 12,
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ff3b30',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
    height: 36,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  location: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
});
