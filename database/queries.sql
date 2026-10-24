-- =============================================================================
-- Kalori ve Besin Takip Sistemi — Açıklamalı SQL Sorguları ve Görünümler
-- =============================================================================
-- Bu dosya dört bölümden oluşur:
--   A. GÖRÜNÜMLER      — çalıştırılabilir, idempotent (CREATE OR REPLACE)
--   B. PARAMETRELİ SORGULAR — backend'in birebir kullandığı ifadeler ($1, $2 ...)
--   C. TEST / BAKIM    — INSERT, güvenli UPDATE, güvenli DELETE örnekleri
--   D. DENETİM         — tutarlılık ve bayatlama kontrolleri
--
-- ÇALIŞTIRMA:
--   psql -U postgres -d nutrition_tracker -f database/queries.sql
--
-- TASARIM İLKESİ: Günlük toplamlar ve haftalık ortalamalar burada, SQL
-- tarafında hesaplanır. Ölçekleme formülü yalnızca fn_scale_per_100g() içinde
-- tanımlıdır; hiçbir yerde ikinci kez yazılmaz.
-- =============================================================================

BEGIN;

-- #############################################################################
-- BÖLÜM A — GÖRÜNÜMLER
-- #############################################################################

-- -----------------------------------------------------------------------------
-- A.1 v_meal_items_enriched
-- meal_items + meals + foods birleşimi. Günlük ve haftalık hesapların tabanı.
-- Sebze/meyve/baklagil bayrakları foods'tan gelir; ayrıca saklanmaz.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_meal_items_enriched AS
SELECT
    mi.id                       AS meal_item_id,
    mi.meal_id,
    m.user_id,
    m.meal_date,
    m.meal_type,
    mi.food_id,
    f.name                      AS food_name,
    f.state                     AS food_state,
    f.is_vegetable,
    f.is_fruit,
    f.is_legume,
    mi.quantity_grams,
    mi.calories,
    mi.protein,
    mi.carbohydrates,
    mi.total_sugars,
    mi.added_sugars,
    mi.fat,
    mi.saturated_fat,
    mi.fiber,
    mi.created_at               AS item_created_at,
    greatest(mi.updated_at, m.updated_at) AS record_updated_at
FROM meal_items mi
JOIN meals m ON m.id = mi.meal_id
JOIN foods f ON f.id = mi.food_id;

COMMENT ON VIEW v_meal_items_enriched IS
    'Besin günlüğü kayıtlarının öğün ve besin bilgisiyle birleştirilmiş hali.';


-- -----------------------------------------------------------------------------
-- A.2 v_daily_totals
-- GÜNÜK TOPLAMLAR. Bir kullanıcının bir günündeki tüm öğünlerin toplamı.
--
-- added_sugars_notable: SUM(NULL içeren kolon) NULL'ları yok sayar. Yani bir
-- besin ilave şekerini BİLDİRMİYORSA toplam düşük çıkar. Bu yüzden
--   * added_sugars_known_sum -> yalnızca bilinenlerin toplamı (alt sınır)
--   * added_sugars_incomplete -> TRUE ise bu değer "en az" olarak okunmalıdır
-- Toplam şeker ile ilave şeker hiçbir yerde birbirine karıştırılmaz.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_daily_totals AS
SELECT
    user_id,
    meal_date                                            AS log_date,
    count(*)                                             AS item_count,
    sum(quantity_grams)                                  AS total_grams,

    sum(calories)                                        AS calories,
    sum(protein)                                         AS protein,
    sum(carbohydrates)                                   AS carbohydrates,
    sum(total_sugars)                                    AS total_sugars,
    sum(fat)                                             AS fat,
    sum(saturated_fat)                                   AS saturated_fat,
    sum(fiber)                                           AS fiber,

    sum(added_sugars)                                    AS added_sugars_known_sum,
    count(*) FILTER (WHERE added_sugars IS NULL)         AS items_missing_added_sugars,
    bool_or(added_sugars IS NULL)                        AS added_sugars_incomplete,

    sum(quantity_grams) FILTER (WHERE is_vegetable)      AS vegetable_grams,
    sum(quantity_grams) FILTER (WHERE is_fruit)          AS fruit_grams,
    sum(quantity_grams) FILTER (WHERE is_legume)         AS legume_grams,

    fn_serving_count(sum(quantity_grams) FILTER (WHERE is_vegetable)) AS vegetable_servings,
    fn_serving_count(sum(quantity_grams) FILTER (WHERE is_fruit))     AS fruit_servings,
    fn_serving_count(sum(quantity_grams) FILTER (WHERE is_legume))    AS legume_servings,

    max(record_updated_at)                               AS last_updated
FROM v_meal_items_enriched
GROUP BY user_id, meal_date;

COMMENT ON VIEW v_daily_totals IS
    'Kullanıcı ve gün bazında besin toplamları. Yalnızca kayıt olan günler satır üretir; veri olmayan gün burada YOKTUR (sıfır sayılmaz).';


-- -----------------------------------------------------------------------------
-- A.3 v_daily_vs_targets
-- Günlük tüketim ile günlük hedeflerin karşılaştırması.
-- Hedef NULL ise yüzde de NULL olur: arayüz "hedef hesaplanamadı" der,
-- %0 veya %100 gibi yanıltıcı bir değer üretmez.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_daily_vs_targets AS
SELECT
    d.user_id,
    d.log_date,
    d.item_count,
    d.calories,
    d.protein,
    d.carbohydrates,
    d.fat,
    d.fiber,
    d.total_sugars,
    d.added_sugars_known_sum,
    d.added_sugars_incomplete,
    d.items_missing_added_sugars,
    d.saturated_fat,
    d.vegetable_grams,
    d.fruit_grams,
    d.legume_grams,
    d.vegetable_servings,
    d.fruit_servings,
    d.legume_servings,

    t.target_date,
    t.calories_target,
    t.calories_target_min,
    t.calories_target_max,
    t.protein_target_min,
    t.protein_target_max,
    t.carbohydrates_target_min,
    t.carbohydrates_target_max,
    t.fat_target_min,
    t.fat_target_max,
    t.fiber_target,
    t.added_sugars_limit,
    t.saturated_fat_limit,
    t.vegetable_servings_target,
    t.fruit_servings_target,
    t.legume_servings_target,
    t.bmr_kcal,
    t.activity_factor,
    t.target_source,
    t.target_references,
    t.calculation_warnings,

    CASE WHEN t.calories_target IS NULL OR t.calories_target = 0 THEN NULL
         ELSE round(100.0 * d.calories / t.calories_target, 1) END           AS calories_pct_of_target,
    CASE WHEN t.fiber_target IS NULL OR t.fiber_target = 0 THEN NULL
         ELSE round(100.0 * d.fiber / t.fiber_target, 1) END                 AS fiber_pct_of_target,
    CASE WHEN t.protein_target_min IS NULL OR t.protein_target_min = 0 THEN NULL
         ELSE round(100.0 * d.protein / t.protein_target_min, 1) END         AS protein_pct_of_min_target,
    -- İlave şeker oranı YALNIZCA tüm kayıtların ilave şekeri biliniyorsa hesaplanır.
    -- Bilinmeyen ilave şekeri 0 saymak düşük bir oran uydurur; bu yüzden NULL döner.
    CASE WHEN d.added_sugars_incomplete THEN NULL
         WHEN t.added_sugars_limit IS NULL OR t.added_sugars_limit = 0 THEN NULL
         ELSE round(100.0 * d.added_sugars_known_sum / t.added_sugars_limit, 1)
    END                                                                     AS added_sugars_pct_of_limit,
    CASE WHEN t.saturated_fat_limit IS NULL OR t.saturated_fat_limit = 0 THEN NULL
         ELSE round(100.0 * d.saturated_fat / t.saturated_fat_limit, 1) END  AS saturated_fat_pct_of_limit
FROM v_daily_totals d
LEFT JOIN daily_targets t
       ON t.user_id = d.user_id
      AND t.target_date = d.log_date;

COMMENT ON VIEW v_daily_vs_targets IS 'Günlük tüketim-hedef karşılaştırması; hedef yoksa oranlar NULL kalır.';


-- -----------------------------------------------------------------------------
-- A.4 v_weekly_daily_rows
-- Haftalık analiz için günlük satırların hafta başına (Pazartesi) göre gruplanmış hali.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_weekly_daily_rows AS
SELECT
    user_id,
    fn_week_start(log_date) AS week_start,
    log_date,
    calories,
    protein,
    carbohydrates,
    fat,
    saturated_fat,
    fiber,
    total_sugars,
    added_sugars_known_sum,
    added_sugars_incomplete,
    vegetable_grams,
    fruit_grams,
    legume_grams,
    vegetable_servings,
    fruit_servings,
    legume_servings
FROM v_daily_totals;


-- -----------------------------------------------------------------------------
-- A.5 v_weekly_averages
-- HAFTALIK ORTALAMALAR — SQL tarafında.
--
-- avg() yalnızca var olan satırlar üzerinden hesaplar. Yani veri girilmeyen
-- gün ortalamaya SIFIR olarak girmez; bu, prompt md. 7.2 kuralının SQL
-- düzeyindeki karşılığıdır. data_coverage_days o hafta kaç gün kayıt olduğunu
-- söyler; coverage_sufficient, ortalamanın güvenilir olup olmadığını işaretler
-- (eşik: >=4 gün). Eşik tek yerde, bu görünümde tanımlıdır.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_weekly_averages AS
SELECT
    user_id,
    week_start,
    week_start + 6                              AS week_end,
    count(*)                                    AS data_coverage_days,
    count(*) >= 4                               AS coverage_sufficient,

    round(avg(calories), 2)                     AS average_calories,
    round(avg(protein), 2)                      AS average_protein,
    round(avg(carbohydrates), 2)                AS average_carbohydrates,
    round(avg(fat), 2)                          AS average_fat,
    round(avg(saturated_fat), 2)                AS average_saturated_fat,
    round(avg(fiber), 2)                        AS average_fiber,
    round(avg(total_sugars), 2)                 AS average_total_sugars,
    -- İlave şeker ortalaması: yalnızca tüm günlerde veri tamsa anlamlı.
    CASE WHEN bool_or(added_sugars_incomplete) THEN NULL
         ELSE round(avg(added_sugars_known_sum), 2) END AS average_added_sugars,
    bool_or(added_sugars_incomplete)            AS added_sugars_incomplete,

    min(calories)                               AS min_daily_calories,
    max(calories)                               AS max_daily_calories,
    round(max(calories) - min(calories), 2)     AS daily_calorie_spread,
    round(stddev_samp(calories), 2)             AS daily_calorie_stddev,

    round(avg(vegetable_servings), 2)           AS vegetable_servings_avg,
    round(avg(fruit_servings), 2)               AS fruit_servings_avg,
    round(avg(legume_servings), 2)              AS legume_servings_avg,
    round(avg(vegetable_grams), 1)              AS vegetable_grams_avg,
    round(avg(fruit_grams), 1)                  AS fruit_grams_avg,
    round(avg(legume_grams), 1)                 AS legume_grams_avg,

    -- Tüketim SIKLIĞI (yalnızca gram değil, kaç gün — prompt md. 7.5)
    count(*) FILTER (WHERE vegetable_grams > 0) AS days_with_vegetables,
    count(*) FILTER (WHERE fruit_grams > 0)     AS days_with_fruit,
    count(*) FILTER (WHERE legume_grams > 0)    AS days_with_legumes
FROM v_weekly_daily_rows
GROUP BY user_id, week_start;

COMMENT ON VIEW v_weekly_averages IS
    'Haftalık ortalamaların tek kanonik tanımı. weekly_reports tablosu bu görünümün önbelleğidir.';


-- -----------------------------------------------------------------------------
-- A.6 v_weekly_report_freshness
-- Kayıtlı haftalık rapor bayatladı mı? Raporun okuduğu veri anı (data_as_of)
-- ile o haftadaki kayıtların CANLI en son güncellenme anı karşılaştırılır.
-- Bayatsa rapor yeniden üretilmelidir (POST /api/reports/weekly?refresh=1).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_weekly_report_freshness AS
SELECT
    wr.id                AS weekly_report_id,
    wr.user_id,
    wr.week_start,
    wr.week_end,
    wr.created_at,
    wr.data_as_of,
    live.max_updated     AS live_max_updated,
    (live.max_updated IS NOT NULL AND live.max_updated > wr.data_as_of) AS is_stale
FROM weekly_reports wr
LEFT JOIN LATERAL (
    SELECT max(x.updated_at) AS max_updated
    FROM (
        SELECT m.updated_at
        FROM meals m
        WHERE m.user_id = wr.user_id
          AND m.meal_date BETWEEN wr.week_start AND wr.week_end
        UNION ALL
        SELECT mi.updated_at
        FROM meal_items mi
        JOIN meals m ON m.id = mi.meal_id
        WHERE m.user_id = wr.user_id
          AND m.meal_date BETWEEN wr.week_start AND wr.week_end
    ) x
) live ON TRUE;

COMMENT ON VIEW v_weekly_report_freshness IS
    'Önbelleğe alınmış haftalık raporların güncelliğini denetler. is_stale=TRUE ise raporu yenileyin.';


-- -----------------------------------------------------------------------------
-- A.7 v_meal_item_drift
-- Saklanan snapshot değerler, fn_scale_per_100g() ile yeniden hesaplanan
-- değerlerle uyuşuyor mu? Yalnızca SAPAN satırları döner (boş sonuç = sağlıklı).
-- Tolerans 0.02: iki ayrı round işleminden kaynaklanan kuruş farkına izin verir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_meal_item_drift AS
SELECT
    mi.id                                                          AS meal_item_id,
    mi.meal_id,
    m.user_id,
    mi.food_id,
    mi.quantity_grams,
    mi.calories                                                    AS stored_calories,
    fn_scale_per_100g(f.calories_per_100g, mi.quantity_grams)      AS expected_calories,
    mi.protein                                                     AS stored_protein,
    fn_scale_per_100g(f.protein_per_100g, mi.quantity_grams)       AS expected_protein,
    mi.carbohydrates                                               AS stored_carbohydrates,
    fn_scale_per_100g(f.carbohydrates_per_100g, mi.quantity_grams) AS expected_carbohydrates,
    mi.fat                                                         AS stored_fat,
    fn_scale_per_100g(f.fat_per_100g, mi.quantity_grams)           AS expected_fat,
    mi.fiber                                                       AS stored_fiber,
    fn_scale_per_100g(f.fiber_per_100g, mi.quantity_grams)         AS expected_fiber
FROM meal_items mi
JOIN meals m ON m.id = mi.meal_id
JOIN foods f ON f.id = mi.food_id
WHERE abs(mi.calories      - fn_scale_per_100g(f.calories_per_100g,      mi.quantity_grams)) > 0.02
   OR abs(mi.protein       - fn_scale_per_100g(f.protein_per_100g,       mi.quantity_grams)) > 0.02
   OR abs(mi.carbohydrates - fn_scale_per_100g(f.carbohydrates_per_100g, mi.quantity_grams)) > 0.02
   OR abs(mi.total_sugars  - fn_scale_per_100g(f.total_sugars_per_100g,  mi.quantity_grams)) > 0.02
   OR abs(mi.fat           - fn_scale_per_100g(f.fat_per_100g,           mi.quantity_grams)) > 0.02
   OR abs(mi.saturated_fat - fn_scale_per_100g(f.saturated_fat_per_100g, mi.quantity_grams)) > 0.02
   OR abs(mi.fiber         - fn_scale_per_100g(f.fiber_per_100g,         mi.quantity_grams)) > 0.02;

COMMENT ON VIEW v_meal_item_drift IS
    'Saklanan ve yeniden hesaplanan besin değerleri arasındaki sapmayı listeler. Boş dönmelidir.';

COMMIT;


-- #############################################################################
-- BÖLÜM B — PARAMETRELİ SORGULAR
-- #############################################################################
-- Aşağıdaki ifadeler backend'in çalıştırdığı sorguların birebir kopyasıdır.
-- $1, $2 ... pg paketinin parametreli sorgu yer tutucularıdır. Kullanıcı girdisi
-- HİÇBİR zaman string birleştirme ile sorguya eklenmez (SQL injection koruması).
--
-- SAHİPLİK KURALI: kullanıcı verisine dokunan her sorguda user_id filtresi
-- vardır. meal_items üzerinde işlem yapılırken bile önce meals.user_id
-- doğrulanır, böylece başka kullanıcının kaydına erişilemez.


-- -----------------------------------------------------------------------------
-- B.1 Besin arama (GET /api/foods?search=mercimek&category=Baklagiller)
-- Dinamik parçalar YALNIZCA beyaz listeden gelen kolon adlarıdır; değerler
-- her zaman parametredir. Sıralama kolonu backend'de sabit listeye karşı
-- doğrulanır.
-- -----------------------------------------------------------------------------
SELECT
    f.id,
    f.name,
    fc.name AS category,
    f.state,
    f.calories_per_100g,
    f.protein_per_100g,
    f.carbohydrates_per_100g,
    f.total_sugars_per_100g,
    f.added_sugars_per_100g,
    f.fat_per_100g,
    f.saturated_fat_per_100g,
    f.fiber_per_100g,
    f.portion_grams,
    f.portion_unit,
    f.is_vegetable,
    f.is_fruit,
    f.is_legume,
    f.source_name,
    f.source_url,
    f.source_food_id,
    f.data_quality
FROM foods f
JOIN food_categories fc ON fc.id = f.category_id
WHERE ($1::text IS NULL OR lower(f.name) LIKE '%' || lower($1) || '%')
  AND ($2::text IS NULL OR fc.name = $2)
  AND ($3::boolean IS NULL OR f.is_vegetable = $3)
  AND ($4::boolean IS NULL OR f.is_fruit     = $4)
  AND ($5::boolean IS NULL OR f.is_legume    = $5)
ORDER BY f.name ASC
LIMIT $6::int OFFSET $7::int;


-- -----------------------------------------------------------------------------
-- B.2 Günlük öğünler ve içindekiler (GET /api/meals?date=YYYY-MM-DD)
-- LEFT JOIN: o gün öğün başlığı açılmış ama henüz besin eklenmemişse de görünür.
-- Tek sorguda 4 öğün listesi döner (N+1 sorgu yok).
-- -----------------------------------------------------------------------------
SELECT
    m.id              AS meal_id,
    m.meal_date,
    m.meal_type,
    m.notes,
    mi.id             AS meal_item_id,
    mi.food_id,
    f.name            AS food_name,
    f.state           AS food_state,
    f.portion_grams   AS food_portion_grams,
    f.portion_unit    AS food_portion_unit,
    mi.quantity_grams,
    mi.calories,
    mi.protein,
    mi.carbohydrates,
    mi.total_sugars,
    mi.added_sugars,
    mi.fat,
    mi.saturated_fat,
    mi.fiber
FROM meals m
LEFT JOIN meal_items mi ON mi.meal_id = m.id
LEFT JOIN foods f       ON f.id = mi.food_id
WHERE m.user_id = $1::int
  AND m.meal_date = $2::date
ORDER BY
    CASE m.meal_type
        WHEN 'breakfast' THEN 1
        WHEN 'lunch'     THEN 2
        WHEN 'dinner'    THEN 3
        WHEN 'snack'     THEN 4
    END,
    m.id, mi.id;


-- -----------------------------------------------------------------------------
-- B.3 Öğüne besin ekleme (POST /api/meals/:id/items)
-- Besin değerleri UYGULAMA KODUNDA hesaplanmaz; fn_scale_per_100g() ile SQL
-- içinde hesaplanır. Formülün tek tanımı budur.
-- RETURNING ile eklenen satır ve besin adı tek turda döner.
--
-- Önceki CTE öğünün SAHİPLİĞİNİ doğrular: user_id eşleşmeyen öğün için
-- INSERT hiç çalışmaz (0 satır etkilenir) ve controller 404 döner.
-- -----------------------------------------------------------------------------
WITH owned_meal AS (
    SELECT id
    FROM meals
    WHERE id = $1::int
      AND user_id = $2::int
)
INSERT INTO meal_items (
    meal_id, food_id, quantity_grams,
    calories, protein, carbohydrates, total_sugars, added_sugars,
    fat, saturated_fat, fiber
)
SELECT
    om.id,
    f.id,
    $3::numeric,
    fn_scale_per_100g(f.calories_per_100g,      $3::numeric),
    fn_scale_per_100g(f.protein_per_100g,       $3::numeric),
    fn_scale_per_100g(f.carbohydrates_per_100g, $3::numeric),
    fn_scale_per_100g(f.total_sugars_per_100g,  $3::numeric),
    CASE WHEN f.added_sugars_per_100g IS NULL THEN NULL
         ELSE fn_scale_per_100g(f.added_sugars_per_100g, $3::numeric) END,
    fn_scale_per_100g(f.fat_per_100g,           $3::numeric),
    fn_scale_per_100g(f.saturated_fat_per_100g, $3::numeric),
    fn_scale_per_100g(f.fiber_per_100g,         $3::numeric)
FROM owned_meal om
JOIN foods f ON f.id = $4::int
RETURNING
    meal_items.id AS meal_item_id,
    meal_items.meal_id,
    meal_items.food_id,
    meal_items.quantity_grams,
    meal_items.calories,
    meal_items.protein,
    meal_items.carbohydrates,
    meal_items.total_sugars,
    meal_items.added_sugars,
    meal_items.fat,
    meal_items.saturated_fat,
    meal_items.fiber;


-- -----------------------------------------------------------------------------
-- B.4 Günlük rapor (GET /api/reports/daily?date=YYYY-MM-DD)
-- v_daily_vs_targets görünümünden okunur; hesap burada tekrarlanmaz.
-- -----------------------------------------------------------------------------
SELECT
    user_id, log_date, item_count,
    calories, protein, carbohydrates, fat, saturated_fat, fiber,
    total_sugars, added_sugars_known_sum, added_sugars_incomplete, items_missing_added_sugars,
    vegetable_grams, fruit_grams, legume_grams,
    vegetable_servings, fruit_servings, legume_servings,
    target_date, bmr_kcal, activity_factor,
    calories_target, calories_target_min, calories_target_max,
    protein_target_min, protein_target_max,
    carbohydrates_target_min, carbohydrates_target_max,
    fat_target_min, fat_target_max,
    fiber_target, added_sugars_limit, saturated_fat_limit,
    vegetable_servings_target, fruit_servings_target, legume_servings_target,
    calories_pct_of_target, fiber_pct_of_target, protein_pct_of_min_target,
    added_sugars_pct_of_limit, saturated_fat_pct_of_limit,
    target_source, target_references, calculation_warnings
FROM v_daily_vs_targets
WHERE user_id = $1::int
  AND log_date = $2::date;


-- -----------------------------------------------------------------------------
-- B.5 Kayıt olmayan günler için günlük satır (GET /api/reports/daily, boş gün)
-- v_daily_totals yalnızca kayıt olan günleri içerir. Kullanıcı hiç veri
-- girmediyse bu sorgu 0 satır döner ve uygulama "kayıt yok" ile
-- "sıfır tüketildi"yi birbirinden ayırır.
-- -----------------------------------------------------------------------------
SELECT
    t.user_id,
    t.target_date AS log_date,
    NULL::numeric AS calories,
    t.calories_target,
    t.protein_target_min,
    t.protein_target_max,
    t.fiber_target,
    t.target_source
FROM daily_targets t
WHERE t.user_id = $1::int
  AND t.target_date = $2::date;


-- -----------------------------------------------------------------------------
-- B.6 Haftalık ortalama (GET /api/reports/weekly?start=YYYY-MM-DD)
-- $2 tarihinden hangi güne denk gelirse gelsin fn_week_start() ile o haftanın
-- Pazartesi'sine normalize edilir; böylece hafta sınırı tek yerde tanımlıdır.
-- -----------------------------------------------------------------------------
SELECT
    user_id, week_start, week_end, data_coverage_days, coverage_sufficient,
    average_calories, average_protein, average_carbohydrates,
    average_fat, average_saturated_fat, average_fiber,
    average_total_sugars, average_added_sugars, added_sugars_incomplete,
    min_daily_calories, max_daily_calories, daily_calorie_spread, daily_calorie_stddev,
    vegetable_servings_avg, fruit_servings_avg, legume_servings_avg,
    vegetable_grams_avg, fruit_grams_avg, legume_grams_avg,
    days_with_vegetables, days_with_fruit, days_with_legumes
FROM v_weekly_averages
WHERE user_id = $1::int
  AND week_start = fn_week_start($2::date);


-- -----------------------------------------------------------------------------
-- B.7 Haftanın gün gün dökümü + VERİ GİRİLMEYEN GÜNLER
-- generate_series ile haftanın 7 günü üretilir, gerçek veriler LEFT JOIN edilir.
-- Kayıt olmayan gün calories=NULL kalır (0 DEĞİL). Prompt md. 7.2'nin uygulanışı.
-- -----------------------------------------------------------------------------
SELECT
    d.day_date,
    to_char(d.day_date, 'Dy')          AS day_name_short,
    EXTRACT(ISODOW FROM d.day_date)    AS iso_day_of_week,
    t.calories,
    t.protein,
    t.carbohydrates,
    t.fat,
    t.fiber,
    t.total_sugars,
    t.vegetable_servings,
    t.fruit_servings,
    t.legume_servings,
    (t.log_date IS NULL)               AS is_missing_day,
    t.item_count
FROM generate_series(
        fn_week_start($2::date),
        fn_week_start($2::date) + 6,
        INTERVAL '1 day') AS d(day_date)
LEFT JOIN v_daily_totals t
       ON t.user_id = $1::int
      AND t.log_date = d.day_date::date
ORDER BY d.day_date;


-- -----------------------------------------------------------------------------
-- B.8 Sebze / meyve / baklagil analizi (haftalık, besin bazında ayrıntı)
-- Yalnızca gram değil; hangi besinden, kaç gün, kaç porsiyon geldiğini gösterir.
-- -----------------------------------------------------------------------------
SELECT
    e.user_id,
    fn_week_start(e.meal_date)                    AS week_start,
    CASE
        WHEN e.is_legume    THEN 'legume'
        WHEN e.is_vegetable THEN 'vegetable'
        WHEN e.is_fruit     THEN 'fruit'
    END                                           AS food_group,
    e.food_name,
    e.food_state,
    sum(e.quantity_grams)                         AS total_grams,
    fn_serving_count(sum(e.quantity_grams))       AS total_servings,
    count(DISTINCT e.meal_date)                   AS days_consumed,
    count(*)                                      AS record_count,
    sum(e.fiber)                                  AS fiber_from_group
FROM v_meal_items_enriched e
WHERE e.user_id = $1::int
  AND e.meal_date BETWEEN fn_week_start($2::date) AND fn_week_start($2::date) + 6
  AND (e.is_vegetable OR e.is_fruit OR e.is_legume)
GROUP BY
    e.user_id,
    fn_week_start(e.meal_date),
    CASE
        WHEN e.is_legume    THEN 'legume'
        WHEN e.is_vegetable THEN 'vegetable'
        WHEN e.is_fruit     THEN 'fruit'
    END,
    e.food_name,
    e.food_state
ORDER BY food_group, total_grams DESC;


-- -----------------------------------------------------------------------------
-- B.9 Kullanıcıya göre tarih aralığındaki tüm kayıtlar
-- Aralık backend'de doğrulanır (bitiş >= başlangıç, makul uzunluk).
-- -----------------------------------------------------------------------------
SELECT
    e.meal_date,
    e.meal_type,
    e.food_name,
    e.quantity_grams,
    e.calories,
    e.protein,
    e.carbohydrates,
    e.total_sugars,
    e.added_sugars,
    e.fat,
    e.saturated_fat,
    e.fiber,
    e.is_vegetable,
    e.is_fruit,
    e.is_legume
FROM v_meal_items_enriched e
WHERE e.user_id = $1::int
  AND e.meal_date BETWEEN $2::date AND $3::date
ORDER BY e.meal_date, e.meal_item_id;


-- -----------------------------------------------------------------------------
-- B.10 Günlük hedefleri UPSERT et (hesaplanan hedefleri kaydet)
-- ON CONFLICT sayesinde aynı gün için tekrar tekrar hesaplamak güvenlidir.
-- -----------------------------------------------------------------------------
INSERT INTO daily_targets (
    user_id, target_date,
    calories_target, calories_target_min, calories_target_max,
    protein_target_min, protein_target_max,
    carbohydrates_target_min, carbohydrates_target_max,
    fat_target_min, fat_target_max,
    fiber_target, added_sugars_limit, saturated_fat_limit,
    vegetable_servings_target, fruit_servings_target, legume_servings_target,
    bmr_kcal, activity_factor,
    target_source, target_references, calculation_warnings
)
VALUES (
    $1::int, $2::date,
    $3::numeric, $4::numeric, $5::numeric,
    $6::numeric, $7::numeric,
    $8::numeric, $9::numeric,
    $10::numeric, $11::numeric,
    $12::numeric, $13::numeric, $14::numeric,
    $15::numeric, $16::numeric, $17::numeric,
    $18::numeric, $19::numeric,
    $20::text, $21::jsonb, $22::text[]
)
ON CONFLICT (user_id, target_date)
DO UPDATE SET
    calories_target           = EXCLUDED.calories_target,
    calories_target_min       = EXCLUDED.calories_target_min,
    calories_target_max       = EXCLUDED.calories_target_max,
    protein_target_min        = EXCLUDED.protein_target_min,
    protein_target_max        = EXCLUDED.protein_target_max,
    carbohydrates_target_min  = EXCLUDED.carbohydrates_target_min,
    carbohydrates_target_max  = EXCLUDED.carbohydrates_target_max,
    fat_target_min            = EXCLUDED.fat_target_min,
    fat_target_max            = EXCLUDED.fat_target_max,
    fiber_target              = EXCLUDED.fiber_target,
    added_sugars_limit        = EXCLUDED.added_sugars_limit,
    saturated_fat_limit       = EXCLUDED.saturated_fat_limit,
    vegetable_servings_target = EXCLUDED.vegetable_servings_target,
    fruit_servings_target     = EXCLUDED.fruit_servings_target,
    legume_servings_target    = EXCLUDED.legume_servings_target,
    bmr_kcal                  = EXCLUDED.bmr_kcal,
    activity_factor           = EXCLUDED.activity_factor,
    target_source             = EXCLUDED.target_source,
    target_references         = EXCLUDED.target_references,
    calculation_warnings      = EXCLUDED.calculation_warnings;

-- Not: ON CONFLICT hedefi daily_targets_user_date_uidx UNIQUE indeksidir.


-- -----------------------------------------------------------------------------
-- B.11 Haftalık raporu UPSERT et (yeniden üretilebilir önbellek)
-- data_as_of = now() yazılır; v_weekly_report_freshness bunu canlı veriyle
-- karşılaştırıp bayatlamayı tespit eder.
-- -----------------------------------------------------------------------------
INSERT INTO weekly_reports (
    user_id, week_start, week_end,
    average_calories, average_protein, average_carbohydrates,
    average_fat, average_fiber, average_total_sugars, average_added_sugars,
    average_saturated_fat,
    vegetable_servings_avg, fruit_servings_avg, legume_servings_avg,
    data_coverage_days, coverage_sufficient, details,
    data_as_of, source_max_updated
)
VALUES (
    $1::int, $2::date, $2::date + 6,
    $3::numeric, $4::numeric, $5::numeric,
    $6::numeric, $7::numeric, $8::numeric, $9::numeric,
    $10::numeric,
    $11::numeric, $12::numeric, $13::numeric,
    $14::smallint, $15::boolean, $16::jsonb,
    now(), now()
)
ON CONFLICT (user_id, week_start)
DO UPDATE SET
    week_end               = EXCLUDED.week_end,
    average_calories       = EXCLUDED.average_calories,
    average_protein        = EXCLUDED.average_protein,
    average_carbohydrates  = EXCLUDED.average_carbohydrates,
    average_fat            = EXCLUDED.average_fat,
    average_fiber          = EXCLUDED.average_fiber,
    average_total_sugars   = EXCLUDED.average_total_sugars,
    average_added_sugars   = EXCLUDED.average_added_sugars,
    average_saturated_fat  = EXCLUDED.average_saturated_fat,
    vegetable_servings_avg = EXCLUDED.vegetable_servings_avg,
    fruit_servings_avg     = EXCLUDED.fruit_servings_avg,
    legume_servings_avg    = EXCLUDED.legume_servings_avg,
    data_coverage_days     = EXCLUDED.data_coverage_days,
    coverage_sufficient    = EXCLUDED.coverage_sufficient,
    details                = EXCLUDED.details,
    data_as_of             = EXCLUDED.data_as_of,
    source_max_updated     = EXCLUDED.source_max_updated,
    updated_at             = now()
RETURNING id, week_start, week_end, data_coverage_days, data_as_of;


-- #############################################################################
-- BÖLÜM C — TEST / BAKIM İŞLEMLERİ
-- #############################################################################

-- -----------------------------------------------------------------------------
-- C.1 GÜVENLİ UPDATE — miktarı değiştir
-- Sahiplik, meals üzerinden JOIN ile doğrulanır. $2 kullanıcı kimliği
-- eşleşmezse 0 satır güncellenir (başkasının kaydı değiştirilemez).
-- Besin değerleri elle yazılmaz; fn_scale_per_100g() ile yeniden hesaplanır.
-- -----------------------------------------------------------------------------
UPDATE meal_items mi
SET
    quantity_grams = $3::numeric,
    calories       = fn_scale_per_100g(f.calories_per_100g,      $3::numeric),
    protein        = fn_scale_per_100g(f.protein_per_100g,       $3::numeric),
    carbohydrates  = fn_scale_per_100g(f.carbohydrates_per_100g, $3::numeric),
    total_sugars   = fn_scale_per_100g(f.total_sugars_per_100g,  $3::numeric),
    added_sugars   = CASE WHEN f.added_sugars_per_100g IS NULL THEN NULL
                          ELSE fn_scale_per_100g(f.added_sugars_per_100g, $3::numeric) END,
    fat            = fn_scale_per_100g(f.fat_per_100g,           $3::numeric),
    saturated_fat  = fn_scale_per_100g(f.saturated_fat_per_100g, $3::numeric),
    fiber          = fn_scale_per_100g(f.fiber_per_100g,         $3::numeric)
FROM meals m
JOIN foods f ON f.id = mi.food_id
WHERE mi.id = $1::int
  AND m.id = mi.meal_id
  AND m.user_id = $2::int
RETURNING mi.id, mi.quantity_grams, mi.calories, mi.protein;


-- -----------------------------------------------------------------------------
-- C.2 GÜVENLİ DELETE — tek besin kaydını sil
-- Silmeden ÖNCE sahiplik doğrulanır. Alt sorgu 0 satır dönerse DELETE çalışmaz.
-- -----------------------------------------------------------------------------
DELETE FROM meal_items
WHERE id = $1::int
  AND meal_id IN (
      SELECT id FROM meals WHERE user_id = $2::int
  )
RETURNING id, meal_id, quantity_grams, calories;


-- -----------------------------------------------------------------------------
-- C.3 Öğüne ait TÜM kayıtları sil (öğünü boşalt)
-- meal_items ON DELETE CASCADE olduğu için öğün silinirse kayıtlar da silinir;
-- ancak burada yalnızca içeriği boşaltmak istediğimiz için CASCADE kullanılmaz.
-- -----------------------------------------------------------------------------
DELETE FROM meal_items
WHERE meal_id = $1::int
  AND meal_id IN (SELECT id FROM meals WHERE user_id = $2::int)
RETURNING id;


-- -----------------------------------------------------------------------------
-- C.4 Öğün başlığını oluştur veya getir (upsert)
-- meals_user_date_type_uidx sayesinde aynı gün aynı öğün türü tek kalır.
-- -----------------------------------------------------------------------------
INSERT INTO meals (user_id, meal_date, meal_type, notes)
VALUES ($1::int, $2::date, $3::text, $4::text)
ON CONFLICT (user_id, meal_date, meal_type)
DO UPDATE SET notes = coalesce(EXCLUDED.notes, meals.notes)
RETURNING id, user_id, meal_date, meal_type, notes, created_at;


-- -----------------------------------------------------------------------------
-- C.5 Süresi dolmuş / iptal edilmiş oturumları temizle (bakım)
-- -----------------------------------------------------------------------------
DELETE FROM sessions
WHERE expires_at < now() OR revoked_at IS NOT NULL
RETURNING session_id;


-- -----------------------------------------------------------------------------
-- C.6 TEST İÇİN ÖRNEK VERİ AKIŞI
-- (Gerçek seed verisi database/seed.sql içindedir. Aşağısı manuel deneme.)
--
-- BEGIN;
--   -- 1) Kullanıcı (parola hash'i bcrypt ile üretilir, asla düz metin saklanmaz)
--   INSERT INTO users (email, password_hash, name, age, biological_sex,
--                      height_cm, weight_kg, activity_level, goal)
--   VALUES ('ornek@example.com', '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH',
--           'Örnek Kullanıcı', 34, 'female', 165, 62, 'moderately_active', 'maintain')
--   RETURNING id;                       -- diyelim ki 1
--
--   -- 2) Öğün başlığı
--   INSERT INTO meals (user_id, meal_date, meal_type)
--   VALUES (1, CURRENT_DATE, 'lunch')
--   ON CONFLICT (user_id, meal_date, meal_type) DO NOTHING
--   RETURNING id;                        -- diyelim ki 1
--
--   -- 3) 150 g pişmiş mercimek ekle (değerler SQL'de hesaplanır)
--   --    B.3'teki INSERT ... SELECT ifadesini $1=1, $2=1, $3=150, $4=<mercimek id>
--   --    ile çalıştırın.
--
--   -- 4) Sonucu doğrula
--   SELECT * FROM v_daily_totals WHERE user_id = 1 AND log_date = CURRENT_DATE;
--   SELECT * FROM v_meal_item_drift;      -- boş dönmeli
-- ROLLBACK;
-- -----------------------------------------------------------------------------


-- #############################################################################
-- BÖLÜM D — DENETİM SORGULARI
-- #############################################################################

-- -----------------------------------------------------------------------------
-- D.1 Snapshot tutarlılığı denetimi — boş dönmelidir
-- -----------------------------------------------------------------------------
SELECT * FROM v_meal_item_drift;

-- -----------------------------------------------------------------------------
-- D.2 Bayatlamış haftalık raporlar
-- -----------------------------------------------------------------------------
SELECT weekly_report_id, user_id, week_start, data_as_of, live_max_updated, is_stale
FROM v_weekly_report_freshness
WHERE is_stale
ORDER BY user_id, week_start;

-- -----------------------------------------------------------------------------
-- D.3 Kaynağı belirsiz veya doğrulanmamış besinler
-- -----------------------------------------------------------------------------
SELECT id, name, state, source_name, source_url, data_quality
FROM foods
WHERE data_quality IN ('unverified', 'secondary')
ORDER BY data_quality, name;

-- -----------------------------------------------------------------------------
-- D.4 Besin verisi fiziksel tutarlılık kontrolü
-- Atwater'a göre beklenen enerji ile kayıtlı enerji arasındaki büyük farklar
-- yanlış veri girişini işaret eder.
-- -----------------------------------------------------------------------------
SELECT
    id, name, state,
    calories_per_100g AS stored_kcal,
    round(4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g, 2) AS atwater_kcal,
    round(calories_per_100g /
          nullif(4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g, 0), 3) AS ratio
FROM foods
WHERE calories_per_100g > 5
ORDER BY ratio NULLS LAST;

-- -----------------------------------------------------------------------------
-- D.5 Kullanıcı başına kayıt hacmi (veri kapsamı özeti)
-- -----------------------------------------------------------------------------
SELECT
    u.id AS user_id,
    u.name,
    count(DISTINCT m.meal_date) AS logged_days,
    min(m.meal_date)            AS first_logged_day,
    max(m.meal_date)            AS last_logged_day,
    count(mi.id)                AS total_items
FROM users u
LEFT JOIN meals m      ON m.user_id = u.id
LEFT JOIN meal_items mi ON mi.meal_id = m.id
GROUP BY u.id, u.name
ORDER BY u.id;

-- =============================================================================
-- SON
-- =============================================================================
