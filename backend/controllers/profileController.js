'use strict';

/**
 * Kullanıcı profili ve günlük hedefler.
 *
 * PUT /api/profile bir TAM GÜNCELLEMEDİR: gönderilen profil alanlarının tümü
 * yazılır, gönderilmeyen alan null olur. Bu davranış bilinçlidir; kısmi
 * güncelleme (PATCH) yapılmaz çünkü form her zaman tüm alanları gönderir ve
 * "alanı temizlemek" ile "alanı göndermemek" ayrımı belirsizleşir.
 */

const { query } = require('../db');
const { createValidator, todayLocal } = require('../lib/validate');
const { ValidationError } = require('../lib/errors');
const { asyncHandler } = require('../lib/asyncHandler');
const targetService = require('../services/targetService');
const {
  ACTIVITY_LEVELS,
  GOAL_LABELS,
} = require('../services/nutritionTargets');
const { REFERENCES } = require('../services/references');
const {
  ACTIVITY_VALUES,
  GOAL_VALUES,
  validateProfileFields,
} = require('./authController');

/** users satırını API yanıt biçimine çevirir. */
function mapProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    age: row.age,
    biologicalSex: row.biological_sex,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    activityLevel: row.activity_level,
    goal: row.goal,
    dietaryRestrictions: row.dietary_restrictions,
    isAdmin: row.is_admin === true,
    createdAt: row.created_at,
  };
}

/** Form seçeneklerini kaynak bilgisiyle birlikte döner (arayüzde gösterilir). */
function formMetadata() {
  return {
    biologicalSexOptions: [
      { value: 'female', label: 'Kadın' },
      { value: 'male', label: 'Erkek' },
      {
        value: 'unspecified',
        label: 'Belirtmek istemiyorum',
        note: 'BMR hesaplanamaz: Mifflin-St Jeor denklemi cinsiyete göre farklı sabit kullanır.',
      },
    ],
    activityLevelOptions: ACTIVITY_VALUES.map((key) => {
      const lvl = ACTIVITY_LEVELS[key];
      return {
        value: key,
        label: lvl.label,
        description: lvl.description,
        palRange: `${lvl.palMin.toFixed(2)}–${lvl.palMax.toFixed(2)}`,
        usedFactor: lvl.activityFactor,
        faoCategory: lvl.faoCategory,
      };
    }),
    goalOptions: [
      { value: 'maintain', label: GOAL_LABELS.maintain },
      { value: 'lose', label: GOAL_LABELS.lose },
      { value: 'gain', label: GOAL_LABELS.gain },
    ],
    activitySource: {
      organisation: REFERENCES.FAO_WHO_UNU_2004.organisation,
      title: REFERENCES.FAO_WHO_UNU_2004.title,
      year: REFERENCES.FAO_WHO_UNU_2004.year,
      url: REFERENCES.FAO_WHO_UNU_2004.url,
      note: 'PAL = toplam enerji harcaması / BMR. Uygulama kategori aralığının orta noktasını kullanır; bu bir yaklaşıklıktır.',
    },
    bmrSource: {
      organisation: REFERENCES.MIFFLIN_ST_JEOR_1990.organisation,
      title: REFERENCES.MIFFLIN_ST_JEOR_1990.title,
      citation: REFERENCES.MIFFLIN_ST_JEOR_1990.citation,
      year: REFERENCES.MIFFLIN_ST_JEOR_1990.year,
      url: REFERENCES.MIFFLIN_ST_JEOR_1990.url,
      formula: 'BMR = 10×kg + 6.25×cm − 5×yaş + (erkek +5 / kadın −161)',
      limitations: REFERENCES.MIFFLIN_ST_JEOR_1990.limitations,
    },
  };
}

/** GET /api/profile */
const getProfile = asyncHandler(async (req, res) => {
  const date = req.query.date ? String(req.query.date) : todayLocal();

  const { targets, recalculated, user } = await targetService.ensureDailyTargets(
    req.user.id,
    date,
  );

  res.json({
    user: mapProfileRow(user),
    targets: { date, recalculated, ...targets },
    form: formMetadata(),
  });
});
/** PUT /api/profile */
const updateProfile = asyncHandler(async (req, res) => {
  const v = createValidator(req.body ?? {});
  v.string('name', { required: false, min: 1, max: 100 });
  validateProfileFields(v);

  if (!v.ok) throw new ValidationError('Profil bilgileri doğrulanamadı.', v.errors);

  await query(
    `UPDATE users
        SET name = coalesce($2, name),
            age = $3,
            biological_sex = $4,
            height_cm = $5,
            weight_kg = $6,
            activity_level = $7,
            goal = $8,
            dietary_restrictions = $9
      WHERE id = $1`,
    [
      req.user.id,
      v.values.name ?? null,
      v.values.age ?? null,
      v.values.biologicalSex ?? null,
      v.values.heightCm ?? null,
      v.values.weightKg ?? null,
      v.values.activityLevel ?? null,
      v.values.goal ?? null,
      v.values.dietaryRestrictions ?? null,
    ],
  );

  // Profil değiştiği için bugünün hedefleri zorla yeniden hesaplanır.
  // users.updated_at trigger ile now() oldu; ensureDailyTargets bayatlığı görür.
  const date = todayLocal();
  const { targets, recalculated, user } = await targetService.ensureDailyTargets(
    req.user.id,
    date,
    { force: true },
  );

  res.json({
    message: 'Profil güncellendi.',
    user: mapProfileRow(user),
    targets: { date, recalculated, ...targets },
    form: formMetadata(),
  });
});

module.exports = { getProfile, updateProfile, formMetadata };
