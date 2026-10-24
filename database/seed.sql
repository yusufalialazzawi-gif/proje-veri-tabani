-- =============================================================================
-- Kalori ve Besin Takip Sistemi — Başlangıç Besin Verisi (seed)
-- =============================================================================
-- VERİ KAYNAĞI
--   USDA FoodData Central, "SR Legacy" veri kümesi (2018-04 sürümü;
--   kayıt yayın tarihi 2019-04-01).
--   Erişim: https://fdc.nal.usda.gov/download-datasets
--            (FoodData_Central_sr_legacy_food_csv_2018-04.zip)
--   Çevrimiçi doğrulama: https://fdc.nal.usda.gov/fdc-app.html#/food-details/<fdcId>/nutrients
--
-- Bu dosyadaki TÜM besin değerleri yukarıdaki CSV'den (food.csv +
-- food_nutrient.csv) alınmıştır; tahmin veya yuvarlama dışında değiştirilmemiştir.
-- Yuvarlama: veritabanı kolonları NUMERIC(8,2) olduğu için USDA'nın 3 ondalıklı
-- değerleri 2 ondalığa yuvarlanmıştır (ör. doymuş yağ 3.267 -> 3.27).
--
-- ÇALIŞTIRMA (schema.sql'den SONRA):
--   psql -U postgres -d nutrition_tracker -v ON_ERROR_STOP=1 -f database/seed.sql
--
-- İDEMPOTENT: ON CONFLICT DO NOTHING ile tekrar çalıştırılabilir, mevcut kayıtlar
-- ezilmez. (Kullanıcının sonradan düzelttiği bir besin değeri kaybolmaz.)
--
-- ÖNEMLİ KURALLAR
--   1. *_per_100g kolonları HER ZAMAN 100 g yenilebilir kısım içindir.
--      source_basis='per_100g' çünkü USDA SR Legacy 100 g üzerinden raporlar.
--      portion_grams/portion_unit yalnızca kullanıcıya kolaylık içindir ve
--      USDA'nın food_portion.csv kayıtlarından alınmıştır; hesaba katılmaz.
--   2. ÇİĞ ile PİŞMİŞ değer karıştırılmaz: her kayıtta `state` alanı ve
--      USDA tanımının tam çevirisi source_note içinde saklanır.
--   3. İLAVE ŞEKER: SR Legacy "Sugars, added" (nutrient 1235) alanını bu
--      kayıtlar için DOLDURMAMIŞTIR. Bu yüzden:
--        * Tek bileşenli, hiçbir şey eklenmemiş besinlerde (çiğ meyve/sebze,
--          tuzsuz haşlanmış baklagil, sade yoğurt, zeytinyağı ...) ilave şeker
--          tanım gereği 0.00 olarak kaydedilmiştir.
--        * Karışım/ticari ürün olan "Ekmek, tam buğday" için ilave şeker
--          BİLİNMİYOR kabul edilmiş ve NULL bırakılmıştır.
--      NULL ile 0 asla birbirine karıştırılmaz; NULL değeri olan bir besin
--      eklendiğinde günlük ilave şeker toplamı "eksik" (added_sugars_incomplete)
--      olarak işaretlenir ve haftalık ilave şeker ortalaması hiç gösterilmez.
-- =============================================================================

BEGIN;

-- Kategori sözlüğü schema.sql içinde oluşturulur. Burada yalnızca besinler eklenir.
-- (Aynı verinin iki dosyada tutulması tutarsızlık riski yaratır.)

INSERT INTO foods (
    name, category_id,
    calories_per_100g, protein_per_100g, carbohydrates_per_100g,
    total_sugars_per_100g, added_sugars_per_100g,
    fat_per_100g, saturated_fat_per_100g, fiber_per_100g,
    portion_grams, portion_unit, state,
    is_vegetable, is_fruit, is_legume,
    source_name, source_url, source_food_id,
    source_basis, source_portion_grams, data_quality, source_note
)
SELECT
    s.name,
    c.id,
    s.calories_per_100g, s.protein_per_100g, s.carbohydrates_per_100g,
    s.total_sugars_per_100g, s.added_sugars_per_100g,
    s.fat_per_100g, s.saturated_fat_per_100g, s.fiber_per_100g,
    s.portion_grams, s.portion_unit, s.state,
    s.is_vegetable, s.is_fruit, s.is_legume,
    'USDA FoodData Central — SR Legacy (2018-04)',
    'https://fdc.nal.usda.gov/fdc-app.html#/food-details/' || s.source_food_id || '/nutrients',
    s.source_food_id,
    'per_100g',
    NULL,
    'usda_fdc',
    s.source_note
FROM (VALUES
    -- ------------------------------------------------------------------ Yumurta
    ('Yumurta, haşlanmış (katı)',
     'Yumurta',
     155.00, 12.58, 1.12, 1.12, 0.00, 10.61, 3.27, 0.00,
     50.00, 'adet (büyük)', 'cooked', FALSE, FALSE, FALSE,
     '173424',
     'USDA: "Egg, whole, cooked, hard-boiled". PİŞMİŞ değer; çiğ yumurta farklıdır. Porsiyon: USDA food_portion seq 3 = 1 large = 50 g. Toplam şeker 1.12 g yumurtanın kendi glikozudur, ilave şeker değildir.'),

    -- ------------------------------------------------------- Süt ve süt ürünleri
    ('Süt, tam yağlı (%3,25 yağ), D vitamini eklenmiş',
     'Süt ve süt ürünleri',
     61.00, 3.15, 4.80, 5.05, 0.00, 3.25, 1.87, 0.00,
     244.00, 'su bardağı', 'unspecified', FALSE, FALSE, FALSE,
     '171265',
     'USDA: "Milk, whole, 3.25% milkfat, with added vitamin D". Porsiyon: USDA food_portion seq 1 = 1 cup = 244 g. NOT: USDA toplam şekeri (5.05 g) doğrudan analizle, karbonhidratı (4.80 g) fark yöntemiyle hesapladığı için şeker karbonhidrattan büyüktür; bu USDA verisinin kendi tutarlılığıdır, şemadaki foods_sugar_within_carb kısıtı bu yüzden 1.00 g tolerans içerir. Toplam şeker laktozdur; ilave şeker yoktur (yalnızca D vitamini eklenmiştir). Pişirme durumu belirtilmediği için state=unspecified.'),

    ('Yoğurt, sade, tam yağlı',
     'Süt ve süt ürünleri',
     61.00, 3.47, 4.66, 4.66, 0.00, 3.25, 2.10, 0.00,
     170.00, 'kase (170 g)', 'unspecified', FALSE, FALSE, FALSE,
     '171284',
     'USDA: "Yogurt, plain, whole milk". SADE yoğurt; meyveli/tatlandırılmış yoğurt farklı bir kayıttır ve ilave şeker içerir. Porsiyon: USDA food_portion seq 1 = container (6 oz) = 170 g. Toplam şeker laktozdur.'),

    -- ------------------------------------------------- Et ve kümes hayvanları
    ('Tavuk göğsü, derisiz, fırında pişmiş',
     'Et ve kümes hayvanları',
     165.00, 31.02, 0.00, 0.00, 0.00, 3.57, 1.01, 0.00,
     86.00, 'porsiyon (½ göğüs)', 'cooked', FALSE, FALSE, FALSE,
     '171477',
     'USDA: "Chicken, broilers or fryers, breast, meat only, cooked, roasted". PİŞMİŞ ve YALNIZCA ET değeri; derili veya çiğ kayıt farklıdır. Porsiyon: USDA food_portion seq 3 = 0.5 breast, bone and skin removed = 86 g.'),

    -- ------------------------------------------------- Balık ve deniz ürünleri
    ('Somon, çiftlik, pişmiş',
     'Balık ve deniz ürünleri',
     206.00, 22.10, 0.00, 0.00, 0.00, 12.35, 2.40, 0.00,
     85.00, 'porsiyon (85 g)', 'cooked', FALSE, FALSE, FALSE,
     '175168',
     'USDA: "Fish, salmon, Atlantic, farmed, cooked, dry heat". ÇİFTLİK somonu ve PİŞMİŞ; yabani veya çiğ somon farklı değerlere sahiptir. Porsiyon: USDA food_portion seq 1 = 3 oz = 85 g.'),

    -- ------------------------------------------------------------ Kuru baklagiller
    ('Mercimek, pişmiş (haşlanmış, tuzsuz)',
     'Kuru baklagiller',
     116.00, 9.02, 20.13, 1.80, 0.00, 0.38, 0.05, 7.90,
     198.00, 'su bardağı', 'boiled', FALSE, FALSE, TRUE,
     '172421',
     'USDA: "Lentils, mature seeds, cooked, boiled, without salt". PİŞMİŞ değer; kuru mercimek (FDC 172420, 352 kcal/100 g) ile karıştırılmamalıdır. Porsiyon: USDA food_portion seq 1 = 1 cup = 198 g. Karbonhidrat USDA convention''ında lifi içerir (7.90 g lif, 20.13 g karbonhidratın içindedir).'),

    ('Nohut, pişmiş (haşlanmış, tuzsuz)',
     'Kuru baklagiller',
     164.00, 8.86, 27.42, 4.80, 0.00, 2.59, 0.27, 7.60,
     164.00, 'su bardağı', 'boiled', FALSE, FALSE, TRUE,
     '173757',
     'USDA: "Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt". PİŞMİŞ değer. Porsiyon: USDA food_portion seq 1 = 1 cup = 164 g. Konserve nohut tuz içeriği açısından farklıdır; makro besinler benzer kabul edilir.'),

    ('Kuru fasulye, pişmiş (haşlanmış, tuzsuz)',
     'Kuru baklagiller',
     127.00, 8.67, 22.80, 0.32, 0.00, 0.50, 0.07, 6.40,
     177.00, 'su bardağı', 'boiled', FALSE, FALSE, TRUE,
     '173740',
     'USDA: "Beans, kidney, all types, mature seeds, cooked, boiled, without salt". PİŞMİŞ değer. Porsiyon: USDA food_portion seq 1 = 1 cup = 177 g.'),

    -- ----------------------------------------------- Tahıllar ve tahıl ürünleri
    ('Pirinç, beyaz, pişmiş',
     'Tahıllar ve tahıl ürünleri',
     130.00, 2.69, 28.17, 0.05, 0.00, 0.28, 0.08, 0.40,
     158.00, 'su bardağı', 'boiled', FALSE, FALSE, FALSE,
     '168935',
     'USDA: "Rice, white, long-grain, regular, cooked, unenriched, with salt". PİŞMİŞ değer; kuru pirinç (FDC 169756, 365 kcal/100 g) ile karıştırılmamalıdır. SR Legacy''de tuzsuz pişmiş uzun taneli beyaz pirinç kaydı yoktur; eklenen tuz makro besinleri ve enerjiyi değiştirmez. Porsiyon: USDA food_portion seq 1 = 1 cup = 158 g.'),

    ('Bulgur, pişmiş',
     'Tahıllar ve tahıl ürünleri',
     83.00, 3.08, 18.58, 0.10, 0.00, 0.24, 0.04, 4.50,
     182.00, 'su bardağı', 'boiled', FALSE, FALSE, FALSE,
     '170287',
     'USDA: "Bulgur, cooked". PİŞMİŞ değer; kuru bulgur (FDC 170688, 342 kcal/100 g) farklı kayıttır. Porsiyon: USDA food_portion seq 1 = 1 cup = 182 g.'),

    ('Yulaf, kuru (sade, fortifiye edilmemiş)',
     'Tahıllar ve tahıl ürünleri',
     379.00, 13.15, 67.70, 0.99, 0.00, 6.52, 1.11, 10.10,
     81.00, 'su bardağı', 'dried', FALSE, FALSE, FALSE,
     '173904',
     'USDA: "Cereals, oats, regular and quick, not fortified, dry". KURU değer; pişmiş yulaf lapası su içeriği nedeniyle çok daha düşük enerji yoğunluğuna sahiptir. Porsiyon: USDA food_portion seq 1 = 1 cup = 81 g.'),

    ('Ekmek, tam buğday',
     'Tahıllar ve tahıl ürünleri',
     274.00, 10.67, 47.54, 5.73, NULL, 4.53, 0.70, 4.00,
     29.00, 'dilim', 'cooked', FALSE, FALSE, FALSE,
     '172686',
     'USDA: "Bread, wheat". Ticari/karışım bir ürün olduğu için İLAVE ŞEKER BİLİNMİYOR (NULL); SR Legacy bu kayıt için "Sugars, added" verisi içermez. Toplam şeker 5.73 g''ın ne kadarının ilave olduğu belirlenemez. Porsiyon: USDA food_portion seq 1 = 1 slice = 29 g. Markalar arasında belirgin fark vardır.'),

    -- ------------------------------------------------------------------- Meyveler
    ('Elma, çiğ, kabuklu',
     'Meyveler',
     52.00, 0.26, 13.81, 10.39, 0.00, 0.17, 0.03, 2.40,
     182.00, 'adet (orta, ~7,5 cm)', 'raw', FALSE, TRUE, FALSE,
     '171688',
     'USDA: "Apples, raw, with skin (Includes foods for USDA''s Food Distribution Program)". ÇİĞ ve KABUKLU; kabuğu soyulmuş elma farklı lif değerine sahiptir. Toplam şeker meyvenin kendi fruktozudur, WHO "serbest şeker" tanımına BÜTÜN meyve girmez (meyve suyu girer). Porsiyon: USDA food_portion seq 4 = medium (3" dia) = 182 g.'),

    ('Muz, çiğ',
     'Meyveler',
     89.00, 1.09, 22.84, 12.23, 0.00, 0.33, 0.11, 2.60,
     118.00, 'adet (orta, ~18 cm)', 'raw', FALSE, TRUE, FALSE,
     '173944',
     'USDA: "Bananas, raw". ÇİĞ değer. Toplam şeker meyvenin kendi şekeridir; ilave şeker yoktur. Porsiyon: USDA food_portion seq 5 = medium (7" to 7-7/8" long) = 118 g.'),

    -- ------------------------------------------------------------------ Sebzeler
    ('Domates, çiğ',
     'Sebzeler',
     18.00, 0.88, 3.89, 2.63, 0.00, 0.20, 0.03, 1.20,
     123.00, 'adet (orta, ~6,5 cm)', 'raw', TRUE, FALSE, FALSE,
     '170457',
     'USDA: "Tomatoes, red, ripe, raw, year round average". ÇİĞ ve KIRMIZI olgun domates; yıl ortalaması. Porsiyon: USDA food_portion seq 6 = medium whole (2-3/5" dia) = 123 g.'),

    ('Salatalık, kabuklu, çiğ',
     'Sebzeler',
     15.00, 0.65, 3.63, 1.67, 0.00, 0.11, 0.04, 0.50,
     52.00, 'porsiyon (½ su bardağı)', 'raw', TRUE, FALSE, FALSE,
     '168409',
     'USDA: "Cucumber, with peel, raw". ÇİĞ ve KABUKLU. Porsiyon: USDA food_portion seq 1 = 0.5 cup slices = 52 g (bir bütün salatalık 301 g''dır; pratik porsiyon olarak dilim ölçüsü kullanıldı).'),

    ('Brokoli, pişmiş (haşlanmış, süzülmüş, tuzsuz)',
     'Sebzeler',
     35.00, 2.38, 7.18, 1.39, 0.00, 0.41, 0.08, 3.30,
     156.00, 'su bardağı (doğranmış)', 'boiled', TRUE, FALSE, FALSE,
     '169967',
     'USDA: "Broccoli, cooked, boiled, drained, without salt". PİŞMİŞ değer; çiğ brokoli (FDC 170379) farklıdır. Porsiyon: USDA food_portion seq 1 = 0.5 cup chopped = 78 g, dolayısıyla 1 cup = 156 g.'),

    -- ---------------------------------------------------------------------- Yağlar
    ('Zeytinyağı',
     'Yağlar',
     884.00, 0.00, 0.00, 0.00, 0.00, 100.00, 13.81, 0.00,
     13.50, 'yemek kaşığı', 'unspecified', FALSE, FALSE, FALSE,
     '171413',
     'USDA: "Oil, olive, salad or cooking". %100 yağ: protein ve karbonhidrat 0, bu yüzden Atwater hesabı 4*0+4*0+9*100=900 kcal verirken USDA 884 kcal raporlar (oran 0.98, foods_energy_plausible aralığı içinde). Porsiyon: USDA food_portion seq 1 = 1 tablespoon = 13.5 g. Enerji yoğunluğu çok yüksek olduğu için miktar girişinde dikkat gerektirir.')

) AS s(
    name, category_name,
    calories_per_100g, protein_per_100g, carbohydrates_per_100g,
    total_sugars_per_100g, added_sugars_per_100g,
    fat_per_100g, saturated_fat_per_100g, fiber_per_100g,
    portion_grams, portion_unit, state,
    is_vegetable, is_fruit, is_legume,
    source_food_id, source_note
)
JOIN food_categories c ON c.name = s.category_name
ON CONFLICT DO NOTHING;


-- =============================================================================
-- DOĞRULAMA SORGULARI (elle çalıştırılır; seed'in doğru yüklendiğini denetler)
-- =============================================================================

-- 1) Kaç besin yüklendi? (Beklenen: 18)
--    SELECT count(*) AS food_count FROM foods;

-- 2) Kategori dağılımı
--    SELECT c.name, count(f.id) AS foods
--      FROM food_categories c LEFT JOIN foods f ON f.category_id = c.id
--     GROUP BY c.name ORDER BY c.name;

-- 3) Atwater tutarlılığı: enerji / (4P + 4K + 9Y) oranı.
--    Gerçek besin verisinde 0.80-1.10 arası normaldir (su, kül, organik asitler).
--    SELECT name,
--           calories_per_100g AS kcal,
--           round(4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g, 1) AS atwater,
--           round(calories_per_100g /
--                 nullif(4*protein_per_100g + 4*carbohydrates_per_100g + 9*fat_per_100g, 0), 3) AS ratio
--      FROM foods ORDER BY ratio;

-- 4) İlave şekeri BİLİNMEYEN (NULL) besinler — haftalık ilave şeker ortalamasını
--    "eksik" işaretleyen kayıtlar bunlardır.
--    SELECT name, total_sugars_per_100g, added_sugars_per_100g, source_note
--      FROM foods WHERE added_sugars_per_100g IS NULL;

-- 5) Sebze / meyve / baklagil bayrakları doğru mu?
--    SELECT name, state, is_vegetable, is_fruit, is_legume
--      FROM foods
--     WHERE is_vegetable OR is_fruit OR is_legume
--     ORDER BY is_legume DESC, is_vegetable DESC, is_fruit DESC, name;

-- 6) Ölçekleme formülünün elle kontrolü (prompt md. 6 örneği: 150 g pişmiş mercimek)
--    Beklenen: 116 * 150/100 = 174.00 kcal, lif 7.90 * 1.5 = 11.85 g
--    SELECT f.name,
--           fn_scale_per_100g(f.calories_per_100g, 150) AS kcal_150g,
--           fn_scale_per_100g(f.fiber_per_100g, 150)    AS fiber_150g
--      FROM foods f WHERE f.source_food_id = '172421';

COMMIT;
