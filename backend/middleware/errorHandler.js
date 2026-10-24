'use strict';

/**
 * Merkezi hata yönetimi.
 *
 * Amaç: kullanıcıya anlaşılır Türkçe mesaj dönerken iç ayrıntıları
 * (SQL metni, yığın izi, tablo adları) SIZDIRMAMAK.
 * Üretimde 500 yanıtları genel bir mesajdır; ayrıntı yalnızca sunucu loguna yazılır.
 */

const { HttpError } = require('../lib/errors');

/** PostgreSQL SQLSTATE kodları → HTTP karşılıkları */
const PG_ERROR_MAP = {
  '23505': { status: 409, message: 'Bu kayıt zaten var (benzersizlik kısıtı).' },
  '23503': { status: 409, message: 'İlişkili kayıt bulunamadığı için işlem yapılamadı.' },
  '23514': { status: 422, message: 'Gönderilen değer veritabanı kısıtlarına uymuyor.' },
  '22001': { status: 422, message: 'Gönderilen değer çok uzun.' },
  '22P02': { status: 400, message: 'Gönderilen değer beklenen biçimde değil.' },
  '22003': { status: 422, message: 'Gönderilen sayısal değer izin verilen aralığın dışında.' },
  '42601': { status: 500, message: 'Sorgu hatası.' },
};

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: `Bulunamadı: ${req.method} ${req.originalUrl}`,
      type: 'NotFoundError',
    },
  });
}

// eslint-disable-next-line no-unused-vars -- Express 4 imza argümanından hata yakalayıcıyı tanır
function errorHandler(err, req, res, next) {
  // Yanıt zaten gönderildiyse Express'e devret.
  if (res.headersSent) return next(err);

  let status = 500;
  let message = 'Sunucu tarafında beklenmeyen bir hata oluştu.';
  let details;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err && typeof err.code === 'string' && PG_ERROR_MAP[err.code]) {
    const mapped = PG_ERROR_MAP[err.code];
    status = mapped.status;
    message = mapped.message;
    details = { pgCode: err.code, constraint: err.constraint ?? null };
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    message = 'İstek gövdesi geçerli JSON değil.';
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    message = 'İstek gövdesi çok büyük.';
  } else if (err?.code === 'ECONNREFUSED' || (Array.isArray(err?.errors) && err.errors.some(e => e.code === 'ECONNREFUSED'))) {
    status = 503;
    message = 'PostgreSQL veritabanına bağlanılamadı. Lütfen PostgreSQL servisinin çalıştığından ve .env dosyasındaki bağlantı bilgilerinin doğru olduğundan emin olun.';
  }

  // Sunucu logu: üretimde bile ayrıntı burada kalır, istemciye gitmez.
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn('[error]', status, req.method, req.originalUrl, err.message);
  }

  const body = { error: { message, type: err?.name ?? 'Error' } };
  if (details !== undefined) body.error.details = details;
  // Geliştirmede yığın izini göstermek hata ayıklamayı hızlandırır.
  if (status >= 500 && process.env.NODE_ENV !== 'production' && err?.stack) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
  return undefined;
}

module.exports = { errorHandler, notFoundHandler };
