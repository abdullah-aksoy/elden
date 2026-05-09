export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  location?: {
    city?: string;
    district?: string;
    coordinates?: [number, number];
  };
  rating: {
    average: number;
    count: number;
  };
  createdAt: string;
}

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerAvatar?: string;
  sellerRating: {
    average: number;
    count: number;
  };
  isPromoted?: boolean;
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  images: string[];
  location?: {
    city?: string;
    district?: string;
    coordinates?: [number, number];
  };
  status: string;
  views: number;
  favoriteCount: number;
  isFavorited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  listingId: string;
  senderId: string;
  receiverId: string;
  text: string;
  image?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  listingId: string;
  listingTitle: string;
  listingImage?: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface Rating {
  id: string;
  userId: string;
  reviewerId: string;
  reviewerName: string;
  rating: number;
  comment?: string;
  listingId?: string;
  createdAt: string;
  replyText?: string;
  replyAt?: string;
  replyAuthorId?: string;
}

export interface MessagePartner {
  userId: string;
  name: string;
  avatar?: string;
  lastMessageAt: string;
}

export type MyPurchaseStatus =
  | 'none'
  | 'pending'
  | 'pending_buyer_confirmation'
  | 'confirmed'
  | 'declined';

export interface MyPurchaseState {
  status: MyPurchaseStatus;
  requestId?: string;
  canRate: boolean;
}

export interface PendingPurchaseRequest {
  id: string;
  listingId: string;
  listingTitle: string;
  buyerId: string;
  buyerName: string;
  status: string;
  createdAt: string;
}

/** Satıcı sizi alıcı olarak seçtiğinde profil bildirimlerinde gösterilir. */
export interface BuyerSaleNotification {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage?: string;
  sellerId: string;
  sellerName: string;
  createdAt: string;
}

export interface BuyerPurchaseHistoryItem {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage?: string;
  sellerId: string;
  sellerName: string;
  confirmedAt: string;
}
