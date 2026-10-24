'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBmr,
  computeTdee,
  computeDailyTargets,
  ACTIVITY_LEVELS,
  ADULT_MIN_AGE,
} = require('../../backend/services/nutritionTargets');

test('BMR hesaplama (Mifflin–St Jeor)', async (t) => {
  await t.test('Erkek için formül: 10*kg + 6.25*cm - 5*yaş + 5', () => {
    // 70 kg, 175 cm, 25 yaş erkek:
    // 10*70 + 6.25*175 - 5*25 + 5 = 700 + 1093.75 - 125 + 5 = 1673.75 -> 1674 kcal
    const bmr = computeBmr({ weightKg: 70, heightCm: 175, age: 25, biologicalSex: 'male' });
    assert.strictEqual(bmr.value, 1674);
    assert.strictEqual(bmr.applicable, true);
  });

  await t.test('Kadın için formül: 10*kg + 6.25*cm - 5*yaş - 161', () => {
    // 60 kg, 165 cm, 30 yaş kadın:
    // 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161 = 1320.25 -> 1320 kcal
    const bmr = computeBmr({ weightKg: 60, heightCm: 165, age: 30, biologicalSex: 'female' });
    assert.strictEqual(bmr.value, 1320);
    assert.strictEqual(bmr.applicable, true);
  });

  await t.test('Cinsiyet belirtilmemişse (unspecified) BMR hesaplanmaz (sahte kesinlik yok)', () => {
    const bmr = computeBmr({ weightKg: 70, heightCm: 175, age: 25, biologicalSex: 'unspecified' });
    assert.strictEqual(bmr.value, null);
    assert.strictEqual(bmr.applicable, false);
    assert.ok(bmr.warnings.some((w) => w.includes('Cinsiyet belirtilmediğinde')));
  });

  await t.test('Eksik boy, kilo veya yaşta null döner', () => {
    assert.strictEqual(computeBmr({ weightKg: null, heightCm: 175, age: 25, biologicalSex: 'male' }).value, null);
    assert.strictEqual(computeBmr({ weightKg: 70, heightCm: null, age: 25, biologicalSex: 'male' }).value, null);
    assert.strictEqual(computeBmr({ weightKg: 70, heightCm: 175, age: null, biologicalSex: 'male' }).value, null);
  });
});

test('TDEE hesaplama (FAO/WHO/UNU PAL katsayıları)', async (t) => {
  await t.test('BMR * Aktivite katsayısı', () => {
    const bmrObj = { value: 1600, applicable: true };
    // sedentary: 1.55
    const tdeeSedentary = computeTdee(bmrObj, 'sedentary');
    assert.strictEqual(tdeeSedentary.value, 1600 * ACTIVITY_LEVELS.sedentary.activityFactor);

    // moderately_active: 1.85
    const tdeeMod = computeTdee(bmrObj, 'moderately_active');
    assert.strictEqual(tdeeMod.value, 1600 * ACTIVITY_LEVELS.moderately_active.activityFactor);

    // very_active: 2.2
    const tdeeVery = computeTdee(bmrObj, 'very_active');
    assert.strictEqual(tdeeVery.value, Math.round(1600 * ACTIVITY_LEVELS.very_active.activityFactor));
  });

  await t.test('BMR veya aktivite seviyesi yoksa null döner', () => {
    assert.strictEqual(computeTdee(null, 'sedentary').value, null);
    assert.strictEqual(computeTdee({ value: 1600 }, null).value, null);
    assert.strictEqual(computeTdee({ value: 1600 }, 'invalid_level').value, null);
  });
});

test('Hedef ve yaş kısıtları', async (t) => {
  await t.test(`Yetişkin olmayan yaşta (< ${ADULT_MIN_AGE}) yetişkin hedefleri uygulanmaz`, () => {
    const profile = {
      age: 16,
      biologicalSex: 'female',
      heightCm: 160,
      weightKg: 50,
      activityLevel: 'moderately_active',
      goal: 'maintain',
    };
    const targets = computeDailyTargets(profile);
    assert.strictEqual(targets.applicable, false);
    assert.ok(targets.warnings.some((w) => w.includes('Mifflin-St Jeor denklemi 19 yaş ve üzeri')));
  });

  await t.test('Kilo verme hedefinde güvenlik tabanı uygulanır', () => {
    const profile = {
      age: 40,
      biologicalSex: 'female',
      heightCm: 150,
      weightKg: 42,
      activityLevel: 'sedentary',
      goal: 'lose',
    };
    const targets = computeDailyTargets(profile);
    assert.ok(targets.caloriesTargetMin >= 1200);
  });

  await t.test('Her hedef hesaplaması bilimsel kaynaklarını yanında taşır', () => {
    const profile = {
      age: 28,
      biologicalSex: 'male',
      heightCm: 180,
      weightKg: 75,
      activityLevel: 'sedentary',
      goal: 'maintain',
    };
    const targets = computeDailyTargets(profile);
    assert.ok(Array.isArray(targets.sources));
    assert.ok(targets.sources.includes('MIFFLIN_ST_JEOR_1990'));
    assert.ok(targets.sources.includes('FAO_WHO_UNU_2004'));
    assert.ok(targets.sources.includes('EFSA_PROTEIN_2012'));
    assert.ok(targets.sources.includes('WHO_HEALTHY_DIET'));
  });
});
