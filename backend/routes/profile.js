'use strict';

/**
 * Kullanıcı profili ve günlük hedefler.
 *
 * GET /api/profile — profil + bugünün hedefleri + form seçenekleri (kaynaklarıyla)
 * PUT /api/profile — profili günceller ve hedefleri zorla yeniden hesaplatır
 *
 * PUT bilinçli olarak TAM DEĞİŞTİRME anlamı taşır: gönderilmeyen isteğe bağlı
 * alanlar NULL olur. Arayüz her zaman mevcut değerleri doldurup gönderir.
 */

const express = require('express');
const controller = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.getProfile);
router.put('/', controller.updateProfile);

module.exports = router;
