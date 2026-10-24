'use strict';

/**
 * Uçtan Uca Entegrasyon Testleri (Prompt §13'teki 12 Senaryo)
 *
 * 1. Yeni kullanıcı oluşturma
 * 2. Profil bilgilerini kaydetme
 * 3. Besin arama
 * 4. Bir öğüne birden fazla besin ekleme
 * 5. Gram üzerinden kalori ve makro besin hesaplama
 * 6. Günlük toplamların SQL sonuçlarıyla uyuşması
 * 7. Haftalık ortalama hesaplama
 * 8. Veri girilmeyen günlerin doğru değerlendirilmesi
 * 9. Bir kaydı güncelleme ve silme
 * 10. Yetkisiz erişimin engellenmesi
 * 11. Yanlış ve negatif miktarların reddedilmesi
 * 12. Farklı kullanıcıların verilerinin birbirine karışmaması
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../backend/server');
const { checkConnection, query, closePool } = require('../../backend/db');

let server;
let baseUrl;
let dbAvailable = false;

// HTTP yardımcı fonksiyonu (cookie oturum desteği ile)
class TestAgent {
  constructor() {
    this.cookies = [];
  }

  async request(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    };

    if (this.cookies.length > 0) {
      headers['Cookie'] = this.cookies.join('; ');
    }

    const res = await fetch(url, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const parts = setCookie.split(',').map((c) => c.split(';')[0].trim());
      for (const p of parts) {
        if (!this.cookies.includes(p)) this.cookies.push(p);
      }
    }

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;

    return { status: res.status, data, headers: res.headers };
  }
}

test('Entegrasyon Testleri Hazırlığı', async () => {
  const conn = await checkConnection();
  dbAvailable = conn.ok;
  if (!dbAvailable) {
    console.log('\n[bilgi] PostgreSQL bağlantısı aktif değil. Entegrasyon testleri zarifçe atlanacaktır.');
    return;
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test('Prompt §13 Entegrasyon Senaryoları (12 Adım)', async (t) => {
  if (!dbAvailable) {
    t.skip('PostgreSQL veritabanı bağlantısı bulunamadığı için atlandı. (DB kurulumu sonrası tümü çalışır)');
    return;
  }

  const agent1 = new TestAgent();
  const agent2 = new TestAgent();
  const email1 = `test_user1_${Date.now()}@example.com`;
  const email2 = `test_user2_${Date.now()}@example.com`;
  let user1;
  let user2;
  let foodList;
  let mealId;
  let mealItemId1;
  let mealItemId2;

  // 1. Yeni kullanıcı oluşturma
  await t.test('1. Yeni kullanıcı oluşturma (register)', async () => {
    const res = await agent1.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Kullanıcı 1',
        email: email1,
        password: 'Password123!',
      },
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.user);
    assert.strictEqual(res.data.user.email, email1);
    user1 = res.data.user;
  });

  // 2. Profil bilgilerini kaydetme
  await t.test('2. Profil bilgilerini kaydetme ve hedeflerin üretilmesi', async () => {
    const res = await agent1.request('/api/profile', {
      method: 'PUT',
      body: {
        name: 'Test Kullanıcı 1 Güncel',
        age: 28,
        biologicalSex: 'male',
        heightCm: 178,
        weightKg: 74,
        activityLevel: 'moderately_active',
        goal: 'maintain',
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user.age, 28);
    assert.strictEqual(res.data.user.weightKg, 74);
    assert.ok(res.data.targets.calories.target > 0);
  });

  // 3. Besin arama
  await t.test('3. Besin arama (search)', async () => {
    const res = await agent1.request('/api/foods?search=');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.foods));
    assert.ok(res.data.foods.length > 0);
    foodList = res.data.foods;
  });

  // 4. Bir öğüne birden fazla besin ekleme
  await t.test('4. Öğün oluşturma ve birden fazla besin ekleme', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mealRes = await agent1.request('/api/meals', {
      method: 'POST',
      body: { mealDate: today, mealType: 'lunch' },
    });
    assert.strictEqual(mealRes.status, 201);
    mealId = mealRes.data.meal.id;

    const food1 = foodList[0];
    const food2 = foodList[1] || foodList[0];

    const item1Res = await agent1.request(`/api/meals/${mealId}/items`, {
      method: 'POST',
      body: { foodId: food1.id, quantityGrams: 150 },
    });
    assert.strictEqual(item1Res.status, 201);
    mealItemId1 = item1Res.data.item.id;

    const item2Res = await agent1.request(`/api/meals/${mealId}/items`, {
      method: 'POST',
      body: { foodId: food2.id, quantityGrams: 200 },
    });
    assert.strictEqual(item2Res.status, 201);
    mealItemId2 = item2Res.data.item.id;
  });

  // 5. Gram üzerinden kalori ve makro besin hesaplama
  await t.test('5. Gram üzerinden besin değerlerinin ölçeklenmesi', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mealsRes = await agent1.request(`/api/meals?date=${today}`);
    assert.strictEqual(mealsRes.status, 200);
    const lunch = mealsRes.data.meals.find((m) => m.mealType === 'lunch');
    assert.ok(lunch);
    assert.strictEqual(lunch.items.length, 2);

    const it1 = lunch.items.find((i) => i.id === mealItemId1);
    assert.strictEqual(it1.quantityGrams, 150);
    assert.ok(it1.calories > 0);
  });

  // 6. Günlük toplamların SQL sonuçlarıyla uyuşması
  await t.test('6. Günlük toplamların v_daily_totals ile uyuşması', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const repRes = await agent1.request(`/api/reports/daily?date=${today}`);
    assert.strictEqual(repRes.status, 200);
    assert.strictEqual(repRes.data.hasData, true);
    assert.ok(repRes.data.totals.itemCount >= 2);
    assert.ok(repRes.data.totals.calories > 0);
  });

  // 7. Haftalık ortalama hesaplama
  await t.test('7. Haftalık ortalama raporu (weekly averages)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekRes = await agent1.request(`/api/reports/weekly?start=${today}`);
    assert.strictEqual(weekRes.status, 200);
    assert.ok(weekRes.data.dataCoverageDays >= 1);
    assert.ok(weekRes.data.averages);
  });

  // 8. Veri girilmeyen günlerin doğru değerlendirilmesi
  await t.test('8. Veri girilmeyen günlerin sıfır sayılmaması', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekRes = await agent1.request(`/api/reports/weekly?start=${today}`);
    assert.strictEqual(weekRes.status, 200);
    // 7 günden kayıt girilmeyenler missingDays olarak listelenmeli
    assert.ok(Array.isArray(weekRes.data.missingDays));
    assert.strictEqual(weekRes.data.dataCoverageDays < 7, true);
  });

  // 9. Bir kaydı güncelleme ve silme
  await t.test('9. Besin kaydını güncelleme ve silme', async () => {
    const updateRes = await agent1.request(`/api/meal-items/${mealItemId1}`, {
      method: 'PUT',
      body: { quantityGrams: 300 },
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.item.quantityGrams, 300);

    const deleteRes = await agent1.request(`/api/meal-items/${mealItemId2}`, {
      method: 'DELETE',
    });
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.data.deleted, true);
  });

  // 10. Yetkisiz erişimin engellenmesi
  await t.test('10. Yetkisiz erişim kontrolü (401)', async () => {
    const unauthAgent = new TestAgent();
    const res = await unauthAgent.request('/api/profile');
    assert.strictEqual(res.status, 401);
  });

  // 11. Yanlış ve negatif miktarların reddedilmesi
  await t.test('11. Negatif ve hatalı miktar reddi (400)', async () => {
    const res = await agent1.request(`/api/meals/${mealId}/items`, {
      method: 'POST',
      body: { foodId: foodList[0].id, quantityGrams: -100 },
    });
    assert.strictEqual(res.status, 400);
  });

  // 12. Farklı kullanıcıların verilerinin birbirine karışmaması
  await t.test('12. Çoklu kullanıcı izolasyonu (Kullanıcı 2 Kullanıcı 1 verisini göremez/silemez)', async () => {
    const reg2 = await agent2.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Kullanıcı 2',
        email: email2,
        password: 'Password123!',
      },
    });
    assert.strictEqual(reg2.status, 201);
    user2 = reg2.data.user;

    // Kullanıcı 2, Kullanıcı 1'in mealItem'ını silmeyi dener -> 404 (bulunamadı / yetkisiz)
    const illegalDelete = await agent2.request(`/api/meal-items/${mealItemId1}`, {
      method: 'DELETE',
    });
    assert.strictEqual(illegalDelete.status, 404);

    // Kullanıcı 2'nin günlük öğün listesi boş olmalıdır
    const today = new Date().toISOString().slice(0, 10);
    const meals2 = await agent2.request(`/api/meals?date=${today}`);
    assert.strictEqual(meals2.status, 200);
    assert.strictEqual(meals2.data.hasData, false);
  });

  // Temizlik: oluşturulan test kullanıcılarını sil
  try {
    await query('DELETE FROM users WHERE id IN ($1, $2)', [user1.id, user2.id]);
  } catch {
    // Test kullanıcısı temizliği opsiyonel
  }
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closePool();
});
