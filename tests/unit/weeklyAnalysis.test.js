'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeeklyAnalysis } = require('../../backend/services/weeklyAnalysis');

test('Haftalık analiz kuralları (Prompt §7)', async (t) => {
  const dummyProfile = { age: 30, biologicalSex: 'female', heightCm: 165, weightKg: 60 };
  const dummyTargets = {
    applicable: true,
    calories: { target: 2000, min: 1800, max: 2200 },
    protein: { min: 50, max: 96 },
    carbohydrates: { min: 225, max: 325 },
    fat: { min: 44, max: 78 },
    fiber: { target: 25 },
    addedSugars: { limit: 50 },
    saturatedFat: { limit: 22 },
    servings: { vegetable: 3, fruit: 2, legume: 1, combinedMin: 5 },
  };

  await t.test('Kural 2: Veri girilmeyen günler sıfır tüketim sayılmaz, ayrı listelenir', () => {
    const dailyRows = [
      { day_date: '2026-10-19', is_missing_day: false, calories: 1900 },
      { day_date: '2026-10-20', is_missing_day: false, calories: 2050 },
      { day_date: '2026-10-21', is_missing_day: true, calories: null },
      { day_date: '2026-10-22', is_missing_day: true, calories: null },
      { day_date: '2026-10-23', is_missing_day: false, calories: 1950 },
      { day_date: '2026-10-24', is_missing_day: true, calories: null },
      { day_date: '2026-10-25', is_missing_day: true, calories: null },
    ];

    const analysis = buildWeeklyAnalysis({
      averages: {
        data_coverage_days: 3,
        coverage_sufficient: false,
        average_calories: 1966.7,
        average_protein: 65,
        average_carbohydrates: 240,
        average_fat: 60,
        average_fiber: 22,
        average_total_sugars: 45,
        average_added_sugars: 20,
        added_sugars_incomplete: false,
        days_with_vegetables: 3,
        days_with_fruit: 2,
        days_with_legumes: 1,
      },
      dailyRows,
      targets: dummyTargets,
      profile: dummyProfile,
      groupDetails: [],
      minCoverage: 4,
    });

    assert.strictEqual(analysis.loggedDays.length, 3);
    assert.strictEqual(analysis.missingDays.length, 4);
    assert.ok(analysis.cautions.some((c) => c.includes('kayda dayanıyor') || c.includes('günden az')));
  });

  await t.test('Kural 6: 4 günden az veride kapsamın yetersiz olduğu belirtilir', () => {
    const dailyRows = [
      { day_date: '2026-10-19', is_missing_day: false, calories: 1900 },
      { day_date: '2026-10-20', is_missing_day: false, calories: 2050 },
    ];
    const analysis = buildWeeklyAnalysis({
      averages: {
        data_coverage_days: 2,
        coverage_sufficient: false,
        average_calories: 1800,
      },
      dailyRows,
      targets: dummyTargets,
      profile: dummyProfile,
      groupDetails: [],
      minCoverage: 4,
    });

    assert.strictEqual(analysis.coverageSufficient, false);
    assert.ok(analysis.cautions.some((c) => c.includes('4 günden az veriyle hesaplandığı için')));
  });

  await t.test('Kural 4: Toplam şeker ile ilave şeker ayrımı korunur', () => {
    const dailyRows = [
      { day_date: '2026-10-19', is_missing_day: false, calories: 2000 },
    ];
    const analysis = buildWeeklyAnalysis({
      averages: {
        data_coverage_days: 5,
        coverage_sufficient: true,
        average_calories: 2000,
        average_total_sugars: 80,
        average_added_sugars: 25,
        added_sugars_incomplete: false,
      },
      dailyRows,
      targets: dummyTargets,
      profile: dummyProfile,
      groupDetails: [],
    });

    assert.ok(analysis.comparisons.some((c) => c.nutrient === 'addedSugars'));
    const totalSugarComp = analysis.comparisons.find((c) => c.nutrient === 'totalSugars');
    assert.ok(totalSugarComp);
    assert.strictEqual(totalSugarComp.position, 'reference');
  });

  await t.test('Kural 8: Çocuklar için yetişkin hedefleri uygulanmaz', () => {
    const childProfile = { age: 14, biologicalSex: 'male' };
    const analysis = buildWeeklyAnalysis({
      averages: { data_coverage_days: 5, coverage_sufficient: true, average_calories: 2000 },
      dailyRows: [{ day_date: '2026-10-19', is_missing_day: false, calories: 2000 }],
      targets: { ...dummyTargets, applicable: false },
      profile: childProfile,
      groupDetails: [],
    });

    assert.strictEqual(analysis.adultTargetsApplicable, false);
    assert.ok(analysis.cautions.some((c) => c.includes('14 yaş için yetişkin hedefleri otomatik uygulanmaz')));
  });

  await t.test('Kural 1 & 7: Kesin patolojik veya alarmist dil kullanılmaz', () => {
    const analysis = buildWeeklyAnalysis({
      averages: {
        data_coverage_days: 5,
        coverage_sufficient: true,
        average_calories: 1400,
        average_protein: 30,
        average_fiber: 10,
      },
      dailyRows: [{ day_date: '2026-10-19', is_missing_day: false, calories: 1400 }],
      targets: dummyTargets,
      profile: dummyProfile,
      groupDetails: [],
    });

    const tumMetin = JSON.stringify(analysis).toLowerCase();
    // Hastalık teşhisi konulmadığı doğrulanır
    assert.ok(!tumMetin.includes('hastasısınız'));
    assert.ok(!tumMetin.includes('patolojik'));
    assert.ok(!tumMetin.includes('tehlikeli yetersizlik'));
  });
});
