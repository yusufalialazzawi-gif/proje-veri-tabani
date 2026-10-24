'use strict';

/**
 * Kimlik doğrulama servisi: kayıt, giriş, çıkış, oturum doğrulama.
 *
 * Tasarım kararları:
 *  - Parolalar bcrypt (cost 12) ile hash'lenir; düz metin asla saklanmaz ve
 *    loglanmaz. bcryptjs kullanılır (bcrypt ile aynı $2b$ biçimi, native derleme
 *    gerektirmez).
 *  - Oturumlar veritabanında tutulur. Çerezde YALNIZCA rastgele session_id
 *    vardır; kullanıcı verisi çereze yazılmaz.
 *  - Giriş hatalarında "e-posta bulunamadı" ile "parola yanlış" AYIRT
 *    EDİLMEZ; ikisi de aynı mesajı döner (kullanıcı adı numaralandırmasını
 *    önlemek için).
 *  - Başarısız denemelerde de bcrypt karşılaştırması çalıştırılır ki yanıt
 *    süresi, hesabın var olup olmadığını sızdırmasın (zamanlama saldırısı).
 */

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { query, queryOne, withTransaction } = require('../db');
const { config } = require('../config');
const { UnauthorizedError, ConflictError } = require('../lib/errors');

/** PostgreSQL hata kodları — kontrol-sonra-ekle yarışını yakalamak için. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

const BCRYPT_ROUNDS = 12;

/** Sabit maliyetli sahte hash — başarısız girişte zamanlama farkını gizler. */
const DUMMY_HASH = bcrypt.hashSync('zamanlama-saldirisi-icin-sabit-deger', BCRYPT_ROUNDS);

const SESSION_INSERT_SQL = `
  INSERT INTO sessions (session_id, user_id, expires_at, user_agent)
  VALUES ($1, $2, now() + make_interval(days => $3), $4)
  RETURNING session_id, user_id, created_at, expires_at
`;

const PUBLIC_USER_COLUMNS = `
  id, name, email, age, biological_sex, height_cm, weight_kg,
  activity_level, goal, dietary_restrictions, is_admin, created_at
`;

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    age: row.age,
    biologicalSex: row.biological_sex,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    activityLevel: row.activity_level,
    goal: row.goal,
    dietaryRestrictions: row.dietary_restrictions,
    isAdmin: row.is_admin === true,
    createdAt: row.created_at,
  };
}

/**
 * Yeni kullanıcı oluşturur ve hemen oturum açar.
 * @returns {{user: object, sessionId: string}}
 */
async function registerUser({ email, password, name, profile = {}, userAgent = null }) {
  const normalizedEmail = email.toLowerCase();

  const existing = await queryOne(
    'SELECT id FROM users WHERE lower(email) = $1',
    [normalizedEmail],
  );
  if (existing) {
    // E-posta zaten kayıtlıysa bu bilgiyi sızdırmak yerine genel bir hata verilir.
    throw new ConflictError('Bu bilgilerle hesap oluşturulamadı. Zaten bir hesabınız varsa giriş yapın.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let row;
  try {
    row = await queryOne(
      `INSERT INTO users (
          email, password_hash, name, age, biological_sex,
          height_cm, weight_kg, activity_level, goal, dietary_restrictions
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${PUBLIC_USER_COLUMNS}`,
      [
        normalizedEmail,
        passwordHash,
        name,
        profile.age ?? null,
        profile.biologicalSex ?? null,
        profile.heightCm ?? null,
        profile.weightKg ?? null,
        profile.activityLevel ?? null,
        profile.goal ?? null,
        profile.dietaryRestrictions ?? null,
      ],
    );
  } catch (err) {
    // İki istek aynı e-postayla yarıştıysa UNIQUE indeks yakalar.
    if (err && err.code === PG_UNIQUE_VIOLATION) {
      throw new ConflictError('Bu bilgilerle hesap oluşturulamadı. Zaten bir hesabınız varsa giriş yapın.');
    }
    if (err && err.code === PG_CHECK_VIOLATION) {
      throw new ConflictError('Profil değerleri geçerli aralıkta değil.', {
        constraint: err.constraint ?? null,
      });
    }
    throw err;
  }

  const sessionId = crypto.randomUUID();
  await query(SESSION_INSERT_SQL, [sessionId, row.id, config.session.ttlDays, userAgent]);

  return { user: mapUser(row), sessionId };
}

/**
 * Giriş. Başarısızsa her zaman aynı UnauthorizedError döner.
 */
async function loginUser({ email, password, userAgent = null }) {
  const normalizedEmail = String(email || '').toLowerCase();

  const row = await queryOne(
    `SELECT password_hash, ${PUBLIC_USER_COLUMNS}
       FROM users
      WHERE lower(email) = $1`,
    [normalizedEmail],
  );

  if (!row) {
    // Hesap yok: yine de bcrypt çalıştır ki yanıt süresi benzer olsun.
    await bcrypt.compare(password, DUMMY_HASH);
    throw new UnauthorizedError('E-posta veya parola hatalı.');
  }

  const matches = await bcrypt.compare(password, row.password_hash);
  if (!matches) {
    throw new UnauthorizedError('E-posta veya parola hatalı.');
  }

  const sessionId = crypto.randomUUID();
  await query(SESSION_INSERT_SQL, [
    sessionId,
    row.id,
    config.session.ttlDays,
    userAgent,
  ]);

  return { user: mapUser(row), sessionId };
}

/** Oturumu iptal eder (çıkış). Başkasının oturumu iptal edilemez. */
async function logoutSession(sessionId) {
  if (!sessionId) return false;
  const result = await query(
    `UPDATE sessions
        SET revoked_at = now()
      WHERE session_id = $1
        AND revoked_at IS NULL`,
    [sessionId],
  );
  return result.rowCount > 0;
}

/**
 * Çerezdeki session_id'yi doğrular ve kullanıcıyı döner.
 * Süresi dolmuş veya iptal edilmiş oturumlar geçersizdir.
 * Geçerli oturumun süresi kayan pencere olarak uzatılır.
 */
async function resolveSession(sessionId) {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  const row = await queryOne(
    `SELECT u.id, u.name, u.email, u.age, u.biological_sex, u.height_cm,
            u.weight_kg, u.activity_level, u.goal, u.dietary_restrictions,
            u.is_admin, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.session_id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [sessionId],
  );

  return row ? mapUser(row) : null;
}

/** Süresi dolmuş oturumları temizler (bakım). */
async function purgeExpiredSessions() {
  const result = await query(
    `DELETE FROM sessions
      WHERE expires_at < now() OR revoked_at IS NOT NULL`,
  );
  return result.rowCount;
}

/**
 * Parola değiştirir ve diğer tüm oturumları iptal eder.
 * (Parola değişince eski oturumların geçerli kalması güvenlik açığıdır.)
 */
async function changePassword({ userId, currentPassword, newPassword }) {
  const row = await queryOne('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row) throw new UnauthorizedError('Oturum geçersiz.');

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) throw new UnauthorizedError('Mevcut parola hatalı.');

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  });

  return true;
}

module.exports = {
  registerUser,
  loginUser,
  logoutSession,
  resolveSession,
  purgeExpiredSessions,
  changePassword,
  mapUser,
  BCRYPT_ROUNDS,
};
