'use strict';

/**
 * Rapor uç noktaları: günlük özet ve haftalık analiz.
 *
 * GET /api/reports/daily?date=YYYY-MM-DD
 * GET /api/reports/weekly?start=YYYY-MM-DD[&refresh=1]
 *
 * Haftalık rapor weekly_reports tablosunda önbelleğe alınır; kayıt verisi
 * değiştiğinde (v_weekly_report_freshness.is_stale) kendiliğinden yeniden üretilir.
 */

const express = require('express');
const controller = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/daily', controller.getDaily);
router.get('/weekly', controller.getWeekly);

module.exports = router;
