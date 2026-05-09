# İkinci El Alım-Satım Uygulaması — Lokal Kurulum Rehberi

Bu dosya **yalnızca geliştirme makinesinde kurulum ve sorun giderme** içindir: yazılım sürümleri, sanal ortam, `.env`, MongoDB, backend ve frontend’i nasıl başlatacağınız, sık hatalar.

| Ne arıyorsunuz? | Nereye bakın? |
|-----------------|----------------|
| Proje nedir, hangi özellikler var, mobil mi web mi, API özeti, güvenlik | **[README.md](README.md)** (ana giriş) |
| İlk kurulum, `mongosh`, port, Expo + cihaz IP, hata mesajları | **Bu dosya** (`README_LOCAL_SETUP.md`) |

---

## 📋 Gereksinimler

Projeyi çalıştırmak için aşağıdaki yazılımların bilgisayarınızda kurulu olması gerekiyor:

### 1. Node.js ve npm/yarn
- **Node.js 18+** (https://nodejs.org/)
- npm veya yarn package manager

```bash
# Kontrol edin
node --version  # v18.0.0 veya üzeri
npm --version   # veya yarn --version
```

### 2. Python
- **Python 3.12** (https://www.python.org/) — bu proje 3.12 ile test edilir; Windows’ta `py -3.12` kullanabilirsiniz.
- pip package manager

```bash
# Kontrol edin
py -3.12 --version   # Windows (önerilen)
python --version     # veya python3 --version
pip --version        # veya pip3 --version
```

### 3. MongoDB
- **MongoDB 6.0+** (https://www.mongodb.com/try/download/community)
- MongoDB servisi çalışır durumda olmalı

```bash
# Kontrol edin
mongosh --version
# veya
mongo --version
```

### 4. Git
- Git version control (https://git-scm.com/)

```bash
git --version
```

---

## 🚀 Kurulum Adımları

### 1️⃣ Projeyi Klonlayın

```bash
git clone <your-github-repo-url>
cd <project-folder>
```

### 2️⃣ Backend Kurulumu

```bash
cd backend

# Python sanal ortam oluştur (3.12 önerilir)
py -3.12 -m venv venv
# veya: python3.12 -m venv venv

# Sanal ortamı aktifleştir
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Bağımlılıkları yükle
pip install -r requirements.txt
```

#### Backend .env Dosyası

En hızlı yol: `backend` klasöründe `backend/.env.example` dosyasını `.env` olarak kopyalayıp değerleri doldurun (Windows: dosyayı kopyalayıp adını `.env` yapın).

Minimum örnek:

```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="ikinciel_db"
SECRET_KEY="your-secret-key-change-this-in-production"
```

**Not:** `SECRET_KEY` güvenlik için değiştirin. **PayTR**, **Cloudflare R2**, **SMTP**, **CORS**, **Android App Links** için açıklamalar `backend/.env.example` içindedir. PayTR için `PAYTR_*` ve geçerli `APP_PUBLIC_URL` veya tam `PAYTR_OK_URL` / `PAYTR_FAIL_URL` gerekir.

#### MongoDB — lokal veritabanı entegrasyonu

Backend yalnızca **MongoDB** kullanır; ayrı SQL migrasyon script’i yok. İlk API isteğinde veya sunucu açılışında gerekli **index’ler kod tarafından** oluşturulur (`startup`).

1. **MongoDB’yi kurun ve çalıştırın**  
   - Windows: Kurulumdan sonra servis genelde otomatik başlar; değilse: `net start MongoDB`  
   - macOS (Homebrew örneği): `brew services start mongodb-community`  
   - Bağlantıyı doğrulayın: `mongosh` veya `mongosh "mongodb://127.0.0.1:27017"` — hata yoksa sunucu ayaktadır.

2. **`backend/.env` içinde tutarlılık**  
   - `MONGO_URL`: Yerelde tipik olarak `mongodb://127.0.0.1:27017` veya `mongodb://localhost:27017` (aynı makine).  
   - `DB_NAME`: Kullanacağınız veritabanı adı; **`.env` ile `mongosh` içinde `use <ad>` aynı olmalı.** Bu repodaki örnekler `ikinciel_db` üzerinden gider (`backend/.env.example` ile uyumlu). İsterseniz `elden` gibi başka bir ad seçebilirsiniz; yeter ki tek yerde sabitleyin.  
   - **MongoDB Atlas** kullanıyorsanız: `MONGO_URL=mongodb+srv://kullanici:sifre@cluster.../`, şifrede özel karakter varsa URL-encode edin; IP whitelist’e geliştirme IP’nizi ekleyin.

3. **Sık sorunlar**  
   - `Connection refused` / Motor hataları → MongoDB process çalışmıyor veya yanlış host/port.  
   - Veri “boş” görünüyor → Yanlış `DB_NAME` (başka veritabanına bakıyorsunuz); `mongosh` ile `show dbs` ve `use <DB_NAME>` kontrol edin.  
   - Atlas’ta `ServerSelectionTimeoutError` → Ağ / VPN / firewall veya Atlas **Network Access** (IP allowlist).

4. **Temiz slate** (tüm lokal veriyi silmek): `mongosh` → `use ikinciel_db` → `db.dropDatabase()` — aşağıdaki “Database Temizleme” ile aynı.

### 3️⃣ Frontend Kurulumu

```bash
cd frontend

# Bağımlılıkları yükle
npm install
# veya
yarn install
```

#### Frontend .env Dosyası

`frontend/.env` dosyasını oluşturun:

```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
```

**Not:** Gerçek cihazda test için `localhost` yerine bilgisayarınızın LAN IP’sini kullanın (`http://192.168.x.x:8001`). Şablon: `frontend/.env.example`.

---

## ▶️ Uygulamayı Çalıştırma

### 1️⃣ MongoDB'yi Başlatın

```bash
# Windows (servis olarak):
net start MongoDB

# macOS/Linux:
sudo systemctl start mongod
# veya
mongod --dbpath /path/to/your/data/directory
```

### 2️⃣ Backend'i Başlatın

Yeni bir terminal açın:

```bash
cd backend

# Sanal ortamı aktifleştir (eğer aktif değilse)
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Uygulamayı başlat (venv aktifken — Windows'ta "uvicorn bulunamadı" hatasını önler)
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

**Not:** Sanal ortam aktif değilse önce `venv\Scripts\activate` (Windows) çalıştırın. Aktifleştirmeden tek satırda: `venv\Scripts\python.exe -m uvicorn server:app --reload --host 0.0.0.0 --port 8001`

**Windows:** `python` bazen venv yerine başka bir sürümü (ör. 3.14) çağırır; prompt’ta `(venv)` görünmüyorsa veya `ModuleNotFoundError: motor` alıyorsanız mutlaka yukarıdaki `venv\Scripts\python.exe -m uvicorn ...` komutunu kullanın veya `activate` sonrası `where python` ile yolun `...\backend\venv\Scripts\python.exe` olduğunu doğrulayın.

✅ Backend çalışıyorsa: `http://localhost:8001/docs` (FastAPI Swagger)

### 3️⃣ Frontend'i Başlatın

Yeni bir terminal açın:

```bash
cd frontend

# Expo development server'ı başlat
npm start
# veya
yarn start
# veya
npx expo start
```

✅ Metro bundler çalışıyor!

---

## 📱 Uygulamayı Test Etme

### Web'de Test (Hızlı önizleme)
- Expo'da `w` tuşuna basın
- Tarayıcıda açılacak: http://localhost:3000

**⚠️ Dikkat:** GPS konum, kamera gibi özellikler web'de çalışmaz!

### Mobil Cihazda Test (Tam özellikler)

1. **Expo Go Uygulamasını İndirin**
   - iOS: App Store'dan "Expo Go"
   - Android: Google Play'den "Expo Go"

2. **QR Kodu Tarayın**
   - Terminalda görünen QR kodu tarayın
   - iOS: Kamera uygulamasıyla
   - Android: Expo Go uygulamasıyla

3. **Aynı WiFi Ağında Olun**
   - Bilgisayar ve telefon aynı ağda olmalı

**⚠️ IP Adresi Sorunu Çözümü:**

Mobil cihazda backend'e erişemiyorsanız:

```bash
# 1. Bilgisayarınızın IP adresini öğrenin
# Windows:
ipconfig
# macOS/Linux:
ifconfig

# 2. frontend/.env dosyasını güncelleyin:
EXPO_PUBLIC_BACKEND_URL=http://192.168.1.XX:8001
# (XX yerine kendi IP'nizi yazın)

# 3. Frontend'i yeniden başlatın
```

---

## 🗂️ Proje Yapısı

```
.
├── backend/
│   ├── server.py          # FastAPI backend
│   ├── requirements.txt   # Python bağımlılıkları
│   └── .env              # Backend ortam değişkenleri
│
├── frontend/
│   ├── app/              # Expo Router sayfaları
│   │   ├── (tabs)/       # Tab navigation
│   │   ├── auth/         # Login/Register
│   │   ├── listing/      # İlan detay
│   │   ├── chat/         # Mesajlaşma
│   │   └── user/         # Kullanıcı profili
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── contexts/     # React contexts
│   │   ├── services/     # API servisleri
│   │   └── types/        # TypeScript types
│   ├── package.json      # Node bağımlılıkları
│   └── .env             # Frontend ortam değişkenleri
│
└── README.md
```

---

## 🔧 Sık Karşılaşılan Sorunlar

### `ModuleNotFoundError: No module named 'motor'` (veya başka paket)

Genelde **yanlış Python** kullanılıyordur (venv dışındaki `python`, örn. 3.14). Çözüm: `backend` içinde `venv\Scripts\python.exe -m uvicorn server:app --reload --host 0.0.0.0 --port 8001` veya önce `venv\Scripts\activate`, sonra `python -m uvicorn ...` (satır başında `(venv)` olmalı).

### MongoDB Bağlantı Hatası
```bash
# MongoDB çalışıyor mu kontrol edin
mongosh
# veya
mongo

# Çalışmıyorsa başlatın
mongod --dbpath /path/to/data
```

### Port Zaten Kullanımda
```bash
# Port'u kullanan process'i bulun
# Windows:
netstat -ano | findstr :8001
# macOS/Linux:
lsof -i :8001

# Process'i sonlandırın
# Windows:
taskkill /PID <PID> /F
# macOS/Linux:
kill -9 <PID>
```

### Frontend Backend'e Bağlanamıyor
1. Backend'in çalıştığını kontrol edin: `http://localhost:8001/api/categories` (veya `.env`'deki `EXPO_PUBLIC_BACKEND_URL` + `/api/categories`)
2. `.env` dosyasındaki URL'i kontrol edin
3. Mobil cihazda test ediyorsanız IP adresini kullanın

### Expo Go'da "Network Error"
- Aynı WiFi ağında olduğunuzdan emin olun
- Firewall backend portunu (8001) engelliyor olabilir
- `frontend/.env`'de IP adresi doğru mu kontrol edin

---

## 🧪 Test

Uygulamayı denemek için uygulama içinden **kayıt** oluşturun. Repoda paylaşılan sabit test hesabı yoktur; gizli bilgi sızıntısını önlemek için böyle tutulur.

---

## 📦 Production Build (Opsiyonel)

### Android APK Oluşturma
```bash
cd frontend
npx expo prebuild
npx expo run:android
```

### iOS Build (macOS gerektirir)
```bash
cd frontend
npx expo prebuild
npx expo run:ios
```

---

## 🛠️ Geliştirme İpuçları

### Backend Değişikliklerini İzleme
Backend'de `--reload` parametresi ile çalıştırıldığı için kod değişikliklerini otomatik algılar.

### Frontend Hot Reload
Expo otomatik hot reload yapar, kaydettiğiniz değişiklikler anında görünür.

### Debug
```bash
# Backend logları
# Terminal'de otomatik görünür

# Frontend logları
# Expo devtools veya tarayıcı console'da görünür
```

### Database Temizleme
```bash
# MongoDB'yi temizlemek isterseniz
mongosh
> use ikinciel_db
> db.dropDatabase()
```

---

## 📝 Notlar

1. **GPS Konum:** Sadece gerçek mobil cihazda veya Expo Go'da çalışır
2. **Kamera:** Web'de çalışmaz, mobil cihaz gerektirir
3. **Push Notifications:** Prodüksiyon build'de aktif olur
4. **Base64 Resimler:** Performans için resim sayısı 10 ile sınırlı

---

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing`)
5. Pull Request açın

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) altında lisanslanmıştır.

---

## 💬 Destek

Sorularınız için:
- GitHub Issues açın
- Genel bakış ve mimari: [README.md](README.md) — kurulum adımları: bu dosya

---

## 🎉 Başarılar!

Uygulamanız artık lokal olarak çalışıyor! 🚀

Kayıt oluşturup giriş yaparak özellikleri deneyebilirsiniz.
