import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { getBackendBaseUrl } from '../lib/backendUrl';

type WsEvent =
  | { type: 'hello' }
  | { type: 'message_new'; message: any }
  | { type: 'message_read'; listingId: string; readerId: string; otherUserId: string }
  | { type: 'refresh_conversations' }
  | { type: 'refresh_unread' }
  | { type: 'refresh_buyer_sales' }
  | { type: 'seller_offer_new'; listingId: string; requestId: string }
  | { type: 'question_new'; listingId: string; questionId: string }
  | { type: 'question_update'; listingId: string; questionId: string }
  | { type: string; [k: string]: any };

type Listener = (evt: WsEvent) => void;

function getWsUrl(): string {
  const base = getBackendBaseUrl();

  const proto = base.startsWith('https://') ? 'wss://' : base.startsWith('http://') ? 'ws://' : null;
  if (!proto) {
    // If someone passes a bare host, assume https.
    return `wss://${base.replace(/^\/+/, '')}/ws`;
  }
  const host = base.replace(/^https?:\/\//, '');
  return `${proto}${host}/ws`;
}

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectAttempt = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private lastAppState: AppStateStatus = AppState.currentState;
  private appStateSub: any = null;

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(evt: WsEvent) {
    for (const cb of this.listeners) cb(evt);
  }

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const url = `${getWsUrl()}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.emit({ type: 'hello' });
      this.startHeartbeat();
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg && typeof msg.type === 'string') this.emit(msg);
      } catch {
        // ignore
      }
    };
    ws.onerror = () => {
      // allow close handler to trigger reconnect
    };
    ws.onclose = () => {
      this.ws = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', (st: AppStateStatus) => {
        const prev = this.lastAppState;
        this.lastAppState = st;
        if (prev !== 'active' && st === 'active') {
          // Come back fast: cancel backoff and reconnect immediately.
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.reconnectAttempt = 0;
          void this.connect();
        }
      });
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    try {
      ws?.close();
    } catch {
      // ignore
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // Keep socket warm across mobile networks / proxies.
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send('ping');
      } catch {
        // ignore
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const attempt = Math.min(this.reconnectAttempt++, 6);
    const delayMs = Math.min(30000, 500 * Math.pow(2, attempt));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }
}

export const wsClient = new WsClient();

