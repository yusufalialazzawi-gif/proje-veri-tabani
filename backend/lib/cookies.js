'use strict';

const { config } = require('../config');

/**
 * Oturum çerezi ayarları.
 *  - httpOnly: JavaScript çerezi okuyamaz (XSS ile oturum çalma riskini azaltır)
 *  - sameSite=lax: siteler arası isteklerde çerez gönderilmez (CSRF yüzeyini daraltır)
 *  - secure: üretimde zorunlu true; yalnızca HTTPS üzerinden gönderilir
 *  - path=/: tüm uygulama aynı çerezi kullanır
 */
function setSessionCookie(res, sessionId) {
  res.cookie(config.session.cookieName, sessionId, {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.session.ttlDays * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = { setSessionCookie, clearSessionCookie };
