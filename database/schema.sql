-- =============================================================================
-- Kalori ve Besin Takip Sistemi — PostgreSQL Şeması
-- =============================================================================
-- Hedef sürüm: PostgreSQL 14 veya daha yeni (DATE_TRUNC 'week', GENERATED, JSONB)
--
-- KURULUM
-- -------
-- PostgreSQL'de "CREATE DATABASE" bir şema dosyası içinde transaction bloğunda
-- çalıştırılamaz; bu yüzden veritabanını önce komut satırından oluşturun:
--
--   psql -U postgres -c "CREATE DATABASE nutrition_tracker ENCODING 'UTF8';"
--   psql -U postgres -d nutrition_tracker -f database/schema.sql
--   psql -U postgres -d nutrition_tracker -f database/seed.sql
--
-- Bu dosya IDEMPOTENT'tir: tekrar çalıştırıldığında mevcut yapıyı bozmaz.
-- (Not: DROP komutu içermez, veri kaybı riski oluşturmaz.)
-- =============================================================================

BEGIN;

-- Gerekiyorsa tarih/sayı çıktı biçimini sabitle (tr_TR locale'de ondalık ayıracı
-- farklı olabildiği için sorgu sonuçlarının öngörülebilir kalmasını sağlar).
SET LOCAL datestyle = 'ISO, MDY';

-- =============================================================================
-- 1. ENUM BENZERİ KISITLAMALAR (CHECK ile; ALTER ile genişletmesi kolay olsun diye)
-- =============================================================================
-- CHECK kısıtları doğrudan tablo tanımlarında yazıldı (aşağıda).

-- =============================================================================
-- 2. food_categories — besin kategorileri
-- =============================================================================
CREATE TABLE IF NOT EXISTS food_categories (
    id          SERIAL       PRIMARY KEY,
    name        TEXT         NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_categories IS 'Besinlerin sınıflandırıldığı sözlük tablosu (Baklagiller, Sebzeler, Tahıllar ...).';

-- =============================================================================
-- 3. users — kullanıcı profili ve kimlik doğrulama
-- =============================================================================
-- Prompt'taki alanlara ek olarak kimlik doğrulama için email + password_hash ve
-- "isteğe bağlı beslenme kısıtlamaları" için dietary_restrictions eklendi.
--
-- age / height_cm / weight_kg / biological_sex / activity_level NULL olabilir.
-- Bilinçli tasarım kararı: eksik veri olduğunda BMR/TDEE HESAPLANMAZ.
-- Sahte kesinlik üretmek yerine uygulama "bilgi eksik" der (prompt md. 4).
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id                   SERIAL       PRIMARY KEY,
    email                TEXT         NOT NULL,
    password_hash        TEXT         NOT NULL,
    name                 TEXT         NOT NULL,

    age                  SMALLINT,
    biological_sex       TEXT,
    height_cm            NUMERIC(5,1),
    weight_kg            NUMERIC(5,1),
    activity_level       TEXT,
    goal                 TEXT,
    dietary_restrictions TEXT,
    -- Besin kataloğuna yazma yetkisi (POST /api/foods). Varsayılan FALSE:
    -- yeni kullanıcılar paylaşılan kataloğu değiştiremez.
    is_admin             BOOLEAN      NOT NULL DEFAULT FALSE,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT users_age_range CHECK (age IS NULL OR (age BETWEEN 1 AND 120)),
    CONSTRAINT users_height_range CHECK (height_cm IS NULL OR (height_cm BETWEEN 40 AND 250)),
    CONSTRAINT users_weight_range CHECK (weight_kg IS NULL OR (weight_kg BETWEEN 2 AND 400)),
    CONSTRAINT users_sex_values CHECK (
        biological_sex IS NULL
        OR biological_sex IN ('female', 'male', 'unspecified')
    ),
    CONSTRAINT users_activity_values CHECK (
        activity_level IS NULL
        OR activity_level IN ('sedentary', 'moderately_active', 'very_active', 'unknown')
    ),
    CONSTRAINT users_goal_values CHECK (
        goal IS NULL OR goal IN ('maintain', 'gain', 'lose')
    ),
    CONSTRAINT users_email_shape CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

COMMENT ON COLUMN users.biological_sex IS
    'Mifflin-St Jeor denklemi cinsiyete göre farklı sabit kullanır (+5 / -161). unspecified ise BMR hesaplanmaz.';
COMMENT ON COLUMN users.activity_level IS
    'FAO/WHO/UNU (2004) PAL kategorileriyle eşleşir: sedentary=1.40-1.69, moderately_active=1.70-1.99, very_active=2.00-2.40.';

CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at);

-- E-posta büyük/küçük harf duyarsız ve tektir. Uygulama e-postayı kaydederken
-- lower() ile normalize eder; bu indeks hem tekliği hem de aramayı sağlar.
-- (CITEXT eklentisi gerektirmez — eklenti kurulumu superuser yetkisi ister.)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (lower(email));

-- =============================================================================
-- 4. sessions — sunucu taraflı oturum (httpOnly cookie'de yalnızca session_id taşınır)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    user_agent  TEXT,

    CONSTRAINT sessions_expiry_future CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

COMMENT ON TABLE sessions IS
    'Oturumlar veritabanında tutulur; iptal (logout) ve süre dolması anında geçerlidir. JWT kullanılmaz.';

-- =============================================================================
-- 5. foods — besin veritabanı (kanonik olarak 100 g üzerinden)
-- =============================================================================
-- ÖNEMLİ İNvaryant: *_per_100g kolonlarındaki değerler HER ZAMAN 100 gram
-- yenilebilir kısım içindir. source_basis='per_portion' olan kayıtlar eklenirken
-- fn_normalize_to_100g() ile dönüştürülür ve dönüşüm source_portion_grams
-- içinde denetlenebilir şekilde saklanır.
--
-- is_vegetable / is_fruit / is_legume ayrı bayraklardır, çünkü baklagiller hem
-- sebze hem protein grubunda sayılır (DGA 2025-2030; TÜBER 2022). Tek bir
-- "category" alanı bu çoklu üyeliği ifade edemez.
-- =============================================================================
CREATE TABLE IF NOT EXISTS foods (
    id                     SERIAL        PRIMARY KEY,
    name                   TEXT          NOT NULL,
    category_id            INTEGER       NOT NULL REFERENCES food_categories(id) ON DELETE RESTRICT,

    calories_per_100g      NUMERIC(8,2)  NOT NULL DEFAULT 0,
    protein_per_100g       NUMERIC(8,2)  NOT NULL DEFAULT 0,
    carbohydrates_per_100g NUMERIC(8,2)  NOT NULL DEFAULT 0,
    total_sugars_per_100g  NUMERIC(8,2)  NOT NULL DEFAULT 0,
    added_sugars_per_100g  NUMERIC(8,2),          -- NULL = kaynak bildirmiyor (0 ile karıştırılmaz)
    fat_per_100g           NUMERIC(8,2)  NOT NULL DEFAULT 0,
    saturated_fat_per_100g NUMERIC(8,2)  NOT NULL DEFAULT 0,
    fiber_per_100g         NUMERIC(8,2)  NOT NULL DEFAULT 0,

    portion_grams          NUMERIC(8,2),          -- besinin tipik porsiyonu (gram)
    portion_unit           TEXT,                  -- 'adet', 'su bardağı', 'dilim', 'yemek kaşığı', 'gram'
    state                  TEXT          NOT NULL DEFAULT 'unspecified',  -- raw/cooked/dry/...
    is_vegetable           BOOLEAN       NOT NULL DEFAULT FALSE,
    is_fruit               BOOLEAN       NOT NULL DEFAULT FALSE,
    is_legume              BOOLEAN       NOT NULL DEFAULT FALSE,

    source_name            TEXT          NOT NULL,
    source_url             TEXT,
    source_food_id         TEXT,
    source_basis           TEXT          NOT NULL DEFAULT 'per_100g',
    source_portion_grams   NUMERIC(8,2),
    data_quality           TEXT          NOT NULL DEFAULT 'unverified',
    -- Kayıt türetme notu: değerin hangi kaynak kaydından geldiği, çiğ/pişmiş
    -- durumu, ilave şekerin neden 0 ya da NULL sayıldığı gibi açıklamalar.
    -- Besin değerinin izlenebilirliğini korur (prompt md. 5 ve 12).
    source_note            TEXT,

    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT foods_nonneg_values CHECK (
        calories_per_100g      >= 0 AND
        protein_per_100g       >= 0 AND
        carbohydrates_per_100g >= 0 AND
        total_sugars_per_100g  >= 0 AND
        fat_per_100g           >= 0 AND
        saturated_fat_per_100g >= 0 AND
        fiber_per_100g         >= 0 AND
        (added_sugars_per_100g IS NULL OR added_sugars_per_100g >= 0)
    ),
    -- Fiziksel tutarlılık. Kural: carbohydrates_per_100g TOPLAM karbonhidrattır
    -- ve USDA convention'ında lifi de içerir (carbohydrate, by difference).
    -- Bu yüzden lif ayrıca toplanmaz; lif <= toplam karbonhidrat olmalıdır.
    CONSTRAINT foods_macro_mass_ceiling CHECK (
        protein_per_100g + carbohydrates_per_100g + fat_per_100g <= 100.5
    ),
    CONSTRAINT foods_fiber_within_carb CHECK (fiber_per_100g <= carbohydrates_per_100g + 0.01),
    -- Toplam şeker normalde karbonhidratın alt kümesidir. Ancak USDA şekeri
    -- doğrudan analizle (direct assay), karbonhidratı "fark yoluyla" (by
    -- difference) hesaplar; iki yöntem küçük ölçüde çelişebilir. Gerçek örnek:
    -- tam yağlı süt (FDC 171265) şeker 5.05 g, karbonhidrat 4.80 g.
    -- Bu yüzden 1.00 g tolerans bırakılır — kaba veri giriş hataları yine yakalanır.
    CONSTRAINT foods_sugar_within_carb CHECK (total_sugars_per_100g <= carbohydrates_per_100g + 1.00),
    CONSTRAINT foods_satfat_within_fat CHECK (saturated_fat_per_100g <= fat_per_100g + 0.01),
    -- Enerji tutarlılığı (Atwater: 4 kcal/g protein & karb., 9 kcal/g yağ).
    -- Amaç ondalık hatası gibi kaba veri giriş hatalarını yakalamak; besin
    -- bileşimindeki doğal sapmalara (su, kül, organik asitler) tolerans bırakır.
    CONSTRAINT foods_energy_plausible CHECK (
        calories_per_100g BETWEEN
            0.55 * (4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g)
        AND 1.60 * (4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g) + 5
    ),
    CONSTRAINT foods_portion_positive CHECK (portion_grams IS NULL OR portion_grams > 0),
    CONSTRAINT foods_state_values CHECK (
        state IN ('raw', 'cooked', 'boiled', 'dried', 'unspecified')
    ),
    CONSTRAINT foods_source_basis_values CHECK (source_basis IN ('per_100g', 'per_portion')),
    CONSTRAINT foods_source_basis_portion CHECK (
        source_basis <> 'per_portion' OR (source_portion_grams IS NOT NULL AND source_portion_grams > 0)
    ),
    CONSTRAINT foods_data_quality_values CHECK (
        data_quality IN ('usda_fdc', 'national_composition_table', 'label', 'secondary', 'unverified')
    )
);

-- Aynı isimde + aynı durumda iki kayıt olmamalı (ör. "Mercimek (pişmiş)" tek olmalı).
CREATE UNIQUE INDEX IF NOT EXISTS foods_name_state_unique_idx
    ON foods (lower(trim(name)), state);

CREATE INDEX IF NOT EXISTS foods_name_lower_idx   ON foods (lower(name));
CREATE INDEX IF NOT EXISTS foods_category_id_idx  ON foods (category_id);
CREATE INDEX IF NOT EXISTS foods_group_flags_idx  ON foods (is_vegetable, is_fruit, is_legume);

COMMENT ON COLUMN foods.added_sugars_per_100g IS
    'NULL = kaynak ilave şeker bildirmiyor. 0 = bildiriyor ve sıfır. WHO "serbest şeker" ile FDA "ilave şeker" farklı tanımlardır; toplam şekerle karıştırılmamalıdır.';
COMMENT ON COLUMN foods.data_quality IS
    'usda_fdc: USDA FoodData Central; national_composition_table: ulusal kompozisyon tablosu; label: ambalaj etiketi; secondary: ikincil kaynak; unverified: doğrulanmadı.';
COMMENT ON COLUMN foods.source_note IS
    'Değerin nasıl türetildiğini açıklayan serbest metin: kaynak kayıt adı, çiğ/pişmiş durumu, ilave şekerin neden 0 ya da NULL kabul edildiği.';

-- =============================================================================
-- 6. meals — günlük öğün başlıkları
-- =============================================================================
CREATE TABLE IF NOT EXISTS meals (
    id          SERIAL      PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_date   DATE        NOT NULL,
    meal_type   TEXT        NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT meals_type_values CHECK (
        meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')
    ),
    CONSTRAINT meals_date_sane CHECK (meal_date BETWEEN DATE '1900-01-01' AND DATE '2200-12-31'),
    CONSTRAINT meals_notes_length CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

-- Bir kullanıcının bir gününde her öğün türünden en fazla bir kayıt olur.
-- Böylece "bugünkü kahvaltı" sorgusu tektir ve mükerrer başlık oluşmaz.
CREATE UNIQUE INDEX IF NOT EXISTS meals_user_date_type_uidx
    ON meals (user_id, meal_date, meal_type);

CREATE INDEX IF NOT EXISTS meals_user_date_idx ON meals (user_id, meal_date);

-- =============================================================================
-- 7. meal_items — öğüne eklenen besin kayıtları
-- =============================================================================
-- Besin değerleri BURAYA YAZILIR (snapshot). Gerekçe: bir besin günlüğü geçmiş
-- kaydıdır; foods tablosu sonradan düzeltilirse kullanıcının o gün kaydettiği
-- değer değişmemelidir.
--
-- Tutarlılık garantisi: bu değerler uygulama kodunda değil, fn_scale_per_100g()
-- üzerinden TEK bir SQL formülüyle hesaplanır (bkz. queries.sql ve
-- services/mealService.js). Drift denetimi için v_meal_item_drift görünümü var.
-- =============================================================================
CREATE TABLE IF NOT EXISTS meal_items (
    id             SERIAL        PRIMARY KEY,
    meal_id        INTEGER       NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    food_id        INTEGER       NOT NULL REFERENCES foods(id)  ON DELETE RESTRICT,
    quantity_grams NUMERIC(9,2)  NOT NULL,

    calories       NUMERIC(9,2)  NOT NULL,
    protein        NUMERIC(9,2)  NOT NULL,
    carbohydrates  NUMERIC(9,2)  NOT NULL,
    total_sugars   NUMERIC(9,2)  NOT NULL,
    added_sugars   NUMERIC(9,2),          -- NULL korunur: "bilinmiyor" ≠ 0
    fat            NUMERIC(9,2)  NOT NULL,
    saturated_fat  NUMERIC(9,2)  NOT NULL,
    fiber          NUMERIC(9,2)  NOT NULL,

    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Negatif, sıfır veya gerçek dışı miktarlar reddedilir (prompt md. 12).
    CONSTRAINT meal_items_quantity_range CHECK (quantity_grams > 0 AND quantity_grams <= 10000),
    CONSTRAINT meal_items_nonneg CHECK (
        calories      >= 0 AND
        protein       >= 0 AND
        carbohydrates >= 0 AND
        total_sugars  >= 0 AND
        fat           >= 0 AND
        saturated_fat >= 0 AND
        fiber         >= 0 AND
        (added_sugars IS NULL OR added_sugars >= 0)
    ),
    CONSTRAINT meal_items_added_within_total CHECK (
        added_sugars IS NULL OR added_sugars <= total_sugars + 0.01
    ),
    CONSTRAINT meal_items_satfat_within_fat CHECK (saturated_fat <= fat + 0.01)
);

CREATE INDEX IF NOT EXISTS meal_items_meal_id_idx ON meal_items (meal_id);
CREATE INDEX IF NOT EXISTS meal_items_food_id_idx ON meal_items (food_id);

COMMENT ON COLUMN meal_items.quantity_grams IS
    'Tüketilen miktar. Besin değeri = (quantity_grams / 100) * foods.*_per_100g';

-- =============================================================================
-- 8. daily_targets — günlük hedefler (hesaplanan değerlerin önbelleği)
-- =============================================================================
-- Hedefler users profilinden hesaplanır ve buraya yazılır. Tek bir hedef değeri
-- herkese uygulanmaz: protein için kaynaklar arasında gerçek bir anlaşmazlık
-- olduğundan (EFSA 2012 PRI 0.83 g/kg  vs  DGA 2025-2030 1.2-1.6 g/kg) ARALIK
-- saklanır. target_references JSONB alanı her hedefin kaynağını taşır ve
-- arayüzde gösterilir (prompt md. 4: "Hedeflerin hangi bilimsel kaynağa
-- dayandığı gösterilsin").
--
-- calories_target NULL olabilir: kullanıcı profili eksikse (örn. cinsiyet
-- belirtilmemişse) hedef uydurulmaz, NULL kalır ve arayüz "hesaplanamadı" der.
-- =============================================================================
CREATE TABLE IF NOT EXISTS daily_targets (
    id                       SERIAL       PRIMARY KEY,
    user_id                  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_date              DATE         NOT NULL,

    calories_target          NUMERIC(9,2),
    calories_target_min      NUMERIC(9,2),
    calories_target_max      NUMERIC(9,2),
    protein_target_min       NUMERIC(8,2),
    protein_target_max       NUMERIC(8,2),
    carbohydrates_target_min NUMERIC(8,2),
    carbohydrates_target_max NUMERIC(8,2),
    fat_target_min           NUMERIC(8,2),
    fat_target_max           NUMERIC(8,2),
    fiber_target             NUMERIC(8,2),
    added_sugars_limit       NUMERIC(8,2),
    saturated_fat_limit      NUMERIC(8,2),
    vegetable_servings_target NUMERIC(5,2),
    fruit_servings_target    NUMERIC(5,2),
    legume_servings_target   NUMERIC(5,2),

    bmr_kcal                 NUMERIC(9,2),
    activity_factor          NUMERIC(4,2),
    target_source            TEXT         NOT NULL,
    target_references        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    calculation_warnings     TEXT[]       NOT NULL DEFAULT '{}',

    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT daily_targets_positive CHECK (
        (calories_target      IS NULL OR calories_target      > 0) AND
        (calories_target_min  IS NULL OR calories_target_min  > 0) AND
        (calories_target_max  IS NULL OR calories_target_max  > 0) AND
        (calories_target_min  IS NULL OR calories_target_max IS NULL
            OR calories_target_min <= calories_target_max) AND
        (protein_target_min   IS NULL OR protein_target_min   >= 0) AND
        (protein_target_max   IS NULL OR protein_target_max   >= protein_target_min) AND
        (fiber_target         IS NULL OR fiber_target         >= 0) AND
        (added_sugars_limit   IS NULL OR added_sugars_limit   >= 0) AND
        (saturated_fat_limit  IS NULL OR saturated_fat_limit  >= 0)
    ),
    CONSTRAINT daily_targets_source_length CHECK (char_length(target_source) <= 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_targets_user_date_uidx
    ON daily_targets (user_id, target_date);

COMMENT ON COLUMN daily_targets.calculation_warnings IS
    'Örn. {"Mifflin-St Jeor yetişkinler içindir; 18 yaş altı için doğrulanmamıştır.", "Biyolojik cinsiyet belirtilmediği için BMR hesaplanamadı."}';

-- =============================================================================
-- 9. weekly_reports — haftalık analiz (yenilenebilir önbellek)
-- =============================================================================
-- Rapor, meal_items verisinden TÜRETİLEBİLİR. Saklanmasının tek sebebi
-- performanstır; bu yüzden bayatlama (staleness) açıkça modellenir:
--   * data_as_of        -> raporun okuduğu verinin anı
--   * source_max_updated -> o haftadaki kayıtların en son güncellenme anı
--   * v_weekly_report_freshness görünümü ikisini karşılaştırıp is_stale döner
-- Rapor bayatsa POST /api/reports/weekly?refresh=1 ile UPSERT edilir.
-- =============================================================================
CREATE TABLE IF NOT EXISTS weekly_reports (
    id                     SERIAL        PRIMARY KEY,
    user_id                INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start             DATE          NOT NULL,   -- Pazartesi
    week_end               DATE          NOT NULL,   -- Pazar

    average_calories       NUMERIC(9,2),
    average_protein        NUMERIC(9,2),
    average_carbohydrates  NUMERIC(9,2),
    average_fat            NUMERIC(9,2),
    average_fiber          NUMERIC(9,2),
    average_total_sugars   NUMERIC(9,2),
    average_added_sugars   NUMERIC(9,2),
    average_saturated_fat  NUMERIC(9,2),

    vegetable_servings_avg NUMERIC(8,2),
    fruit_servings_avg     NUMERIC(8,2),
    legume_servings_avg    NUMERIC(8,2),

    data_coverage_days     SMALLINT      NOT NULL DEFAULT 0,
    coverage_sufficient    BOOLEAN       NOT NULL DEFAULT FALSE,
    details                JSONB         NOT NULL DEFAULT '{}'::jsonb,

    data_as_of             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    source_max_updated     TIMESTAMPTZ,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Hafta tam olarak Pazartesi-Pazar (7 gün) olmalı.
    CONSTRAINT weekly_reports_week_span CHECK (week_end - week_start = 6),
    CONSTRAINT weekly_reports_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    CONSTRAINT weekly_reports_coverage_range CHECK (data_coverage_days BETWEEN 0 AND 7),
    -- Veri girilmeyen günler SIFIR tüketim sayılmaz (prompt md. 7.2):
    -- ortalamalar yalnızca kayıt olan günler üzerinden alınır, bu yüzden
    -- coverage 0 ise hiçbir ortalama dolu olamaz.
    CONSTRAINT weekly_reports_no_data_no_average CHECK (
        data_coverage_days > 0 OR average_calories IS NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_user_week_uidx
    ON weekly_reports (user_id, week_start);
CREATE INDEX IF NOT EXISTS weekly_reports_user_week_end_idx
    ON weekly_reports (user_id, week_end);

COMMENT ON COLUMN weekly_reports.data_coverage_days IS
    'O hafta en az bir meal_item kaydı olan gün sayısı (0-7). Ortalamalar 7ye değil bu sayıya bölünür.';

-- =============================================================================
-- 10. FONKSİYONLAR — hesaplama mantığının TEK kaynağı
-- =============================================================================

-- updated_at otomatik bakımı
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS foods_touch_updated_at ON foods;
CREATE TRIGGER foods_touch_updated_at
    BEFORE UPDATE ON foods FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS meals_touch_updated_at ON meals;
CREATE TRIGGER meals_touch_updated_at
    BEFORE UPDATE ON meals FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS meal_items_touch_updated_at ON meal_items;
CREATE TRIGGER meal_items_touch_updated_at
    BEFORE UPDATE ON meal_items FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS daily_targets_touch_updated_at ON daily_targets;
CREATE TRIGGER daily_targets_touch_updated_at
    BEFORE UPDATE ON daily_targets FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS weekly_reports_touch_updated_at ON weekly_reports;
CREATE TRIGGER weekly_reports_touch_updated_at
    BEFORE UPDATE ON weekly_reports FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();


-- -----------------------------------------------------------------------------
-- fn_scale_per_100g(value_per_100g, grams)
-- Besin değeri ölçekleme formülünün TEK tanımı:
--     miktar = (tüketilen gram / 100) × 100 gramdaki değer
-- Hem INSERT hem de denetim sorguları bu fonksiyonu kullanır; böylece aynı
-- hesap iki yerde farklı yazılamaz (prompt md. 9).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_scale_per_100g(value_per_100g NUMERIC, grams NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT round(coalesce(value_per_100g, 0) * (grams / 100.0), 2);
$$;

COMMENT ON FUNCTION fn_scale_per_100g IS
    '100 g bazlı besin değerini tüketilen grama ölçekler. Uygulamanın tek besin değeri formülü budur.';


-- -----------------------------------------------------------------------------
-- fn_normalize_to_100g(value_in_source_basis, source_basis, source_portion_grams)
-- Kaynak değeri porsiyon bazlıysa 100 g'a çevirir (denetlenebilir dönüşüm).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_normalize_to_100g(
    source_value       NUMERIC,
    source_basis       TEXT,
    source_portion_grams NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN source_value IS NULL THEN NULL
        WHEN source_basis = 'per_100g' THEN round(source_value, 2)
        WHEN source_basis = 'per_portion' AND source_portion_grams > 0
            THEN round(source_value * 100.0 / source_portion_grams, 2)
        ELSE NULL
    END;
$$;


-- -----------------------------------------------------------------------------
-- fn_week_start(d) — DATE_TRUNC('week', ...) PostgreSQL'de Pazartesi döner.
-- Haftalık analiz Pazartesiden Pazara olduğu için tek yerde sabitlenir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_week_start(d DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT date_trunc('week', d)::date;
$$;


-- -----------------------------------------------------------------------------
-- fn_serving_count(group_grams) — porsiyon sayısı
-- 1 porsiyon sebze/meyve = 80 g (WHO: günde >=400 g = 5 porsiyon).
-- Baklagil için de 80 g pişmiş kullanılır (~1/2 su bardağı pişmiş baklagil).
-- Bu, uygulamanın belgelediği bir yaklaşıklıktır; kaynak tablosunda işaretlidir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_serving_count(group_grams NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT round(coalesce(group_grams, 0) / 80.0, 2);
$$;

COMMENT ON FUNCTION fn_serving_count IS
    'Sebze/meyve/baklagil gramını porsiyona çevirir (1 porsiyon = 80 g, WHO >=400 g/gün = 5 porsiyon).';


-- =============================================================================
-- 11. TEST AMAÇLI INSERT — sözlük (dictionary) verisi
-- =============================================================================
-- food_categories bir referans sözlüğüdür: foods.category_id buna bağlı
-- (ON DELETE RESTRICT), dolayısıyla tablo boşken hiçbir besin eklenemez.
-- Satırlar idempotent eklenir (ON CONFLICT DO NOTHING).
--
-- Besin kayıtları BURAYA DEĞİL, database/seed.sql dosyasına yazılır. Böylece
-- aynı besin verisi iki yerde tutulmaz ve şema dosyası yalnızca yapıdan sorumlu
-- kalır. seed.sql çalıştırıldığında aşağıdaki kategoriler hazır olmalıdır.
-- =============================================================================
INSERT INTO food_categories (name, description) VALUES
    ('Süt ve süt ürünleri',  'Süt, yoğurt, peynir, kefir gibi ürünler.'),
    ('Yumurta',              'Yumurta ve yumurta içeren temel ürünler.'),
    ('Et ve kümes hayvanları', 'Kırmızı et, tavuk, hindi gibi kümes hayvanları.'),
    ('Balık ve deniz ürünleri', 'Balık, kabuklu deniz ürünleri.'),
    ('Kuru baklagiller',     'Mercimek, nohut, kuru fasulye, barbunya gibi olgun tohumlar.'),
    ('Tahıllar ve tahıl ürünleri', 'Pirinç, bulgur, yulaf, ekmek, makarna.'),
    ('Sebzeler',             'Taze, dondurulmuş veya pişmiş sebzeler.'),
    ('Meyveler',             'Taze, kurutulmuş veya dondurulmuş meyveler.'),
    ('Yağlar',               'Zeytinyağı, ayçiçek yağı, tereyağı gibi yağlar.'),
    ('Kuruyemiş ve tohumlar', 'Ceviz, badem, fındık, ay çekirdeği, keten tohumu.'),
    ('İçecekler',            'Su, çay, kahve, meyve suyu, şekerli içecekler.'),
    ('Şeker ve tatlılar',    'Sofra şekeri, bal, reçel, tatlı ve paketli atıştırmalıklar.'),
    ('Diğer',                'Yukarıdaki gruplara girmeyen besinler.')
ON CONFLICT (name) DO NOTHING;

-- Test: şema kuruldu mu, sözlük dolu mu? Aşağıdaki sorgu elle doğrulama içindir.
--   SELECT c.id, c.name, count(f.id) AS food_count
--     FROM food_categories c
--     LEFT JOIN foods f ON f.category_id = c.id
--    GROUP BY c.id, c.name
--    ORDER BY c.id;

COMMIT;
