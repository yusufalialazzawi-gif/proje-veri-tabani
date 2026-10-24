'use strict';

/**
 * Uygulama giriş noktası.
 *
 * Katmanlar:
 *   express.static  -> frontend (index.html, style.css, app.js)
 *   /api            -> REST uç noktaları (backend/routes)
 *   hata katmanı    -> merkezi errorHandler
 *
 * GÜVENLİK:
 *   - helmet: varsayılan güvenlik başlıkları + sıkı CSP (yalnızca kendi
 *     kaynaklarımız; harici script/stil yok, satır içi script yok).
 *   - express.json boyut sınırı: büyük gövdelerle kaynak tüketimi engellenir.
 *   - Oturum çerezi httpOnly + sameSite=lax; üretimde ayrıca secure.
 *   - Giriş/kayıt uç noktalarında hız sınırlaması (backend/routes/auth.js).
 *   - Tüm SQL parametreli; kullanıcı girdisi hiçbir yerde SQL metnine
 *     birleştirilmez (tek istisna: ORDER BY sütun adı, o da beyaz listeden).
 */

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { config, assertConfig } = require('./config');
const apiRouter = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { checkConnection, closePool } = require('./db');

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      // Arayüz ve API aynı origin'den sunuluyor; çapraz origin ihtiyacı yok.
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  // Frontend: index.html kökten sunulur, diğer dosyalar statik.
  app.use(
    express.static(config.frontendDir, {
      index: 'index.html',
      extensions: ['html'],
      setHeaders(res, filePath) {
        // HTML önbelleğe alınmasın; JS/CSS sürümlemede dosya adı değişmese de
        // kısa önbellek yeterlidir.
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    }),
  );

  // Bilinmeyen API yolları HTML 404 değil JSON 404 döner.
  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Sunucuyu başlatır: yapılandırmayı doğrula, veritabanına ulaş, dinle. */
async function start() {
  assertConfig();

  const db = await checkConnection();
  if (!db.ok) {
    console.warn(
      '[başlangıç] UYARI: PostgreSQL bağlantısı kurulamadı:\n' +
        `  ${db.error || 'Bağlantı sağlanamadı.'}\n` +
        '  1) PostgreSQL çalışıyor mu?  2) .env değerleri doğru mu?\n' +
        '  3) Veritabanı oluşturuldu mu? (README "Kurulum" bölümü)',
    );
    if (config.isProduction) {
      process.exitCode = 1;
      return null;
    }
    console.log('[başlangıç] Geliştirme modunda arayüz sunumu için sunucu yine de başlatılıyor...');
  } else {
    console.log('[başlangıç] PostgreSQL bağlantısı kuruldu.');
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[başlangıç] Sunucu hazır: http://localhost:${config.port}`);
    console.log(`[başlangıç] Ortam: ${config.nodeEnv}`);
    console.log(`[başlangıç] Frontend: ${config.frontendDir}`);
  });

  /** SIGINT/SIGTERM: bekleyen istekleri bitir, havuzu kapat. */
  const shutdown = async (signal) => {
    console.log(`\n[kapanış] ${signal} alındı, sunucu kapatılıyor...`);
    server.close(async () => {
      try {
        await closePool();
        console.log('[kapanış] Bağlantı havuzu kapatıldı.');
        process.exit(0);
      } catch (err) {
        console.error('[kapanış] Havuz kapatılırken hata:', err.message);
        process.exit(1);
      }
    });
    // 10 saniye içinde kapanmazsa zorla çık.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

// Doğrudan çalıştırıldıysa başlat; testler createApp()'i import edebilir.
if (require.main === module) {
  start().catch((err) => {
    console.error('[başlangıç] Sunucu başlatılamadı:', err.message);
    process.exit(1);
  });
}

module.exports = { createApp, start };
