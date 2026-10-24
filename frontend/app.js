/**
 * Kalori ve Besin Takip Sistemi — İstemci Uygulama Mantığı (app.js)
 *
 * Sıkı CSP uyumlu: Inline script yok, tüm olaylar addEventListener ile bağlanır.
 * XSS korumalı: Dinamik veriler DOM API ve textContent ile güvenle eklenir.
 * localStorage YOK: Tüm durum SQL veritabanından okunur ve API üzerinden güncellenir.
 */

'use strict';

(function () {
  /* ==========================================================================
     Durum (State)
     ========================================================================== */
  const state = {
    user: null,
    currentDate: getTodayIso(),
    activeTab: 'bugun',
    formMeta: null,
    selectedFood: null,
    weeklyStartDate: null,
    currentMeals: [],
  };

  /* ==========================================================================
     DOM Seçicileri
     ========================================================================== */
  const dom = {
    // Görünümler
    kullaniciAlani: document.getElementById('kullanici-alani'),
    gorunumGiris: document.getElementById('gorunum-giris'),
    gorunumUygulama: document.getElementById('gorunum-uygulama'),

    // Giriş / Kayıt
    dugmeGirisSekme: document.getElementById('dugme-giris-sekme'),
    dugmeKayitSekme: document.getElementById('dugme-kayit-sekme'),
    formGiris: document.getElementById('form-giris'),
    formKayit: document.getElementById('form-kayit'),
    girisHata: document.getElementById('giris-hata'),
    kayitHata: document.getElementById('kayit-hata'),
    girisEposta: document.getElementById('giris-eposta'),
    girisParola: document.getElementById('giris-parola'),

    // Kayıt alanları
    kayitAd: document.getElementById('kayit-ad'),
    kayitEposta: document.getElementById('kayit-eposta'),
    kayitParola: document.getElementById('kayit-parola'),
    kayitYas: document.getElementById('kayit-yas'),
    kayitBoy: document.getElementById('kayit-boy'),
    kayitKilo: document.getElementById('kayit-kilo'),
    kayitCinsiyet: document.getElementById('kayit-cinsiyet'),
    kayitAktivite: document.getElementById('kayit-aktivite'),
    kayitHedef: document.getElementById('kayit-hedef'),

    // Tarih Çubuğu
    gunGeri: document.getElementById('gun-geri'),
    gunIleri: document.getElementById('gun-ileri'),
    gunBugun: document.getElementById('gun-bugun'),
    tarihSecici: document.getElementById('tarih-secici'),
    tarihOkunur: document.getElementById('tarih-okunur'),

    // Sekmeler
    sekmeler: document.getElementById('sekmeler'),
    panelBugun: document.getElementById('panel-bugun'),
    panelRaporlar: document.getElementById('panel-raporlar'),
    panelProfil: document.getElementById('panel-profil'),

    // Panel 1: Bugün
    kaloriAlinan: document.getElementById('kalori-alinan'),
    kaloriHedefEtiket: document.getElementById('kalori-hedef-etiket'),
    kaloriFark: document.getElementById('kalori-fark'),
    kaloriCubukAlan: document.getElementById('kalori-cubuk-alan'),
    kaloriNot: document.getElementById('kalori-not'),
    makroListe: document.getElementById('makro-liste'),
    sekerLifListe: document.getElementById('seker-lif-liste'),
    sekerUyari: document.getElementById('seker-uyari'),
    grupListe: document.getElementById('grup-liste'),
    porsiyonGram: document.getElementById('porsiyon-gram'),

    // Besin Arama & Ekleme
    besinArama: document.getElementById('besin-arama'),
    besinKategori: document.getElementById('besin-kategori'),
    besinAraBtn: document.getElementById('besin-ara'),
    aramaDurum: document.getElementById('arama-durum'),
    besinSonuclari: document.getElementById('besin-sonuclari'),
    formBesinEkle: document.getElementById('form-besin-ekle'),
    seciliBesin: document.getElementById('secili-besin'),
    ekleOgun: document.getElementById('ekle-ogun'),
    ekleGram: document.getElementById('ekle-gram'),
    hizliMiktar: document.getElementById('hizli-miktar'),
    ekleOnizleme: document.getElementById('ekle-onizleme'),
    ekleVazgec: document.getElementById('ekle-vazgec'),
    ekleHata: document.getElementById('ekle-hata'),

    // Öğünler
    ogunIzgara: document.getElementById('ogun-izgara'),

    // Panel 2: Raporlar
    gunlukYenile: document.getElementById('gunluk-yenile'),
    gunlukRapor: document.getElementById('gunluk-rapor'),
    haftaGeri: document.getElementById('hafta-geri'),
    haftaIleri: document.getElementById('hafta-ileri'),
    haftalikTazele: document.getElementById('haftalik-tazele'),
    haftalikRapor: document.getElementById('haftalik-rapor'),

    // Panel 3: Profil
    formProfil: document.getElementById('form-profil'),
    profilAd: document.getElementById('profil-ad'),
    profilYas: document.getElementById('profil-yas'),
    profilCinsiyet: document.getElementById('profil-cinsiyet'),
    cinsiyetNot: document.getElementById('cinsiyet-not'),
    profilBoy: document.getElementById('profil-boy'),
    profilKilo: document.getElementById('profil-kilo'),
    profilAktivite: document.getElementById('profil-aktivite'),
    aktiviteNot: document.getElementById('aktivite-not'),
    profilHedef: document.getElementById('profil-hedef'),
    profilKisit: document.getElementById('profil-kisit'),
    profilHata: document.getElementById('profil-hata'),
    hedefOzet: document.getElementById('hedef-ozet'),
    formParola: document.getElementById('form-parola'),
    parolaEski: document.getElementById('parola-eski'),
    parolaYeni: document.getElementById('parola-yeni'),
    parolaHata: document.getElementById('parola-hata'),

    // Ortak
    bildirim: document.getElementById('bildirim'),
    yukleniyor: document.getElementById('yukleniyor'),
  };

  /* ==========================================================================
     Yardımcı Fonksiyonlar (Utilities)
     ========================================================================== */
  function getTodayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatTurkishDate(isoString) {
    if (!isoString) return '';
    const [y, m, d] = isoString.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const gunler = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const aylar = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];
    return `${d} ${aylar[date.getMonth()]} ${y}, ${gunler[date.getDay()]}`;
  }

  function addDays(isoString, days) {
    const [y, m, d] = isoString.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
  }

  function formatNumber(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return Number(val).toLocaleString('tr-TR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function bildirimGoster(mesaj, tur = 'bilgi') {
    if (!dom.bildirim) return;
    dom.bildirim.textContent = mesaj;
    dom.bildirim.className = `bildirim ${tur}`;
    dom.bildirim.hidden = false;
    clearTimeout(dom.bildirim._timer);
    dom.bildirim._timer = setTimeout(() => {
      dom.bildirim.hidden = true;
    }, 4000);
  }

  function yukleniyor(aktif) {
    if (dom.yukleniyor) {
      dom.yukleniyor.hidden = !aktif;
    }
  }

  function hataGoster(kutusu, mesaj) {
    if (!kutusu) return;
    if (mesaj) {
      kutusu.textContent = mesaj;
      kutusu.hidden = false;
    } else {
      kutusu.textContent = '';
      kutusu.hidden = true;
    }
  }

  /* ==========================================================================
     API İstek İstemcisi
     ========================================================================== */
  async function api(path, options = {}) {
    yukleniyor(true);
    try {
      const fetchOpts = {
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          ...(options.headers || {}),
        },
        ...options,
      };

      if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(options.body);
      }

      const res = await fetch(path, fetchOpts);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        if (res.status === 401) {
          state.user = null;
          ekraniGuncelle();
        }
        const errMsg = data?.error?.message || data?.message || `İşlem başarısız oldu (${res.status}).`;
        const err = new Error(errMsg);
        err.status = res.status;
        err.details = data?.error?.details || null;
        throw err;
      }

      return data;
    } finally {
      yukleniyor(false);
    }
  }

  /* ==========================================================================
     Oturum Yönetimi
     ========================================================================== */
  async function oturumKontrol() {
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
    } catch {
      state.user = null;
    }
    ekraniGuncelle();
    if (state.user) {
      await formMetadatalariYukle();
      await verileriYukle();
    } else {
      await formMetadatalariYukle();
    }
  }

  async function girisYap(email, password) {
    hataGoster(dom.girisHata, '');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      state.user = data.user;
      bildirimGoster('Giriş başarılı.', 'basari');
      ekraniGuncelle();
      await verileriYukle();
    } catch (err) {
      hataGoster(dom.girisHata, err.message);
    }
  }

  async function kayitOl(formData) {
    hataGoster(dom.kayitHata, '');
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: formData,
      });
      state.user = data.user;
      bildirimGoster('Hesap oluşturuldu ve giriş yapıldı.', 'basari');
      ekraniGuncelle();
      await verileriYukle();
    } catch (err) {
      hataGoster(dom.kayitHata, err.message);
    }
  }

  async function cikisYap() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Hata olsa dahi istemci durumunu sıfırla
    }
    state.user = null;
    bildirimGoster('Oturum kapatıldı.', 'bilgi');
    ekraniGuncelle();
  }

  async function formMetadatalariYukle() {
    if (state.formMeta) return;
    try {
      const data = await api('/api/profile');
      state.formMeta = data.form;
      selectSecenekleriniDoldur();
    } catch {
      // Profil uç noktası 401 dönebilir, varsayılan seçenekleri statik doldurabiliriz
      state.formMeta = {
        biologicalSexOptions: [
          { value: 'female', label: 'Kadın' },
          { value: 'male', label: 'Erkek' },
          { value: 'unspecified', label: 'Belirtmek istemiyorum' }
        ],
        activityLevelOptions: [
          { value: 'sedentary', label: 'Hareketsiz / hafif aktif' },
          { value: 'moderately_active', label: 'Orta derecede aktif' },
          { value: 'very_active', label: 'Çok aktif' }
        ],
        goalOptions: [
          { value: 'maintain', label: 'Mevcut kiloyu koruma' },
          { value: 'lose', label: 'Kilo verme' },
          { value: 'gain', label: 'Kilo alma' }
        ]
      };
      selectSecenekleriniDoldur();
    }
  }

  function selectSecenekleriniDoldur() {
    if (!state.formMeta) return;

    function doldur(selectEl, liste, bosEtiket = 'Seçiniz…') {
      if (!selectEl) return;
      selectEl.replaceChildren();
      const bosOpt = document.createElement('option');
      bosOpt.value = '';
      bosOpt.textContent = bosEtiket;
      selectEl.appendChild(bosOpt);

      for (const item of liste) {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        selectEl.appendChild(opt);
      }
    }

    doldur(dom.kayitCinsiyet, state.formMeta.biologicalSexOptions);
    doldur(dom.kayitAktivite, state.formMeta.activityLevelOptions);
    doldur(dom.kayitHedef, state.formMeta.goalOptions);

    doldur(dom.profilCinsiyet, state.formMeta.biologicalSexOptions);
    doldur(dom.profilAktivite, state.formMeta.activityLevelOptions);
    doldur(dom.profilHedef, state.formMeta.goalOptions);
  }

  /* ==========================================================================
     Arayüz Görünümü & Sekme Geçişleri
     ========================================================================== */
  function ekraniGuncelle() {
    const oturumVar = Boolean(state.user);

    dom.gorunumGiris.hidden = oturumVar;
    dom.gorunumUygulama.hidden = !oturumVar;

    // Üst Bar Kullanıcı Alanı
    dom.kullaniciAlani.replaceChildren();
    if (oturumVar) {
      const bilgiDiv = document.createElement('div');
      bilgiDiv.className = 'kullanici-bilgi';

      const adSpan = document.createElement('div');
      adSpan.className = 'kullanici-ad';
      adSpan.textContent = state.user.name || 'Kullanıcı';

      const epostaSpan = document.createElement('div');
      epostaSpan.className = 'kullanici-eposta';
      epostaSpan.textContent = state.user.email;

      bilgiDiv.appendChild(adSpan);
      bilgiDiv.appendChild(epostaSpan);

      const cikisBtn = document.createElement('button');
      cikisBtn.type = 'button';
      cikisBtn.className = 'dugme dugme-ikincil dugme-kucuk';
      cikisBtn.textContent = 'Çıkış yap';
      cikisBtn.addEventListener('click', cikisYap);

      dom.kullaniciAlani.appendChild(bilgiDiv);
      dom.kullaniciAlani.appendChild(cikisBtn);
    }

    tarihCubugunuGuncelle();
    sekmeGuncelle(state.activeTab);
  }

  function tarihCubugunuGuncelle() {
    dom.tarihSecici.value = state.currentDate;
    dom.tarihOkunur.textContent = formatTurkishDate(state.currentDate);
  }

  function sekmeGuncelle(tabId) {
    state.activeTab = tabId;
    const dugmeler = dom.sekmeler.querySelectorAll('.sekme');
    dugmeler.forEach((btn) => {
      const aktif = btn.dataset.panel === tabId;
      btn.classList.toggle('is-aktif', aktif);
      btn.setAttribute('aria-selected', aktif ? 'true' : 'false');
    });

    dom.panelBugun.hidden = tabId !== 'bugun';
    dom.panelRaporlar.hidden = tabId !== 'raporlar';
    dom.panelProfil.hidden = tabId !== 'profil';

    if (state.user) {
      if (tabId === 'raporlar') raporlariYukle();
      if (tabId === 'profil') profiliYukle();
    }
  }

  /* ==========================================================================
     Ana Veri Yükleme (Bugün Paneli)
     ========================================================================== */
  async function verileriYukle() {
    if (!state.user) return;
    try {
      tarihCubugunuGuncelle();
      const [mealsData, dailyReport] = await Promise.all([
        api(`/api/meals?date=${state.currentDate}`),
        api(`/api/reports/daily?date=${state.currentDate}`),
      ]);

      state.currentMeals = mealsData.meals;
      renderOzetler(mealsData.totals, dailyReport.targets);
      renderOgunler(mealsData.meals);
      kategorileriYukle();
    } catch (err) {
      bildirimGoster('Veriler yüklenirken bir hata oluştu: ' + err.message, 'hata');
    }
  }

  /* ==========================================================================
     Render: Kalori, Makrolar, Şeker/Lif, Besin Grupları
     ========================================================================== */
  function renderOzetler(totals, targets) {
    // 1. Kalori Özeti
    const kaloriAlinan = totals ? totals.calories : 0;
    dom.kaloriAlinan.textContent = totals ? formatNumber(kaloriAlinan, 0) : '0';

    const calTarget = targets?.calories?.target;
    const calMin = targets?.calories?.min;
    const calMax = targets?.calories?.max;

    dom.kaloriCubukAlan.replaceChildren();

    if (calTarget || (calMin && calMax)) {
      const hedefMetin = calMin && calMax
        ? `${formatNumber(calMin, 0)} – ${formatNumber(calMax, 0)} kcal`
        : `${formatNumber(calTarget, 0)} kcal`;
      dom.kaloriHedefEtiket.textContent = `Günlük Hedef: ${hedefMetin}`;

      const refCal = calTarget || calMin;
      const pct = Math.round((kaloriAlinan / refCal) * 100);
      const fark = Math.round(kaloriAlinan - refCal);
      dom.kaloriFark.textContent = fark >= 0
        ? `Hedef referansına göre +${fark} kcal (%${pct})`
        : `Hedef referansına göre ${fark} kcal (%${pct})`;

      const cubuk = progressCubuguOlustur(pct, pct > 115 ? 'kirmizi' : pct >= 85 ? 'yesil' : 'birincil');
      dom.kaloriCubukAlan.appendChild(cubuk);
      dom.kaloriNot.textContent = 'Hedefler Mifflin–St Jeor denklemi ve FAO/WHO PAL aktivite katsayıları baz alınarak tahmin edilmiştir.';
    } else {
      dom.kaloriHedefEtiket.textContent = 'Hedef hesaplanamadı';
      dom.kaloriFark.textContent = 'Profilde yaş, cinsiyet, boy veya kilo bilgisi eksik.';
      dom.kaloriNot.textContent = 'Sahte kesinlik oluşturulmaması için profil bilgileri tamamlanana kadar kalori hedefi gösterilmez.';
    }

    // 2. Makrolar (Protein, Karbonhidrat, Yağ)
    dom.makroListe.replaceChildren();
    const makrolar = [
      {
        ad: 'Protein',
        alinan: totals ? totals.protein : 0,
        hedefMin: targets?.protein?.min,
        hedefMax: targets?.protein?.max,
        renk: 'mor',
        not: 'EFSA (0,83 g/kg) ve DGA (1,2–1,6 g/kg) referans aralıkları.',
      },
      {
        ad: 'Karbonhidrat',
        alinan: totals ? totals.carbohydrates : 0,
        hedefMin: targets?.carbohydrates?.min,
        hedefMax: targets?.carbohydrates?.max,
        renk: 'amber',
        not: 'AMDR: Toplam enerjinin %45–65’i (IOM 2005).',
      },
      {
        ad: 'Yağ',
        alinan: totals ? totals.fat : 0,
        hedefMin: targets?.fat?.min,
        hedefMax: targets?.fat?.max,
        renk: 'turuncu',
        not: 'AMDR: Toplam enerjinin %20–35’i (WHO / FAO).',
      },
    ];

    for (const m of makrolar) {
      dom.makroListe.appendChild(gostergeKartiOlustur(m));
    }

    // 3. Şeker ve Lif
    dom.sekerLifListe.replaceChildren();
    dom.sekerUyari.replaceChildren();

    const sekerLif = [
      {
        ad: 'Toplam Şeker',
        alinan: totals ? totals.totalSugars : 0,
        hedefMin: null,
        hedefMax: null,
        renk: 'amber',
        not: 'Meyve fruktozu ve süt laktozunu da içerir. Toplam şekere sınır konulmaz.',
      },
      {
        ad: 'İlave / Serbest Şeker',
        alinan: totals ? totals.addedSugarsKnownSum : 0,
        hedefMin: null,
        hedefMax: targets?.addedSugars?.limit,
        renk: 'kirmizi',
        not: 'WHO serbest şeker önerisi: günlük enerjinin <%10’u (isteğe bağlı <%5).',
      },
      {
        ad: 'Doymuş Yağ',
        alinan: totals ? totals.saturatedFat : 0,
        hedefMin: null,
        hedefMax: targets?.saturatedFat?.limit,
        renk: 'kirmizi',
        not: 'WHO ve DGA önerisi: toplam enerjinin <%10’u.',
      },
      {
        ad: 'Lif',
        alinan: totals ? totals.fiber : 0,
        hedefMin: targets?.fiber?.target,
        hedefMax: null,
        renk: 'yesil',
        not: 'EFSA yeterli alım: 25 g/gün (veya 14 g / 1000 kcal).',
      },
    ];

    for (const s of sekerLif) {
      dom.sekerLifListe.appendChild(gostergeKartiOlustur(s));
    }

    if (totals?.addedSugarsIncomplete) {
      const uyariKutusu = document.createElement('div');
      uyariKutusu.className = 'not';
      uyariKutusu.style.color = 'var(--renk-amber)';
      uyariKutusu.textContent = 'ℹ️ Tüketilen bazı besinlerde ilave şeker verisi bulunmuyor (USDA SR Legacy sınırlaması). Uydurma düşük değer vermek yerine durum açıkça belirtilmiştir.';
      dom.sekerUyari.appendChild(uyariKutusu);
    }

    // 4. Sebze · Meyve · Baklagil
    dom.grupListe.replaceChildren();
    const gruplar = [
      {
        sinif: 'sebze',
        ad: 'Sebze',
        gram: totals ? totals.vegetableGrams : 0,
        porsiyon: totals ? totals.vegetableServings : 0,
        hedefPorsiyon: targets?.servings?.vegetable ?? 3,
        aciklama: 'DGA / TÜBER önerisi: Günde en az 3 porsiyon.',
      },
      {
        sinif: 'meyve',
        ad: 'Meyve',
        gram: totals ? totals.fruitGrams : 0,
        porsiyon: totals ? totals.fruitServings : 0,
        hedefPorsiyon: targets?.servings?.fruit ?? 2,
        aciklama: 'DGA / TÜBER önerisi: Günde en az 2 porsiyon.',
      },
      {
        sinif: 'baklagil',
        ad: 'Baklagil',
        gram: totals ? totals.legumeGrams : 0,
        porsiyon: totals ? totals.legumeServings : 0,
        hedefPorsiyon: targets?.servings?.legume ?? null,
        aciklama: 'Lif ve bitkisel protein kaynağı (mercimek, nohut, fasulye).',
      },
    ];

    for (const g of gruplar) {
      const kart = document.createElement('div');
      kart.className = `grup-kart ${g.sinif}`;

      const baslik = document.createElement('div');
      baslik.className = 'grup-baslik';
      baslik.textContent = g.ad;

      const sayi = document.createElement('div');
      sayi.className = 'grup-sayi';
      sayi.textContent = formatNumber(g.porsiyon, 1);
      const birim = document.createElement('span');
      birim.className = 'grup-birim';
      birim.textContent = 'porsiyon';
      sayi.appendChild(birim);

      const gramBilgi = document.createElement('div');
      gramBilgi.className = 'alan-not';
      gramBilgi.textContent = `Toplam: ${formatNumber(g.gram, 0)} g`;

      const aciklama = document.createElement('div');
      aciklama.className = 'grup-aciklama';
      aciklama.textContent = g.aciklama;

      kart.appendChild(baslik);
      kart.appendChild(sayi);
      kart.appendChild(gramBilgi);
      kart.appendChild(aciklama);

      dom.grupListe.appendChild(kart);
    }
  }

  function progressCubuguOlustur(pct, renk = 'birincil') {
    const kapsayici = document.createElement('div');
    kapsayici.className = 'cubuk-kapsayici';
    const dolgu = document.createElement('div');
    dolgu.className = `cubuk-dolgu ${renk}`;
    const guvenliPct = Math.min(100, Math.max(0, pct));
    dolgu.style.setProperty('--doluluk', `${guvenliPct}%`);
    kapsayici.appendChild(dolgu);
    return kapsayici;
  }

  function gostergeKartiOlustur(item) {
    const kart = document.createElement('div');
    kart.className = 'gosterge-kart';

    const ust = document.createElement('div');
    ust.className = 'gosterge-ust';

    const ad = document.createElement('span');
    ad.className = 'gosterge-ad';
    ad.textContent = item.ad;

    const deger = document.createElement('span');
    deger.className = 'gosterge-deger';
    deger.textContent = `${formatNumber(item.alinan, 1)} g`;

    ust.appendChild(ad);
    ust.appendChild(deger);
    kart.appendChild(ust);

    let hedefMetin = '';
    let pct = 0;

    if (item.hedefMin && item.hedefMax) {
      hedefMetin = `Hedef: ${formatNumber(item.hedefMin, 0)} – ${formatNumber(item.hedefMax, 0)} g`;
      pct = Math.round((item.alinan / item.hedefMin) * 100);
    } else if (item.hedefMin) {
      hedefMetin = `Hedef: En az ${formatNumber(item.hedefMin, 0)} g`;
      pct = Math.round((item.alinan / item.hedefMin) * 100);
    } else if (item.hedefMax) {
      hedefMetin = `Sınır: En çok ${formatNumber(item.hedefMax, 0)} g`;
      pct = Math.round((item.alinan / item.hedefMax) * 100);
    }

    if (hedefMetin) {
      kart.appendChild(progressCubuguOlustur(pct, item.renk));
      const alt = document.createElement('div');
      alt.className = 'gosterge-alt';

      const hSpan = document.createElement('span');
      hSpan.textContent = hedefMetin;
      const nSpan = document.createElement('span');
      nSpan.textContent = item.not;

      alt.appendChild(hSpan);
      alt.appendChild(nSpan);
      kart.appendChild(alt);
    } else {
      const alt = document.createElement('div');
      alt.className = 'gosterge-alt';
      const nSpan = document.createElement('span');
      nSpan.textContent = item.not;
      alt.appendChild(nSpan);
      kart.appendChild(alt);
    }

    return kart;
  }

  /* ==========================================================================
     Öğün Listeleri (Bölüm 6)
     ========================================================================== */
  function renderOgunler(meals) {
    dom.ogunIzgara.replaceChildren();

    for (const meal of meals) {
      const kart = document.createElement('div');
      kart.className = 'ogun-kart';

      const baslikSatir = document.createElement('div');
      baslikSatir.className = 'ogun-baslik-satir';

      const adSpan = document.createElement('span');
      adSpan.className = 'ogun-ad';
      adSpan.textContent = meal.label || meal.mealType;

      const toplamKalori = meal.items.reduce((s, it) => s + Number(it.calories || 0), 0);
      const kaloriSpan = document.createElement('span');
      kaloriSpan.className = 'ogun-kalori';
      kaloriSpan.textContent = toplamKalori > 0 ? `${formatNumber(toplamKalori, 0)} kcal` : '';

      baslikSatir.appendChild(adSpan);
      baslikSatir.appendChild(kaloriSpan);
      kart.appendChild(baslikSatir);

      const liste = document.createElement('ul');
      liste.className = 'ogun-madde-liste';

      if (meal.items.length === 0) {
        const bos = document.createElement('li');
        bos.className = 'ogun-bos-metin';
        bos.textContent = 'Bu öğüne henüz besin eklenmemiş.';
        liste.appendChild(bos);
      } else {
        for (const item of meal.items) {
          const li = document.createElement('li');
          li.className = 'ogun-madde';

          const bilgi = document.createElement('div');
          bilgi.className = 'ogun-madde-bilgi';

          const maddeAd = document.createElement('div');
          maddeAd.className = 'ogun-madde-ad';
          maddeAd.textContent = `${item.foodName} (${formatNumber(item.quantityGrams, 0)} g)`;

          const makro = document.createElement('div');
          makro.className = 'ogun-madde-makro';
          makro.textContent = `${formatNumber(item.calories, 0)} kcal · P: ${formatNumber(item.protein, 1)}g · K: ${formatNumber(item.carbohydrates, 1)}g · Y: ${formatNumber(item.fat, 1)}g`;

          bilgi.appendChild(maddeAd);
          bilgi.appendChild(makro);

          const islemler = document.createElement('div');
          islemler.className = 'ogun-madde-islem';

          const duzenleBtn = document.createElement('button');
          duzenleBtn.type = 'button';
          duzenleBtn.className = 'dugme dugme-ikincil dugme-kucuk';
          duzenleBtn.textContent = 'Düzenle';
          duzenleBtn.addEventListener('click', () => besinMiktarDuzenle(item));

          const silBtn = document.createElement('button');
          silBtn.type = 'button';
          silBtn.className = 'dugme dugme-tehlike dugme-kucuk';
          silBtn.textContent = 'Sil';
          silBtn.addEventListener('click', () => besinSil(item));

          islemler.appendChild(duzenleBtn);
          islemler.appendChild(silBtn);

          li.appendChild(bilgi);
          li.appendChild(islemler);
          liste.appendChild(li);
        }
      }

      kart.appendChild(liste);
      dom.ogunIzgara.appendChild(kart);
    }
  }

  async function besinMiktarDuzenle(item) {
    const yeniMiktar = window.prompt(
      `${item.foodName} için yeni gramajı giriniz (0.1 - 10000):`,
      item.quantityGrams
    );
    if (!yeniMiktar) return;

    const miktarSayisi = parseFloat(yeniMiktar);
    if (isNaN(miktarSayisi) || miktarSayisi <= 0 || miktarSayisi > 10000) {
      bildirimGoster('Lütfen 0.1 ile 10000 arasında geçerli bir gramaj girin.', 'hata');
      return;
    }

    try {
      await api(`/api/meal-items/${item.id}`, {
        method: 'PUT',
        body: { quantityGrams: miktarSayisi },
      });
      bildirimGoster('Miktar güncellendi.', 'basari');
      await verileriYukle();
    } catch (err) {
      bildirimGoster('Güncelleme hatası: ' + err.message, 'hata');
    }
  }

  async function besinSil(item) {
    if (!window.confirm(`${item.foodName} kaydını silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      await api(`/api/meal-items/${item.id}`, { method: 'DELETE' });
      bildirimGoster('Besin kaydı silindi.', 'bilgi');
      await verileriYukle();
    } catch (err) {
      bildirimGoster('Silme hatası: ' + err.message, 'hata');
    }
  }

  /* ==========================================================================
     Besin Arama & Ekleme (Bölüm 5)
     ========================================================================== */
  async function kategorileriYukle() {
    if (dom.besinKategori.children.length > 0) return;
    try {
      const data = await api('/api/foods/categories');
      dom.besinKategori.replaceChildren();
      const tumu = document.createElement('option');
      tumu.value = '';
      tumu.textContent = 'Tüm kategoriler';
      dom.besinKategori.appendChild(tumu);

      for (const cat of data.categories) {
        const opt = document.createElement('option');
        opt.value = cat.name;
        opt.textContent = cat.name;
        dom.besinKategori.appendChild(opt);
      }
    } catch {
      // Hata olursa varsayılan boş kalsın
    }
  }

  async function besinAra() {
    const aramaMetni = dom.besinArama.value.trim();
    const kategori = dom.besinKategori.value;

    dom.aramaDurum.textContent = 'Aranıyor…';
    dom.besinSonuclari.replaceChildren();

    try {
      const params = new URLSearchParams();
      if (aramaMetni) params.set('search', aramaMetni);
      if (kategori) params.set('category', kategori);
      params.set('limit', '50');

      const data = await api(`/api/foods?${params.toString()}`);
      dom.aramaDurum.textContent = `${data.total} besin bulundu. Eklemek için birine tıklayın.`;

      if (data.foods.length === 0) {
        const bos = document.createElement('div');
        bos.className = 'besin-satir';
        bos.textContent = 'Aramanıza uygun besin bulunamadı.';
        dom.besinSonuclari.appendChild(bos);
        return;
      }

      for (const food of data.foods) {
        const satir = document.createElement('div');
        satir.className = 'besin-satir';

        const sol = document.createElement('div');
        sol.className = 'besin-satir-sol';

        const ad = document.createElement('div');
        ad.className = 'besin-satir-ad';
        ad.textContent = food.name;

        const detay = document.createElement('div');
        detay.className = 'besin-satir-detay';
        detay.textContent = `${food.category} · 100g: ${formatNumber(food.caloriesPer100g, 0)} kcal, P: ${formatNumber(food.proteinPer100g, 1)}g, K: ${formatNumber(food.carbohydratesPer100g, 1)}g, Y: ${formatNumber(food.fatPer100g, 1)}g`;

        sol.appendChild(ad);
        sol.appendChild(detay);

        const secBtn = document.createElement('button');
        secBtn.type = 'button';
        secBtn.className = 'dugme dugme-ikincil dugme-kucuk';
        secBtn.textContent = 'Seç';

        satir.appendChild(sol);
        satir.appendChild(secBtn);

        satir.addEventListener('click', () => besinSec(food));
        dom.besinSonuclari.appendChild(satir);
      }
    } catch (err) {
      dom.aramaDurum.textContent = 'Arama hatası: ' + err.message;
    }
  }

  function besinSec(food) {
    state.selectedFood = food;
    dom.seciliBesin.replaceChildren();

    const ad = document.createElement('strong');
    ad.textContent = food.name;
    const ayrinti = document.createElement('div');
    ayrinti.className = 'alan-not';
    ayrinti.textContent = `100 g için: ${formatNumber(food.caloriesPer100g, 0)} kcal | Protein: ${formatNumber(food.proteinPer100g, 1)} g | Karbonhidrat: ${formatNumber(food.carbohydratesPer100g, 1)} g | Yağ: ${formatNumber(food.fatPer100g, 1)} g | Lif: ${formatNumber(food.fiberPer100g, 1)} g`;

    dom.seciliBesin.appendChild(ad);
    dom.seciliBesin.appendChild(ayrinti);

    // Hızlı porsiyon butonları
    dom.hizliMiktar.replaceChildren();
    const hizliMiktarlar = [50, 100, 150, 200];
    if (food.portionGrams && !hizliMiktarlar.includes(Number(food.portionGrams))) {
      hizliMiktarlar.push(Number(food.portionGrams));
    }
    hizliMiktarlar.sort((a, b) => a - b);

    for (const g of hizliMiktarlar) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dugme dugme-ikincil dugme-kucuk';
      btn.textContent = food.portionGrams === g && food.portionUnit
        ? `${g} g (1 ${food.portionUnit})`
        : `${g} g`;
      btn.addEventListener('click', () => {
        dom.ekleGram.value = g;
        canliOnizlemeGuncelle();
      });
      dom.hizliMiktar.appendChild(btn);
    }

    dom.ekleGram.value = food.portionGrams ? food.portionGrams : 100;
    canliOnizlemeGuncelle();

    dom.formBesinEkle.hidden = false;
    dom.ekleGram.focus();
  }

  function canliOnizlemeGuncelle() {
    if (!state.selectedFood) return;
    const g = parseFloat(dom.ekleGram.value);
    if (isNaN(g) || g <= 0) {
      dom.ekleOnizleme.textContent = 'Miktar girildiğinde hesaplama görüntülenecektir.';
      return;
    }

    const f = state.selectedFood;
    const factor = g / 100;
    const cal = (f.caloriesPer100g * factor);
    const p = (f.proteinPer100g * factor);
    const c = (f.carbohydratesPer100g * factor);
    const fat = (f.fatPer100g * factor);
    const fib = (f.fiberPer100g * factor);

    dom.ekleOnizleme.textContent = `${g} gram için: ~${formatNumber(cal, 1)} kcal · Protein: ${formatNumber(p, 1)} g · Karb: ${formatNumber(c, 1)} g · Yağ: ${formatNumber(fat, 1)} g · Lif: ${formatNumber(fib, 1)} g`;
  }

  async function seciliBesiniOgunaEkle(e) {
    e.preventDefault();
    hataGoster(dom.ekleHata, '');

    if (!state.selectedFood) return;
    const mealType = dom.ekleOgun.value;
    const quantityGrams = parseFloat(dom.ekleGram.value);

    if (isNaN(quantityGrams) || quantityGrams <= 0 || quantityGrams > 10000) {
      hataGoster(dom.ekleHata, 'Miktar 0.1 ile 10000 gram arasında olmalıdır.');
      return;
    }

    try {
      // Önce bu öğün başlığı var mı bakalım, yoksa ensureMeal yap
      let targetMeal = state.currentMeals.find((m) => m.mealType === mealType && m.mealId);
      if (!targetMeal) {
        const mealRes = await api('/api/meals', {
          method: 'POST',
          body: { mealDate: state.currentDate, mealType },
        });
        targetMeal = { mealId: mealRes.meal.id };
      }

      await api(`/api/meals/${targetMeal.mealId}/items`, {
        method: 'POST',
        body: {
          foodId: state.selectedFood.id,
          quantityGrams,
        },
      });

      bildirimGoster(`${state.selectedFood.name} öğüne eklendi.`, 'basari');
      dom.formBesinEkle.hidden = true;
      state.selectedFood = null;
      await verileriYukle();
    } catch (err) {
      hataGoster(dom.ekleHata, err.message);
    }
  }

  /* ==========================================================================
     Raporlar Paneli (Bölüm 7)
     ========================================================================== */
  async function raporlariYukle() {
    gunlukRaporuYukle();
    haftalikRaporuYukle();
  }

  async function gunlukRaporuYukle() {
    dom.gunlukRapor.replaceChildren();
    try {
      const data = await api(`/api/reports/daily?date=${state.currentDate}`);
      if (!data.hasData) {
        const bilgi = document.createElement('p');
        bilgi.className = 'not';
        bilgi.textContent = data.message || 'Bu gün için kayıt girilmemiş.';
        dom.gunlukRapor.appendChild(bilgi);
        return;
      }

      const t = data.totals;
      const tg = data.targets;

      const tabloKapsayici = document.createElement('div');
      tabloKapsayici.className = 'tablo-kapsayici';

      const tablo = document.createElement('table');
      tablo.className = 'rapor-tablo';

      tablo.innerHTML = `
        <thead>
          <tr>
            <th>Besin Ögesi</th>
            <th>Tüketilen Miktar</th>
            <th>Hedef / Sınır Referansı</th>
            <th>Değerlendirme</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Enerji (Kalori)</td>
            <td><strong>${formatNumber(t.calories, 0)} kcal</strong></td>
            <td>${tg?.calories?.min && tg?.calories?.max ? `${formatNumber(tg.calories.min, 0)} – ${formatNumber(tg.calories.max, 0)} kcal` : (tg?.calories?.target ? `${formatNumber(tg.calories.target, 0)} kcal` : '—')}</td>
            <td><span class="durum-etiket uygun">Takip Edildi</span></td>
          </tr>
          <tr>
            <td>Protein</td>
            <td><strong>${formatNumber(t.protein, 1)} g</strong></td>
            <td>${tg?.protein?.min ? `${formatNumber(tg.protein.min, 1)} – ${formatNumber(tg?.protein?.max, 1)} g` : '—'}</td>
            <td>${tg?.protein?.min && t.protein < tg.protein.min ? '<span class="durum-etiket dikkat">Aralığın altında</span>' : '<span class="durum-etiket uygun">Aralık içinde</span>'}</td>
          </tr>
          <tr>
            <td>Karbonhidrat</td>
            <td><strong>${formatNumber(t.carbohydrates, 1)} g</strong></td>
            <td>${tg?.carbohydrates?.min ? `${formatNumber(tg.carbohydrates.min, 1)} – ${formatNumber(tg?.carbohydrates?.max, 1)} g` : '—'}</td>
            <td><span class="durum-etiket uygun">AMDR Takibi</span></td>
          </tr>
          <tr>
            <td>Yağ</td>
            <td><strong>${formatNumber(t.fat, 1)} g</strong></td>
            <td>${tg?.fat?.min ? `${formatNumber(tg.fat.min, 1)} – ${formatNumber(tg?.fat?.max, 1)} g` : '—'}</td>
            <td><span class="durum-etiket uygun">AMDR Takibi</span></td>
          </tr>
          <tr>
            <td>Doymuş Yağ</td>
            <td><strong>${formatNumber(t.saturatedFat, 1)} g</strong></td>
            <td>${tg?.saturatedFat?.limit ? `En çok ${formatNumber(tg.saturatedFat.limit, 1)} g` : '—'}</td>
            <td>${tg?.saturatedFat?.limit && t.saturatedFat > tg.saturatedFat.limit ? '<span class="durum-etiket uyari">Sınırın üzerinde</span>' : '<span class="durum-etiket uygun">Sınır altında</span>'}</td>
          </tr>
          <tr>
            <td>Toplam Şeker</td>
            <td><strong>${formatNumber(t.totalSugars, 1)} g</strong></td>
            <td>Sınır yok (meyve & süt dahil)</td>
            <td><span class="durum-etiket uygun">Bilgilendirme</span></td>
          </tr>
          <tr>
            <td>İlave / Serbest Şeker</td>
            <td><strong>${formatNumber(t.addedSugarsKnownSum, 1)} g</strong></td>
            <td>${tg?.addedSugars?.limit ? `En çok ${formatNumber(tg.addedSugars.limit, 1)} g` : '—'}</td>
            <td>${tg?.addedSugars?.limit && t.addedSugarsKnownSum > tg.addedSugars.limit ? '<span class="durum-etiket uyari">WHO sınırı aşıldı</span>' : '<span class="durum-etiket uygun">Sınır altında</span>'}</td>
          </tr>
          <tr>
            <td>Lif</td>
            <td><strong>${formatNumber(t.fiber, 1)} g</strong></td>
            <td>${tg?.fiber?.target ? `En az ${formatNumber(tg.fiber.target, 0)} g` : '—'}</td>
            <td>${tg?.fiber?.target && t.fiber < tg.fiber.target ? '<span class="durum-etiket dikkat">Hedefin altında</span>' : '<span class="durum-etiket uygun">Hedef karşılandı</span>'}</td>
          </tr>
          <tr>
            <td>Sebze & Meyve</td>
            <td><strong>${formatNumber(Number(t.vegetableServings || 0) + Number(t.fruitServings || 0), 1)} porsiyon</strong></td>
            <td>En az 5 porsiyon (DGA / WHO)</td>
            <td>${Number(t.vegetableServings || 0) + Number(t.fruitServings || 0) >= 5 ? '<span class="durum-etiket uygun">Yeterli</span>' : '<span class="durum-etiket dikkat">Artırılabilir</span>'}</td>
          </tr>
        </tbody>
      `;

      tabloKapsayici.appendChild(tablo);
      dom.gunlukRapor.appendChild(tabloKapsayici);
    } catch (err) {
      dom.gunlukRapor.textContent = 'Günlük rapor yüklenemedi: ' + err.message;
    }
  }

  async function haftalikRaporuYukle(forceRefresh = false) {
    dom.haftalikRapor.replaceChildren();
    const queryDate = state.weeklyStartDate || state.currentDate;
    try {
      const url = forceRefresh
        ? `/api/reports/weekly?start=${queryDate}&refresh=1`
        : `/api/reports/weekly?start=${queryDate}`;

      const rep = await api(url);
      state.weeklyStartDate = rep.weekStart;

      const baslikMetin = document.createElement('h3');
      baslikMetin.className = 'alt-baslik';
      baslikMetin.textContent = `Hafta: ${formatTurkishDate(rep.weekStart)} – ${formatTurkishDate(rep.weekEnd)}`;
      dom.haftalikRapor.appendChild(baslikMetin);

      const kapsamMetin = document.createElement('p');
      kapsamMetin.className = 'not';
      kapsamMetin.textContent = `Bu hafta içinde 7 günün ${rep.dataCoverageDays} gününde veri kaydı bulunmaktadır. ${rep.coverageSufficient ? 'Ortalamalar istatistiksel analiz için yeterlidir.' : '⚠️ 4 günden az veri girildiği için haftalık ortalamalar kesin sonuç ifade etmez.'}`;
      dom.haftalikRapor.appendChild(kapsamMetin);

      if (!rep.hasData) {
        const bos = document.createElement('p');
        bos.className = 'not';
        bos.textContent = 'Bu hafta için henüz hiçbir kayıt bulunmamaktadır.';
        dom.haftalikRapor.appendChild(bos);
        return;
      }

      // Ortalamalar Tablosu
      const avg = rep.averages;
      const tabloKapsayici = document.createElement('div');
      tabloKapsayici.className = 'tablo-kapsayici';
      const tablo = document.createElement('table');
      tablo.className = 'rapor-tablo';

      tablo.innerHTML = `
        <thead>
          <tr>
            <th>Öge</th>
            <th>Günlük Ortalama (Kayıtlı Günler)</th>
            <th>Değişkenlik / Sıklık</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Kalori</td>
            <td><strong>${formatNumber(avg.average_calories, 0)} kcal</strong></td>
            <td>Aralık: ${formatNumber(avg.min_daily_calories, 0)} – ${formatNumber(avg.max_daily_calories, 0)} kcal</td>
          </tr>
          <tr>
            <td>Protein</td>
            <td><strong>${formatNumber(avg.average_protein, 1)} g</strong></td>
            <td>Günlük ortalama tüketim</td>
          </tr>
          <tr>
            <td>Karbonhidrat</td>
            <td><strong>${formatNumber(avg.average_carbohydrates, 1)} g</strong></td>
            <td>Günlük ortalama tüketim</td>
          </tr>
          <tr>
            <td>Yağ</td>
            <td><strong>${formatNumber(avg.average_fat, 1)} g</strong></td>
            <td>Doymuş yağ ort.: ${formatNumber(avg.average_saturated_fat, 1)} g</td>
          </tr>
          <tr>
            <td>Toplam Şeker</td>
            <td><strong>${formatNumber(avg.average_total_sugars, 1)} g</strong></td>
            <td>İlave şeker ort.: ${avg.added_sugars_incomplete ? 'Eksik veri var' : `${formatNumber(avg.average_added_sugars, 1)} g`}</td>
          </tr>
          <tr>
            <td>Lif</td>
            <td><strong>${formatNumber(avg.average_fiber, 1)} g</strong></td>
            <td>Yeterli alım: 25 g</td>
          </tr>
          <tr>
            <td>Sebze Tüketimi</td>
            <td><strong>${formatNumber(avg.vegetable_servings_avg, 1)} porsiyon/gün</strong></td>
            <td>${avg.days_with_vegetables} gün sebze tüketildi</td>
          </tr>
          <tr>
            <td>Meyve Tüketimi</td>
            <td><strong>${formatNumber(avg.fruit_servings_avg, 1)} porsiyon/gün</strong></td>
            <td>${avg.days_with_fruit} gün meyve tüketildi</td>
          </tr>
          <tr>
            <td>Baklagil Tüketimi</td>
            <td><strong>${formatNumber(avg.legume_servings_avg, 1)} porsiyon/gün</strong></td>
            <td>${avg.days_with_legumes} gün baklagil tüketildi</td>
          </tr>
        </tbody>
      `;
      tabloKapsayici.appendChild(tablo);
      dom.haftalikRapor.appendChild(tabloKapsayici);

      // Öneriler
      if (rep.recommendations && rep.recommendations.length > 0) {
        const oneriKutu = document.createElement('div');
        oneriKutu.className = 'oneri-kutu';
        const oneriBaslik = document.createElement('h4');
        oneriBaslik.textContent = 'Gelecek Hafta İçin Uygulanabilir Öneriler';
        oneriKutu.appendChild(oneriBaslik);

        const ulist = document.createElement('ul');
        ulist.className = 'madde-liste';
        for (const rec of rep.recommendations) {
          const li = document.createElement('li');
          li.textContent = rec.action || rec.message || rec;
          ulist.appendChild(li);
        }
        oneriKutu.appendChild(ulist);
        dom.haftalikRapor.appendChild(oneriKutu);
      }

      // Çekinceler & Bilimsel Uyarılar
      if (rep.cautions && rep.cautions.length > 0) {
        const cekinceKutu = document.createElement('div');
        cekinceKutu.className = 'cekince-kutu';
        const cBaslik = document.createElement('h4');
        cBaslik.textContent = 'Bilimsel Değerlendirme Çekinceleri';
        cekinceKutu.appendChild(cBaslik);

        const clist = document.createElement('ul');
        clist.className = 'madde-liste';
        for (const c of rep.cautions) {
          const li = document.createElement('li');
          li.textContent = c.message || c;
          clist.appendChild(li);
        }
        cekinceKutu.appendChild(clist);
        dom.haftalikRapor.appendChild(cekinceKutu);
      }
    } catch (err) {
      dom.haftalikRapor.textContent = 'Haftalık rapor yüklenemedi: ' + err.message;
    }
  }

  /* ==========================================================================
     Profil & Hedefler Paneli (Bölüm 8)
     ========================================================================== */
  async function profiliYukle() {
    hataGoster(dom.profilHata, '');
    try {
      const data = await api('/api/profile');
      const u = data.user;
      if (u) {
        dom.profilAd.value = u.name || '';
        dom.profilYas.value = u.age || '';
        dom.profilCinsiyet.value = u.biologicalSex || '';
        dom.profilBoy.value = u.heightCm || '';
        dom.profilKilo.value = u.weightKg || '';
        dom.profilAktivite.value = u.activityLevel || '';
        dom.profilHedef.value = u.goal || '';
        dom.profilKisit.value = u.dietaryRestrictions || '';
      }

      renderHedefBilimleri(data.targets);
    } catch (err) {
      hataGoster(dom.profilHata, err.message);
    }
  }

  function renderHedefBilimleri(targets) {
    dom.hedefOzet.replaceChildren();
    if (!targets) {
      dom.hedefOzet.textContent = 'Hedef bilgileri yüklenemedi.';
      return;
    }

    const kapsayici = document.createElement('div');
    kapsayici.className = 'madde-liste';

    // Formül açıklamaları
    const bmrLi = document.createElement('li');
    bmrLi.innerHTML = `<strong>BMR (Bazal Metabolizma Hızı):</strong> ${targets.bmrKcal ? `${formatNumber(targets.bmrKcal, 0)} kcal` : 'Hesaplanamadı (cinsiyet veya kilo/boy/yaş eksik)'}. <em>(Mifflin–St Jeor 1990)</em>`;
    kapsayici.appendChild(bmrLi);

    const tdeeLi = document.createElement('li');
    tdeeLi.innerHTML = `<strong>TDEE (Toplam Günlük Enerji Harcaması):</strong> ${targets.tdeeKcal ? `${formatNumber(targets.tdeeKcal, 0)} kcal` : 'Hesaplanamadı'}. <em>(Aktivite çarpanı: ${targets.activityFactor || '—'}, FAO/WHO/UNU 2004)</em>`;
    kapsayici.appendChild(tdeeLi);

    const hedefLi = document.createElement('li');
    hedefLi.innerHTML = `<strong>Hedef Durumu:</strong> ${targets.goalLabel || 'Belirtilmedi'} ${targets.calories?.min ? `(${formatNumber(targets.calories.min, 0)} – ${formatNumber(targets.calories.max, 0)} kcal)` : ''}`;
    kapsayici.appendChild(hedefLi);

    dom.hedefOzet.appendChild(kapsayici);

    // Bilimsel Referans Kaynakları
    if (targets.expandedSources && targets.expandedSources.length > 0) {
      const kaynakBaslik = document.createElement('h3');
      kaynakBaslik.className = 'alt-baslik';
      kaynakBaslik.style.marginTop = '1.25rem';
      kaynakBaslik.textContent = 'Dayanak Gösterilen Bilimsel Kılavuzlar';
      dom.hedefOzet.appendChild(kaynakBaslik);

      for (const s of targets.expandedSources) {
        const kKart = document.createElement('div');
        kKart.className = 'kaynak-kart';

        const kAd = document.createElement('div');
        kAd.className = 'kaynak-ad';
        kAd.textContent = `${s.organisation || s.id} (${s.year || 'Kılavuz'})`;

        const kBaslik = document.createElement('div');
        kBaslik.textContent = s.title || s.citation || '';

        kKart.appendChild(kAd);
        if (s.title) kKart.appendChild(kBaslik);

        if (s.url) {
          const a = document.createElement('a');
          a.className = 'kaynak-link';
          a.href = s.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = 'Resmi Kaynağı Görüntüle →';
          kKart.appendChild(a);
        }

        dom.hedefOzet.appendChild(kKart);
      }
    }
  }

  async function profilKaydet(e) {
    e.preventDefault();
    hataGoster(dom.profilHata, '');

    const body = {
      name: dom.profilAd.value.trim() || null,
      age: dom.profilYas.value ? parseInt(dom.profilYas.value, 10) : null,
      biologicalSex: dom.profilCinsiyet.value || null,
      heightCm: dom.profilBoy.value ? parseFloat(dom.profilBoy.value) : null,
      weightKg: dom.profilKilo.value ? parseFloat(dom.profilKilo.value) : null,
      activityLevel: dom.profilAktivite.value || null,
      goal: dom.profilHedef.value || null,
      dietaryRestrictions: dom.profilKisit.value.trim() || null,
    };

    try {
      const data = await api('/api/profile', {
        method: 'PUT',
        body,
      });
      state.user = data.user;
      bildirimGoster('Profil güncellendi ve hedefler yeniden hesaplandı.', 'basari');
      renderHedefBilimleri(data.targets);
    } catch (err) {
      hataGoster(dom.profilHata, err.message);
    }
  }

  async function parolaGuncelle(e) {
    e.preventDefault();
    hataGoster(dom.parolaHata, '');

    const currentPassword = dom.parolaEski.value;
    const newPassword = dom.parolaYeni.value;

    if (!currentPassword || !newPassword) {
      hataGoster(dom.parolaHata, 'Lütfen tüm alanları doldurun.');
      return;
    }

    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      bildirimGoster('Parola güncellendi. Lütfen yeniden giriş yapın.', 'bilgi');
      state.user = null;
      ekraniGuncelle();
    } catch (err) {
      hataGoster(dom.parolaHata, err.message);
    }
  }

  /* ==========================================================================
     Olay Dinleyicileri (Event Listeners)
     ========================================================================== */
  function olaylariBagla() {
    // Giriş / Kayıt Sekmesi
    dom.dugmeGirisSekme.addEventListener('click', () => {
      dom.dugmeGirisSekme.classList.add('is-aktif');
      dom.dugmeKayitSekme.classList.remove('is-aktif');
      dom.formGiris.hidden = false;
      dom.formKayit.hidden = true;
    });

    dom.dugmeKayitSekme.addEventListener('click', () => {
      dom.dugmeKayitSekme.classList.add('is-aktif');
      dom.dugmeGirisSekme.classList.remove('is-aktif');
      dom.formKayit.hidden = false;
      dom.formGiris.hidden = true;
    });

    // Giriş Formu
    dom.formGiris.addEventListener('submit', (e) => {
      e.preventDefault();
      girisYap(dom.girisEposta.value.trim(), dom.girisParola.value);
    });

    // Kayıt Formu
    dom.formKayit.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = {
        name: dom.kayitAd.value.trim(),
        email: dom.kayitEposta.value.trim(),
        password: dom.kayitParola.value,
        age: dom.kayitYas.value ? parseInt(dom.kayitYas.value, 10) : null,
        biologicalSex: dom.kayitCinsiyet.value || null,
        heightCm: dom.kayitBoy.value ? parseFloat(dom.kayitBoy.value) : null,
        weightKg: dom.kayitKilo.value ? parseFloat(dom.kayitKilo.value) : null,
        activityLevel: dom.kayitAktivite.value || null,
        goal: dom.kayitHedef.value || null,
      };
      kayitOl(formData);
    });

    // Tarih Gezinimi
    dom.gunGeri.addEventListener('click', () => {
      state.currentDate = addDays(state.currentDate, -1);
      verileriYukle();
    });

    dom.gunIleri.addEventListener('click', () => {
      state.currentDate = addDays(state.currentDate, 1);
      verileriYukle();
    });

    dom.gunBugun.addEventListener('click', () => {
      state.currentDate = getTodayIso();
      verileriYukle();
    });

    dom.tarihSecici.addEventListener('change', (e) => {
      if (e.target.value) {
        state.currentDate = e.target.value;
        verileriYukle();
      }
    });

    // Sekmeler
    dom.sekmeler.addEventListener('click', (e) => {
      const btn = e.target.closest('.sekme');
      if (btn && btn.dataset.panel) {
        sekmeGuncelle(btn.dataset.panel);
      }
    });

    // Besin Arama
    dom.besinAraBtn.addEventListener('click', besinAra);
    dom.besinArama.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        besinAra();
      }
    });
    dom.besinKategori.addEventListener('change', besinAra);

    // Besin Ekleme Formu
    dom.ekleGram.addEventListener('input', canliOnizlemeGuncelle);
    dom.ekleVazgec.addEventListener('click', () => {
      dom.formBesinEkle.hidden = true;
      state.selectedFood = null;
    });
    dom.formBesinEkle.addEventListener('submit', seciliBesiniOgunaEkle);

    // Rapor Butonları
    dom.gunlukYenile.addEventListener('click', gunlukRaporuYukle);
    dom.haftaGeri.addEventListener('click', () => {
      if (state.weeklyStartDate) {
        state.weeklyStartDate = addDays(state.weeklyStartDate, -7);
        haftalikRaporuYukle();
      }
    });
    dom.haftaIleri.addEventListener('click', () => {
      if (state.weeklyStartDate) {
        state.weeklyStartDate = addDays(state.weeklyStartDate, 7);
        haftalikRaporuYukle();
      }
    });
    dom.haftalikTazele.addEventListener('click', () => haftalikRaporuYukle(true));

    // Profil Formları
    dom.formProfil.addEventListener('submit', profilKaydet);
    dom.formParola.addEventListener('submit', parolaGuncelle);
  }

  /* ==========================================================================
     Başlatıcı (Initialize)
     ========================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    olaylariBagla();
    oturumKontrol();
  });
})();
