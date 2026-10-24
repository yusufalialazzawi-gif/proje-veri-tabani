'use strict';

/**
 * PostgreSQL bağlantı havuzu ve sorgu yardımcıları.
 *
 * İKİ ÖNEMLİ TİP KARARI (pg varsayılanları burada bilinçli olarak değiştirilir):
 *
 *  1. NUMERIC (OID 1700) pg tarafından STRING döner ("123.45"). API JSON
 *     ürettiği ve frontend sayı beklediği için parseFloat ile sayıya çeviriyoruz.
 *     Güvenli çünkü bu şemadaki en büyük değer ~10^7 ve 2 ondalıklı; çift
 *     duyarlıklı (double) temsil hatası olmaz.
 *
 *  2. DATE (OID 1082) pg tarafından yerel saat diliminde GECE YARISINA
 *     ayarlanmış bir JS Date'e çevrilir. Sunucu UTC, kullanıcı UTC+3 ise
 *     tarih bir gün geri kayar. Bunu önlemek için DATE'i olduğu gibi
 *     'YYYY-MM-DD' dizesi olarak alıyoruz — saat dilimi hatası imkânsız hale
 *     geliyor. Uygulama boyunca tarihler dize olarak taşınır.
 */

const { Pool, types } = require('pg');
const { config } = require('../config');

const OID_NUMERIC = 1700;
const OID_DATE = 1082;

types.setTypeParser(OID_NUMERIC, (value) => (value === null ? null : Number.parseFloat(value)));
types.setTypeParser(OID_DATE, (value) => value); // 'YYYY-MM-DD' dizesi olarak kalır

let pool = null;

/** Havuzu tembel olarak oluşturur (testlerde mock enjekte edilebilsin diye). */
function getPool() {
  if (!pool) {
    pool = config.db.connectionString
      ? new Pool({
          connectionString: config.db.connectionString,
          ssl: config.db.ssl,
          max: config.db.max,
          idleTimeoutMillis: config.db.idleTimeoutMillis,
          connectionTimeoutMillis: config.db.connectionTimeoutMillis,
        })
      : new Pool({
          host: config.db.host,
          port: config.db.port,
          database: config.db.database,
          user: config.db.user,
          password: config.db.password,
          ssl: config.db.ssl,
          max: config.db.max,
          idleTimeoutMillis: config.db.idleTimeoutMillis,
          connectionTimeoutMillis: config.db.connectionTimeoutMillis,
        });

    // Beklenmeyen havuz hataları process'i çökertmesin; loglansın.
    pool.on('error', (err) => {
      console.error('[db] bağlantı havuzunda beklenmeyen hata:', err.message);
    });
  }
  return pool;
}

/**
 * Parametreli sorgu çalıştırır.
 * @param {string} text  - $1, $2 ... yer tutucuları içeren SQL
 * @param {unknown[]} [params]
 */
async function query(text, params = []) {
  const result = await getPool().query(text, params);
  return result;
}

/** Tek satır bekleyen sorgular için. Satır yoksa null. */
async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] ?? null;
}

/**
 * İşlemi tek bir transaction içinde çalıştırır.
 * Besin ekleme + günlük hedefleri güncelleme gibi birlikte tutarlı olması
 * gereken yazmalar burada gruplanır; hata olursa her şey geri alınır.
 */
async function withTransaction(handler) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] ROLLBACK başarısız:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Sunucu kapanırken havuzu temizle. */
async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/**
 * Bağlantı sağlığı (GET /api/health ve açılış denetimi için).
 * Hata fırlatmaz: ulaşılamayan veritabanı bir "başarısız sağlık" sonucudur.
 *
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
async function checkConnection() {
  try {
    const { rows } = await query('SELECT 1 AS ok');
    return { ok: rows[0]?.ok === 1, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getPool,
  query,
  queryOne,
  withTransaction,
  closePool,
  checkConnection,
};
