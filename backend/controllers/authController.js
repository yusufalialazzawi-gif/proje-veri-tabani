'use strict';

const authService = require('../services/authService');
const { createValidator } = require('../lib/validate');
const { ValidationError } = require('../lib/errors');
const { asyncHandler } = require('../lib/asyncHandler');
const { setSessionCookie, clearSessionCookie } = require('../lib/cookies');
const { ACTIVITY_LEVELS, GOAL_LABELS } = require('../services/nutritionTargets');

const SEX_VALUES = ['female', 'male', 'unspecified'];
const ACTIVITY_VALUES = Object.keys(ACTIVITY_LEVELS);
const GOAL_VALUES = Object.keys(GOAL_LABELS);

/**
 * Profil alanlarını doğrular (kayıt ve profil güncellemede ortak).
 *
 * Tüm profil alanları İSTEĞE BAĞLIDIR. Eksik bırakıldığında hata üretilmez:
 * hedef hesaplayıcı eksik bilgiyi görünce NULL hedef döner ve arayüz bunu
 * açıkça söyler. Böylece eksik veri için sahte bir kesinlik oluşturulmaz.
 */
function validateProfileFields(v) {
  v.int('age', { required: false, min: 1, max: 120 });
  v.enum('biologicalSex', SEX_VALUES, { required: false });
  v.number('heightCm', { required: false, min: 40, max: 250, decimals: 1 });
  v.number('weightKg', { required: false, min: 2, max: 400, decimals: 1 });
  v.enum('activityLevel', ACTIVITY_VALUES, { required: false });
  v.enum('goal', GOAL_VALUES, { required: false });
  v.string('dietaryRestrictions', { required: false, max: 500, emptyAsNull: true });
}

/**
 * POST /api/auth/register
 * Hesap oluşturur ve oturum açar. Profil bilgileri isteğe bağlıdır; eksikse
 * hedefler hesaplanmaz ve arayüz bunu söyler.
 */
const register = asyncHandler(async (req, res) => {
  const v = createValidator(req.body ?? {});
  v.email('email');
  v.password('password');
  v.string('name', { required: true, min: 1, max: 100 });
  validateProfileFields(v);

  if (!v.ok) throw new ValidationError('Kayıt bilgileri doğrulanamadı.', v.errors);

  const { user, sessionId } = await authService.registerUser({
    email: v.values.email,
    password: v.values.password,
    name: v.values.name,
    profile: {
      age: v.values.age,
      biologicalSex: v.values.biologicalSex,
      heightCm: v.values.heightCm,
      weightKg: v.values.weightKg,
      activityLevel: v.values.activityLevel,
      goal: v.values.goal,
      dietaryRestrictions: v.values.dietaryRestrictions,
    },
    userAgent: req.get('user-agent') ?? null,
  });

  setSessionCookie(res, sessionId);
  res.status(201).json({ user, message: 'Hesap oluşturuldu ve oturum açıldı.' });
});

/**
 * POST /api/auth/login
 * Hata mesajı bilinçli olarak geneldir: hangi alanın yanlış olduğu söylenmez.
 */
const login = asyncHandler(async (req, res) => {
  const v = createValidator(req.body ?? {});
  v.email('email');
  v.string('password', { required: true, min: 1, max: 72, trim: false });

  if (!v.ok) throw new ValidationError('Giriş bilgileri doğrulanamadı.', v.errors);

  const { user, sessionId } = await authService.loginUser({
    email: v.values.email,
    password: v.values.password,
    userAgent: req.get('user-agent') ?? null,
  });

  setSessionCookie(res, sessionId);
  res.json({ user, message: 'Giriş başarılı.' });
});

/** POST /api/auth/logout — oturumu iptal eder ve çerezi siler. */
const logout = asyncHandler(async (req, res) => {
  if (req.sessionId) await authService.logoutSession(req.sessionId);
  clearSessionCookie(res);
  res.json({ message: 'Çıkış yapıldı.' });
});

/** GET /api/auth/me — aktif oturumun kullanıcısı (yoksa 401). */
const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/change-password
 * Parolayı değiştirir ve TÜM oturumları iptal eder; kullanıcı yeni parolayla
 * yeniden giriş yapar. Eski çerezler geçersizleşir.
 */
const changePassword = asyncHandler(async (req, res) => {
  const v = createValidator(req.body ?? {});
  v.string('currentPassword', { required: true, min: 1, max: 72, trim: false });
  v.password('newPassword');

  if (!v.ok) throw new ValidationError('Parola değiştirilemedi.', v.errors);

  await authService.changePassword({
    userId: req.user.id,
    currentPassword: v.values.currentPassword,
    newPassword: v.values.newPassword,
  });

  clearSessionCookie(res);
  res.json({ message: 'Parola güncellendi. Tüm oturumlar kapatıldı; yeniden giriş yapın.' });
});

module.exports = {
  register,
  login,
  logout,
  me,
  changePassword,
  SEX_VALUES,
  ACTIVITY_VALUES,
  GOAL_VALUES,
  validateProfileFields,
};
