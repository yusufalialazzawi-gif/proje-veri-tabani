'use strict';

/**
 * Küçük doğrulama yardımcıları.
 *
 * Amaç: kullanıcı girdisi veritabanına ulaşmadan önce biçim ve aralık olarak
 * doğrulanır. Hatalı, negatif veya gerçek dışı besin miktarları reddedilir.
 * Tüm değerler tip dönüşümünden geçirilerek alınır; SQL'e her zaman parametre
 * olarak bağlanır (string birleştirme yoktur).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isPlainObject = (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 'YYYY-MM-DD' biçiminde ve GERÇEK bir takvim tarihi mi?
 * Örn. 2026-02-30 reddedilir.
 * @returns {string|null} geçerliyse aynı tarih dizesi, değilse null
 */
function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;

  // Ayın gerçek gün sayısını kontrol et (artık yıl dahil).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;

  return value.trim();
}

/** Sayıya çevir; NaN/Infinity/boş dize null döner (0 ile karıştırılmaz). */
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Doğrulama bağlamı. Her alan için hata biriktirir, ilk hatada durmaz;
 * böylece kullanıcı formdaki tüm sorunları tek seferde görür.
 */
function createValidator(source = {}) {
  if (!isPlainObject(source)) source = {};

  const values = {};
  const errors = {};

  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  const api = {
    values,
    errors,
    get ok() {
      return Object.keys(errors).length === 0;
    },

    string(field, { required = false, min = 1, max = 255, trim = true, emptyAsNull = false } = {}) {
      let raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) fail(field, 'Bu alan zorunludur.');
        else values[field] = null;
        return api;
      }
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        fail(field, 'Metin olmalıdır.');
        return api;
      }
      let v = String(raw);
      if (trim) v = v.trim();
      if (v.length === 0 && emptyAsNull) {
        values[field] = null;
        return api;
      }
      if (v.length < min) {
        fail(field, `En az ${min} karakter olmalıdır.`);
        return api;
      }
      if (v.length > max) {
        fail(field, `En fazla ${max} karakter olmalıdır.`);
        return api;
      }
      values[field] = v;
      return api;
    },

    email(field, { required = true } = {}) {
      let raw = source[field];
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        if (required) fail(field, 'E-posta zorunludur.');
        else values[field] = null;
        return api;
      }
      const v = String(raw).trim().toLowerCase();
      if (v.length > 254 || !EMAIL_RE.test(v)) {
        fail(field, 'Geçerli bir e-posta adresi girin.');
        return api;
      }
      values[field] = v;
      return api;
    },

    password(field, { required = true } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) fail(field, 'Parola zorunludur.');
        else values[field] = null;
        return api;
      }
      if (typeof raw !== 'string') {
        fail(field, 'Parola metin olmalıdır.');
        return api;
      }
      // Parola kırpılmaz (baş/son boşluk anlamlı olabilir) ama uzunluk sınırlanır.
      // Üst sınır bcrypt'in 72 baytlık etkin sınırından önce keser.
      if (raw.length < 8) {
        fail(field, 'Parola en az 8 karakter olmalıdır.');
        return api;
      }
      if (raw.length > 72) {
        fail(field, 'Parola en fazla 72 karakter olmalıdır.');
        return api;
      }
      values[field] = raw;
      return api;
    },

    /**
     * Ondalıklı sayı. Besin miktarları ve gramajlar buradan geçer.
     * Negatif, sıfır, NaN ve gerçek dışı büyük değerler reddedilir.
     */
    number(field, { required = false, min = -Infinity, max = Infinity, exclusiveMin = false, decimals = 2 } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) fail(field, 'Bu alan zorunludur.');
        else values[field] = null;
        return api;
      }
      const n = parseNumber(raw);
      if (n === null) {
        fail(field, 'Sayısal bir değer girin.');
        return api;
      }
      if (exclusiveMin ? n <= min : n < min) {
        fail(field, exclusiveMin ? `${min} değerinden büyük olmalıdır.` : `${min} değerinden küçük olamaz.`);
        return api;
      }
      if (n > max) {
        fail(field, `${max} değerinden büyük olamaz.`);
        return api;
      }
      const f = 10 ** decimals;
      values[field] = Math.round(n * f) / f;
      return api;
    },

    /** Tamsayı (kimlikler, sayfa numarası, yaş). */
    int(field, { required = false, min = -Infinity, max = Infinity } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) fail(field, 'Bu alan zorunludur.');
        else values[field] = null;
        return api;
      }
      const n = parseNumber(raw);
      if (n === null || !Number.isInteger(n)) {
        fail(field, 'Tam sayı olmalıdır.');
        return api;
      }
      if (n < min || n > max) {
        fail(field, `${min} ile ${max} arasında olmalıdır.`);
        return api;
      }
      values[field] = n;
      return api;
    },

    /** YYYY-MM-DD tarih. */
    date(field, { required = false, defaultValue = null } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) {
          fail(field, 'Tarih zorunludur (YYYY-MM-DD).');
        } else {
          values[field] = defaultValue;
        }
        return api;
      }
      const v = parseDateOnly(raw);
      if (!v) {
        fail(field, 'Tarih YYYY-MM-DD biçiminde ve geçerli bir takvim tarihi olmalıdır.');
        return api;
      }
      values[field] = v;
      return api;
    },

    /** Beyaz listeden değer. Bilinmeyen değer reddedilir (SQL için kritik). */
    enum(field, allowed, { required = false, defaultValue = null } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        if (required) fail(field, `Şunlardan biri olmalıdır: ${allowed.join(', ')}.`);
        else values[field] = defaultValue;
        return api;
      }
      const v = String(raw);
      if (!allowed.includes(v)) {
        fail(field, `Şunlardan biri olmalıdır: ${allowed.join(', ')}.`);
        return api;
      }
      values[field] = v;
      return api;
    },

    bool(field, { defaultValue = null } = {}) {
      const raw = source[field];
      if (raw === undefined || raw === null || raw === '') {
        values[field] = defaultValue;
        return api;
      }
      if (typeof raw === 'boolean') {
        values[field] = raw;
        return api;
      }
      const v = String(raw).trim().toLowerCase();
      if (['1', 'true', 'yes', 'evet'].includes(v)) values[field] = true;
      else if (['0', 'false', 'no', 'hayir', 'hayır'].includes(v)) values[field] = false;
      else fail(field, 'true/false olmalıdır.');
      return api;
    },
  };

  return api;
}

/**
 * Sıralama kolonunu beyaz listeye karşı doğrular.
 * Sorguya eklenen TEK dinamik parça budur; bu yüzden mutlaka beyaz listeden
 * geçmelidir (SQL injection'ın en sık kaçtığı yer ORDER BY'dır).
 */
function safeSortColumn(requested, whitelist, fallback) {
  if (typeof requested !== 'string') return fallback;
  const key = requested.trim();
  return whitelist.includes(key) ? key : fallback;
}

/**
 * Tüketilen miktar için özel doğrulama (prompt md. 12:
 * "Hatalı, negatif veya gerçek dışı besin miktarlarını reddet").
 * @returns {{ok: boolean, value?: number, message?: string}}
 */
function validateQuantityGrams(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, message: 'Tüketilen miktar (gram) zorunludur.' };
  }
  const n = parseNumber(raw);
  if (n === null) {
    return { ok: false, message: 'Miktar sayısal olmalıdır (ör. 150 veya 12.5).' };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, message: 'Miktar sonlu bir sayı olmalıdır.' };
  }
  if (n <= 0) {
    return { ok: false, message: 'Miktar sıfırdan büyük olmalıdır; negatif veya sıfır değer reddedilir.' };
  }
  if (n > 10000) {
    return { ok: false, message: 'Tek bir kayıt için 10000 g üzeri miktar gerçek dışıdır.' };
  }
  if (n < 0.1) {
    return { ok: false, message: '0.1 gramdan küçük miktarlar kaydedilemez.' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Bugünün yerel tarihi 'YYYY-MM-DD' olarak. */
function todayLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = {
  createValidator,
  parseDateOnly,
  parseNumber,
  safeSortColumn,
  validateQuantityGrams,
  todayLocal,
};
