# 📱 İkinci El Alım-Satım — Mobil Uygulama

## Demo



https://github.com/user-attachments/assets/93e7a580-af42-4601-9b34-61d96ed24fe1



https://github.com/user-attachments/assets/52ffc8a0-0e3b-446e-8e58-1d4e224fe59f



---

Letgo tarzı ikinci el alım-satım deneyimi **yalnızca mobil** (iOS / Android) için tasarlanmıştır: **React Native (Expo)** istemci, **FastAPI** REST/WebSocket API ve **MongoDB**. Bu repoda **ayrı bir kullanıcı web sitesi veya yönetici web paneli yok**; ürün arayüzü mobil uygulamadır.

## Belgeler (iki README arasındaki fark)

| Dosya | Ne zaman okunur? | İçerik |
|--------|-------------------|--------|
| **Bu dosya — [README.md](README.md)** | Repoya ilk baktığınızda, mimari ve özellik özeti istediğinizde | Ürün tanımı (mobil odak), özellik listesi, **kısa** kurulum komutları, ortam değişkenleri tablosu, teknoloji özeti, API grupları, güvenlik / PayTR notu, yol haritası |
| **[README_LOCAL_SETUP.md](README_LOCAL_SETUP.md)** | Bilgisayarda ilk kez kurulum, sürüm kontrolü, MongoDB / `.env` / hata ayıklama | Gereksinimler (Node, Python, MongoDB, Git), **adım adım** backend + frontend kurulumu, MongoDB lokal entegrasyonu, uygulamayı çalıştırma, sık sorunlar, veritabanı temizleme |

Özet: **README.md** = “bu proje ne”; **README_LOCAL_SETUP.md** = “makinede nasıl çalıştırırım”. Lokal kurulumda takılırsanız [README_LOCAL_SETUP.md](README_LOCAL_SETUP.md) dosyasına gidin.

## ✨ Özellikler (kod tabanına göre)

### 🔐 Kullanıcı
- E-posta / şifre ile kayıt ve giriş
- Şifre sıfırlama (e-posta; SMTP yapılandırması gerekir)
- Profil düzenleme (`edit-profile`), başka kullanıcı profili (`user/[id]`)
- Değerlendirme ve satıcı yanıtı (`/api/ratings`, `/api/ratings/{id}/reply`)

### 📦 İlanlar
- Oluşturma, düzenleme (`edit-listing/[id]`), silme; çoklu görsel (R2 presigned upload); video presign uç noktası
- Harita pinleri (`/api/listings/map`), yakın ilanlar (`/api/listings/nearby`), metin araması ve filtreler
- Favoriler, görüntülenme, ilan paylaşımı
- **Öne çıkarma (PayTR):** paket seçimi, iframe ödeme, webhook (`/api/payments/paytr/notify`); test modunda `promo/confirm` yedek akışı

### 💬 Mesajlaşma ve alışveriş akışı
- Konuşmalar, okundu, silme; WebSocket (`/ws`) ile canlı güncelleme
- Satın alma talebi, satıcı onayı, alıcı “satıldı” onayı / reddi; bekleyen talepler ve geçmiş uç noktaları

### ❓ Soru–cevap ve hikâyeler
- İlana soru ve satıcı cevabı (`/api/questions` …)
- Süreli hikâyeler (`/api/stories`, `app/stories/[id]`)

### 🚨 Raporlama
- İlan raporu (`/api/reports`)

## 🚀 Hızlı Başlangıç

Aşağıdaki komutlar özet içindir; sürüm kontrolü, Windows/macOS ayrıntıları, MongoDB ve `.env` satır satır açıklaması için **[README_LOCAL_SETUP.md](README_LOCAL_SETUP.md)** kullanın (özellikle **“MongoDB — lokal veritabanı entegrasyonu”** bölümü).

### Kısa özet

```bash
git clone <repo-url>
cd <project-folder>

cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # Windows: Copy-Item .env.example .env

cd ../frontend
npm install
cp .env.example .env       # Windows: Copy-Item .env.example .env

# MongoDB çalışır durumda olmalı
cd ../backend
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001

cd ../frontend
npm start
```

### Ortam değişkenleri

| Bölüm | Dosya | Özet |
|--------|--------|------|
| Backend | `backend/.env` ← `backend/.env.example` | `MONGO_URL`, `DB_NAME`, `SECRET_KEY`, `APP_PUBLIC_URL`, SMTP, R2, **PayTR** (`PAYTR_*`), isteğe bağlı `CORS_ORIGINS` (çoğunlukla geliştirme / Expo web önizlemesi), Android App Links |
| Frontend | `frontend/.env` ← `frontend/.env.example` | `EXPO_PUBLIC_BACKEND_URL` (varsayılan kod tarafı: `http://localhost:8001`) |
| EAS | `frontend/eas.json` | Store derlemeleri için `EXPO_PUBLIC_BACKEND_URL` |

`.env` dosyaları `.gitignore` ile dışlanır; gerçek anahtarları repoya koymayın.

## 📱 Çalıştırma ve test

- **Asıl hedef:** **Expo Go** veya **development / production build** (gerçek cihaz veya emülatör). Konum, kamera, push vb. tam deneyim burada.
- **Tarayıcı (`w`):** Expo’nun isteğe bağlı **web önizlemesi**; hızlı bakmak içindir, tam özellikli web ürünü değildir (GPS, kamera gibi kısıtlar normaldir).

Hesap: uygulamadan kayıt (repoda sabit test şifresi yok).

## 🛠️ Teknolojiler

### Mobil istemci (özet)
- Expo **54**, Expo Router **6**, React **19**, React Native **0.81**
- TypeScript, Axios, `expo-notifications`, `expo-location`, `expo-image-picker`, `react-native-maps`, `react-native-webview`
- Oturum: **React Context** (`AuthContext`) + AsyncStorage  
- `react-native-web` yalnızca Expo’nun web hedefi için bağımlılıkta; **ürün olarak web sürümü yoktur.**

### Backend (özet)
- FastAPI, Motor, MongoDB, JWT + bcrypt
- WebSocket (`/ws`), Expo push token kayıtları, harici gönderim `exp.host` API
- **PayTR** sunucu tarafı token üretimi ve bildirim doğrulaması (HMAC)
- **Cloudflare R2** (S3 uyumlu) presigned upload
- Bazı uç noktalarda **basit in-memory rate limit** (login, şifre sıfırlama, presign, mesaj)

## 📂 Proje yapısı (özet)

```
.
├── backend/
│   ├── server.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── (tabs)/          # home, search, add-listing, messages, profile
│   │   ├── auth/            # login, register, forgot-password, reset
│   │   ├── listing/[id].tsx
│   │   ├── edit-listing/[id].tsx
│   │   ├── chat/[listingId]/[userId].tsx
│   │   ├── user/[id].tsx
│   │   ├── stories/[id].tsx
│   │   └── edit-profile.tsx
│   ├── src/                 # components, contexts, services, lib
│   ├── package.json
│   ├── .env.example
│   └── eas.json
├── assets/                  # README demo: demo.mp4, demo-2.mp4
├── .github/workflows/
├── README_LOCAL_SETUP.md
└── README.md
```

## 🎨 Arayüz

Tüm ekran akışları **mobil** üzerinden: keşfet / arama, ilan detayı (PayTR için `WebView` ile ödeme sayfası), mesajlar, profil ve ilanlarım.

## 🔒 Güvenlik ve PayTR

- JWT, bcrypt, CORS (`CORS_ORIGINS` ile genişletilebilir), seçili rotalarda rate limit.
- **PayTR:** `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT` yalnızca **ortam değişkeninde**; repodaki kodda sabit mağaza sırrı yok. `PAYTR_PACKAGES` yalnızca paket kimliği, süre ve **TL tutarı** (halka açık iş kuralı). İstemci yalnızca backend’den dönen `iframeToken` ile PayTR’nin standart iframe URL’sini açar; mağaza parolası istemciye gitmez.

## 📝 HTTP API (mobil istemci için)

Backend, **mobil uygulamanın** kullandığı JSON API ve WebSocket sunar. Geliştiriciler için şema ve deneme: backend açıkken **`http://localhost:8001/docs`** (Swagger UI — son kullanıcı web arayüzü değildir).

Özet gruplar (hepsi `/api` ön eki ile):

| Grup | Örnek yollar |
|------|----------------|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password` |
| Kullanıcı / push | `GET /users/{id}`, `PUT /users/profile`, `POST /push/register`, `POST /push/unregister` |
| Yükleme | `POST /uploads/presign`, `POST /uploads/presign-video` |
| İlanlar | `GET|POST /listings`, `GET /listings/nearby`, `GET /listings/map`, `GET /listings/{id}`, `PUT|DELETE /listings/{id}`, `GET /listings/my/listings`, favoriler |
| Ödeme (PayTR) | `POST /payments/paytr/token`, `POST /payments/paytr/notify`, `POST /payments/paytr/promo/confirm` |
| Hikâye / soru | `GET|POST /stories`, `GET /listings/{id}/questions`, `POST /questions`, `POST /questions/{id}/answer` |
| Satın alma | `POST /listings/{id}/purchase-request`, `POST /listings/{id}/initiate-sold-to`, `GET /purchases/...`, `POST /purchases/{request_id}/...` |
| Mesajlar | `POST /messages`, `GET /messages/conversations`, `GET /messages/{listingId}/{userId}`, okundu / silme |
| Diğer | `GET /categories`, `POST /ratings`, `GET /ratings/{userId}`, `POST /reports` |

## 🌟 Yol haritası / eksikler

- [ ] Yönetici / moderasyon **arayüzü** (şu an yok; mobil veya ayrı bir istemci olarak düşünülebilir — **web paneli bu projenin parçası değildir**)
- [ ] Görsel CDN dönüşümü ve agresif optimizasyon
- [ ] Liste ve önbellek stratejisinin ihtiyaca göre netleştirilmesi

## 🤝 Katkı

Fork → branch → commit → PR.

## 📄 Lisans

MIT (depo köküne `LICENSE` dosyası eklemeniz önerilir).

## 💬 İletişim

GitHub Issues.
