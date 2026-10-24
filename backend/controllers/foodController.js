'use strict';

const foodService = require('../services/foodService');
const { createValidator } = require('../lib/validate');
const { ValidationError, ForbiddenError } = require('../lib/errors');
const { asyncHandler } = require('../lib/asyncHandler');

const DATA_QUALITY_VALUES = [
  'usda_fdc',
  'national_composition_table',
  'label',
  'secondary',
  'unverified',
];
const STATE_VALUES = ['raw', 'cooked', 'boiled', 'dried', 'unspecified'];
const SOURCE_BASIS_VALUES = ['per_100g', 'per_portion'];

/** GET /api/foods — arama ve listeleme (herkese açık, oturum gerekmez). */
const listFoods = asyncHandler(async (req, res) => {
  const v = createValidator(req.query ?? {});
  v.string('search', { required: false, max: 120, emptyAsNull: true });
  v.string('category', { required: false, max: 80, emptyAsNull: true });
  v.bool('vegetable', { defaultValue: null });
  v.bool('fruit', { defaultValue: null });
  v.bool('legume', { defaultValue: null });
  v.int('limit', { required: false, min: 1, max: 200 });
  v.int('offset', { required: false, min: 0, max: 100000 });
  v.enum('sort', foodService.SORT_WHITELIST, { required: false, defaultValue: 'name' });
  v.enum('order', ['asc', 'desc'], { required: false, defaultValue: 'asc' });

  if (!v.ok) throw new ValidationError('Arama parametreleri geçersiz.', v.errors);

  const result = await foodService.listFoods({
    search: v.values.search,
    category: v.values.category,
    isVegetable: v.values.vegetable,
    isFruit: v.values.fruit,
    isLegume: v.values.legume,
    limit: v.values.limit ?? 50,
    offset: v.values.offset ?? 0,
    sort: v.values.sort,
    order: v.values.order,
  });

  res.json(result);
});

/** GET /api/foods/:id */
const getFood = asyncHandler(async (req, res) => {
  const v = createValidator(req.params);
  v.int('id', { required: true, min: 1 });
  if (!v.ok) throw new ValidationError('Besin kimliği geçersiz.', v.errors);

  const food = await foodService.getFoodById(v.values.id);
  res.json({ food });
});

/** GET /api/foods/categories — arama filtresi ve form için kategori listesi. */
const listCategories = asyncHandler(async (_req, res) => {
  res.json({ categories: await foodService.listCategories() });
});

/**
 * POST /api/foods — YETKİLİ kullanım: yalnızca is_admin=true olan kullanıcı.
 * Besin kataloğu paylaşılan veridir; herkesin yazması veri kalitesini bozar.
 *
 * source_basis='per_portion' ise sourcePortionGrams zorunludur; değerler
 * fn_normalize_to_100g() ile 100 g'a çevrilir.
 */
const createFood = asyncHandler(async (req, res) => {
  if (!req.user?.isAdmin) {
    throw new ForbiddenError(
      'Besin kataloğuna ekleme yetkisi yalnızca yönetici kullanıcılardadır.',
    );
  }

  const body = req.body ?? {};
  const v = createValidator(body);
  v.string('name', { required: true, min: 1, max: 150 });
  v.string('categoryName', { required: true, min: 1, max: 80 });

  v.number('caloriesPer100g', { required: true, min: 0, max: 900, decimals: 2 });
  v.number('proteinPer100g', { required: true, min: 0, max: 100, decimals: 2 });
  v.number('carbohydratesPer100g', { required: true, min: 0, max: 100, decimals: 2 });
  v.number('totalSugarsPer100g', { required: true, min: 0, max: 100, decimals: 2 });
  v.number('addedSugarsPer100g', { required: false, min: 0, max: 100, decimals: 2 });
  v.number('fatPer100g', { required: true, min: 0, max: 100, decimals: 2 });
  v.number('saturatedFatPer100g', { required: true, min: 0, max: 100, decimals: 2 });
  v.number('fiberPer100g', { required: true, min: 0, max: 100, decimals: 2 });

  v.number('portionGrams', { required: false, min: 0.1, max: 5000, decimals: 2 });
  v.string('portionUnit', { required: false, max: 40, emptyAsNull: true });
  v.enum('state', STATE_VALUES, { required: false, defaultValue: 'unspecified' });
  v.bool('isVegetable', { defaultValue: false });
  v.bool('isFruit', { defaultValue: false });
  v.bool('isLegume', { defaultValue: false });

  v.string('sourceName', { required: true, min: 1, max: 200 });
  v.string('sourceUrl', { required: false, max: 500, emptyAsNull: true });
  v.string('sourceFoodId', { required: false, max: 80, emptyAsNull: true });
  v.enum('sourceBasis', SOURCE_BASIS_VALUES, { required: false, defaultValue: 'per_100g' });
  v.number('sourcePortionGrams', { required: false, min: 0.1, max: 5000, decimals: 2 });
  v.enum('dataQuality', DATA_QUALITY_VALUES, { required: false, defaultValue: 'unverified' });
  v.string('sourceNote', { required: false, max: 1000, emptyAsNull: true });

  if (!v.ok) throw new ValidationError('Besin bilgileri doğrulanamadı.', v.errors);

  // Porsiyon bazlı kayıt için porsiyon gramajı olmadan dönüşüm yapılamaz.
  if (v.values.sourceBasis === 'per_portion' && v.values.sourcePortionGrams === null) {
    throw new ValidationError(
      'source_basis "per_portion" ise sourcePortionGrams zorunludur; aksi halde 100 g’a dönüşüm yapılamaz.',
      { field: 'sourcePortionGrams' },
    );
  }

  const categoryId = await foodService.resolveCategoryId(v.values.categoryName);

  const food = await foodService.createFood({
    name: v.values.name,
    categoryId,
    caloriesPer100g: v.values.caloriesPer100g,
    proteinPer100g: v.values.proteinPer100g,
    carbohydratesPer100g: v.values.carbohydratesPer100g,
    totalSugarsPer100g: v.values.totalSugarsPer100g,
    addedSugarsPer100g: v.values.addedSugarsPer100g,
    fatPer100g: v.values.fatPer100g,
    saturatedFatPer100g: v.values.saturatedFatPer100g,
    fiberPer100g: v.values.fiberPer100g,
    portionGrams: v.values.portionGrams,
    portionUnit: v.values.portionUnit,
    state: v.values.state,
    isVegetable: v.values.isVegetable,
    isFruit: v.values.isFruit,
    isLegume: v.values.isLegume,
    sourceName: v.values.sourceName,
    sourceUrl: v.values.sourceUrl,
    sourceFoodId: v.values.sourceFoodId,
    sourceBasis: v.values.sourceBasis,
    sourcePortionGrams: v.values.sourcePortionGrams,
    dataQuality: v.values.dataQuality,
    sourceNote: v.values.sourceNote,
  });

  res.status(201).json({ food, message: 'Besin eklendi.' });
});

module.exports = { listFoods, getFood, createFood, listCategories };
