'use strict';

/**
 * API yönlendiricilerini tek yerden toplar.
 *
 * Prompt'ta istenen uç noktaların tamamı burada eşlenir:
 *   GET    /api/foods              -> foods
 *   GET    /api/foods/:id          -> foods
 *   POST   /api/foods              -> foods (yalnızca yönetici)
 *   GET    /api/meals?date=        -> meals
 *   POST   /api/meals              -> meals
 *   POST   /api/meals/:id/items    -> meals
 *   PUT    /api/meal-items/:id     -> meal-items
 *   DELETE /api/meal-items/:id     -> meal-items
 *   GET    /api/reports/daily      -> reports
 *   GET    /api/reports/weekly     -> reports
 *   GET    /api/profile            -> profile
 *   PUT    /api/profile            -> profile
 *
 * Ek olarak: /api/auth/* (oturum + parola) ve /api/health.
 */

const express = require('express');
const authRoutes = require('./auth');
const foodRoutes = require('./foods');
const { mealsRouter, mealItemsRouter } = require('./meals');
const reportRoutes = require('./reports');
const profileRoutes = require('./profile');
const { attachUser } = require('../middleware/auth');
const { checkConnection } = require('../db');

const router = express.Router();

/**
 * Oturumu her API isteğinde çözer. Hata fırlatmaz; oturum yoksa req.user boş
 * kalır ve requireAuth ilgili uç noktada 401 üretir.
 */
router.use(attachUser);

/** Servis ayakta mı ve veritabanına ulaşabiliyor mu? */
router.get('/health', async (_req, res) => {
  const db = await checkConnection();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    database: db.ok ? 'connected' : 'unreachable',
    detail: db.ok ? null : db.error,
    time: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/foods', foodRoutes);
router.use('/meals', mealsRouter);
router.use('/meal-items', mealItemsRouter);
router.use('/reports', reportRoutes);
router.use('/profile', profileRoutes);

module.exports = router;
