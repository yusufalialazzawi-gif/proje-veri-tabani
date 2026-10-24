'use strict';

/**
 * Öğün ve besin kaydı servisi.
 *
 * Besin değerleri JS'te hesaplanmaz. fn_scale_per_100g() SQL fonksiyonu
 * kullanılır; böylece ölçekleme formülü (tüketilen gram / 100 × 100 g değeri)
 * projede TEK bir yerde tanımlı kalır.
 *
 * SAHİPLİK: her yazma işlemi meals.user_id üzerinden doğrulanır. Başka
 * kullanıcının öğünü veya kaydı üzerinde işlem yapılamaz; eşleşme olmazsa
 * 0 satır etkilenir ve NotFoundError döner.
 */

const { query, queryOne } = require('../db');
const { NotFoundError, ValidationError } = require('../lib/errors');
const { validateQuantityGrams } = require('../lib/validate');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

const MEAL_TYPE_LABELS = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle yemeği',
  dinner: 'Akşam yemeği',
  snack: 'Ara öğün',
};

const MEAL_ORDER_SQL = `
  CASE m.meal_type
    WHEN 'breakfast' THEN 1
    WHEN 'lunch'     THEN 2
    WHEN 'dinner'    THEN 3
    WHEN 'snack'     THEN 4
  END
`;

/**
 * Belirli bir günün öğünlerini ve içindekileri tek sorguda getirir (N+1 yok).
 * Hiç kayıt yoksa dört boş öğün başlığı yine de döner; arayüz listeyi kurabilir.
 */
async function listMealsForDate(userId, date) {
  const result = await query(
    `SELECT
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
        f.source_name     AS food_source_name,
        f.data_quality    AS food_data_quality,
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
    WHERE m.user_id = $1
      AND m.meal_date = $2
    ORDER BY ${MEAL_ORDER_SQL}, m.id, mi.id`,
    [userId, date],
  );

  const byType = new Map(MEAL_TYPES.map((t) => [t, { mealType: t, label: MEAL_TYPE_LABELS[t], mealId: null, notes: null, items: [] }]));

  for (const row of result.rows) {
    const bucket = byType.get(row.meal_type);
    if (!bucket) continue;
    bucket.mealId = row.meal_id;
    bucket.mealDate = row.meal_date;
    bucket.notes = row.notes;
    if (row.meal_item_id !== null) {
      bucket.items.push({
        id: row.meal_item_id,
        foodId: row.food_id,
        foodName: row.food_name,
        foodState: row.food_state,
        portionGrams: row.food_portion_grams,
        portionUnit: row.food_portion_unit,
        sourceName: row.food_source_name,
        dataQuality: row.food_data_quality,
        quantityGrams: row.quantity_grams,
        calories: row.calories,
        protein: row.protein,
        carbohydrates: row.carbohydrates,
        totalSugars: row.total_sugars,
        addedSugars: row.added_sugars,
        fat: row.fat,
        saturatedFat: row.saturated_fat,
        fiber: row.fiber,
      });
    }
  }

  return MEAL_TYPES.map((t) => byType.get(t));
}

/** Öğün başlığını oluşturur veya mevcut olanı döner (upsert). */
async function ensureMeal(userId, date, mealType, notes = null) {
  if (!MEAL_TYPES.includes(mealType)) {
    throw new ValidationError('Geçersiz öğün türü.', {
      field: 'mealType',
      allowed: MEAL_TYPES,
    });
  }

  const row = await queryOne(
    `INSERT INTO meals (user_id, meal_date, meal_type, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, meal_date, meal_type)
     DO UPDATE SET notes = coalesce(EXCLUDED.notes, meals.notes)
     RETURNING id, user_id, meal_date, meal_type, notes, created_at`,
    [userId, date, mealType, notes],
  );

  return row;
}

/**
 * Öğüne besin ekler.
 * Değerler SQL tarafında fn_scale_per_100g() ile hesaplanır.
 */
async function addItemToMeal(userId, mealId, foodId, rawQuantity) {
  const quantityCheck = validateQuantityGrams(rawQuantity);
  if (!quantityCheck.ok) {
    throw new ValidationError(quantityCheck.message, { field: 'quantityGrams' });
  }
  const quantityGrams = quantityCheck.value;

  // Besin var mı? (Yoksa INSERT 0 satır döner ve hata ayırt edilemez.)
  const food = await queryOne('SELECT id, name FROM foods WHERE id = $1', [foodId]);
  if (!food) {
    throw new NotFoundError('Besin bulunamadı.');
  }

  const inserted = await queryOne(
    `WITH owned_meal AS (
         SELECT id FROM meals WHERE id = $1 AND user_id = $2
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
         meal_items.id AS meal_item_id, meal_items.meal_id, meal_items.food_id,
         meal_items.quantity_grams, meal_items.calories, meal_items.protein,
         meal_items.carbohydrates, meal_items.total_sugars, meal_items.added_sugars,
         meal_items.fat, meal_items.saturated_fat, meal_items.fiber`,
    [mealId, userId, quantityGrams, foodId],
  );

  if (!inserted) {
    // Besin var ama öğün yok ya da başka kullanıcıya ait.
    throw new NotFoundError('Öğün bulunamadı veya bu öğüne erişim yetkiniz yok.');
  }

  return {
    id: inserted.meal_item_id,
    mealId: inserted.meal_id,
    foodId: inserted.food_id,
    foodName: food.name,
    quantityGrams: inserted.quantity_grams,
    calories: inserted.calories,
    protein: inserted.protein,
    carbohydrates: inserted.carbohydrates,
    totalSugars: inserted.total_sugars,
    addedSugars: inserted.added_sugars,
    fat: inserted.fat,
    saturatedFat: inserted.saturated_fat,
    fiber: inserted.fiber,
  };
}

/** Tüketilen miktarı günceller; besin değerleri yeniden hesaplanır. */
async function updateMealItem(userId, itemId, rawQuantity) {
  const quantityCheck = validateQuantityGrams(rawQuantity);
  if (!quantityCheck.ok) {
    throw new ValidationError(quantityCheck.message, { field: 'quantityGrams' });
  }
  const quantityGrams = quantityCheck.value;

  const row = await queryOne(
    `UPDATE meal_items mi
        SET quantity_grams = $3::numeric,
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
      RETURNING mi.id, mi.meal_id, mi.food_id, mi.quantity_grams, mi.calories,
                mi.protein, mi.carbohydrates, mi.total_sugars, mi.added_sugars,
                mi.fat, mi.saturated_fat, mi.fiber, f.name AS food_name`,
    [itemId, userId, quantityGrams],
  );

  if (!row) throw new NotFoundError('Besin kaydı bulunamadı veya güncelleme yetkiniz yok.');

  return {
    id: row.id,
    mealId: row.meal_id,
    foodId: row.food_id,
    foodName: row.food_name,
    quantityGrams: row.quantity_grams,
    calories: row.calories,
    protein: row.protein,
    carbohydrates: row.carbohydrates,
    totalSugars: row.total_sugars,
    addedSugars: row.added_sugars,
    fat: row.fat,
    saturatedFat: row.saturated_fat,
    fiber: row.fiber,
  };
}

/** Tek bir besin kaydını siler (sahiplik doğrulanır). */
async function deleteMealItem(userId, itemId) {
  const row = await queryOne(
    `DELETE FROM meal_items
      WHERE id = $1::int
        AND meal_id IN (SELECT id FROM meals WHERE user_id = $2::int)
      RETURNING id, meal_id, quantity_grams, calories`,
    [itemId, userId],
  );

  if (!row) throw new NotFoundError('Besin kaydı bulunamadı veya silme yetkiniz yok.');
  return { deleted: true, id: row.id, mealId: row.meal_id };
}

/** Bir günün toplam besin değerleri (v_daily_totals görünümünden). */
async function getDailyTotals(userId, date) {
  return queryOne(
    `SELECT user_id, log_date, item_count, total_grams,
            calories, protein, carbohydrates, total_sugars,
            added_sugars_known_sum, items_missing_added_sugars, added_sugars_incomplete,
            fat, saturated_fat, fiber,
            vegetable_grams, fruit_grams, legume_grams,
            vegetable_servings, fruit_servings, legume_servings
       FROM v_daily_totals
      WHERE user_id = $1 AND log_date = $2`,
    [userId, date],
  );
}

module.exports = {
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  listMealsForDate,
  ensureMeal,
  addItemToMeal,
  updateMealItem,
  deleteMealItem,
  getDailyTotals,
};
