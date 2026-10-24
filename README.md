# Kalori ve Besin Takip Sistemi (SQL Veritabanlı)

Bilimsel kılavuzlara (WHO, EFSA, NIH-NASEM, USDA FoodData Central ve TÜBER) dayanan, günlük enerji ve besin ögelerini takip eden, SQL fonksiyonları ve görünümleriyle hesaplama yapan, haftalık beslenme analizi sunan tam yığın (full-stack) web uygulaması.

---

## 📌 İçindekiler

1. [Projenin Amacı ve Bilimsel İlkeler](#1-projenin-amacı-ve-bilimsel-ilkeler)
2. [Teknoloji Yığını ve Mimari](#2-teknoloji-yığını-ve-mimari)
3. [Dizin ve Dosya Yapısı](#3-dizin-ve-dosya-yapısı)
4. [Kurulum ve Çalıştırma Adımları](#4-kurulum-ve-çalıştırma-adımları)
5. [Veritabanı Şeması ve SQL Mantığı](#5-veritabanı-şeması-ve-sql-mantığı)
6. [REST API Uç Noktaları](#6-rest-api-uç-noktaları)
7. [Güvenlik Önlemleri](#7-güvenlik-önlemleri)
8. [Testler](#8-testler)
9. [Veritabanı Yedekleme ve Geri Yükleme](#9-veritabanı-yedekleme-ve-geri-yükleme)

---

## 1. Projenin Amacı ve Bilimsel İlkeler

Uygulamanın amacı yalnızca kalori saymak değildir. Kullanıcının protein, karbonhidrat, yağ, doymuş yağ, toplam şeker, ilave/serbest şeker, lif ile sebze, meyve ve baklagil tüketimini takip etmek ve beslenme örüntüsünü bilimsel temellere göre değerlendirmektir.

### 🔬 Uygulanan Bilimsel İlkeler:
1. **Sahte Kesinlik Yok:** Gerekli profil bilgileri (yaş, boy, kilo, biyolojik cinsiyet) eksikse sahte veya uydurma hedefler üretilmez, değerler `NULL` kalır ve durum kullanıcıya bildirilir.
2. **Tek Hedef Yok (Aralık İlkesi):** Makro besinlerde tek bir rakam dayatılmaz; kılavuzlar arasındaki bilimsel mutabakat ve farklar (örneğin protein için EFSA PRI: 0,83 g/kg ile DGA 2025-2030: 1,2–1,6 g/kg) aralık olarak modellenir.
3. **Mifflin–St Jeor & FAO/WHO/UNU PAL:** Bazal Metabolizma Hızı (BMR), Mifflin-St Jeor (1990) formülüyle hesaplanır. TDEE, FAO/WHO/UNU (2004) Fiziksel Aktivite Düzeyi (PAL) katsayılarıyla (1.55, 1.85, 2.2) tahmin edilir.
4. **Şeker Ayrımı:** Toplam şeker ile ilave/serbest şeker birbirinden kesinlikle ayrılır. Meyvedeki fruktoz ve sütteki laktoz doğal şekerdir; WHO'nun enerjiye oranı <%10 (tercihen <%5) olan sınırı yalnızca serbest/ilave şekerler içindir.
5. **Kayıt Olmayan Günün Değerlendirilmesi:** Veri girilmeyen günler kesinlikle "0 kalori tüketildi" sayılmaz; eksik gün olarak işaretlenip haftalık ortalamaya dahil edilmez.
6. **Yetişkin Hedeflerinin Sınırı:** Formüller 19 yaş ve üzeri sağlıklı yetişkinler için geçerlidir. Çocuk, ergen ve özel gereksinimi olanlara yetişkin hedefleri otomatik uygulanmaz.
7. **Tıbbi Teşhis İddiası Yok:** Sistem hastalık teşhisi koymaz, alarmist veya korkutucu bir dil kullanmaz; yapıcı beslenme rehberliği sağlar.

---

## 2. Teknoloji Yığını ve Mimari

- **Backend:** Node.js (>=20) & Express.js (REST API mimarisi).
- **Veritabanı:** PostgreSQL (>=14) & `pg` (node-postgres) bağlantı havuzu.
- **Frontend:** Vanilla HTML5, Vanilla CSS3 (modern responsive tasarım sistemi, CSS custom properties) & Vanilla JavaScript (ES2022, modüler ve güvenli).
- **Güvenlik:** Helmet (sıkı CSP `script-src 'self'`), HttpOnly / SameSite Lax çerez oturumu, bcrypt (salt rounds = 12), parametreli SQL sorguları, rate limiting.
- **Testler:** Node.js yerleşik test çalıştırıcısı (`node:test` ve `node:assert/strict`).

---

## 3. Dizin ve Dosya Yapısı

```text
nutrition-tracker/
├── database/
│   ├── schema.sql           # Tablolar, CHECK kısıtları, fonksiyonlar, indeksler
│   ├── queries.sql          # Görünümler (v_daily_totals vb.) ve SQL sorgu seti
│   └── seed.sql             # USDA FoodData Central SR Legacy 18 doğrulanmış besin
├── backend/
│   ├── server.js            # Express uygulaması, Helmet CSP, statik sunucu
│   ├── config.js            # Ortam değişkenleri ve yapılandırma doğrulaması
│   ├── db/
│   │   └── index.js         # pg Pool, withTransaction, tip dönüşümleri
│   ├── lib/
│   │   ├── validate.js      # Girdi ve miktar doğrulama motoru
│   │   ├── errors.js        # Özel hata sınıfları (Validation, Auth, NotFound vb.)
│   │   ├── cookies.js       # Güvenli çerez okuma/yazma
│   │   └── asyncHandler.js  # Asenkron rota sarmalayıcısı
│   ├── middleware/
│   │   ├── auth.js          # attachUser ve requireAuth
│   │   └── errorHandler.js  # Merkezi hata yöneticisi (SQLSTATE -> HTTP)
│   ├── routes/
│   │   ├── index.js         # Ana rota yönlendirici
│   │   ├── auth.js          # Oturum, giriş, kayıt rotaları
│   │   ├── foods.js         # Besin arama ve detay rotaları
│   │   ├── meals.js         # Öğün ve öğün maddesi rotaları
│   │   ├── profile.js       # Profil ve hedef rotaları
│   │   └── reports.js       # Günlük ve haftalık rapor rotaları
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── foodController.js
│   │   ├── mealController.js
│   │   ├── profileController.js
│   │   └── reportController.js
│   └── services/
│       ├── references.js       # Bilimsel kılavuz metaverileri ve kaynak linkleri
│       ├── nutritionTargets.js # BMR, TDEE, AMDR ve hedef hesaplama motoru
│       ├── weeklyAnalysis.js   # 8 kuralı uygulayan haftalık analiz motoru
│       ├── targetService.js    # Hedef veritabanı önbellekleme
│       ├── mealService.js      # Öğün ve besin maddesi işlemleri
│       ├── foodService.js      # Besin arama ve kategori servisi
│       ├── reportService.js    # Günlük / haftalık rapor servisi
│       └── authService.js      # Oturum ve kimlik doğrulama servisi
├── frontend/
│   ├── index.html           # Semantik, erişilebilir 8 bölümlü arayüz
│   ├── style.css            # Responsive, CSS değişkenli tasarım sistemi
│   └── app.js               # İstemci tarafı uygulama mantığı ve API köprüsü
├── tests/
│   ├── unit/
│   │   ├── nutritionTargets.test.js  # BMR/TDEE/hedef matematiği testleri
│   │   ├── weeklyAnalysis.test.js    # 8 analitik kuralın birim testleri
│   │   └── validate.test.js          # Miktar ve tarih girdi doğrulaması
│   └── integration/
│       └── api.test.js               # 12 adımlı uçtan uca senaryo testleri
├── .env.example             # Örnek çevre değişkenleri şablonu
├── .gitignore
├── package.json
└── README.md
```

---

## 4. Kurulum ve Çalıştırma Adımları

### 1. Ön Gereksinimler
- **Node.js:** v20.0.0 veya üzeri (`node -v`)
- **PostgreSQL:** v14.0 veya üzeri (`psql -V`)

### 2. Proje Paketlerini Yükleme
```bash
npm install
```

### 3. Çevre Değişkenlerini Hazırlama
`.env.example` dosyasını `.env` olarak kopyalayın:
```bash
cp .env.example .env
```
`.env` dosyasını metin düzenleyicinizle açın ve PostgreSQL bağlantı bilgilerinizi ayarlayın:
```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=en_az_32_karakterlik_cok_guclu_bir_rastgele_anahtar_buraya_yazilmalidir

PGHOST=localhost
PGPORT=5432
PGDATABASE=nutrition_tracker
PGUSER=postgres
PGPASSWORD=parolaniz
```

### 4. PostgreSQL Veritabanı ve Şemanın Kurulması
Veritabanını oluşturup tüm tabloları, fonksiyonları, görünümleri ve başlangıç besinlerini tek komutla kurabilirsiniz:
```bash
npm run db:setup
```
*(Alternatif olarak psql ile elle çalıştırmak isterseniz)*:
```bash
psql -U postgres -c "CREATE DATABASE nutrition_tracker ENCODING 'UTF8';"
psql -U postgres -d nutrition_tracker -f database/schema.sql
psql -U postgres -d nutrition_tracker -f database/queries.sql
psql -U postgres -d nutrition_tracker -f database/seed.sql
```

### 5. Uygulamayı Başlatma
Geliştirme modunda (canlı yeniden yükleme):
```bash
npm run dev
```
Normal başlatma:
```bash
npm start
```
Tarayıcınızdan **`http://localhost:3000`** adresini açın.

---

## 5. Veritabanı Şeması ve SQL Mantığı

### Tablolar:
1. **`users`**: Kullanıcı hesapları, parola hash'i, yaş, cinsiyet, boy, kilo, aktivite düzeyi ve beslenme hedefi.
2. **`food_categories`**: Besin kategorileri (sebzeler, meyveler, baklagiller vb.).
3. **`foods`**: USDA SR Legacy'den alınan 100g bazlı besin değerleri, kaynak bağlantıları, porsiyon bilgisi.
4. **`meals`**: Kullanıcıya ve tarihe bağlı öğün başlıkları (kahvaltı, öğle, akşam, ara öğün).
5. **`meal_items`**: Tüketilen miktarlar ve o anki değerlerin snapshot kaydı.
6. **`daily_targets`**: Kullanıcının profilinden türetilen ve önbelleğe alınan günlük hedefler.
7. **`weekly_reports`**: Pazartesi-Pazar arası hesaplanan ve bayatlama kontrolü olan haftalık analiz raporları.
8. **`sessions`**: HttpOnly çerez ile eşleşen güvenli kullanıcı oturumları.

### Tek-Hesap-Yeri Kuralı (Single Point of Truth):
- **`fn_scale_per_100g(val, grams)`**: `(grams / 100.0) * val` formülü yalnızca SQL içinde tanımlıdır. JavaScript tarafında ikinci bir formül yazılmaz.
- **`fn_week_start(date)`**: Haftanın Pazartesi gününe normalize edilmesini sağlar.
- **`fn_serving_count(grams)`**: 80g yenilebilir kısmı 1 porsiyon olarak standartlaştırır.
- **`v_daily_totals` & `v_weekly_averages`**: Günlük ve haftalık tüm sayısal toplamlar doğrudan SQL görünümlerinde hesaplanır.

---

## 6. REST API Uç Noktaları

| Yöntem | Uç Nokta | Açıklama | Yetki |
|---|---|---|---|
| `POST` | `/api/auth/register` | Yeni kullanıcı kaydı | Açık |
| `POST` | `/api/auth/login` | Oturum açma | Açık |
| `POST` | `/api/auth/logout` | Oturum kapatma | Açık |
| `GET` | `/api/auth/me` | Aktif kullanıcı bilgisi | Kullanıcı |
| `POST` | `/api/auth/change-password` | Parola güncelleme | Kullanıcı |
| `GET` | `/api/foods` | Besin arama ve listeleme | Açık |
| `GET` | `/api/foods/:id` | Besin detayı | Açık |
| `GET` | `/api/foods/categories` | Kategori listesi | Açık |
| `POST` | `/api/foods` | Yeni besin ekleme | Yönetici |
| `GET` | `/api/meals?date=YYYY-MM-DD` | Günün öğünleri ve toplamları | Kullanıcı |
| `POST` | `/api/meals` | Öğün başlığı oluşturma | Kullanıcı |
| `POST` | `/api/meals/:id/items` | Öğüne besin ekleme | Kullanıcı |
| `PUT` | `/api/meal-items/:id` | Tüketilen miktarı güncelleme | Kullanıcı |
| `DELETE` | `/api/meal-items/:id` | Besin kaydını silme | Kullanıcı |
| `GET` | `/api/reports/daily?date=YYYY-MM-DD` | Günlük besin ve hedef raporu | Kullanıcı |
| `GET` | `/api/reports/weekly?start=YYYY-MM-DD` | Haftalık değerlendirme raporu | Kullanıcı |
| `GET` | `/api/profile` | Profil ve hesaplanan hedefler | Kullanıcı |
| `PUT` | `/api/profile` | Profil tam güncellemesi | Kullanıcı |
| `GET` | `/api/health` | Veritabanı ve servis sağlık kontrolü | Açık |

---

## 7. Güvenlik Önlemleri

1. **İçerik Güvenliği Politikası (CSP):** Helmet ile katı `default-src 'self'` ve `script-src 'self'` kuralları uygulanır. Inline JavaScript ve harici CDN scriptleri engellenir.
2. **SQL Injection Koruması:** İstisnasız tüm SQL sorguları parametreli (`$1, $2...`) olarak çalıştırılır. Kullanıcı girdisi hiçbir koşulda SQL metnine birleştirilmez.
3. **Kaba Kuvvet (Brute-Force) Önlemi:** Giriş ve kayıt uç noktalarına IP bazlı hız sınırlaması (`express-rate-limit`) uygulanır.
4. **Çoklu Kullanıcı İzolasyonu:** Her öğün ekleme, güncelleme ve silme işleminde `user_id` sahipliği SQL seviyesinde (`WHERE meals.user_id = $2`) teyit edilir.
5. **Girdi Doğrulaması:** 0'dan küçük veya 10.000 gramın üzerindeki gerçek dışı besin miktarları API katmanında reddedilir.

---

## 8. Testler

Proje kapsamlı birim ve entegrasyon testlerine sahiptir:
- **`tests/unit/`**:
  - `nutritionTargets.test.js`: Mifflin-St Jeor BMR matematiği, PAL katsayıları, TDEE, yaş sınırları, AMDR makro aralıkları.
  - `weeklyAnalysis.test.js`: Prompt §7'de yer alan 8 kuralın (veri olmayan günün sıfır sayılmaması, dil hassasiyeti vb.) doğrulanması.
  - `validate.test.js`: Miktar (negatif, aşırı değer) ve tarih doğrulama testleri.
- **`tests/integration/`**:
  - `api.test.js`: Prompt §13'teki 12 senaryonun uçtan uca doğrulanması (PostgreSQL bağlantısı yoksa otomatik atlar).

### Test Komutları:
```bash
# Tüm testleri çalıştırma
npm test

# Yalnızca birim testleri çalıştırma
npm run test:unit

# Yalnızca entegrasyon testlerini çalıştırma
npm run test:integration
```

---

## 9. Veritabanı Yedekleme ve Geri Yükleme

### Yedek Alma (Backup):
Veritabanını sıkıştırılmış veya düz SQL dosyası olarak yedeklemek için:
```bash
# Düz metin SQL yedeği
pg_dump -U postgres -d nutrition_tracker -F p -f nutrition_tracker_backup.sql

# Özel ikili (custom binary) formatta sıkıştırılmış yedek
pg_dump -U postgres -d nutrition_tracker -F c -f nutrition_tracker_backup.dump
```

### Yedekten Geri Yükleme (Restore):
Alınan yedeği yeni veya mevcut bir veritabanına geri yüklemek için:
```bash
# SQL dosyasından geri yükleme
psql -U postgres -d nutrition_tracker -f nutrition_tracker_backup.sql

# Özel dump formatından geri yükleme
pg_restore -U postgres -d nutrition_tracker -v nutrition_tracker_backup.dump
```
