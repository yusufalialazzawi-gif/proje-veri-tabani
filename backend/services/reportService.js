'use strict';

/**
 * Rapor servisi: günlük ve haftalık raporlar.
 *
 * Günlük/haftalık SAYISAL toplamlar SQL görünümlerinden okunur
 * (v_daily_vs_totals, v_weekly_averages). Bu servis JS'te yeniden toplama
 * YAPMAZ; yalnızca okur, hedeflerle eşleştirir ve haftalık raporu önbelleğe alır.
 *
 * Haftalık rapor önbelleği bayatlayabilir. v_weekly_report_freshness görünümü
 * kayıtlı raporun okuduğu veri anı ile canlı veriyi karşılaştırır; bayatsa
 * rapor yeniden üretilir. Böylece "eski rapor güncel veriyle çelişiyor" sorunu
 * kapalı değil, açıkça modellenmiş olur.
 */

const { query, queryOne } = require('../db');
const { config } = require('../config');
const targetService = require('./targetService');
const { buildWeeklyAnalysis } = require('./weeklyAnalysis');

const DAILY_REPORT_SELECT = `
  SELECT user_id, log_date, item_count,
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
   WHERE user_id = $1 AND log_date = $2
`;

// Hedef satırını okuyan SQL ifadesi targetService'te TEK kez tanımlıdır;
// burada ikinci bir kopya tutulmaz (prompt md. 9: aynı hesap iki yerde yazılmaz).
const TARGETS_ONLY_SELECT = targetService.TARGET_ROW_SELECT;

const WEEK_DAYS_SELECT = `
  SELECT d.day_date::text                              AS day_date,
         EXTRACT(ISODOW FROM d.day_date)::int          AS iso_day_of_week,
         t.calories, t.protein, t.carbohydrates, t.fat, t.fiber, t.total_sugars,
         t.added_sugars_known_sum, t.added_sugars_incomplete,
         t.vegetable_servings, t.fruit_servings, t.legume_servings,
         t.vegetable_grams, t.fruit_grams, t.legume_grams,
         t.item_count,
         (t.log_date IS NULL)                          AS is_missing_day
    FROM generate_series(fn_week_start($2::date),
                         fn_week_start($2::date) + 6,
                         INTERVAL '1 day') AS d(day_date)
    LEFT JOIN v_daily_totals t
           ON t.user_id = $1 AND t.log_date = d.day_date::date
   ORDER BY d.day_date
`;

const WEEK_AVERAGES_SELECT = `
  SELECT user_id, week_start::text AS week_start, week_end::text AS week_end,
         data_coverage_days, coverage_sufficient,
         average_calories, average_protein, average_carbohydrates,
         average_fat, average_saturated_fat, average_fiber,
         average_total_sugars, average_added_sugars, added_sugars_incomplete,
         min_daily_calories, max_daily_calories, daily_calorie_spread, daily_calorie_stddev,
         vegetable_servings_avg, fruit_servings_avg, legume_servings_avg,
         vegetable_grams_avg, fruit_grams_avg, legume_grams_avg,
         days_with_vegetables, days_with_fruit, days_with_legumes
    FROM v_weekly_averages
   WHERE user_id = $1 AND week_start = fn_week_start($2::date)
`;

const WEEK_GROUPS_SELECT = `
  SELECT CASE
           WHEN e.is_legume    THEN 'legume'
           WHEN e.is_vegetable THEN 'vegetable'
           WHEN e.is_fruit     THEN 'fruit'
         END                                AS food_group,
         e.food_name,
         e.food_state,
         sum(e.quantity_grams)              AS total_grams,
         fn_serving_count(sum(e.quantity_grams)) AS total_servings,
         count(DISTINCT e.meal_date)        AS days_consumed,
         count(*)                           AS record_count,
         sum(e.fiber)                       AS fiber_from_group
    FROM v_meal_items_enriched e
   WHERE e.user_id = $1
     AND e.meal_date BETWEEN fn_week_start($2::date) AND fn_week_start($2::date) + 6
     AND (e.is_vegetable OR e.is_fruit OR e.is_legume)
   GROUP BY 1, e.food_name, e.food_state
   ORDER BY 1, total_grams DESC
`;

const WEEK_NORMALIZE_SELECT = `SELECT fn_week_start($1::date)::text AS week_start`;

/* -------------------------------------------------------------------------- */
/* Günlük rapor                                                                */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/reports/daily?date=YYYY-MM-DD
 * Hedefleri gerekirse hesaplar, tüketimi ve hedefleri tek nesnede döner.
 */
async function getDailyReport(userId, date) {
  // Hedeflerin güncel olmasını sağla (profil değiştiyse yeniden hesaplanır).
  await targetService.ensureDailyTargets(userId, date);

  let row = await queryOne(DAILY_REPORT_SELECT, [userId, date]);

  // v_daily_totals yalnızca kayıt olan günleri içerir. Kayıt yoksa hedefler
  // yine de döner ama tüketim NULL kalır — "sıfır tüketildi" DEMEZ.
  const hasData = row !== null;
  if (!row) {
    row = await queryOne(TARGETS_ONLY_SELECT, [userId, date]);
  }

  const targets = targetService.formatTargets(row);

  return {
    date,
    hasData,
    totals: hasData
      ? {
          itemCount: row.item_count,
          calories: row.calories,
          protein: row.protein,
          carbohydrates: row.carbohydrates,
          fat: row.fat,
          saturatedFat: row.saturated_fat,
          fiber: row.fiber,
          totalSugars: row.total_sugars,
          addedSugarsKnownSum: row.added_sugars_known_sum,
          addedSugarsIncomplete: row.added_sugars_incomplete,
          itemsMissingAddedSugars: row.items_missing_added_sugars,
          vegetableGrams: row.vegetable_grams,
          fruitGrams: row.fruit_grams,
          legumeGrams: row.legume_grams,
          vegetableServings: row.vegetable_servings,
          fruitServings: row.fruit_servings,
          legumeServings: row.legume_servings,
        }
      : null,
    targets,
    message: hasData
      ? null
      : 'Bu tarih için kayıt yok. Bu, sıfır tüketim anlamına gelmez; yalnızca o günün takip edilmediğini gösterir.',
  };
}

/* -------------------------------------------------------------------------- */
/* Haftalık rapor                                                              */
/* -------------------------------------------------------------------------- */

/** Verilen tarihin haftasının Pazartesi gününü SQL'e sorar (tek tanım yeri). */
async function resolveWeekStart(date) {
  const row = await queryOne(WEEK_NORMALIZE_SELECT, [date]);
  return row?.week_start ?? null;
}

/** Hafta verisini SQL'den okur (önbelleğe bakmaz). */
async function loadWeekData(userId, weekStart) {
  const [averagesRow, dailyResult, groupsResult] = await Promise.all([
    queryOne(WEEK_AVERAGES_SELECT, [userId, weekStart]),
    query(WEEK_DAYS_SELECT, [userId, weekStart]),
    query(WEEK_GROUPS_SELECT, [userId, weekStart]),
  ]);

  return {
    averages: averagesRow,
    dailyRows: dailyResult.rows,
    groupDetails: groupsResult.rows,
  };
}

/**
 * Haftalık raporu hesaplar ve weekly_reports tablosuna UPSERT eder.
 * details JSONB alanı tüm analizi taşır; rapor bu alan okunarak sunulur.
 */
async function generateWeeklyReport(userId, weekStart, profileRow) {
  const data = await loadWeekData(userId, weekStart);

  await targetService.ensureDailyTargets(userId, weekStart);
  const targetRow = await queryOne(TARGETS_ONLY_SELECT, [userId, weekStart]);
  const targets = targetService.formatTargets(targetRow);

  const analysis = buildWeeklyAnalysis({
    averages: data.averages,
    dailyRows: data.dailyRows,
    targets,
    profile: profileRow,
    groupDetails: data.groupDetails,
    minCoverage: config.nutrition.weeklyMinCoverageDays,
  });

  const a = data.averages;
  const details = {
    averages: a,
    dailyRows: data.dailyRows,
    groupDetails: data.groupDetails,
    comparisons: analysis.comparisons,
    variability: analysis.variability,
    groupIntake: analysis.groupIntake,
    recommendations: analysis.recommendations,
    cautions: analysis.cautions,
    loggedDays: analysis.loggedDays,
    missingDays: analysis.missingDays,
    targets,
    adultTargetsApplicable: analysis.adultTargetsApplicable,
    weekStart,
    weekEnd: weekEndOf(weekStart),
  };

  const saved = await queryOne(
    `INSERT INTO weekly_reports (
        user_id, week_start, week_end,
        average_calories, average_protein, average_carbohydrates,
        average_fat, average_fiber, average_total_sugars, average_added_sugars,
        average_saturated_fat,
        vegetable_servings_avg, fruit_servings_avg, legume_servings_avg,
        data_coverage_days, coverage_sufficient, details,
        data_as_of, source_max_updated
     )
     SELECT $1, $2::date, $2::date + 6,
            $3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,
            $14,$15,$16::jsonb,
            now(),
            (SELECT max(x.updated_at) FROM (
                SELECT m.updated_at FROM meals m
                 WHERE m.user_id = $1 AND m.meal_date BETWEEN $2::date AND $2::date + 6
                UNION ALL
                SELECT mi.updated_at FROM meal_items mi
                  JOIN meals m2 ON m2.id = mi.meal_id
                 WHERE m2.user_id = $1 AND m2.meal_date BETWEEN $2::date AND $2::date + 6
             ) x)
     ON CONFLICT (user_id, week_start) DO UPDATE SET
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
        source_max_updated     = EXCLUDED.source_max_updated
     RETURNING id, data_coverage_days, coverage_sufficient, data_as_of, updated_at, created_at`,
    [
      userId,
      weekStart,
      a?.average_calories ?? null,
      a?.average_protein ?? null,
      a?.average_carbohydrates ?? null,
      a?.average_fat ?? null,
      a?.average_fiber ?? null,
      a?.average_total_sugars ?? null,
      a?.average_added_sugars ?? null,
      a?.average_saturated_fat ?? null,
      a?.vegetable_servings_avg ?? null,
      a?.fruit_servings_avg ?? null,
      a?.legume_servings_avg ?? null,
      a?.data_coverage_days ?? 0,
      a ? a.coverage_sufficient : false,
      JSON.stringify(details),
    ],
  );

  return {
    weekStart,
    weekEnd: details.weekEnd,
    fromCache: false,
    isStale: false,
    reportId: saved.id,
    dataAsOf: saved.data_as_of,
    dataCoverageDays: saved.data_coverage_days,
    coverageSufficient: saved.coverage_sufficient,
    hasData: Boolean(a),
    averages: a,
    ...details,
  };
}

/**
 * GET /api/reports/weekly?start=YYYY-MM-DD
 *
 * Akış:
 *  1. Tarihi o haftanın Pazartesi'sine normalize et.
 *  2. Önbellekte rapor var mı ve TAZE mi? (v_weekly_report_freshness)
 *  3. Taze ve refresh istenmiyorsa önbellekten sun.
 *  4. Aksi halde yeniden hesapla ve UPSERT et.
 */
async function getWeeklyReport(userId, requestedDate, { refresh = false, profileRow } = {}) {
  const weekStart = await resolveWeekStart(requestedDate);
  if (!weekStart) return null;

  if (!refresh) {
    const cached = await queryOne(
      `SELECT wr.id, wr.data_coverage_days, wr.coverage_sufficient, wr.data_as_of,
              wr.details, wr.created_at, wr.updated_at,
              fr.is_stale
         FROM weekly_reports wr
         JOIN v_weekly_report_freshness fr ON fr.weekly_report_id = wr.id
        WHERE wr.user_id = $1 AND wr.week_start = $2::date`,
      [userId, weekStart],
    );

    if (cached && !cached.is_stale && cached.details) {
      const details =
        typeof cached.details === 'string' ? JSON.parse(cached.details) : cached.details;
      return {
        weekStart,
        weekEnd: details.weekEnd ?? weekEndOf(weekStart),
        fromCache: true,
        isStale: false,
        reportId: cached.id,
        dataAsOf: cached.data_as_of,
        dataCoverageDays: cached.data_coverage_days,
        coverageSufficient: cached.coverage_sufficient,
        hasData: cached.data_coverage_days > 0,
        averages: details.averages ?? null,
        ...details,
      };
    }
  }

  return generateWeeklyReport(userId, weekStart, profileRow);
}

/** 'YYYY-MM-DD' + 6 gün → hafta sonu (Pazar). */
function weekEndOf(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  return end.toISOString().slice(0, 10);
}

module.exports = {
  getDailyReport,
  getWeeklyReport,
  generateWeeklyReport,
  resolveWeekStart,
  loadWeekData,
  weekEndOf,
};
