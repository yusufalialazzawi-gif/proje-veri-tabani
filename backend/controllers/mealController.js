'use strict';

const mealService = require('../services/mealService');
const { createValidator, todayLocal, parseDateOnly } = require('../lib/validate');
const { ValidationError, BadRequestError } = require('../lib/errors');
const { asyncHandler } = require('../lib/asyncHandler');
const { queryOne } = require('../db');

/**
 * v_daily_totals satırını arayüzün kullandığı camelCase biçime çevirir.
 * Sayılar SQL'de hesaplanır; burada yalnızca adlandırma değişir.
 */
function mapTotals(totals, date) {
  if (!totals) return null;
  return {
    date: date ?? totals.log_date,
    itemCount: totals.item_count,
    calories: totals.calories,
    protein: totals.protein,
    carbohydrates: totals.carbohydrates,
    totalSugars: totals.total_sugars,
    addedSugarsKnownSum: totals.added_sugars_known_sum,
    addedSugarsIncomplete: totals.added_sugars_incomplete,
    itemsMissingAddedSugars: totals.items_missing_added_sugars,
    fat: totals.fat,
    saturatedFat: totals.saturated_fat,
    fiber: totals.fiber,
    vegetableGrams: totals.vegetable_grams,
    fruitGrams: totals.fruit_grams,
    legumeGrams: totals.legume_grams,
    vegetableServings: totals.vegetable_servings,
    fruitServings: totals.fruit_servings,
    legumeServings: totals.legume_servings,
  };
}

/**
 * Bir öğünün ait olduğu gün için güncel toplamları döner.
 * Ekleme/güncelleme/silme sonrası arayüzün gün özetini tazelemesi için kullanılır;
 * sahiplik sorguda doğrulanır.
 */
async function getDailySnapshot(userId, mealId) {
  const meal = await queryOne(
    'SELECT meal_date FROM meals WHERE id = $1::int AND user_id = $2::int',
    [mealId, userId],
  );
  if (!meal) return null;
  const totals = await mealService.getDailyTotals(userId, meal.meal_date);
  return mapTotals(totals, meal.meal_date);
}

/**
 * GET /api/meals?date=YYYY-MM-DD
 * Günün dört öğün başlığını ve içindekileri döner. Hiç başlık yoksa boş
 * listeler döner; ayrıca günlük toplamlar (varsa) eklenir.
 */
const listMeals = asyncHandler(async (req, res) => {
  const rawDate = req.query.date ? String(req.query.date) : todayLocal();
  const date = parseDateOnly(rawDate);
  if (!date) {
    throw new BadRequestError('date parametresi YYYY-MM-DD biçiminde geçerli bir tarih olmalıdır.');
  }

  const [meals, totals] = await Promise.all([
    mealService.listMealsForDate(req.user.id, date),
    mealService.getDailyTotals(req.user.id, date),
  ]);

  res.json({
    date,
    meals,
    totals: mapTotals(totals, date),
    // Kayıt yoksa "sıfır tüketim" DEĞİL, "kayıt yok" olarak işaretlenir.
    hasData: totals !== null,
  });
});

/** POST /api/meals — öğün başlığı oluşturur (varsa mevcut olanı döner). */
const createMeal = asyncHandler(async (req, res) => {
  const v = createValidator(req.body ?? {});
  v.date('mealDate', { required: false, defaultValue: todayLocal() });
  v.enum('mealType', mealService.MEAL_TYPES, { required: true });
  v.string('notes', { required: false, max: 1000, emptyAsNull: true });

  if (!v.ok) throw new ValidationError('Öğün bilgileri doğrulanamadı.', v.errors);

  const meal = await mealService.ensureMeal(
    req.user.id,
    v.values.mealDate,
    v.values.mealType,
    v.values.notes,
  );

  res.status(201).json({
    meal: {
      id: meal.id,
      mealDate: meal.meal_date,
      mealType: meal.meal_type,
      label: mealService.MEAL_TYPE_LABELS[meal.meal_type],
      notes: meal.notes,
    },
  });
});

/**
 * POST /api/meals/:id/items — öğüne besin ekler.
 * Besin değerleri SQL tarafında fn_scale_per_100g() ile hesaplanır.
 */
const addMealItem = asyncHandler(async (req, res) => {
  const v = createValidator({ ...req.params, ...(req.body ?? {}) });
  v.int('id', { required: true, min: 1 });
  v.int('foodId', { required: true, min: 1 });
  v.number('quantityGrams', { required: true, min: 0.1, max: 10000, decimals: 2 });

  if (!v.ok) throw new ValidationError('Besin kaydı doğrulanamadı.', v.errors);

  const item = await mealService.addItemToMeal(
    req.user.id,
    v.values.id,
    v.values.foodId,
    v.values.quantityGrams,
  );

  // Günlük toplamları da döner; arayüz ayrı bir istek atmak zorunda kalmaz.
  const daily = await getDailySnapshot(req.user.id, item.mealId);
  res.status(201).json({ item, daily });
});

/** PUT /api/meal-items/:id — tüketilen miktarı günceller. */
const updateMealItem = asyncHandler(async (req, res) => {
  const v = createValidator({ ...req.params, ...(req.body ?? {}) });
  v.int('id', { required: true, min: 1 });
  v.number('quantityGrams', { required: true, min: 0.1, max: 10000, decimals: 2 });

  if (!v.ok) throw new ValidationError('Miktar güncellenemedi.', v.errors);

  const item = await mealService.updateMealItem(req.user.id, v.values.id, v.values.quantityGrams);
  const daily = await getDailySnapshot(req.user.id, item.mealId);
  res.json({ item, daily, message: 'Miktar güncellendi.' });
});

/** DELETE /api/meal-items/:id — besin kaydını siler. */
const deleteMealItem = asyncHandler(async (req, res) => {
  const v = createValidator(req.params);
  v.int('id', { required: true, min: 1 });
  if (!v.ok) throw new ValidationError('Kayıt kimliği geçersiz.', v.errors);

  const result = await mealService.deleteMealItem(req.user.id, v.values.id);
  // Silme sonrası günün yeni toplamı döner; arayüz yeniden istek atmaz.
  const daily = await getDailySnapshot(req.user.id, result.mealId);

  res.json({
    deleted: result.deleted,
    id: result.id,
    mealId: result.mealId,
    daily,
    message: 'Besin kaydı silindi.',
  });
});

module.exports = {
  listMeals,
  createMeal,
  addMealItem,
  updateMealItem,
  deleteMealItem,
};
