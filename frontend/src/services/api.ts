import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBackendBaseUrl } from '../lib/backendUrl';

function getApiBaseUrl(): string {
  return `${getBackendBaseUrl()}/api`;
}

export const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth APIs
export const authAPI = {
  register: (data: { email: string; password: string; name: string; phone?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, newPassword }),
};

// Listing APIs
export const listingAPI = {
  create: (data: any) => api.post('/listings', data),
  getAll: (params?: any) => api.get('/listings', { params }),
  getById: (id: string) => api.get(`/listings/${id}`),
  update: (id: string, data: any) => api.put(`/listings/${id}`, data),
  delete: (id: string) => api.delete(`/listings/${id}`),
  getMyListings: () => api.get('/listings/my/listings'),
  getFavorites: () => api.get('/listings/my/favorites'),
  addFavorite: (id: string) => api.post(`/listings/${id}/favorite`),
  removeFavorite: (id: string) => api.delete(`/listings/${id}/favorite`),
  getMyPurchase: (listingId: string) => api.get(`/listings/${listingId}/my-purchase`),
  createPurchaseRequest: (listingId: string) => api.post(`/listings/${listingId}/purchase-request`),
  getMessagePartners: (listingId: string) => api.get(`/listings/${listingId}/message-partners`),
  initiateSoldTo: (listingId: string, buyerId: string) =>
    api.post(`/listings/${listingId}/initiate-sold-to`, { buyerId }),
};

// Satın alma talepleri (satıcı)
export const purchaseAPI = {
  getSellerPending: () => api.get('/purchases/seller/pending'),
  getBuyerPendingConfirmations: () => api.get('/purchases/buyer/pending-confirmations'),
  getBuyerHistory: () => api.get('/purchases/buyer/history'),
  confirm: (requestId: string) => api.post(`/purchases/${requestId}/confirm`),
  decline: (requestId: string) => api.post(`/purchases/${requestId}/decline`),
  buyerConfirmSold: (requestId: string) => api.post(`/purchases/${requestId}/buyer-confirm-sold`),
  buyerRejectSold: (requestId: string) => api.post(`/purchases/${requestId}/buyer-reject-sold`),
};

// Message APIs
export const messageAPI = {
  send: (data: { listingId: string; receiverId: string; text?: string; image?: string }) =>
    api.post('/messages', data),
  getConversations: () => api.get('/messages/conversations'),
  getUnreadCount: () => api.get<{ total: number }>('/messages/unread-count'),
  getChatMessages: (listingId: string, otherUserId: string) =>
    api.get(`/messages/${listingId}/${otherUserId}`),
  markRead: (listingId: string, otherUserId: string) =>
    api.post('/messages/read', { listingId, otherUserId }),
  deleteMessage: (messageId: string) => api.delete(`/messages/${messageId}`),
  deleteConversation: (listingId: string, otherUserId: string) =>
    api.delete(`/messages/conversations/${listingId}/${otherUserId}`),
};

// Push token APIs
export const pushAPI = {
  register: (expoPushToken: string, platform?: string) =>
    api.post('/push/register', { expoPushToken, platform }),
  unregister: (expoPushToken: string) => api.post('/push/unregister', { expoPushToken }),
};

// User APIs
export const userAPI = {
  getUser: (id: string) => api.get(`/users/${id}`),
  updateProfile: (data: any) => api.put('/users/profile', data),
};

// Rating APIs
export const ratingAPI = {
  create: (data: { userId: string; rating: number; comment?: string; listingId?: string }) =>
    api.post('/ratings', data),
  getRatings: (userId: string) => api.get(`/ratings/${userId}`),
  reply: (ratingId: string, text: string) => api.post(`/ratings/${ratingId}/reply`, { text }),
};

// Report API
export const reportAPI = {
  create: (data: { listingId: string; reason: string; description?: string }) =>
    api.post('/reports', data),
};

// Categories
export const categoryAPI = {
  getAll: () => api.get('/categories'),
};

export const paytrAPI = {
  createToken: (listingId: string, packageId: string) =>
    api.post<{ iframeToken: string; merchantOid: string; amountKurus: number }>('/payments/paytr/token', {
      listingId,
      packageId,
    }),
  /** PayTR test modunda WebView basari URL donunce notify gelmeyebilir; promosyonu aktive eder. */
  confirmPromo: (merchantOid: string) =>
    api.post<{ ok: boolean; alreadyActive?: boolean }>('/payments/paytr/promo/confirm', { merchantOid }),
};

export const storyAPI = {
  getAll: () =>
    api.get<
      {
        id: string;
        listingId: string;
        videoUrl: string;
        thumbUrl?: string | null;
        listingTitle?: string | null;
        expiresAt?: string;
      }[]
    >('/stories'),
  create: (listingId: string, videoUrl: string, thumbUrl?: string) => api.post('/stories', { listingId, videoUrl, thumbUrl }),
  presignVideo: (contentType: string, sizeBytes: number) =>
    api.post<{ uploadUrl: string; publicUrl: string; key: string; contentType: string }>('/uploads/presign-video', {
      contentType,
      sizeBytes,
    }),
};

export const questionAPI = {
  listForListing: (listingId: string) => api.get(`/listings/${listingId}/questions`),
  ask: (listingId: string, text: string) => api.post('/questions', { listingId, text }),
  answer: (questionId: string, text: string) => api.post(`/questions/${questionId}/answer`, { text }),
  delete: (questionId: string) => api.delete(`/questions/${questionId}`),
};

export default api;
