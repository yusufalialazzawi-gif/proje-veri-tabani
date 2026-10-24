'use strict';

/**
 * Günlük hedef servisi.
 *
 * Hedefler kullanıcı profilinden hesaplanır ve daily_targets tablosuna
 * MATERYZALİZE edilir (önbellek). Bayatlama kuralı: kullanıcının profili
 * hedef satırından daha yeni güncellendiyse hedef yeniden hesaplanır.
 * Böylece eski hedefler güncel profille çelişmez.
 *
 * Hesaplamanın kendisi nutritionTargets.js içindedir ve tüm referansları
 * yanında taşır; burada yalnızca veritabanıyla eşleştirme yapılır.
 */

const { query, queryOne, withTransaction } = require('../db');
const { computeDailyTargets } = require('./nutritionTargets');
const { REFERENCES } = require('./references');
const { config } = require('../config');
const { NotFoundError } = require('../lib/errors');

const USER_SQL = `
  SELECT id, name, email, age, biological_sex, height_cm, weight_kg,
         activity_level, goal, dietary_restrictions, is_admin, created_at, updated_at
    FROM users
   WHERE id = $1
`;

/** users satırını computeDailyTargets'ın beklediği profile biçimine çevirir. */
function toProfile(userRow) {
  return {
    age: userRow.age,
    biologicalSex: userRow.biological_sex,
    heightCm: userRow.height_cm,
    weightKg: userRow.weight_kg,
    activityLevel: userRow.activity_level,
    goal: userRow.goal,
  };
}

/** Hesaplanan hedefleri daily_targets satır parametrelerine eşler. */
function toTargetRow(userId, date, targets) {
  return {
    params: [
      userId,
      date,
      targets.caloriesTarget,
      targets.caloriesTargetMin,
      targets.caloriesTargetMax,
      targets.proteinTargetMin,
      targets.proteinTargetMax,
      targets.carbohydratesTargetMin,
      targets.carbohydratesTargetMax,
      targets.fatTargetMin,
      targets.fatTargetMax,
      targets.fiberTarget,
      targets.addedSugarsLimit,
      targets.saturatedFatLimit,
      targets.vegetableServingsTarget,
      targets.fruitServingsTarget,
      targets.legumeServingsTarget,
      targets.bmrKcal,
      targets.activityFactor,
      targets.sources.join('; '),
      JSON.stringify({
        references: targets.references,
        informational: targets.informational,
        goal: targets.goal,
        goalLabel: targets.goalLabel,
        tdeeKcal: targets.tdeeKcal,
        servingGrams: targets.servingGrams,
        applicable: targets.applicable,
      }),
      targets.warnings,
    ],
  };
}

/**
 * daily_targets satırını formatTargets()'ın beklediği tüm kolonlarla okur.
 * Bu SELECT ifadesi TEK tanımdır: reportService de aynı sabiti kullanır,
 * böylece "hedef" nesnesinin biçimi projede iki kez yazılmaz.
 */
const TARGET_ROW_SELECT = `
  SELECT target_date, calories_target, calories_target_min, calories_target_max,
         protein_target_min, protein_target_max,
         carbohydrates_target_min, carbohydrates_target_max,
         fat_target_min, fat_target_max,
         fiber_target, added_sugars_limit, saturated_fat_limit,
         vegetable_servings_target, fruit_servings_target, legume_servings_target,
         bmr_kcal, activity_factor, target_source, target_references, calculation_warnings,
         NULL::numeric AS calories_pct_of_target,
         NULL::numeric AS fiber_pct_of_target,
         NULL::numeric AS protein_pct_of_min_target,
         NULL::numeric AS added_sugars_pct_of_limit,
         NULL::numeric AS saturated_fat_pct_of_limit
    FROM daily_targets
   WHERE user_id = $1 AND target_date = $2
`;

const UPSERT_DAILY_TARGETS_SQL = `
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
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
  ON CONFLICT (user_id, target_date) DO UPDATE SET
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
    calculation_warnings      = EXCLUDED.calculation_warnings
  RETURNING target_date, calories_target, updated_at
`;

/**
 * Belirli bir tarih için hedeflerin güncel olmasını sağlar.
 * Zaten güncelse yeniden hesaplamaz (gereksiz yazma yok).
 *
 * Dönen `targets` alanı HER ZAMAN formatTargets() biçimindedir; böylece
 * GET /api/profile ile GET /api/reports/daily aynı hedef nesnesini döner ve
 * arayüz iki farklı biçimle uğraşmaz.
 *
 * @returns {Promise<{date: string, recalculated: boolean, targets: object|null,
 *                    computed: object, user: object}>}
 */
async function ensureDailyTargets(userId, date, { force = false } = {}) {
  const userRow = await queryOne(USER_SQL, [userId]);
  if (!userRow) throw new NotFoundError('Kullanıcı bulunamadı.');

  const existing = await queryOne(
    `SELECT target_date, calories_target, updated_at
       FROM daily_targets
      WHERE user_id = $1 AND target_date = $2`,
    [userId, date],
  );

  const stale =
    force ||
    !existing ||
    (userRow.updated_at && existing.updated_at && userRow.updated_at > existing.updated_at);

  const computed = computeDailyTargets(toProfile(userRow), config.nutrition.servingGrams);

  if (stale) {
    const { params } = toTargetRow(userId, date, computed);
    await query(UPSERT_DAILY_TARGETS_SQL, params);
  }

  const row = await queryOne(TARGET_ROW_SELECT, [userId, date]);

  return {
    date,
    recalculated: stale,
    targets: formatTargets(row),
    computed,
    user: userRow,
  };
}

/**
 * Bir tarih aralığındaki tüm hedefleri yeniden hesaplar.
 * Test ve bakım için kullanılır; normal akışta hedefler ensureDailyTargets()
 * tarafından tembel olarak tazelenir.
 */
async function recalculateTargets(userId, fromDate, toDate) {
  return withTransaction(async (client) => {
    const userResult = await client.query(USER_SQL, [userId]);
    if (userResult.rowCount === 0) throw new NotFoundError('Kullanıcı bulunamadı.');

    const targets = computeDailyTargets(toProfile(userResult.rows[0]), config.nutrition.servingGrams);
    const { params } = toTargetRow(userId, null, targets);

    const dates = await client.query(
      `SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d`,
      [fromDate, toDate],
    );

    for (const { d } of dates.rows) {
      const dayParams = [...params];
      dayParams[1] = d;
      await client.query(UPSERT_DAILY_TARGETS_SQL, dayParams);
    }

    return {
      daysUpdated: dates.rowCount,
      applicable: targets.applicable,
      caloriesTarget: targets.caloriesTarget,
      warnings: targets.warnings,
    };
  });
}

/** Hedef satırını arayüz için okunabilir biçime çevirir. */
function formatTargets(row) {
  if (!row) return null;
  let references = {};
  if (typeof row.target_references === 'string') {
    try {
      references = JSON.parse(row.target_references);
    } catch {
      references = {};
    }
  } else if (row.target_references) {
    references = row.target_references;
  }

  return {
    targetDate: row.target_date,
    applicable: references.applicable !== false,
    servingGrams: references.servingGrams ?? config.nutrition.servingGrams,
    calories: {
      target: row.calories_target,
      min: row.calories_target_min,
      max: row.calories_target_max,
      pctOfTarget: row.calories_pct_of_target ?? null,
    },
    protein: {
      min: row.protein_target_min,
      max: row.protein_target_max,
      adequacyFloorG: references.references?.protein?.proteinAdequacyFloorG ?? null,
      pctOfMinTarget: row.protein_pct_of_min_target ?? null,
    },
    carbohydrates: { min: row.carbohydrates_target_min, max: row.carbohydrates_target_max },
    fat: {
      min: row.fat_target_min,
      max: row.fat_target_max,
      whoTotalFatMaxG: references.references?.fat?.whoTotalFatMaxG ?? null,
    },
    fiber: { target: row.fiber_target, pctOfTarget: row.fiber_pct_of_target ?? null },
    addedSugars: {
      limit: row.added_sugars_limit,
      whoConditionalLimitG: references.references?.addedSugars?.whoConditionalLimitG ?? null,
      dgaPerMealLimitG: references.references?.addedSugars?.dgaPerMealLimitG ?? null,
      pctOfLimit: row.added_sugars_pct_of_limit ?? null,
    },
    saturatedFat: {
      limit: row.saturated_fat_limit,
      pctOfLimit: row.saturated_fat_pct_of_limit ?? null,
    },
    servings: {
      vegetable: row.vegetable_servings_target,
      fruit: row.fruit_servings_target,
      legume: row.legume_servings_target,
      combinedMin: references.references?.foodGroups?.combinedMinServings ?? 5,
    },
    bmrKcal: row.bmr_kcal,
    activityFactor: row.activity_factor,
    tdeeKcal: references.tdeeKcal ?? null,
    goal: references.goal ?? null,
    goalLabel: references.goalLabel ?? null,
    targetSource: row.target_source,
    references: references.references ?? {},
    informational: references.informational ?? {},
    warnings: row.calculation_warnings ?? [],
    expandedSources: expandSourceList(row.target_source),
  };
}

/** 'A; B; C' biçimindeki kaynak listesini tam kaynak kayıtlarına çevirir. */
function expandSourceList(targetSource) {
  if (!targetSource) return [];
  return targetSource
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const ref = REFERENCES[id];
      if (!ref) return { id, organisation: id, title: null, year: null, url: null };
      return {
        id,
        organisation: ref.organisation,
        title: ref.title,
        year: ref.year ?? null,
        published: ref.published ?? null,
        citation: ref.citation ?? null,
        url: ref.url,
        ageGroup: ref.ageGroup ?? null,
      };
    });
}

module.exports = {
  ensureDailyTargets,
  recalculateTargets,
  formatTargets,
  expandSourceList,
  toProfile,
  USER_SQL,
  TARGET_ROW_SELECT,
};
