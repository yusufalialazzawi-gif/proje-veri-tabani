'use strict';

/**
 * Günlük besin hedeflerinin hesaplanması.
 *
 * Bu modül bilimsel referansları (references.js) sayısal hedeflere çevirir.
 * Üç ilke bütün hesaplamalara uygulanır:
 *
 *  1. SAHTE KESİNLİK YOK: gerekli profil bilgisi eksikse hedef NULL döner.
 *     Uydurma bir varsayılan değer atanmaz.
 *  2. TEK HEDEF YOK: protein/karbonhidrat/yağ/enerji için ARALIK üretilir,
 *     çünkü kılavuzlar arasında gerçek farklılıklar vardır.
 *  3. KAYNAK TAŞINIR: her sayı, hangi kaynaktan türediğini yanında taşır ve
 *     arayüzde gösterilir.
 *
 * Hedefler genel sağlıklı YETİŞKİNLER (19+) içindir. Çocuklar, ergenler,
 * gebeler/emzirenler ve kronik hastalığı olanlar için otomatik uygulanmaz.
 */

const { REFERENCES, SERVING_GRAMS_DEFAULT } = require('./references');

/* -------------------------------------------------------------------------- */
/* Aktivite düzeyleri — FAO/WHO/UNU (2004) PAL kategorileri                    */
/* -------------------------------------------------------------------------- */
/* PAL = toplam enerji harcaması / BMR. Kategori aralıkları doğrudan
 * FAO/WHO/UNU 2004 raporundan alınmıştır. Uygulama kategori ORTA NOKTASINI
 * kullanır; bu bir yaklaşıklıktır ve APP_ASSUMPTION olarak işaretlenir.
 */
const ACTIVITY_LEVELS = {
  sedentary: {
    key: 'sedentary',
    label: 'Hareketsiz / hafif aktif',
    description: 'Masa başı iş, az veya hiç düzenli egzersiz',
    palMin: 1.4,
    palMax: 1.69,
    activityFactor: 1.55,
    faoCategory: 'Sedentary or light activity lifestyle',
  },
  moderately_active: {
    key: 'moderately_active',
    label: 'Orta derecede aktif',
    description: 'Ayakta çalışılan iş veya haftada birkaç gün düzenli egzersiz',
    palMin: 1.7,
    palMax: 1.99,
    activityFactor: 1.85,
    faoCategory: 'Active or moderately active lifestyle',
  },
  very_active: {
    key: 'very_active',
    label: 'Çok aktif',
    description: 'Ağır fiziksel iş veya günde 1 saatten fazla yoğun egzersiz',
    palMin: 2.0,
    palMax: 2.4,
    activityFactor: 2.2,
    faoCategory: 'Vigorous or vigorously active lifestyle',
  },
};

/** Hedeflerin geçerli olduğu yaş grubu. Mifflin-St Jeor yetişkinlerde türetilmiştir. */
const ADULT_MIN_AGE = 19;

/* Enerji ayarı (APP_ASSUMPTION): geleneksel planlama aralıkları. */
const GOAL_ADJUSTMENTS = {
  maintain: { minKcal: 0, maxKcal: 0, label: 'Mevcut kiloyu koruma' },
  lose: { minKcal: -500, maxKcal: -300, label: 'Kilo verme' },
  gain: { minKcal: 250, maxKcal: 450, label: 'Kilo alma' },
};

/* Kilo verme hedefinde uygulanacak taban. Bu değer bir klinik kılavuz değil,
 * yaygın kullanılan bir güvenlik tabanıdır ve APP_ASSUMPTION olarak işaretlenir. */
const UNSUPERVISED_LOSS_FLOOR_KCAL = { female: 1200, male: 1500 };

/* Atwater genel faktörleri (kcal/g) — AMDR yüzdelerini grama çevirmek için. */
const KCAL_PER_G = { protein: 4, carbohydrate: 4, fat: 9 };

/* AMDR (IOM/National Academies 2005): enerjinin yüzdesi olarak aralıklar. */
const AMDR = {
  carbohydrate: { minPct: 0.45, maxPct: 0.65 },
  protein: { minPct: 0.1, maxPct: 0.35 },
  fat: { minPct: 0.2, maxPct: 0.35 },
};

/* DGA 2025-2030: 2000 kcal deseni için günlük porsiyonlar. */
const DGA_2000_KCAL_PATTERN = { calories: 2000, vegetableServings: 3, fruitServings: 2 };

/* EFSA 2012 yetişkin protein PRI ve DGA 2025-2030 protein aralığı (g/kg/gün). */
const PROTEIN_G_PER_KG = {
  efsaPri: 0.83,
  iomRda: 0.8,
  dga2025Min: 1.2,
  dga2025Max: 1.6,
};

/* EFSA 2010: yetişkinler için yeterli lif alımı. */
const FIBRE_ADEQUATE_INTAKE_G = 25;
/* IOM 2005 / DGA: 1000 kcal başına lif. */
const FIBRE_G_PER_1000_KCAL = 14;

/* WHO serbest şeker ve doymuş yağ enerji yüzdeleri. */
const FREE_SUGARS_MAX_PCT = 0.1; // güçlü öneri
const FREE_SUGARS_CONDITIONAL_PCT = 0.05; // koşullu öneri
const SATURATED_FAT_MAX_PCT = 0.1;
const TRANS_FAT_MAX_PCT = 0.01;

/* DGA 2020-2025: 2000 kcal için haftada 1.5 kase-eşdeğeri kuru baklagil.
 * 1 kase-eşdeğeri pişmiş baklagil ≈ 180 g (USDA porsiyon ağırlıkları).
 * 1.5 × 180 = 270 g/hafta → 80 g'lık porsiyonla 3.375 porsiyon/hafta
 * → günde ~0.48 porsiyon → 0.5 porsiyon/gün. Türetme APP_ASSUMPTION'dır. */
const LEGUME_WEEKLY_CUP_EQ_2000_KCAL = 1.5;
const LEGUME_CUP_EQUIVALENT_GRAMS = 180;

/* -------------------------------------------------------------------------- */
/* Yardımcılar                                                                 */
/* -------------------------------------------------------------------------- */

const round = (value, decimals = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

const roundToHalf = (value) => {
  if (value === null || value === undefined) return null;
  return Math.round(value * 2) / 2;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/* -------------------------------------------------------------------------- */
/* BMR — Mifflin-St Jeor (1990)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bazal metabolizma hızını hesaplar.
 *
 * @returns {{value: number|null, method: string, applicable: boolean,
 *            missingFields: string[], warnings: string[]}}
 *          Gerekli bilgi eksikse value=null ve applicable=false döner.
 */
function computeBmr({ age, biologicalSex, heightCm, weightKg }) {
  const warnings = [];
  const missingFields = [];

  const ageNum = toNumber(age);
  const heightNum = toNumber(heightCm);
  const weightNum = toNumber(weightKg);

  if (ageNum === null) missingFields.push('age');
  if (!biologicalSex || biologicalSex === 'unspecified') missingFields.push('biological_sex');
  if (heightNum === null) missingFields.push('height_cm');
  if (weightNum === null) missingFields.push('weight_kg');

  const base = {
    value: null,
    method: 'mifflin_st_jeor_1990',
    applicable: false,
    missingFields,
    warnings,
  };

  if (missingFields.length > 0) {
    const labels = {
      age: 'yaş',
      biological_sex: 'biyolojik cinsiyet',
      height_cm: 'boy',
      weight_kg: 'kilo',
    };
    warnings.push(
      `Eksik bilgi: ${missingFields.map((f) => labels[f] ?? f).join(', ')}. Bu alanlar olmadan enerji gereksinimi hesaplanamaz ve tahmin uydurulmaz.`,
    );
    if (missingFields.includes('biological_sex')) {
      warnings.push(
        'Mifflin-St Jeor denklemi cinsiyete göre farklı sabit kullanır (erkek +5, kadın -161). Cinsiyet belirtilmediğinde bu sabit seçilemediği için BMR hesaplanmaz.',
      );
    }
    return base;
  }

  // Yaş sınırı: denklem sağlıklı yetişkinlerde türetilmiştir.
  if (ageNum < ADULT_MIN_AGE) {
    warnings.push(
      `Mifflin-St Jeor denklemi ${ADULT_MIN_AGE} yaş ve üzeri sağlıklı yetişkinlerde türetilmiştir. ${ageNum} yaş için yetişkin hedefleri otomatik uygulanmaz; çocuk ve ergenlerde büyüme nedeniyle enerji gereksinimi farklı yöntemlerle (FAO/WHO/UNU yaşa özgü denklemler) belirlenir. Bir sağlık profesyoneline veya diyetisyene danışın.`,
    );
    return base;
  }

  if (ageNum > 80) {
    warnings.push(
      '80 yaş üzerinde Mifflin-St Jeor doğruluğu azalır; kas kütlesi kaybı nedeniyle tahmin sapabilir.',
    );
  }

  const sexConstant = biologicalSex === 'male' ? 5 : -161;
  const bmr = 10 * weightNum + 6.25 * heightNum - 5 * ageNum + sexConstant;

  if (bmr <= 0) {
    warnings.push(
      'Girilen boy/kilo/yaş kombinasyonu gerçek dışı bir BMR üretiyor. Lütfen değerleri kontrol edin.',
    );
    return { ...base, warnings };
  }

  // Denklem normal-aşırı kilo aralığındaki yetişkinlerde doğrulandı.
  const heightM = heightNum / 100;
  const bmi = weightNum / (heightM * heightM);
  if (bmi < 16 || bmi > 45) {
    warnings.push(
      `Beden kütle indeksi ${round(bmi, 1)} çıktı. Mifflin-St Jeor bu aralığın dışında doğrulanmadı; sonuç güvenilir olmayabilir.`,
    );
  }

  warnings.push(
    'BMR bir TAHMİNDİR (denklem varyansın ~%71’ini açıklar), laboratuvar ölçümü değildir. BMR ile günlük toplam enerji harcaması (TDEE) farklı kavramlardır.',
  );

  return {
    value: round(bmr, 0),
    rawValue: bmr,
    method: 'mifflin_st_jeor_1990',
    applicable: true,
    missingFields: [],
    warnings,
    bmi: round(bmi, 1),
  };
}

/* -------------------------------------------------------------------------- */
/* TDEE = BMR × PAL                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Günlük toplam enerji harcamasını tahmin eder.
 * Aktivite düzeyi bilinmiyorsa NULL döner — varsayılan katsayı uydurulmaz.
 */
function computeTdee(bmr, activityLevel) {
  const warnings = [];

  if (!bmr || bmr.value === null) {
    return { value: null, activityFactor: null, warnings: ['BMR hesaplanamadığı için TDEE hesaplanamadı.'] };
  }

  const level = ACTIVITY_LEVELS[activityLevel];
  if (!level) {
    warnings.push(
      'Fiziksel aktivite düzeyi seçilmediği veya bilinmediği için günlük toplam enerji harcaması hesaplanamadı. Aktivite katsayısı uydurulmaz.',
    );
    return { value: null, activityFactor: null, warnings };
  }

  const tdee = bmr.value * level.activityFactor;
  warnings.push(
    `TDEE = BMR × ${level.activityFactor} (FAO/WHO/UNU "${level.faoCategory}" aralığı ${level.palMin.toFixed(2)}-${level.palMax.toFixed(2)}, kategori orta noktası kullanıldı). Sonuç tahmindir; ±%10 sapma normaldir.`,
  );

  return {
    value: round(tdee, 0),
    rawValue: tdee,
    activityFactor: level.activityFactor,
    palRange: { min: level.palMin, max: level.palMax },
    tdeeRange: {
      min: round(bmr.value * level.palMin, 0),
      max: round(bmr.value * level.palMax, 0),
    },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Günlük hedefler                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Kullanıcı profilinden günlük hedefleri üretir.
 *
 * @param {object} profile - users satırı (camelCase)
 * @param {number} [servingGrams] - 1 porsiyon gramı (varsayılan 80, WHO)
 * @returns {object} hedefler + kaynaklar + uyarılar
 */
function computeDailyTargets(profile, servingGrams = SERVING_GRAMS_DEFAULT) {
  const warnings = [];
  const goal = profile.goal && GOAL_ADJUSTMENTS[profile.goal] ? profile.goal : 'maintain';

  const bmr = computeBmr(profile);
  warnings.push(...bmr.warnings);

  const tdee = bmr.applicable ? computeTdee(bmr, profile.activityLevel) : { value: null, warnings: [] };
  warnings.push(...tdee.warnings);

  // Standart kapsayıcılık uyarısı: hangi popülasyon için geçerli.
  warnings.push(
    'Hedefler genel sağlıklı yetişkinler (19+) içindir. Gebelik, emzirme, kronik hastalık, düzenli ilaç kullanımı veya sporcu beslenmesi durumlarında bu hedefler otomatik uygulanmaz; bir diyetisyene danışın.',
  );

  const result = {
    computedAt: null,
    applicable: false,
    bmrKcal: bmr.value,
    activityFactor: tdee.activityFactor ?? null,
    tdeeKcal: tdee.value,
    goal,
    goalLabel: GOAL_ADJUSTMENTS[goal].label,
    caloriesTarget: null,
    caloriesTargetMin: null,
    caloriesTargetMax: null,
    proteinTargetMin: null,
    proteinTargetMax: null,
    carbohydratesTargetMin: null,
    carbohydratesTargetMax: null,
    fatTargetMin: null,
    fatTargetMax: null,
    fiberTarget: null,
    addedSugarsLimit: null,
    saturatedFatLimit: null,
    vegetableServingsTarget: null,
    fruitServingsTarget: null,
    legumeServingsTarget: null,
    servingGrams,
    warnings,
    sources: [],
    references: {},
    informational: {},
  };

  result.references.activityLevel = {
    sourceId: 'FAO_WHO_UNU_2004',
    detail: tdee.activityFactor
      ? `PAL ${ACTIVITY_LEVELS[profile.activityLevel].palMin}-${ACTIVITY_LEVELS[profile.activityLevel].palMax} aralığının orta noktası ${tdee.activityFactor}`
      : 'Aktivite düzeyi bilinmiyor',
  };
  result.references.bmr = { sourceId: 'MIFFLIN_ST_JEOR_1990', detail: 'BMR = 10×kg + 6.25×cm − 5×yaş + (erkek +5 / kadın −161)' };

  if (tdee.value === null) {
    warnings.push(
      'Enerji gereksinimi hesaplanamadığı için makro besin ve şeker/yağ hedefleri de hesaplanamadı (bu hedefler enerji yüzdesi olarak tanımlıdır). Profil bilgilerinizi tamamlayın.',
    );
    result.sources = ['MIFFLIN_ST_JEOR_1990', 'FAO_WHO_UNU_2004'];
    result.informational = buildInformational(null, profile);
    return result;
  }

  /* --- Enerji hedefi ---------------------------------------------------- */
  const adj = GOAL_ADJUSTMENTS[goal];
  let calMin = tdee.value + adj.minKcal;
  let calMax = tdee.value + adj.maxKcal;

  if (goal === 'lose') {
    const floor = UNSUPERVISED_LOSS_FLOOR_KCAL[profile.biologicalSex] ?? UNSUPERVISED_LOSS_FLOOR_KCAL.female;
    if (calMin < floor) {
      warnings.push(
        `Kilo verme hedefi için hesaplanan alt sınır (${Math.round(calMin)} kcal) gözetimsiz kullanım için çok düşük. Hedef ${floor} kcal tabanına yükseltildi. Bu taban klinik bir kılavuz değil, yaygın kullanılan bir güvenlik sınırıdır; daha agresif bir plan için bir sağlık profesyoneline danışın.`,
      );
      calMin = floor;
      calMax = Math.max(calMax, floor);
    }
  }

  const caloriesTarget = round((calMin + calMax) / 2, 0);
  result.applicable = true;
  result.caloriesTarget = caloriesTarget;
  result.caloriesTargetMin = round(calMin, 0);
  result.caloriesTargetMax = round(calMax, 0);

  result.references.calories = {
    sourceIds: goal === 'maintain' ? ['MIFFLIN_ST_JEOR_1990', 'FAO_WHO_UNU_2004'] : ['MIFFLIN_ST_JEOR_1990', 'FAO_WHO_UNU_2004', 'APP_ASSUMPTION'],
    detail:
      goal === 'maintain'
        ? `TDEE = BMR (${bmr.value} kcal) × PAL (${tdee.activityFactor}) = ${tdee.value} kcal`
        : `TDEE ${tdee.value} kcal, ${adj.label.toLowerCase()} için ${adj.minKcal > 0 ? '+' : ''}${adj.minKcal} ile ${adj.maxKcal > 0 ? '+' : ''}${adj.maxKcal} kcal aralığı uygulandı`,
  };

  /* --- Protein ---------------------------------------------------------- */
  /* Öneri aralığı: DGA 2025-2030 (1.2-1.6 g/kg) ∩ AMDR (%10-35 enerji).
   * Yeterlilik tabanı (arayüzde "eksiklik" dememek için ayrıca taşınır):
   * EFSA 2012 PRI 0.83 g/kg ∩ AMDR alt sınırı. */
  const weightKg = toNumber(profile.weightKg);
  const amdrProteinMinG = (AMDR.protein.minPct * caloriesTarget) / KCAL_PER_G.protein;
  const amdrProteinMaxG = (AMDR.protein.maxPct * caloriesTarget) / KCAL_PER_G.protein;

  const proteinAdequacyFloor = weightKg
    ? round(Math.max(PROTEIN_G_PER_KG.efsaPri * weightKg, amdrProteinMinG), 1)
    : round(amdrProteinMinG, 1);

  if (weightKg) {
    const dgaMinG = PROTEIN_G_PER_KG.dga2025Min * weightKg;
    const dgaMaxG = PROTEIN_G_PER_KG.dga2025Max * weightKg;
    result.proteinTargetMin = round(clamp(dgaMinG, amdrProteinMinG, amdrProteinMaxG), 1);
    result.proteinTargetMax = round(clamp(dgaMaxG, result.proteinTargetMin, amdrProteinMaxG), 1);
  } else {
    result.proteinTargetMin = round(amdrProteinMinG, 1);
    result.proteinTargetMax = round(amdrProteinMaxG, 1);
    warnings.push(
      'Kilo bilgisi olmadığı için protein hedefi g/kg yerine yalnızca enerji yüzdesi (AMDR %10-35) üzerinden hesaplandı.',
    );
  }

  result.references.protein = {
    sourceIds: ['DGA_2025_2030', 'EFSA_PROTEIN_2012', 'IOM_AMDR_2005'],
    detail: `Hedef aralığı DGA 2025-2030 (1.2-1.6 g/kg) ile AMDR (%10-35 enerji) kesişimi. Yeterlilik tabanı EFSA PRI 0.83 g/kg = ${proteinAdequacyFloor} g.`,
    proteinAdequacyFloorG: proteinAdequacyFloor,
    note: 'Kılavuzlar arasında gerçek bir fark var: EFSA 0.83 g/kg yeterli alımı, DGA 2025-2030 ise 1.2-1.6 g/kg öneriyor. İkisi de gösteriliyor, tek sayı dayatılmıyor.',
  };

  /* --- Karbonhidrat ve yağ (AMDR) --------------------------------------- */
  result.carbohydratesTargetMin = round((AMDR.carbohydrate.minPct * caloriesTarget) / KCAL_PER_G.carbohydrate, 1);
  result.carbohydratesTargetMax = round((AMDR.carbohydrate.maxPct * caloriesTarget) / KCAL_PER_G.carbohydrate, 1);
  result.fatTargetMin = round((AMDR.fat.minPct * caloriesTarget) / KCAL_PER_G.fat, 1);
  result.fatTargetMax = round((AMDR.fat.maxPct * caloriesTarget) / KCAL_PER_G.fat, 1);

  result.references.carbohydrates = {
    sourceIds: ['IOM_AMDR_2005'],
    detail: `AMDR: enerjinin %45-65'i, 4 kcal/g ile grama çevrildi (${caloriesTarget} kcal bazında).`,
  };
  result.references.fat = {
    sourceIds: ['IOM_AMDR_2005', 'WHO_HEALTHY_DIET'],
    detail: `AMDR: enerjinin %20-35'i, 9 kcal/g. WHO toplam yağı enerjinin ≤%30'u ile sınırlandırır; bu aralık içinde kalır.`,
    whoTotalFatMaxG: round((0.3 * caloriesTarget) / KCAL_PER_G.fat, 1),
  };

  /* --- Lif ---------------------------------------------------------------- */
  /* EFSA 25 g/gün (yetişkin AI) esas alınır. IOM/DGA'nın 14 g/1000 kcal
   * karşılığı ayrıca gösterilir çünkü enerjiyle ölçeklenir. */
  const fibreByEnergy = (FIBRE_G_PER_1000_KCAL * caloriesTarget) / 1000;
  result.fiberTarget = round(FIBRE_ADEQUATE_INTAKE_G, 1);
  result.references.fiber = {
    sourceIds: ['EFSA_FIBRE_2010', 'IOM_AMDR_2005'],
    detail: `EFSA yeterli alım (AI): 25 g/gün (yetişkinler). IOM/DGA formülü 14 g/1000 kcal bu enerji düzeyinde ${round(fibreByEnergy, 1)} g verir; ikisi de gösteriliyor.`,
    fibreByEnergyG: round(fibreByEnergy, 1),
  };

  /* --- Şeker ve doymuş yağ sınırları ------------------------------------- */
  result.addedSugarsLimit = round((FREE_SUGARS_MAX_PCT * caloriesTarget) / KCAL_PER_G.carbohydrate, 1);
  result.saturatedFatLimit = round((SATURATED_FAT_MAX_PCT * caloriesTarget) / KCAL_PER_G.fat, 1);

  result.references.addedSugars = {
    sourceIds: ['WHO_HEALTHY_DIET', 'DGA_2025_2030', 'DGA_2020_2025'],
    detail: `WHO: serbest şeker enerjinin <%10'u = ${result.addedSugarsLimit} g; ideal olarak <%5 = ${round((FREE_SUGARS_CONDITIONAL_PCT * caloriesTarget) / KCAL_PER_G.carbohydrate, 1)} g. DGA 2025-2030 öğün başına <10 g önerir.`,
    whoConditionalLimitG: round((FREE_SUGARS_CONDITIONAL_PCT * caloriesTarget) / KCAL_PER_G.carbohydrate, 1),
    dgaPerMealLimitG: 10,
    note: 'WHO "serbest şeker" tanımı bal, şurup, meyve suyu şekerlerini ve ilave şekerleri kapsar; FDA "ilave şeker" tanımından geniştir. Taze bütün meyvedeki doğal şeker serbest şeker SAYILMAZ. Veritabanında toplam şeker ile ilave şeker ayrı kolonlarda tutulur ve raporlarda birbirine karıştırılmaz.',
  };
  result.references.saturatedFat = {
    sourceIds: ['WHO_HEALTHY_DIET', 'DGA_2025_2030'],
    detail: `WHO ve DGA: doymuş yağ enerjinin <%10'u = ${result.saturatedFatLimit} g. Trans yağ için WHO sınırı enerjinin ≤%1'i (${round((TRANS_FAT_MAX_PCT * caloriesTarget) / KCAL_PER_G.fat, 1)} g); uygulama trans yağ takibi yapmaz.`,
    transFatLimitG: round((TRANS_FAT_MAX_PCT * caloriesTarget) / KCAL_PER_G.fat, 1),
  };

  /* --- Sebze / meyve / baklagil porsiyonları ------------------------------ */
  /* DGA porsiyonları 2000 kcal desenine göredir; kullanıcının enerji
   * düzeyine ölçeklenir ve WHO'nun 80 g'lık porsiyonuna çevrilir. */
  const energyScale = caloriesTarget / DGA_2000_KCAL_PATTERN.calories;
  let veg = roundToHalf(DGA_2000_KCAL_PATTERN.vegetableServings * energyScale);
  const fruit = roundToHalf(DGA_2000_KCAL_PATTERN.fruitServings * energyScale);

  // WHO/TÜBER birleşik alt sınırı: günde en az 5 porsiyon (~400 g).
  if (veg + fruit < 5) {
    const bump = 5 - fruit - veg;
    if (bump > 0) {
      veg = roundToHalf(veg + bump);
      warnings.push(
        `Enerji düzeyine göre ölçeklenen sebze+meyve porsiyonu WHO/TÜBER alt sınırının (günde en az 5 porsiyon ≈ ${5 * servingGrams} g) altında kaldığı için sebze hedefi ${veg} porsiyona yükseltildi.`,
      );
    }
  }

  result.vegetableServingsTarget = veg;
  result.fruitServingsTarget = fruit;
  result.legumeServingsTarget = Math.max(
    0.5,
    roundToHalf(
      ((LEGUME_WEEKLY_CUP_EQ_2000_KCAL * energyScale) * LEGUME_CUP_EQUIVALENT_GRAMS) / 7 / servingGrams,
    ),
  );

  result.references.foodGroups = {
    sourceIds: ['DGA_2025_2030', 'WHO_HEALTHY_DIET', 'TUBER_2022', 'APP_ASSUMPTION'],
    detail: `DGA 2025-2030 2000 kcal deseni (sebze 3, meyve 2 porsiyon) ${caloriesTarget} kcal'e ölçeklendi ve WHO porsiyon tanımına (${servingGrams} g) çevrildi. WHO/TÜBER birleşik alt sınırı: günde en az 5 porsiyon (~${5 * servingGrams} g) sebze+meyve.`,
    combinedMinServings: 5,
    combinedMinGrams: 5 * servingGrams,
    legumeDerivation: `DGA 2020-2025: 2000 kcal için haftada ${LEGUME_WEEKLY_CUP_EQ_2000_KCAL} kase-eşdeğeri kuru baklagil. 1 kase-eşdeğeri pişmiş baklagil ≈ ${LEGUME_CUP_EQUIVALENT_GRAMS} g → ${result.legumeServingsTarget} porsiyon/gün (${servingGrams} g'lık porsiyonla).`,
    note: 'DGA porsiyonları "kase-eşdeğeri" kullanır; bu uygulama WHO ile tutarlı olması için 80 g\'lık porsiyon kullanır. Bu bir yaklaşıklıktır.',
  };

  result.sources = [
    'MIFFLIN_ST_JEOR_1990',
    'FAO_WHO_UNU_2004',
    'DGA_2025_2030',
    'DGA_2020_2025',
    'EFSA_PROTEIN_2012',
    'EFSA_FIBRE_2010',
    'IOM_AMDR_2005',
    'WHO_HEALTHY_DIET',
    'TUBER_2022',
    ...(goal === 'maintain' ? [] : ['APP_ASSUMPTION']),
  ];

  result.informational = buildInformational(caloriesTarget, profile);
  return result;
}

/**
 * Takip edilmeyen ama kullanıcıya gösterilmesi gereken bilgilendirmeler
 * (prompt md. 3.8: su tüketimi ve temel mikro besinler hakkında bilgilendirme).
 */
function buildInformational(caloriesTarget, profile) {
  const waterRef = REFERENCES.EFSA_WATER_2010;
  const waterLitres =
    profile.biologicalSex === 'male' ? 2.5 : profile.biologicalSex === 'female' ? 2.0 : null;

  return {
    water: {
      label: 'Toplam su alımı (bilgilendirme)',
      value: waterLitres ? `${waterLitres} L/gün` : 'Biyolojik cinsiyet belirtilmediği için değer verilemedi',
      source: `${waterRef.organisation}, ${waterRef.title} (${waterRef.year})`,
      url: waterRef.url,
      note:
        'Bu değer içme suyu, diğer içecekler ve besinlerin içerdiği suyun TOPLAMIDIR. Sıcak iklim, yoğun egzersiz, gebelik/emzirme ve hastalıkta gereksinim artar. Uygulama su takibi yapmaz.',
    },
    salt: {
      label: 'Tuz (bilgilendirme)',
      value: 'Günde <5 g tuz (≈ <2 g sodyum)',
      source: `${REFERENCES.WHO_HEALTHY_DIET.organisation}, ${REFERENCES.WHO_HEALTHY_DIET.title}`,
      url: REFERENCES.WHO_HEALTHY_DIET.url,
      note: 'Uygulama tuz/sodyum takibi yapmaz; besin veritabanında sodyum alanı yoktur.',
    },
    transFat: {
      label: 'Trans yağ (bilgilendirme)',
      value: caloriesTarget
        ? `Enerjinin ≤%1'i ≈ ${round((TRANS_FAT_MAX_PCT * caloriesTarget) / KCAL_PER_G.fat, 1)} g/gün`
        : 'Enerji gereksinimi hesaplanamadı',
      source: `${REFERENCES.WHO_HEALTHY_DIET.organisation}, ${REFERENCES.WHO_HEALTHY_DIET.title}`,
      url: REFERENCES.WHO_HEALTHY_DIET.url,
      note: 'Uygulama trans yağ takibi yapmaz.',
    },
    micronutrients: {
      label: 'Mikro besinler (bilgilendirme)',
      value: 'Takip edilmiyor',
      source: 'EFSA Dietary Reference Values; NIH Office of Dietary Supplements',
      url: 'https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values',
      note:
        'Bu uygulama yalnızca enerji, makro besinler, şeker, lif ve sebze/meyve/baklagil gruplarını takip eder. Vitamin ve mineral gereksinimleri yaş, cinsiyet ve yaşam evresine göre değişir ve bu uygulamanın kapsamı dışındadır. Çeşitli bir beslenme örüntüsü çoğu sağlıklı yetişkin için mikro besin gereksinimlerini karşılar; eksiklik şüphesi varsa kan testi ve profesyonel değerlendirme gerekir.',
    },
  };
}

/** Referans kimliklerini tam kaynak kayıtlarına çevirir (arayüz gösterimi için). */
function expandReferences(sourceIds) {
  if (!Array.isArray(sourceIds)) return [];
  return sourceIds
    .filter((id) => REFERENCES[id])
    .map((id) => ({
      id,
      organisation: REFERENCES[id].organisation,
      title: REFERENCES[id].title,
      year: REFERENCES[id].year ?? null,
      url: REFERENCES[id].url,
      ageGroup: REFERENCES[id].ageGroup ?? null,
    }));
}

module.exports = {
  ACTIVITY_LEVELS,
  ADULT_MIN_AGE,
  GOAL_LABELS: Object.fromEntries(
    Object.entries(GOAL_ADJUSTMENTS).map(([k, v]) => [k, v.label]),
  ),
  PROTEIN_G_PER_KG,
  FIBRE_ADEQUATE_INTAKE_G,
  FREE_SUGARS_MAX_PCT,
  SATURATED_FAT_MAX_PCT,
  computeBmr,
  computeTdee,
  computeDailyTargets,
  expandReferences,
};
