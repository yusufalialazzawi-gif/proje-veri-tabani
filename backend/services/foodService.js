'use strict';

/**
 * Besin kataloğu servisi.
 *
 * Not: porsiyon bazlı kaynak verisi 100 g'a çevrilirken JS'te ikinci bir formül
 * YAZILMAZ; veritabanındaki fn_normalize_to_100g() fonksiyonu kullanılır.
 * Böylece dönüşüm kuralı tek yerde kalır.
 */

const { query, queryOne } = require('../db');
const { safeSortColumn } = require('../lib/validate');
const { NotFoundError, ValidationError } = require('../lib/errors');

/** ORDER BY için beyaz liste. Sorguya eklenen tek dinamik parça buradan gelir. */
const SORT_WHITELIST = [
  'name',
  'calories_per_100g',
  'protein_per_100g',
  'carbohydrates_per_100g',
  'total_sugars_per_100g',
  'fat_per_100g',
  'fiber_per_100g',
];

const FOOD_SELECT = `
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
    f.source_basis,
    f.source_portion_grams,
    f.data_quality,
    f.source_note,
    f.created_at
`;

function mapFood(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    state: row.state,
    per100g: {
      calories: row.calories_per_100g,
      protein: row.protein_per_100g,
      carbohydrates: row.carbohydrates_per_100g,
      totalSugars: row.total_sugars_per_100g,
      // NULL korunur: "kaynak bildirmiyor" ile "0" farklı şeylerdir.
      addedSugars: row.added_sugars_per_100g,
      fat: row.fat_per_100g,
      saturatedFat: row.saturated_fat_per_100g,
      fiber: row.fiber_per_100g,
    },
    portion: {
      grams: row.portion_grams,
      unit: row.portion_unit,
    },
    groups: {
      vegetable: row.is_vegetable,
      fruit: row.is_fruit,
      legume: row.is_legume,
    },
    source: {
      name: row.source_name,
      url: row.source_url,
      foodId: row.source_food_id,
      basis: row.source_basis,
      portionGrams: row.source_portion_grams,
      dataQuality: row.data_quality,
      note: row.source_note,
    },
  };
}

/**
 * Besin arama ve listeleme (GET /api/foods).
 * Filtreler NULL ise uygulanmaz — SQL'de ($n IS NULL OR kolon = $n) kalıbı.
 */
async function listFoods({
  search = null,
  category = null,
  isVegetable = null,
  isFruit = null,
  isLegume = null,
  limit = 50,
  offset = 0,
  sort = 'name',
  order = 'asc',
} = {}) {
  const sortColumn = safeSortColumn(sort, SORT_WHITELIST, 'name');
  const direction = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const countResult = await query(
    `SELECT count(*)::int AS total
       FROM foods f
       JOIN food_categories fc ON fc.id = f.category_id
      WHERE ($1::text IS NULL OR lower(f.name) LIKE '%' || lower($1) || '%')
        AND ($2::text IS NULL OR fc.name = $2)
        AND ($3::boolean IS NULL OR f.is_vegetable = $3)
        AND ($4::boolean IS NULL OR f.is_fruit = $4)
        AND ($5::boolean IS NULL OR f.is_legume = $5)`,
    [search, category, isVegetable, isFruit, isLegume],
  );

  const rowsResult = await query(
    `SELECT ${FOOD_SELECT}
       FROM foods f
       JOIN food_categories fc ON fc.id = f.category_id
      WHERE ($1::text IS NULL OR lower(f.name) LIKE '%' || lower($1) || '%')
        AND ($2::text IS NULL OR fc.name = $2)
        AND ($3::boolean IS NULL OR f.is_vegetable = $3)
        AND ($4::boolean IS NULL OR f.is_fruit = $4)
        AND ($5::boolean IS NULL OR f.is_legume = $5)
      ORDER BY ${sortColumn} ${direction}, f.id ASC
      LIMIT $6::int OFFSET $7::int`,
    [search, category, isVegetable, isFruit, isLegume, limit, offset],
  );

  return {
    items: rowsResult.rows.map(mapFood),
    total: countResult.rows[0]?.total ?? 0,
    limit,
    offset,
    sort: sortColumn,
    order: direction.toLowerCase(),
  };
}

async function getFoodById(id) {
  const row = await queryOne(
    `SELECT ${FOOD_SELECT}
       FROM foods f
       JOIN food_categories fc ON fc.id = f.category_id
      WHERE f.id = $1`,
    [id],
  );
  if (!row) throw new NotFoundError('Besin bulunamadı.');
  return mapFood(row);
}

/** Besin var mı? meal_items eklerken anlamlı hata vermek için kullanılır. */
async function foodExists(id) {
  const row = await queryOne('SELECT 1 FROM foods WHERE id = $1', [id]);
  return Boolean(row);
}

async function listCategories() {
  const result = await query(
    `SELECT fc.id, fc.name, fc.description, count(f.id)::int AS food_count
       FROM food_categories fc
       LEFT JOIN foods f ON f.category_id = fc.id
      GROUP BY fc.id, fc.name, fc.description
      ORDER BY fc.name`,
  );
  return result.rows;
}

/**
 * Yeni besin ekleme (POST /api/foods — yalnızca admin).
 *
 * source_basis='per_portion' ise değerler fn_normalize_to_100g() ile 100 g'a
 * çevrilir ve kaynak porsiyon gramajı saklanır (denetlenebilir dönüşüm).
 */
async function createFood(input) {
  const row = await queryOne(
    `INSERT INTO foods (
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
        $1, $2,
        fn_normalize_to_100g($3, $20, $21),
        fn_normalize_to_100g($4, $20, $21),
        fn_normalize_to_100g($5, $20, $21),
        fn_normalize_to_100g($6, $20, $21),
        fn_normalize_to_100g($7, $20, $21),
        fn_normalize_to_100g($8, $20, $21),
        fn_normalize_to_100g($9, $20, $21),
        fn_normalize_to_100g($10, $20, $21),
        $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19,
        $20, $21, $22, $23
     RETURNING id`,
    [
      input.name,
      input.categoryId,
      input.caloriesPer100g,
      input.proteinPer100g,
      input.carbohydratesPer100g,
      input.totalSugarsPer100g,
      input.addedSugarsPer100g ?? null,
      input.fatPer100g,
      input.saturatedFatPer100g,
      input.fiberPer100g,
      input.portionGrams ?? null,
      input.portionUnit ?? null,
      input.state ?? 'unspecified',
      input.isVegetable ?? false,
      input.isFruit ?? false,
      input.isLegume ?? false,
      input.sourceName,
      input.sourceUrl ?? null,
      input.sourceFoodId ?? null,
      input.sourceBasis ?? 'per_100g',
      input.sourcePortionGrams ?? null,
      input.dataQuality ?? 'unverified',
      input.sourceNote ?? null,
    ],
  );

  return getFoodById(row.id);
}

/** Kategori adından kimlik çözer; yoksa açık hata verir. */
async function resolveCategoryId(name) {
  const row = await queryOne('SELECT id FROM food_categories WHERE name = $1', [name]);
  if (!row) {
    throw new ValidationError('Bilinmeyen besin kategorisi.', {
      field: 'category',
      hint: 'Geçerli kategoriler için GET /api/foods/categories',
    });
  }
  return row.id;
}

module.exports = {
  listFoods,
  getFoodById,
  foodExists,
  listCategories,
  createFood,
  resolveCategoryId,
  mapFood,
  SORT_WHITELIST,
};
