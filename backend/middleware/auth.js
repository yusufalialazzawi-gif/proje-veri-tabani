'use strict';

/**
 * Oturum middleware'leri.
 *
 * attachUser: çerezdeki session_id'yi çözer, req.user'ı doldurur. Hata
 * fırlatmaz — oturum yoksa req.user undefined kalır.
 *
 * requireAuth: oturum yoksa 401 döner. Korunan tüm route'larda kullanılır.
 */

const { config } = require('../config');
const authService = require('../services/authService');
const { UnauthorizedError } = require('../lib/errors');

async function attachUser(req, _res, next) {
  try {
    const sessionId = req.cookies?.[config.session.cookieName];
    if (sessionId) {
      const user = await authService.resolveSession(sessionId);
      if (user) {
        req.user = user;
        req.sessionId = sessionId;
      }
    }
  } catch (err) {
    // Oturum çözülemezse isteği düşürme; requireAuth zaten 401 verir.
    console.error('[auth] oturum çözümleme hatası:', err.message);
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Bu işlem için giriş yapmalısınız.'));
  }
  return next();
}

module.exports = { attachUser, requireAuth };
