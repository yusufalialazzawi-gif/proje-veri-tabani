'use strict';

/**
 * Besin kataloğu uç noktaları.
 *
 * Okuma (listeleme/arama/ayrıntı) giriş gerektirmez: besin verisi herkese açık
 * bir referans veri kümesidir ve kaynak bilgisiyle birlikte sunulur.
 *
 * Yazma (POST /api/foods) yalnızca YÖNETİCİ kullanıcıya açıktır; kontrol
 * foodController.createFood içindedir.
 */

const express = require('express');
const controller = require('../controllers/foodController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', controller.listFoods);
router.get('/categories', controller.listCategories);
router.get('/:id', controller.getFood);
router.post('/', requireAuth, controller.createFood);

module.exports = router;
