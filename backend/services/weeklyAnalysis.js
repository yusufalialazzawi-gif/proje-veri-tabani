'use strict';

/**
 * Haftalık beslenme analizi — anlatı ve karşılaştırma motoru.
 *
 * Saf fonksiyonlardan oluşur (veritabanına dokunmaz), böylece birim testlerle
 * doğrulanabilir. Sayısal hesaplamalar SQL tarafında (v_weekly_averages)
 * yapılır; bu modül yalnızca o sonuçları yorumlar.
 *
 * UYGULANAN ANALİZ KURALLARI (prompt md. 7):
 *  1. Tek güne bakarak yetersizlik veya hastalık ifadesi KULLANILMAZ.
 *  2. Veri girilmeyen günler sıfır tüketim SAYILMAZ; ayrı raporlanır.
 *  3. Karşılaştırmalar tek hedefle değil ARALIKLA yapılır.
 *  4. Toplam şeker ile ilave/serbest şeker ayrı tutulur.
 *  5. Sebze/meyve/baklagil hem gram hem porsiyon hem sıklık olarak gösterilir.
 *  6. Haftalık ortalama için yeterli veri olup olmadığı açıkça belirtilir.
 *  7. Korkutucu veya kesin tıbbi dil kullanılmaz.
 *  8. Yetişkin hedefleri çocuk/ergen/gebe için otomatik uygulanmaz.
 */

/** Yüzde farkı hesaplar; hedef yoksa null (uydurma %0 yok). */
function pctOf(value, target) {
  if (value === null || value === undefined) return null;
  if (target === null || target === undefined || target === 0) return null;
  return Math.round((value / target) * 1000) / 10;
}

const fmt = (n, digits = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('tr-TR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

/** Bir değerin aralığa göre konumu: 'below' | 'within' | 'above' | 'unknown' */
function rangePosition(value, min, max) {
  if (value === null || value === undefined) return 'unknown';
  if (min === null && max === null) return 'unknown';
  if (min !== null && value < min * 0.95) return 'below';
  if (max !== null && value > max * 1.05) return 'above';
  return 'within';
}

const POSITION_LABEL = {
  below: 'aralığın altında',
  within: 'aralık içinde',
  above: 'aralığın üzerinde',
  unknown: 'karşılaştırılamadı',
};

/**
 * Haftalık analizi üretir.
 *
 * @param {object} args
 * @param {object} args.averages     - v_weekly_averages satırı (null olabilir: hiç veri yok)
 * @param {Array}  args.dailyRows    - haftanın 7 günü (is_missing_day bayraklı)
 * @param {object} args.targets      - formatTargets() çıktısı (null olabilir)
 * @param {object} args.profile      - kullanıcı profili (yaş kontrolü için)
 * @param {Array}  args.groupDetails - B.8 sorgusunun sonucu
 * @param {number} args.minCoverage  - yeterli veri eşiği (varsayılan 4 gün)
 */
function buildWeeklyAnalysis({
  averages,
  dailyRows = [],
  targets = null,
  profile = {},
  groupDetails = [],
  minCoverage = 4,
}) {
  const missingDays = dailyRows.filter((d) => d.is_missing_day).map((d) => d.day_date);
  const loggedDays = dailyRows.filter((d) => !d.is_missing_day).map((d) => d.day_date);
  const coverageDays = averages?.data_coverage_days ?? 0;
  const hasAnyData = coverageDays > 0;
  const coverageSufficient = coverageDays >= minCoverage;

  // Kural 8: yetişkin hedefleri otomatik uygulanmaz.
  const adultTargetsApplicable =
    profile.age === null || profile.age === undefined
      ? false
      : Number(profile.age) >= 19;

  const cautions = [];
  const recommendations = [];
  const comparisons = [];

  if (!hasAnyData) {
    return {
      hasData: false,
      coverageDays: 0,
      coverageSufficient: false,
      loggedDays: [],
      missingDays: dailyRows.map((d) => d.day_date),
      averages: null,
      comparisons: [],
      variability: null,
      groupIntake: summarizeGroups(null, groupDetails, targets, adultTargetsApplicable),
      recommendations: [
        'Bu hafta için hiç kayıt yok. Değerlendirme yapılabilmesi için en az birkaç gün besin ekleyin; veri girilmeyen günler sıfır tüketim olarak sayılmaz.',
      ],
      cautions: [
        'Kayıt bulunmayan günler "hiçbir şey yenmedi" anlamına gelmez; yalnızca o günün takip edilmediğini gösterir.',
      ],
      adultTargetsApplicable,
    };
  }

  /* --- Yeterlilik beyanı (Kural 6) -------------------------------------- */
  if (!coverageSufficient) {
    cautions.push(
      `Bu hafta yalnızca ${coverageDays} gün kayıt var. Haftalık ortalamalar ${minCoverage} günden az veriyle hesaplandığı için sınırlıdır ve genel alışkanlıklarınızı temsil etmeyebilir.`,
    );
  } else {
    cautions.push(
      `Haftalık ortalamalar ${coverageDays} günlük kayda dayanıyor (7 günden ${missingDays.length} gün eksik).`,
    );
  }

  /* --- Hedef karşılaştırması yapılabiliyor mu? --------------------------- */
  const canCompare = Boolean(targets && targets.calories?.target) && adultTargetsApplicable;

  if (!adultTargetsApplicable) {
    cautions.push(
      profile.age === null || profile.age === undefined
        ? 'Yaş bilgisi girilmediği için hedef karşılaştırması yapılmadı. Yetişkin hedefleri varsayılmaz.'
        : `${profile.age} yaş için yetişkin hedefleri otomatik uygulanmaz. Çocuklar, ergenler, gebeler, emzirenler ve özel sağlık durumu olanlar için hedefler farklıdır; bir diyetisyene danışın.`,
    );
  } else if (!targets || !targets.calories?.target) {
    cautions.push(
      'Günlük enerji hedefi hesaplanamadığı için tüketim-hedef karşılaştırması yapılmadı (profil bilgisi eksik olabilir). Sayılar yine de kayıtlarınızın toplamıdır.',
    );
  }

  /* --- Enerji ------------------------------------------------------------- */
  if (canCompare) {
    const pos = rangePosition(averages.average_calories, targets.calories.min, targets.calories.max);
    comparisons.push({
      nutrient: 'calories',
      label: 'Enerji',
      unit: 'kcal',
      value: averages.average_calories,
      targetMin: targets.calories.min,
      targetMax: targets.calories.max,
      pctOfTarget: pctOf(averages.average_calories, targets.calories.target),
      position: pos,
      positionLabel: POSITION_LABEL[pos],
      comment: describeCalories(pos, averages.average_calories, targets, profile.goal),
    });

    /* --- Protein (aralık) ------------------------------------------------ */
    const proteinPos = rangePosition(averages.average_protein, targets.protein.min, targets.protein.max);
    comparisons.push({
      nutrient: 'protein',
      label: 'Protein',
      unit: 'g',
      value: averages.average_protein,
      targetMin: targets.protein.min,
      targetMax: targets.protein.max,
      adequacyFloorG: targets.protein.adequacyFloorG ?? null,
      position: proteinPos,
      positionLabel: POSITION_LABEL[proteinPos],
      comment:
        proteinPos === 'below'
          ? `Günlük ortalama protein ${fmt(averages.average_protein, 1)} g, önerilen aralığın (${fmt(targets.protein.min, 1)}–${fmt(targets.protein.max, 1)} g) altında görünüyor. Bu bir yetersizlik tanısı değildir; yalnızca kayıtlarınıza göre bir gözlemdir.`
          : `Günlük ortalama protein ${fmt(averages.average_protein, 1)} g, önerilen ${fmt(targets.protein.min, 1)}–${fmt(targets.protein.max, 1)} g aralığında.`,
    });

    /* --- Karbonhidrat ---------------------------------------------------- */
    const carbPos = rangePosition(averages.average_carbohydrates, targets.carbohydrates.min, targets.carbohydrates.max);
    comparisons.push({
      nutrient: 'carbohydrates',
      label: 'Karbonhidrat',
      unit: 'g',
      value: averages.average_carbohydrates,
      targetMin: targets.carbohydrates.min,
      targetMax: targets.carbohydrates.max,
      position: carbPos,
      positionLabel: POSITION_LABEL[carbPos],
      comment: `Günlük ortalama ${fmt(averages.average_carbohydrates, 1)} g; AMDR aralığı ${fmt(targets.carbohydrates.min, 1)}–${fmt(targets.carbohydrates.max, 1)} g. Konumu: ${POSITION_LABEL[carbPos]}.`,
    });

    /* --- Yağ ------------------------------------------------------------- */
    const fatPos = rangePosition(averages.average_fat, targets.fat.min, targets.fat.max);
    comparisons.push({
      nutrient: 'fat',
      label: 'Yağ',
      unit: 'g',
      value: averages.average_fat,
      targetMin: targets.fat.min,
      targetMax: targets.fat.max,
      position: fatPos,
      positionLabel: POSITION_LABEL[fatPos],
      comment: `Günlük ortalama ${fmt(averages.average_fat, 1)} g; AMDR aralığı ${fmt(targets.fat.min, 1)}–${fmt(targets.fat.max, 1)} g. Konumu: ${POSITION_LABEL[fatPos]}.`,
    });

    /* --- Doymuş yağ (üst sınır) ------------------------------------------ */
    if (targets.saturatedFat?.limit) {
      const satRatio = pctOf(averages.average_saturated_fat, targets.saturatedFat.limit);
      comparisons.push({
        nutrient: 'saturatedFat',
        label: 'Doymuş yağ',
        unit: 'g',
        value: averages.average_saturated_fat,
        targetMax: targets.saturatedFat.limit,
        pctOfLimit: satRatio,
        position: satRatio !== null && satRatio > 100 ? 'above' : 'within',
        positionLabel: satRatio !== null && satRatio > 100 ? 'üst sınırın üzerinde' : 'üst sınırın altında',
        comment:
          satRatio !== null && satRatio > 100
            ? `Doymuş yağ ortalaması WHO/DGA üst sınırının (%10 enerji ≈ ${fmt(targets.saturatedFat.limit, 1)} g) üzerinde görünüyor (${fmt(averages.average_saturated_fat, 1)} g).`
            : `Doymuş yağ ortalaması ${fmt(averages.average_saturated_fat, 1)} g; WHO/DGA üst sınırı ${fmt(targets.saturatedFat.limit, 1)} g.`,
      });
    }

    /* --- Lif -------------------------------------------------------------- */
    if (targets.fiber?.target) {
      const fiberPos = averages.average_fiber < targets.fiber.target * 0.95 ? 'below' : 'within';
      comparisons.push({
        nutrient: 'fiber',
        label: 'Lif',
        unit: 'g',
        value: averages.average_fiber,
        targetMin: targets.fiber.target,
        position: fiberPos,
        positionLabel: fiberPos === 'below' ? 'hedefin altında' : 'hedefe ulaşılmış',
        pctOfTarget: pctOf(averages.average_fiber, targets.fiber.target),
        comment:
          fiberPos === 'below'
            ? `Günlük ortalama lif ${fmt(averages.average_fiber, 1)} g; EFSA yeterli alımı ${fmt(targets.fiber.target, 1)} g. Hedefin altında görünüyor.`
            : `Günlük ortalama lif ${fmt(averages.average_fiber, 1)} g; EFSA yeterli alımı ${fmt(targets.fiber.target, 1)} g.`,
      });
    }
  }

  /* --- Şeker: TOPLAM ile İLAVE ayrı tutulur (Kural 4) -------------------- */
  comparisons.push({
    nutrient: 'totalSugars',
    label: 'Toplam şeker',
    unit: 'g',
    value: averages.average_total_sugars,
    position: 'reference',
    positionLabel: 'bilgi amaçlı',
    comment:
      'Toplam şeker, besinlerde doğal olarak bulunan şekeri (ör. meyvedeki fruktoz, sütteki laktoz) de içerir. Bu değer için tek bir üst sınır yoktur; WHO sınırı SERBEST/İLAVE şeker içindir.',
  });

  if (averages.added_sugars_incomplete || averages.average_added_sugars === null) {
    comparisons.push({
      nutrient: 'addedSugars',
      label: 'İlave / serbest şeker',
      unit: 'g',
      value: null,
      position: 'unknown',
      positionLabel: 'değerlendirilemedi',
      comment:
        'İlave şeker değerlendirmesi yapılamadı. Eklediğiniz besinlerin bir kısmında ilave şeker bilgisi kaynak tarafından bildirilmiyor; eksik bilgi 0 olarak sayılmaz.',
    });
    cautions.push(
      'İlave şeker ortalaması hesaplanamadı: bazı besin kayıtlarında ilave şeker değeri yok. Bu durumda toplam düşük çıkacağı için ortalama hiç gösterilmiyor (yanlış güven vermesin).',
    );
  } else if (targets?.addedSugars?.limit) {
    const limit = targets.addedSugars.limit;
    const whoConditional = targets.addedSugars.whoConditionalLimitG ?? null;
    const ratio = pctOf(averages.average_added_sugars, limit);
    comparisons.push({
      nutrient: 'addedSugars',
      label: 'İlave / serbest şeker',
      unit: 'g',
      value: averages.average_added_sugars,
      targetMax: limit,
      whoConditionalLimitG: whoConditional,
      pctOfLimit: ratio,
      position: ratio !== null && ratio > 100 ? 'above' : 'within',
      positionLabel: ratio !== null && ratio > 100 ? 'üst sınırın üzerinde' : 'üst sınırın altında',
      comment:
        ratio !== null && ratio > 100
          ? `Günlük ortalama ilave/serbest şeker ${fmt(averages.average_added_sugars, 1)} g; WHO üst sınırı (enerjinin %10'u) ${fmt(limit, 1)} g. Sınırın üzerinde görünüyor.`
          : `Günlük ortalama ilave/serbest şeker ${fmt(averages.average_added_sugars, 1)} g; WHO üst sınırı (enerjinin %10'u) ${fmt(limit, 1)} g.`,
    });
    if (whoConditional && averages.average_added_sugars > whoConditional) {
      recommendations.push(
        `WHO'nun koşullu önerisi serbest şekeri enerjinin %5'i ile sınırlamak (${fmt(whoConditional, 1)} g/gün). Şu anki ortalamanız ${fmt(averages.average_added_sugars, 1)} g; şekerli içecekler ve paketli atıştırmalıklar en kolay azaltılabilecek kaynaklardır.`,
      );
    }
  }

  /* --- Günler arası değişim (Kural: günler arasındaki değişimler) -------- */
  const variability = {
    minDailyCalories: averages.min_daily_calories ?? null,
    maxDailyCalories: averages.max_daily_calories ?? null,
    spread: averages.daily_calorie_spread ?? null,
    stddev: averages.daily_calorie_stddev ?? null,
    comment: null,
  };
  if (coverageDays >= 2 && variability.spread !== null) {
    const relativeSpread = targets?.calories?.target
      ? variability.spread / targets.calories.target
      : null;
    variability.comment =
      `Kayıt olan ${coverageDays} gün arasında günlük enerji ${fmt(variability.minDailyCalories)}–${fmt(variability.maxDailyCalories)} kcal arasında değişti (fark ${fmt(variability.spread)} kcal).`;
    if (relativeSpread !== null && relativeSpread > 0.5) {
      variability.comment +=
        ' Günler arası değişim hedefin yarısından fazla; bu, bazı günlerin çok az veya çok çok kayıt içerdiğini gösteriyor olabilir.';
      recommendations.push(
        'Günler arası enerji değişimi yüksek görünüyor. Kayıtların eksiksiz olduğundan emin olun; eksikse bu bir beslenme sorunu değil takip sorunudur.',
      );
    }
  } else {
    variability.comment = 'Değişim hesabı için en az 2 gün kayıt gerekir.';
  }

  /* --- Sebze / meyve / baklagil (Kural 5: gram + porsiyon + sıklık) ------ */
  const groupIntake = summarizeGroups(averages, groupDetails, targets, adultTargetsApplicable);

  /* --- Öneriler ----------------------------------------------------------- */
  recommendations.push(...buildRecommendations({
    averages,
    comparisons,
    targets,
    coverageDays,
    coverageSufficient,
    missingDays,
    groupIntake,
    canCompare,
    goal: profile.goal,
    minCoverage,
  }));

  /* --- Standart çekinceler ------------------------------------------------ */
  cautions.push(
    'Bu rapor bir teşhis, tıbbi değerlendirme veya beslenme tedavisi değildir. Yalnızca sizin girdiğiniz kayıtların özetidir.',
  );
  cautions.push(
    'Besin değerleri kaynak veritabanından gelir ve doğal olarak değişkenlik gösterir; hesaplamalar tahminidir.',
  );
  cautions.push(
    'Tek bir günün veya tek bir haftanın sonucu beslenme yetersizliği göstergesi değildir. Sürekli bir endişeniz varsa bir sağlık profesyoneline danışın.',
  );

  return {
    hasData: true,
    coverageDays,
    coverageSufficient,
    loggedDays,
    missingDays,
    averages,
    comparisons,
    variability,
    groupIntake,
    recommendations,
    cautions,
    adultTargetsApplicable,
  };
}

function describeCalories(position, value, targets, goal) {
  const range = `${fmt(targets.calories.min)}–${fmt(targets.calories.max)} kcal`;
  if (position === 'below') {
    const goalNote =
      goal === 'lose'
        ? ' Kilo verme hedefi seçtiğiniz için daha düşük bir alım beklenen bir durumdur; önemli olan bunun sürdürülebilir ve besin değeri yeterli bir örüntüyle olmasıdır.'
        : '';
    return `Günlük ortalama enerji ${fmt(value)} kcal, hedef aralığının (${range}) altında görünüyor.${goalNote}`;
  }
  if (position === 'above') {
    const goalNote =
      goal === 'gain'
        ? ' Kilo alma hedefi seçtiğiniz için daha yüksek bir alım beklenen bir durumdur.'
        : '';
    return `Günlük ortalama enerji ${fmt(value)} kcal, hedef aralığının (${range}) üzerinde görünüyor.${goalNote}`;
  }
  return `Günlük ortalama enerji ${fmt(value)} kcal, hedef aralığı (${range}) içinde.`;
}

/**
 * Sebze/meyve/baklagil özetini kurar: gram, porsiyon VE tüketim sıklığı.
 */
function summarizeGroups(averages, groupDetails, targets, adultTargetsApplicable) {
  const byGroup = { vegetable: [], fruit: [], legume: [] };
  for (const row of groupDetails) {
    if (byGroup[row.food_group]) byGroup[row.food_group].push(row);
  }

  const build = (key, label, avgGrams, avgServings, daysCount) => {
    const target = adultTargetsApplicable ? targets?.servings?.[key] ?? null : null;
    const position =
      target === null || avgServings === null || avgServings === undefined
        ? 'unknown'
        : avgServings >= target * 0.95
          ? 'within'
          : 'below';
    return {
      key,
      label,
      averageGrams: avgGrams ?? null,
      averageServings: avgServings ?? null,
      daysConsumed: daysCount ?? 0,
      targetServings: target,
      position,
      topFoods: byGroup[key].slice(0, 5).map((r) => ({
        name: r.food_name,
        state: r.food_state,
        totalGrams: r.total_grams,
        totalServings: r.total_servings,
        daysConsumed: r.days_consumed,
        fiber: r.fiber_from_group,
      })),
    };
  };

  const vegetable = averages
    ? build('vegetable', 'Sebze', averages.vegetable_grams_avg, averages.vegetable_servings_avg, averages.days_with_vegetables)
    : build('vegetable', 'Sebze', null, null, 0);
  const fruit = averages
    ? build('fruit', 'Meyve', averages.fruit_grams_avg, averages.fruit_servings_avg, averages.days_with_fruit)
    : build('fruit', 'Meyve', null, null, 0);
  const legume = averages
    ? build('legume', 'Baklagil', averages.legume_grams_avg, averages.legume_servings_avg, averages.days_with_legumes)
    : build('legume', 'Baklagil', null, null, 0);

  const combined =
    vegetable.averageServings !== null && fruit.averageServings !== null
      ? Math.round((vegetable.averageServings + fruit.averageServings) * 10) / 10
      : null;

  return {
    vegetable,
    fruit,
    legume,
    combinedServings: combined,
    combinedTarget: adultTargetsApplicable ? (targets?.servings?.combinedMin ?? 5) : null,
    note:
      'Baklagiller hem sebze hem protein grubunda sayılabilir (DGA 2025-2030). Bu uygulamada baklagil olarak işaretlenmiş besinler ayrı raporlanır; sebze toplamına dahil edilmez.',
  };
}

/**
 * Bir sonraki hafta için uygulanabilir öneriler.
 * Dil kuralı: emir kipi yerine öneri, kesinlik yerine gözlem.
 */
function buildRecommendations({
  averages,
  comparisons,
  targets,
  coverageDays,
  coverageSufficient,
  missingDays,
  groupIntake,
  canCompare,
  goal,
  minCoverage,
}) {
  const out = [];

  if (!coverageSufficient) {
    out.push(
      `Değerlendirme için en az ${minCoverage} gün kayıt önerilir; bu hafta ${coverageDays} gün var. Önümüzdeki hafta eksik günleri tamamlamak (${missingDays.length} gün) tabloyu daha güvenilir hale getirir.`,
    );
  }

  if (!canCompare) {
    out.push(
      'Profil bilgilerinizi (yaş, boy, kilo, biyolojik cinsiyet, aktivite düzeyi) tamamlarsanız günlük hedefler hesaplanır ve tüketiminiz bilimsel referans aralıklarıyla karşılaştırılabilir.',
    );
  }

  // Lif
  if (canCompare && targets.fiber?.target && averages.average_fiber < targets.fiber.target) {
    const gap = Math.round((targets.fiber.target - averages.average_fiber) * 10) / 10;
    out.push(
      `Lif ortalaması hedefin ${fmt(gap, 1)} g altında. Uygulanabilir adım: haftada birkaç öğüne kuru baklagil ekleyin (100 g pişmiş mercimek yaklaşık 8 g lif sağlar) veya tam tahıllı ekmek/bulgur tercih edin. Lif alımını artırırken su tüketimini de artırmak ve artışı kademeli yapmak sindirim açısından daha rahat olur.`,
    );
  }

  // Sebze
  if (groupIntake.vegetable.targetServings !== null && groupIntake.vegetable.position === 'below') {
    const gap = Math.round((groupIntake.vegetable.targetServings - (groupIntake.vegetable.averageServings ?? 0)) * 10) / 10;
    out.push(
      `Sebze hedefinin ${fmt(gap, 1)} porsiyon altındasınız. Uygulanabilir adım: öğle veya akşam yemeğine bir porsiyon (≈80 g) sebze ekleyin — salata, zeytinyağlı sebze yemeği veya çorba en kolay yollardır.`,
    );
  }

  // Meyve
  if (groupIntake.fruit.targetServings !== null && groupIntake.fruit.position === 'below') {
    out.push(
      `Meyve tüketimi hedefin altında. Uygulanabilir adım: tatlı veya paketli atıştırmalık yerine günde bir porsiyon bütün meyve koyun. Meyve suyu yerine bütün meyve tercih edin; WHO serbest şeker tanımına meyve suyu şekeri de girer.`,
    );
  }

  // Baklagil — haftalık sıklık üzerinden
  if (averages.days_with_legumes !== undefined && averages.days_with_legumes < 2) {
    out.push(
      `Bu hafta ${averages.days_with_legumes} gün baklagil kaydı var. DGA 2000 kcal deseni haftada yaklaşık 1.5 kase-eşdeğeri kuru baklagil önerir; haftada 2-3 güne mercimek, nohut veya kuru fasulye eklemek hem lif hem bitkisel protein açısından kolay bir kazançtır.`,
    );
  }

  // Enerji konumu
  if (canCompare) {
    const calorieComparison = comparisons.find((c) => c.nutrient === 'calories');
    if (calorieComparison?.position === 'below' && goal !== 'lose') {
      out.push(
        'Enerji alımı hedef aralığının altında görünüyor ve kilo verme hedefi seçmediniz. Bu durum birkaç hafta sürerse bir diyetisyenle görüşmek uygun olur; bu bir teşhis değildir.',
      );
    }
    if (calorieComparison?.position === 'above' && goal !== 'gain') {
      out.push(
        'Enerji alımı hedef aralığının üzerinde görünüyor. Uygulanabilir adım: porsiyon büyüklüklerini ve şekerli içecekleri gözden geçirin. Hedefler tahminidir; ±%10 sapma normaldir.',
      );
    }
    if (calorieComparison?.position === 'within') {
      out.push(
        'Enerji alımı hedef aralığınız içinde. Mevcut örüntüyü sürdürmek, sebze-meyve çeşitliliğini ve lif alımını artırmak için iyi bir zemin.',
      );
    }
  }

  // Doymuş yağ
  const sat = comparisons.find((c) => c.nutrient === 'saturatedFat');
  if (sat?.position === 'above') {
    out.push(
      'Doymuş yağ üst sınırın üzerinde görünüyor. Uygulanabilir adım: kızartma yerine fırın/haşlama, tam yağlı süt ürünleri yerine daha az yağlı seçenekler ve tereyağı yerine zeytinyağı kullanmayı deneyin.',
    );
  }

  if (out.length === 0) {
    out.push(
      'Kayıtlarınıza göre belirgin bir sapma görünmüyor. Besin çeşitliliğini korumak ve takibi sürdürmek en değerli adım.',
    );
  }

  return out;
}

module.exports = {
  buildWeeklyAnalysis,
  rangePosition,
  pctOf,
  POSITION_LABEL,
};
