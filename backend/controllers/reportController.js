'use strict';

/**
 * Rapor uç noktaları.
 *
 * Sayısal toplamlar SQL görünümlerinden gelir; bu katman yalnızca tarih
 * doğrulaması yapar, profili getirir ve raporu sunar.
 *
 * Haftalık rapor önbelleği (weekly_reports) bayatladığında kendiliğinden
 * yeniden üretilir; ?refresh=1 ile de zorla yenilenebilir. Böylece "rapor
 * güncel veriyle çelişiyor" durumu kapalı biçimde çözülmüş olur.
 */

const reportService = require('../services/reportService');
const targetService = require('../services/targetService');
const { queryOne } = require('../db');
const { createValidator, todayLocal, parseDateOnly } = require('../lib/validate');
const { ValidationError, BadRequestError } = require('../lib/errors');
const { asyncHandler } = require('../lib/asyncHandler');

/** GET /api/reports/daily?date=YYYY-MM-DD */
const getDaily = asyncHandler(async (req, res) => {
  const rawDate = req.query.date ? String(req.query.date) : todayLocal();
  const date = parseDateOnly(rawDate);
  if (!date) {
    throw new BadRequestError('date parametresi YYYY-MM-DD biçiminde geçerli bir tarih olmalıdır.');
  }

  const report = await reportService.getDailyReport(req.user.id, date);
  res.json(report);
});

/**
 * GET /api/reports/weekly?start=YYYY-MM-DD&refresh=1
 * `start` haftanın herhangi bir günü olabilir; SQL tarafında fn_week_start()
 * ile Pazartesi'ye normalize edilir.
 */
const getWeekly = asyncHandler(async (req, res) => {
  const rawStart = req.query.start ? String(req.query.start) : todayLocal();
  const start = parseDateOnly(rawStart);
  if (!start) {
    throw new BadRequestError('start parametresi YYYY-MM-DD biçiminde geçerli bir tarih olmalıdır.');
  }

  const refresh = parseBoolean(req.query.refresh);

  // Analiz motoru yaş ve hedef bilgisini profilden okur; ham satır verilir.
  const profileRow = await queryOne(targetService.USER_SQL, [req.user.id]);
  if (!profileRow) throw new ValidationError('Profil bulunamadı.');

  const report = await reportService.getWeeklyReport(req.user.id, start, {
    refresh,
    profileRow,
  });

  if (!report) throw new BadRequestError('Hafta hesaplanamadı.');

  res.json(report);
});

/** ?refresh=1, true, yes, on → true. Boş veya geçersiz değer → false. */
function parseBoolean(raw) {
  if (raw === undefined || raw === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

module.exports = { getDaily, getWeekly };
