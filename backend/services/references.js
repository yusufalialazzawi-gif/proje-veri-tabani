'use strict';

/**
 * Bilimsel referans kayıtları.
 *
 * Buradaki her kayıt, hedef hesaplama motorunun (nutritionTargets.js)
 * kullandığı bir değerin dayanağıdır ve arayüzde kullanıcıya gösterilir.
 *
 * ÖNEMLİ: Bu değerler genel sağlıklı YETİŞKİNLER içindir. Çocuklar, ergenler,
 * gebeler, emzirenler ve kronik hastalığı olanlar için yetişkin hedefleri
 * otomatik UYGULANMAZ (prompt md. 7.8).
 */

const REFERENCES = {
  WHO_HEALTHY_DIET: {
    id: 'WHO_HEALTHY_DIET',
    organisation: 'Dünya Sağlık Örgütü (WHO)',
    title: 'Healthy diet — Fact sheet',
    year: 2026,
    published: '2026-01-26',
    url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    ageGroup: 'Yetişkinler (>10 yaş için sebze-meyve); serbest şeker her yaş için',
    supports: [
      'Serbest şeker: toplam enerjinin <%10 (~50 g/gün), ideal olarak <%5 (~25 g/gün)',
      'Toplam yağ: enerjinin ≤%30; doymuş yağ ≤%10; trans yağ ≤%1',
      'Tuz: yetişkinlerde günde <5 g',
      'Sebze + meyve: günde en az 400 g (5 × 80 g porsiyon); baklagiller ve kuruyemişler dahil',
    ],
  },

  MIFFLIN_ST_JEOR_1990: {
    id: 'MIFFLIN_ST_JEOR_1990',
    organisation: 'Mifflin MD, St Jeor ST, Hill LA, Scott BB, Daugherty SA, Koh YO',
    title:
      'A new predictive equation for resting energy expenditure in healthy individuals',
    journal: 'American Journal of Clinical Nutrition',
    year: 1990,
    citation: 'Am J Clin Nutr. 1990;51(2):241-247',
    pubmedId: '2305711',
    url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
    ageGroup: 'Sağlıklı yetişkinler (çalışma popülasyonu: 498 sağlıklı birey, 18+)',
    supports: [
      'BMR (erkek) = 10×kg + 6.25×cm − 5×yaş + 5',
      'BMR (kadın) = 10×kg + 6.25×cm − 5×yaş − 161',
      'Denklem varyansın ~%71’ini açıklar; tahmindir, ölçüm değildir',
    ],
    limitations: [
      'Çocuklar ve ergenler için doğrulanmamıştır (Schofield/FAO denklemleri gerekir)',
      'Gebelik ve emzirme dönemi için uygun değildir',
      'Biyolojik cinsiyet bilinmiyorsa sabit (+5 / −161) seçilemez, BMR hesaplanamaz',
      'Kas kütlesi çok yüksek veya çok düşük bireylerde sapma artar',
    ],
  },

  FAO_WHO_UNU_2004: {
    id: 'FAO_WHO_UNU_2004',
    organisation: 'FAO / WHO / UNU',
    title: 'Human energy requirements — Report of a Joint Expert Consultation',
    series: 'FAO Food and Nutrition Series 1',
    year: 2004,
    place: 'Rome',
    url: 'https://www.fao.org/4/y5686e/y5686e07.htm',
    ageGroup: 'Yetişkinler (18+)',
    supports: [
      'PAL (fiziksel aktivite düzeyi) = toplam enerji harcaması / BMR',
      'Hareketsiz veya hafif aktif yaşam tarzı: PAL 1.40–1.69',
      'Aktif veya orta derecede aktif yaşam tarzı: PAL 1.70–1.99',
      'Ağır veya çok ağır aktif yaşam tarzı: PAL 2.00–2.40',
    ],
    limitations: [
      'Bu uygulama kategori ORTA NOKTASINI kullanır; gerçek PAL bireyler arasında geniştir',
      'TDEE = BMR × PAL bir tahmindir, ±%10 sapma normaldir',
    ],
  },

  EFSA_PROTEIN_2012: {
    id: 'EFSA_PROTEIN_2012',
    organisation: 'EFSA NDA Panel (Avrupa Gıda Güvenliği Otoritesi)',
    title: 'Scientific Opinion on Dietary Reference Values for protein',
    journal: 'EFSA Journal',
    year: 2012,
    citation: 'EFSA Journal 2012;10(2):2557',
    doi: '10.2903/j.efsa.2012.2557',
    url: 'https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2012.2557',
    ageGroup: 'Yetişkinler (yaşlılar dahil). Çocuk/ergen için 0.83–1.31 g/kg',
    supports: [
      'Yetişkinler için protein PRI = 0.83 g/kg vücut ağırlığı/gün',
      'Yüksek kaliteli protein ve karışık beslenme proteinleri için geçerlidir',
    ],
  },

  EFSA_FIBRE_2010: {
    id: 'EFSA_FIBRE_2010',
    organisation: 'EFSA NDA Panel',
    title:
      'Scientific Opinion on Dietary Reference Values for carbohydrates and dietary fibre',
    journal: 'EFSA Journal',
    year: 2010,
    citation: 'EFSA Journal 2010;8(3):1462',
    doi: '10.2903/j.efsa.2010.1462',
    url: 'https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2010.1462',
    ageGroup: 'Yetişkinler',
    supports: [
      'Normal bağırsak fonksiyonu için yeterli lif alımı = 25 g/gün (AI)',
      'Kardiyometabolik yarar için kanıtlar daha yüksek alımı (≥25 g) destekler',
    ],
  },

  EFSA_WATER_2010: {
    id: 'EFSA_WATER_2010',
    organisation: 'EFSA NDA Panel',
    title: 'Scientific Opinion on Dietary Reference Values for water',
    journal: 'EFSA Journal',
    year: 2010,
    citation: 'EFSA Journal 2010;8(3):1459',
    doi: '10.2903/j.efsa.2010.1459',
    url: 'https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2010.1459',
    ageGroup: 'Yetişkinler, ılıman iklim ve olağan fiziksel aktivite',
    supports: [
      'Toplam su için yeterli alım (AI): erkek 2.5 L/gün, kadın 2.0 L/gün',
      'Bu değer içme suyu, diğer içecekler ve besinlerin suyunu TOPLAM olarak kapsar',
    ],
    limitations: [
      'Sıcak iklim, yoğun egzersiz, gebelik/emzirme ve hastalıkta gereksinim artar',
      'Uygulama su takibi YAPMAZ; bu bilgi yalnızca bilgilendirme amaçlıdır',
    ],
  },

  IOM_AMDR_2005: {
    id: 'IOM_AMDR_2005',
    organisation:
      'Institute of Medicine / National Academies (ABD-Kanada Besin ve Beslenme Kurulu)',
    title:
      'Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids',
    year: 2005,
    publisher: 'The National Academies Press, Washington DC',
    url: 'https://www.nationalacademies.org/read/27957/chapter/5',
    ageGroup: 'Yetişkinler (AMDR çocuklarda farklıdır)',
    supports: [
      'AMDR karbonhidrat: enerjinin %45–65’i',
      'AMDR protein: enerjinin %10–35’i',
      'AMDR yağ: enerjinin %20–35’i',
      'Protein RDA (ABD/Kanada): 0.8 g/kg/gün',
      'Lif: 14 g/1000 kcal (2000 kcal için ~28 g)',
    ],
  },

  DGA_2025_2030: {
    id: 'DGA_2025_2030',
    organisation: 'ABD Sağlık ve İnsan Hizmetleri Bakanlığı (HHS) / USDA',
    title: 'Dietary Guidelines for Americans, 2025–2030',
    year: 2026,
    published: '2026-01',
    url: 'https://cdn.realfood.gov/DGA.pdf',
    ageGroup: '2 yaş ve üzeri; yetişkin hedefleri 19+ için',
    supports: [
      'Protein: 1.2–1.6 g/kg vücut ağırlığı/gün',
      'Doymuş yağ: enerjinin <%10’u',
      'İlave şeker: öğün başına <10 g önerisiyle sıkı sınırlama',
      '2000 kcal deseninde: sebze 3 porsiyon, meyve 2 porsiyon, süt ürünü 3 porsiyon',
      'Baklagiller protein veya sebze grubunda sayılabilir',
    ],
    limitations: [
      'Bu sürüm 2026-01’de yayımlanmıştır ve protein önerisi önceki ABD RDA’sından (0.8 g/kg) belirgin biçimde yüksektir',
    ],
  },

  DGA_2020_2025: {
    id: 'DGA_2020_2025',
    organisation: 'USDA / HHS',
    title: 'Dietary Guidelines for Americans, 2020–2025',
    year: 2020,
    published: '2020-12',
    url: 'https://www.dietaryguidelines.gov/sites/default/files/2020-12/Dietary_Guidelines_for_Americans_2020-2025.pdf',
    ageGroup: '2 yaş ve üzeri',
    supports: [
      'İlave şeker: 2 yaştan itibaren enerjinin <%10’u',
      'Doymuş yağ: 2 yaştan itibaren enerjinin <%10’u',
      '2000 kcal deseni: 2.5 kase-eşdeğeri sebze, 2 kase-eşdeğeri meyve',
      'Sebze alt grubu "kuru baklagiller (beans, peas, lentils)": 2000 kcal için haftada 1.5 kase-eşdeğeri',
    ],
  },

  TUBER_2022: {
    id: 'TUBER_2022',
    organisation: 'T.C. Sağlık Bakanlığı, Halk Sağlığı Genel Müdürlüğü',
    title: 'Türkiye Beslenme Rehberi (TÜBER) 2022',
    year: 2022,
    place: 'Ankara',
    isbn: '978-975-590-867-0',
    url: 'https://hsgm.saglik.gov.tr/media/attachments/2025-05-12/turkiye-beslenme-rehberi-2022.pdf',
    ageGroup: 'Yaş gruplarına göre ayrılmış öneriler; yetişkin hedefleri burada kullanıldı',
    supports: [
      'Günde en az 5 porsiyon (yaklaşık 400 g) sebze ve/veya meyve',
      'Porsiyon dağılımı: sebze 2.5–4 porsiyon, meyve 2–3 porsiyon',
    ],
    limitations: [
      'Rehber 430 sayfadır; porsiyon sayıları yaş grubuna ve enerji gereksinimine göre değişir',
      'Gebelik ve emzirme döneminde sebze-meyve önerisi artar',
    ],
  },

  USDA_FDC: {
    id: 'USDA_FDC',
    organisation: 'USDA Agricultural Research Service',
    title: 'FoodData Central',
    url: 'https://fdc.nal.usda.gov/',
    ageGroup: 'Yaş grubundan bağımsız besin bileşim verisi',
    supports: [
      'Besin veritabanındaki 100 g başına makro besin değerleri bu kaynaktan alınır',
      'Her foods satırında source_food_id (FDC kimliği) ve source_url saklanır',
    ],
  },

  APP_ASSUMPTION: {
    id: 'APP_ASSUMPTION',
    organisation: 'Bu uygulama (türetilmiş varsayım)',
    title: 'Kılavuzlardan doğrudan alınmayan, uygulama tarafından belirlenen planlama değerleri',
    year: 2026,
    url: null,
    ageGroup: 'Yetişkinler',
    supports: [
      'Kilo verme için −300 ile −500 kcal/gün, kilo alma için +250 ile +450 kcal/gün aralığı',
      'PAL kategorilerinde orta nokta kullanımı (1.55 / 1.85 / 2.20)',
      '1 porsiyon sebze/meyve/baklagil = 80 g',
      'Baklagil hedefi 0.5 porsiyon/gün (DGA haftada 1.5 kase-eşdeğerinden türetildi)',
    ],
    limitations: [
      'Bunlar klinik reçete DEĞİLDİR; planlama kolaylığı için seçilmiş geleneksel aralıklardır',
      'Kilo değişim hızı bireysel olarak geniş ölçüde değişir',
      'Enerji açığı/fazlası hedefleri bir sağlık profesyoneline danışılarak ayarlanmalıdır',
    ],
  },
};

/**
 * Uygulamanın kullandığı 1 porsiyon tanımı.
 * Dayanak: WHO "günde en az 400 g sebze+meyve = 5 porsiyon" → 80 g/porsiyon.
 */
const SERVING_GRAMS_DEFAULT = 80;

/** Haftalık sebze-meyve birleşik hedefi (WHO / TÜBER: en az 5 porsiyon/gün). */
const COMBINED_VEG_FRUIT_SERVINGS = 5;

module.exports = {
  REFERENCES,
  SERVING_GRAMS_DEFAULT,
  COMBINED_VEG_FRUIT_SERVINGS,
};
