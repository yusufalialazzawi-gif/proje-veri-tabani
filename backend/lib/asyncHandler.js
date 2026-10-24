'use strict';

/**
 * Express 4 async route handler'ları reddedilen promise'leri kendiliğinden
 * yakalamaz. Bu sarmalayıcı hatayı merkezi errorHandler'a iletir; aksi halde
 * istek askıda kalır.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
