'use strict';

/**
 * HTTP hata sınıfları. Controller'lar bunları fırlatır, merkezi hata
 * yakalayıcı (middleware/errorHandler.js) uygun durum koduna çevirir.
 * Böylece hata mesajları anlaşılır ve tutarlı biçimde döner.
 */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON() {
    const body = { error: { message: this.message, type: this.name } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

class BadRequestError extends HttpError {
  constructor(message = 'İstek geçersiz.', details) {
    super(400, message, details);
  }
}

class ValidationError extends HttpError {
  constructor(message = 'Gönderilen veriler doğrulanamadı.', details) {
    super(422, message, details);
  }
}

class UnauthorizedError extends HttpError {
  constructor(message = 'Bu işlem için giriş yapmalısınız.') {
    super(401, message);
  }
}

class ForbiddenError extends HttpError {
  constructor(message = 'Bu işlem için yetkiniz yok.') {
    super(403, message);
  }
}

class NotFoundError extends HttpError {
  constructor(message = 'Kayıt bulunamadı.') {
    super(404, message);
  }
}

class ConflictError extends HttpError {
  constructor(message = 'Bu kayıt zaten mevcut.', details) {
    super(409, message, details);
  }
}

module.exports = {
  HttpError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
