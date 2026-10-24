'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateQuantityGrams,
  parseDateOnly,
  createValidator,
} = require('../../backend/lib/validate');

test('Besin miktarı doğrulama (validateQuantityGrams)', async (t) => {
  await t.test('Geçerli gramaj kabul edilir', () => {
    assert.deepStrictEqual(validateQuantityGrams(150), { ok: true, value: 150 });
    assert.deepStrictEqual(validateQuantityGrams('250.5'), { ok: true, value: 250.5 });
    assert.deepStrictEqual(validateQuantityGrams(0.1), { ok: true, value: 0.1 });
    assert.deepStrictEqual(validateQuantityGrams(10000), { ok: true, value: 10000 });
  });

  await t.test('Sıfır veya negatif miktar reddedilir', () => {
    assert.strictEqual(validateQuantityGrams(0).ok, false);
    assert.strictEqual(validateQuantityGrams(-50).ok, false);
    assert.strictEqual(validateQuantityGrams('-0.1').ok, false);
  });

  await t.test('10.000 gramın üzerindeki miktar reddedilir', () => {
    assert.strictEqual(validateQuantityGrams(10000.1).ok, false);
    assert.strictEqual(validateQuantityGrams(50000).ok, false);
  });

  await t.test('Geçersiz girdi tipleri reddedilir', () => {
    assert.strictEqual(validateQuantityGrams(null).ok, false);
    assert.strictEqual(validateQuantityGrams(undefined).ok, false);
    assert.strictEqual(validateQuantityGrams('abc').ok, false);
    assert.strictEqual(validateQuantityGrams(NaN).ok, false);
    assert.strictEqual(validateQuantityGrams(Infinity).ok, false);
  });
});

test('Tarih formatı doğrulama (parseDateOnly)', async (t) => {
  await t.test('Geçerli YYYY-MM-DD tarihleri ayrıştırılır', () => {
    assert.strictEqual(parseDateOnly('2026-10-24'), '2026-10-24');
    assert.strictEqual(parseDateOnly('2024-02-29'), '2024-02-29'); // Artık yıl
  });

  await t.test('Geçersiz formatlar ve tarihler reddedilir', () => {
    assert.strictEqual(parseDateOnly('2026-13-01'), null); // Geçersiz ay
    assert.strictEqual(parseDateOnly('2026-02-30'), null); // Şubat 30 yok
    assert.strictEqual(parseDateOnly('24-10-2026'), null); // Yanlış sıra
    assert.strictEqual(parseDateOnly('bugun'), null);
    assert.strictEqual(parseDateOnly(''), null);
    assert.strictEqual(parseDateOnly(null), null);
  });
});

test('Genel Doğrulayıcı (createValidator)', async (t) => {
  await t.test('Zorunlu alanlar ve aralık kısıtları', () => {
    const v = createValidator({ age: 25, heightCm: 180, goal: 'maintain' });
    v.int('age', { required: true, min: 1, max: 120 });
    v.number('heightCm', { required: true, min: 40, max: 250 });
    v.enum('goal', ['maintain', 'lose', 'gain'], { required: true });

    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.values.age, 25);
    assert.strictEqual(v.values.heightCm, 180);
    assert.strictEqual(v.values.goal, 'maintain');
  });

  await t.test('Geçersiz alanlarda hata üretilir', () => {
    const v = createValidator({ age: -5, goal: 'invalid_goal' });
    v.int('age', { required: true, min: 1, max: 120 });
    v.enum('goal', ['maintain', 'lose', 'gain'], { required: true });

    assert.strictEqual(v.ok, false);
    assert.ok(v.errors.age);
    assert.ok(v.errors.goal);
  });
});
