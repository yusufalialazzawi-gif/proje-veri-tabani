'use strict';

/**
 * Kimlik doğrulama uç noktaları.
 *
 * Giriş ve kayıt uç noktaları hız sınırlamasına tabidir: parola denemelerinin
 * otomatik olarak tekrar tekrar denenmesini (kaba kuvvet) zorlaştırır.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { config } = require('../config');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMinutes * 60 * 1000,
  limit: config.rateLimit.loginMaxAttempts,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      status: 429,
      message: 'Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.',
    },
  },
});

const registerLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMinutes * 60 * 1000,
  limit: config.rateLimit.registerMaxAttempts,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      status: 429,
      message: 'Çok fazla kayıt denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.',
    },
  },
});

router.post('/register', registerLimiter, controller.register);
router.post('/login', loginLimiter, controller.login);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);
router.post('/change-password', requireAuth, controller.changePassword);

module.exports = router;
