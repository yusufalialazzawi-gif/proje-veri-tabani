'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

// .env proje kökünde aranır (npm script'leri nereden çalıştırılırsa çalışsın).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const config = {
  nodeEnv,
  isProduction,
  port: toInt(process.env.PORT, 3000),

  db: {
    // DATABASE_URL tanımlıysa pg onu kullanır; değilse ayrı alanlar kullanılır.
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || 'localhost',
    port: toInt(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE || 'nutrition_tracker',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    max: toInt(process.env.PGPOOL_MAX, 10),
    idleTimeoutMillis: toInt(process.env.PGPOOL_IDLE_TIMEOUT_MS, 30000),
    // Bağlantı kurulamazsa sonsuz beklemek yerine hızlı hata ver.
    connectionTimeoutMillis: toInt(process.env.PGCONNECT_TIMEOUT_MS, 5000),
    ssl: toBool(process.env.PGSSL, false) ? { rejectUnauthorized: false } : false,
  },

  frontendDir: path.resolve(
    __dirname,
    '..',
    process.env.FRONTEND_DIR || 'frontend',
  ),

  session: {
    ttlDays: toInt(process.env.SESSION_TTL_DAYS, 7),
    cookieName: process.env.SESSION_COOKIE_NAME || 'nt_session',
    // Üretimde zorla true: çerez yalnızca HTTPS üzerinden gönderilir.
    secure: isProduction ? true : toBool(process.env.COOKIE_SECURE, false),
  },

  rateLimit: {
    loginWindowMinutes: toInt(process.env.LOGIN_RATE_WINDOW_MINUTES, 15),
    loginMaxAttempts: toInt(process.env.LOGIN_RATE_MAX_ATTEMPTS, 10),
    registerMaxAttempts: toInt(process.env.REGISTER_RATE_MAX_ATTEMPTS, 5),
  },

  nutrition: {
    weeklyMinCoverageDays: toInt(process.env.WEEKLY_MIN_COVERAGE_DAYS, 4),
    servingGrams: Number(process.env.SERVING_GRAMS) || 80,
  },
};

/**
 * Uygulama kritik yapılandırma eksikse başlangıçta durur.
 * Parola boşken sessizce çalışmak yerine açık hata verir.
 */
function assertConfig() {
  const problems = [];

  if (!config.db.connectionString && !config.db.password) {
    problems.push(
      'Veritabanı parolası tanımlı değil. .env.example dosyasını .env olarak kopyalayıp PGPASSWORD (veya DATABASE_URL) değerini doldurun.',
    );
  }
  if (config.session.ttlDays < 1 || config.session.ttlDays > 90) {
    problems.push('SESSION_TTL_DAYS 1 ile 90 arasında olmalıdır.');
  }
  if (config.nutrition.servingGrams <= 0) {
    problems.push('SERVING_GRAMS sıfırdan büyük olmalıdır.');
  }
  if (config.nutrition.weeklyMinCoverageDays < 1 || config.nutrition.weeklyMinCoverageDays > 7) {
    problems.push('WEEKLY_MIN_COVERAGE_DAYS 1 ile 7 arasında olmalıdır.');
  }

  if (problems.length > 0) {
    throw new Error(`Yapılandırma hatası:\n  - ${problems.join('\n  - ')}`);
  }
}

module.exports = { config, assertConfig };
