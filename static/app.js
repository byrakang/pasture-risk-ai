'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const NS = 'http://www.w3.org/2000/svg';

const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LEVELS = {
  low: { mn: 'Бага', en: 'Low', color: '#2E9B6E', cls: 'low' },
  mid: { mn: 'Дунд', en: 'Medium', color: '#D49A1C', cls: 'mid' },
  high: { mn: 'Өндөр', en: 'High', color: '#C8372B', cls: 'high' },
};
const RISK_STOPS = [
  [0, [46, 155, 110]],
  [35, [168, 179, 58]],
  [50, [212, 154, 28]],
  [65, [216, 98, 44]],
  [100, [163, 33, 26]],
];
const TINY_AIMAGS = {
  'Орхон': { dx: 22, dy: -10 },
  'Дархан-Уул': { dx: 18, dy: 20 },
  'Говьсүмбэр': { dx: 20, dy: -10 },
  'Улаанбаатар': { dx: 22, dy: 12 },
};
const LABEL_SHIFT = {
  'Төв': { dx: -6, dy: 26 },
  'Сэлэнгэ': { dx: 33, dy: 0 },
};
const METRICS = [
  ['Total_Livestock', ['Нийт мал', 'Total livestock'], (v) => `${fmt0.format(v)} ${L('толгой', 'head')}`],
  ['NDVI', ['NDVI', 'NDVI'], (v) => fmt2.format(v)],
  ['Precipitation_mm', ['Хур тунадас', 'Precipitation'], (v) => `${fmt0.format(v)} ${L('мм', 'mm')}`],
  ['Temperature_C', ['Температур', 'Temperature'], (v) => `${fmt1.format(v)} °C`],
  ['Stocking_Rate', ['Ачаалал', 'Stocking'], (v) => fmt2.format(v)],
];

const state = {
  lang: 'mn',
  meta: null,
  data: null,
  years: [],
  latestYear: null,
  aimags: [],
  byAimag: new Map(),
  nationalByYear: {},
  year: null,
  selected: null,
  preset: null,
  lastPredict: null,
  view: { k: 1, x: 0, y: 0 },
  mapReady: false,
  anim: true,
};

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Нэг удаах «сканердэж байна» гэрэлтүүлэг тухайн хэсэг дээр. */
function scanFx(el, dur = 1100) {
  if (!el || reduceMotion()) return;
  el.style.position = getComputedStyle(el).position === 'static' ? 'relative' : el.style.position;
  el.classList.add('sweeping');
  el.style.setProperty('--scan-dur', `${dur}ms`);
  const fx = document.createElement('span');
  fx.className = 'scanfx';
  fx.innerHTML = '<i></i>';
  el.appendChild(fx);
  setTimeout(() => {
    fx.remove();
    el.classList.remove('sweeping');
  }, dur + 60);
}

function positionHoloCard() {
  const card = $('#holoCard');
  if (!card || card.hidden || !state.selected) return;
  const a = (window.MN_MAP?.aimags || []).find((x) => x.name === state.selected);
  const svg = $('#mapSvg');
  const box = $('#mapBox');
  if (!a || !svg || !box) return;
  const r = svg.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const { k, x, y } = state.view;
  const sx = (a.cx - MN_MAP.w / 2) * k + MN_MAP.w / 2 + x;
  const sy = (a.cy - MN_MAP.h / 2) * k + MN_MAP.h / 2 + y;
  const px = (sx / MN_MAP.w) * r.width + (r.left - br.left);
  const py = (sy / MN_MAP.h) * r.height + (r.top - br.top);
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const pad = 10;
  const left = clamp(px - cw / 2, pad, Math.max(pad, br.width - cw - pad));
  const above = py - ch - 22 > pad;
  const top = above ? py - ch - 20 : Math.min(py + 20, Math.max(pad, br.height - ch - pad));
  card.classList.toggle('below', !above);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.setProperty('--caret-x', `${clamp(px - left, 18, cw - 18)}px`);
}


const L = (mn, en) => (state.lang === 'en' ? en : mn);
const aimagName = (name) => (state.lang === 'en' ? (window.I18N?.aimag(name) ?? name) : name);
const predictLabel = () => L('Эрсдэл тооцох', 'Calculate risk');
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/* ---------------------------------------------------------------- туслах */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function levelKey(v) {
  const t = state.meta?.thresholds ?? { low_max: 35, medium_max: 65 };
  if (v < t.low_max) return 'low';
  if (v < t.medium_max) return 'mid';
  return 'high';
}
function levelMeta(v) { return LEVELS[levelKey(v)]; }
function levelBadge(v) {
  const l = levelMeta(v);
  return `<span class="lvl ${l.cls}">${l[state.lang]}</span>`;
}

function riskColor(v) {
  const x = clamp(v, 0, 100);
  for (let i = 1; i < RISK_STOPS.length; i += 1) {
    const [p0, c0] = RISK_STOPS[i - 1];
    const [p1, c1] = RISK_STOPS[i];
    if (x <= p1) {
      const t = (x - p0) / (p1 - p0);
      const c = c0.map((ch, j) => Math.round(ch + (c1[j] - ch) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(163,33,26)';
}

async function api(path, options) {
  const sep = path.includes('?') ? '&' : '?';
  const url = state.lang === 'en' ? `${path}${sep}lang=en` : path;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
    ...options,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error || (Array.isArray(body?.errors) ? body.errors.join('; ') : '') || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function rowOf(aimag, year) {
  return state.byAimag.get(aimag)?.get(year) ?? null;
}
function valueOf(row) {
  return row.score;
}
function rowsForYear(year) {
  return state.aimags.map((name) => rowOf(name, year)).filter(Boolean);
}
function meanOfYear(year) {
  const rows = rowsForYear(year);
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + valueOf(r), 0) / rows.length;
}

/** Мэдээллийн цэв дээрх товчууд + хөдөлгөөнт байрлал. */
function initHoloCard() {
  const close = $('#holoClose');
  const go = $('#holoGo');
  close?.addEventListener('click', () => {
    state.selected = null;
    renderAll();
    syncUrl();
  });
  go?.addEventListener('click', () => {
    $('#sidePanel').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    scanFx($('#sidePanel'), 700);
  });
  window.addEventListener('resize', () => positionHoloCard(), { passive: true });
}

/* ---------------------------------------------------------------- гэрэлтүүлгийн горим */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.title = theme === 'dark'
      ? L('Гэрэлтүүлэг горим руу шилжих', 'Switch to light mode')
      : L('Хараат горим руу шилжих', 'Switch to dark mode');
  }
}

function initTheme() {
  const btn = $('#themeBtn');
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('belcheer-theme', next); } catch { /* private mode */ }
    applyTheme(next);
    scanFx($('.top'), 700);
  });
}

/* ---------------------------------------------------------------- кинематик дэвсгэр + гарц */
function buildBgfx() {
  if (!window.MN_MAP || $('.bgfx')) return;
  const layer = document.createElement('div');
  layer.className = 'bgfx';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `
    <svg class="bgmap" viewBox="0 0 ${MN_MAP.w} ${MN_MAP.h}" preserveAspectRatio="xMidYMid meet">
      <g>${MN_MAP.aimags.map((a) => `<path class="bgreg" d="${a.d}"></path>`).join('')}</g>
    </svg>
    <div class="bgbeam"></div>
    <div class="bgvig"></div>`;
  document.body.prepend(layer);
}

const HERO = {
  far: 'M0,206 C118,168 214,196 318,166 C430,134 520,182 622,156 C730,128 822,176 932,150 C1042,124 1132,166 1200,144 L1200,340 L0,340 Z',
  near: 'M0,266 C142,232 240,262 358,234 C470,208 566,254 690,230 C802,208 902,250 1012,226 C1112,204 1170,236 1200,222 L1200,340 L0,340 Z',
  grass: 'M0,308 C160,296 300,312 470,300 C640,288 780,308 940,296 C1080,286 1150,300 1200,294 L1200,340 L0,340 Z',
};

function heroScene(variant) {
  const sun = { x: 972, y: 78, r: 40 };
  const icons = [
    `<g class="hero-near"><path class="hicon" d="M1044,262 q26,-26 52,0 l-6,0 l0,20 l-40,0 l0,-20 Z"/><path class="hicon" d="M1064,282 l0,-12 l12,0 l0,12"/><circle class="hicon" cx="1112" cy="276" r="6"/><circle class="hicon" cx="1130" cy="278" r="5"/></g>`,
    `<g class="hero-near"><path class="hicon" d="M1010,250 a34,34 0 0 1 68,0"/><path class="hicon" d="M1044,216 l0,-24 M1044,192 l16,8"/><path class="hicon" d="M980,268 l128,0"/></g>`,
    `<g class="hero-near"><path class="hicon" d="M1006,272 q10,-20 22,0 q12,-22 24,0 q12,-20 24,0"/><path class="hicon" d="M1000,286 l136,0"/></g>`,
    `<g class="hero-near"><path class="hicon" d="M1012,268 a32,32 0 1 1 64,0"/><path class="hicon" d="M1044,268 l20,-26 M1044,268 l-22,-16"/></g>`,
  ];
  return `
    <span class="tint"></span>
    <svg class="hero-sky" viewBox="0 0 1200 340" preserveAspectRatio="none">
      <circle class="hsun" cx="${sun.x}" cy="${sun.y + (variant % 2) * 26}" r="${sun.r}"></circle>
      <circle class="hring" cx="${sun.x}" cy="${sun.y + (variant % 2) * 26}" r="${sun.r + 26}"></circle>
      <circle class="hring" cx="${sun.x}" cy="${sun.y + (variant % 2) * 26}" r="${sun.r + 54}" style="animation-delay:1.4s"></circle>
    </svg>
    <svg class="hero-far" viewBox="0 0 1200 340" preserveAspectRatio="none">
      <path class="hridge" d="${HERO.far}"></path>
    </svg>
    <svg class="hero-near" viewBox="0 0 1200 340" preserveAspectRatio="none">
      <path class="hridge2" d="${HERO.near}"></path>
      <path class="hfar" d="${HERO.grass}"></path>
      ${icons[variant % icons.length]}
    </svg>`;
}

function buildHeroes() {
  $$('.pagehead').forEach((head) => {
    const fx = $('.herofx', head);
    if (fx && !head.closest('#page-predict')) fx.remove();
  });
  const head = $('#page-predict .pagehead');
  if (!head || $('.herofx', head)) return;
  const fx = document.createElement('div');
  fx.className = 'herofx';
  fx.setAttribute('aria-hidden', 'true');
  fx.innerHTML = heroScene(0);
  head.prepend(fx);
  if (reduceMotion()) return;
  head.addEventListener('pointermove', (e) => {
    const r = head.getBoundingClientRect();
    fx.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    fx.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  });
  head.addEventListener('pointerleave', () => {
    fx.style.setProperty('--px', 0);
    fx.style.setProperty('--py', 0);
  });
}

function buildBoot() {
  const g = $('#bootShapes');
  if (!g || !window.MN_MAP) return;
  g.innerHTML = MN_MAP.aimags
    .map((a, i) => `<path d="${a.d}" style="--i:${i}"></path>`)
    .join('');
}

const BOOT_START = performance.now();

function bootDone() {
  const boot = $('#boot');
  if (!boot || boot.classList.contains('done')) return;
  const hold = Math.max(260, 1150 - (performance.now() - BOOT_START));
  setTimeout(() => boot.classList.add('done'), hold);
}

function initReveal() {
  const items = $$('.fact,.helpitem,.flowsteps li,.modelbox div');
  if (!('IntersectionObserver' in window) || reduceMotion()) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((el, i) => {
    if (el.classList.contains('reveal')) return;
    el.classList.add('reveal');
    el.style.transitionDelay = `${Math.min(240, (i % 6) * 45)}ms`;
    io.observe(el);
  });
}

/* ---------------------------------------------------------------- эх сурвалж (хуудас бүрийн төгсгөлд) */
const A = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const CSV = '<a href="/api/dataset.csv" download>CSV</a>';

const SRC = {
  'src-predict': [
    {
      mn: `<b>Оролт үзүүлэлт:</b> 2010–2025 оны 21 аймгийн жилийн дүн — ${A('https://modis.gsfc.nasa.gov/', 'MODIS NDVI (NASA)')}, ${A('https://era.ecmwf.int/', 'ERA5 (ECMWF)')}, ${A('https://www.chc.ucsb.edu/data/chirps', 'CHIRPS (UCSB)')}, ${A('https://1212.mn/', '1212.mn мал тоололто')}, ${A('https://www.ine.gm/', 'ҮСХ')}.`,
      en: `<b>Input indicators:</b> yearly values for 21 aimags, 2010–2025 — ${A('https://modis.gsfc.nasa.gov/', 'MODIS NDVI (NASA)')}, ${A('https://era.ecmwf.int/', 'ERA5 (ECMWF)')}, ${A('https://www.chc.ucsb.edu/data/chirps', 'CHIRPS (UCSB)')}, ${A('https://1212.mn/', '1212.mn livestock census')}, ${A('https://www.ine.gm/', 'Mongolian NSO')}.`,
    },
    {
      mn: `<b>Тооцоолол:</b> ${A('https://scikit-learn.org/stable/modules/neighbors.html', 'scikit-learn KNeighborsRegressor')} · k=5 · зайгаар жинлэсэн · 336 ажиглалтын 80%-д сургав, 20%-д шалгав.`,
      en: `<b>Calculation:</b> ${A('https://scikit-learn.org/stable/modules/neighbors.html', 'scikit-learn KNeighborsRegressor')} · k=5 · distance-weighted · trained on 80% and tested on 20% of 336 observations.`,
    },
    {
      mn: `<b>Загварын үнэлгээ:</b> MAE 5.7 оноо · эрсдэлийн түвшний тааруулалт 88% · «Баримтууд» хуудасны «Манай загвар» үзүүлэлтүүд энэ тооцоогоос гарсан.`,
      en: `<b>Model evaluation:</b> MAE 5.7 pts · risk-class accuracy 88% · the «Our model» figures on the Facts page come from this calculation.`,
    },
  ],
  'src-map': [
    {
      mn: `<b>Газрын зургийн геометр:</b> ${A('https://geoboundaries.org/', 'geoBoundaries — Монгол улс ADM1')} (OpenStreetMap дээрх оролцоо, ${A('https://www.openstreetmap.org/copyright', 'ODbL')} лиценстэй) 21 аймгийн хил; Улаанбаатарт бэлчээрийн үзүүлэлт байхгүй.`,
      en: `<b>Map geometry:</b> ${A('https://geoboundaries.org/', 'geoBoundaries — Mongolia ADM1')} (built from OpenStreetMap contributions, ${A('https://www.openstreetmap.org/copyright', 'ODbL')} licensed); Ulaanbaatar has no pasture indicators.`,
    },
    {
      mn: `<b>Оноо бүрийн үзүүлэлт:</b> MODIS NDVI, ERA5 температур, CHIRPS хур тунадас, ${A('https://1212.mn/', '1212.mn')} мал тоололто; ачаалал = мал / бэлчээрийн даац.`,
      en: `<b>Indicators behind each score:</b> MODIS NDVI, ERA5 temperature, CHIRPS precipitation, ${A('https://1212.mn/', '1212.mn')} census; stocking rate = livestock / carrying capacity.`,
    },
    {
      mn: `<b>Бодолто:</b> Зураг дээрх оноо нь тухайн аймаг-жилийг сургалтаас гаргаж (leave-one-out) тооцсон тул маягтын тооцоололтой бага зэрэг ялгаатай байж болно. Бүх мөр: ${CSV} татах.`,
      en: `<b>Method:</b> map scores use leave-one-out estimation, so they can differ slightly from the form calculation. All rows: ${CSV} download.`,
    },
  ],
  'facts-sources': [
    {
      mn: `<b>Дэлхий:</b> ${A('https://www.fao.org/pasture-land/en/', 'FAO')} — Global assessment of soil carbon in grasslands (2023), The State of the World's Land and Water Resources, International Year of Rangelands and Pastoralists (2026); ${A('https://www.unccd.int/resources/global-land-outlook/2', 'UNCCD')} — Global Land Outlook (2022); НҮБ-ын Экосистемийн нөхөн сэргээлтийн арван жил (2030 зорилт); ${A('https://www.ipcc.ch/sr15/', 'IPCC')} 1.5°C тусгай тайлан; ELD Initiative — газар доройтын эдийн засгийн үнэлгээ.`,
      en: `<b>World:</b> ${A('https://www.fao.org/pasture-land/en/', 'FAO')} — Global assessment of soil carbon in grasslands (2023), The State of the World's Land and Water Resources, International Year of Rangelands and Pastoralists (2026); ${A('https://www.unccd.int/resources/global-land-outlook/2', 'UNCCD')} — Global Land Outlook (2022); UN Decade on Ecosystem Restoration (2030 target); ${A('https://www.ipcc.ch/sr15/', 'IPCC')} 1.5°C special report; ELD Initiative — economic valuation of land degradation.`,
    },
    {
      mn: `<b>Монгол:</b> ${A('https://www.ine.gm/', 'Үндэсний статистикийн хороо')} — 2025 оны мал, малчин өрхийн тооллого; Байгаль орчин, уур амьсгалын өөрчлөлтийн яам — Монгол орны цөлжилтийн атлас (2026), бэлчээрийн хэт ачааллын үнэлгээ.`,
      en: `<b>Mongolia:</b> ${A('https://www.ine.gm/', 'National Statistics Office')} — 2025 livestock and herder household census; Ministry of Environment and Climate Change — Desertification Atlas of Mongolia (2026), pasture overstocking assessment.`,
    },
    {
      mn: `<b>«Манай загвар»:</b> MODIS NDVI, ERA5, CHIRPS, 1212.mn өгөгдлөөр тооцсон KNN загварын үр дүн (MAE 5.7 оноо, түвшний тааруулалт 88%).`,
      en: `<b>«Our model»:</b> KNN results computed from MODIS NDVI, ERA5, CHIRPS and 1212.mn data (MAE 5.7 pts, class accuracy 88%).`,
    },
  ],
  'src-help': [
    {
      mn: `<b>Алгоритм:</b> ${A('https://scikit-learn.org/stable/modules/neighbors.html', 'scikit-learn — Nearest Neighbors')} (KNeighborsRegressor, weights=distance), ${A('https://scikit-learn.org/stable/modules/preprocessing.html', 'StandardScaler')} хэмжээс шилжүүлэг.`,
      en: `<b>Algorithm:</b> ${A('https://scikit-learn.org/stable/modules/neighbors.html', 'scikit-learn — Nearest Neighbors')} (KNeighborsRegressor, weights=distance) with ${A('https://scikit-learn.org/stable/modules/preprocessing.html', 'StandardScaler')} feature scaling.`,
    },
    {
      mn: `<b>Өгөгдлийн санд:</b> 336 аймаг-жил (21 аймаг × 2010–2025), 5 шинж чанар; MODIS NDVI, ERA5, CHIRPS, 1212.mn, ҮСХ. Түүхий файл: ${CSV} татах.`,
      en: `<b>Dataset:</b> 336 aimag-years (21 aimags × 2010–2025), 5 features; MODIS NDVI, ERA5, CHIRPS, 1212.mn, NSO. Raw file: ${CSV} download.`,
    },
    {
      mn: `<b>Газрын зураг:</b> ${A('https://geoboundaries.org/', 'geoBoundaries')} ADM1 хил (ODbL). Улаанбаатарт бэлчээрийн жилийн үзүүлэлт байхгүй тул зөвхөн 21 аймгийг харуулна.`,
      en: `<b>Map:</b> ${A('https://geoboundaries.org/', 'geoBoundaries')} ADM1 borders (ODbL). Only 21 aimags are shown because Ulaanbaatar has no yearly pasture indicators.`,
    },
    {
      mn: `<b>Хязгаарлалт:</b> KNN нь шалтгаан биш, түүхэн ижил төстэй байдлыг хэмждэг; оноог 0–100 хүрээний тайлбар болгон ашиглах хэрэгтэй.`,
      en: `<b>Limits:</b> KNN measures historical similarity, not causation; read the score as a 0–100 indicator, not a guarantee.`,
    },
  ],
};

function renderSources() {
  Object.entries(SRC).forEach(([id, items]) => {
    const ul = $(`#${id} .srclist`);
    if (!ul) return;
    ul.innerHTML = items
      .map((it, i) => `<li style="--i:${i}">${state.lang === 'en' ? it.en : it.mn}</li>`)
      .join('');
  });
}

/* ---------------------------------------------------------------- цэс */
const PAGES = ['predict', 'map', 'facts', 'help'];

function syncUrl() {
  if (!state.data) return;
  const page = document.body.dataset.page || 'predict';
  const p = new URLSearchParams();
  if (page !== 'predict') p.set('page', page);
  if (state.lang === 'en') p.set('lang', 'en');
  if (state.year && state.year !== state.latestYear) p.set('year', state.year);
  if (page === 'map' && state.selected) p.set('aimag', state.selected);
  const q = p.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
}

function goTo(page, scroll = true) {
  $$('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
  $$('nav button').forEach((b) => {
    if (b.dataset.page === page) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.dataset.page = page;
  if (page === 'map') {
    scanFx($('#mapBox'), 950);
    renderHolo();
  }
  const active = $('nav button[aria-current="page"]');
  if (active && window.matchMedia('(max-width: 700px)').matches) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  syncUrl();
}

function initNav() {
  $$('[data-page]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.id === 'modelChip') return; // chip has its own behavior below
      goTo(el.dataset.page);
    });
  });
  $('#modelChip').addEventListener('click', () => {
    goTo('help');
    setTimeout(() => $('#modelBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  });

  $$('.langswitch button').forEach((b) => {
    b.addEventListener('click', () => setLanguage(b.dataset.lang));
  });

  const nav = $('.top nav');
  const cue = () => {
    nav.classList.toggle('can-left', nav.scrollLeft > 2);
    nav.classList.toggle('can-right', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
  };
  nav.addEventListener('scroll', cue, { passive: true });
  window.addEventListener('resize', cue);
  cue();
}

function initToTop() {
  const btn = $('#toTop');
  const toggle = () => { btn.hidden = window.scrollY < 700; };
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
}

/* ---------------------------------------------------------------- маягт */
function initForm() {
  const form = $('#predictForm');
  const pairs = [
    ['Total_Livestock', 'Total_Livestock_range'],
    ['NDVI', 'NDVI_range'],
    ['Temperature_C', 'Temperature_C_range'],
    ['Precipitation_mm', 'Precipitation_mm_range'],
    ['Stocking_Rate', 'Stocking_Rate_range'],
  ];
  pairs.forEach(([numId, rangeId]) => {
    const num = $(`#${numId}`);
    const range = $(`#${rangeId}`);
    range.addEventListener('input', () => {
      num.value = range.value;
      num.closest('.inwrap')?.classList.remove('invalid');
    });
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (num.value !== '' && Number.isFinite(v)) {
        range.value = clamp(v, Number(range.min), Number(range.max));
      }
      num.closest('.inwrap')?.classList.remove('invalid');
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runPrediction();
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      state.preset = null;
      state.lastPredict = null;
      $('#presetAimag').value = '';
      $('#presetYear').value = '';
      $('#presetYear').disabled = true;
      $('#presetHint').innerHTML = L('Аймаг, жил сонговол тухайн жилийн бодит үзүүлэлтүүд талбарт орно.', "Choose an aimag and year to load that year's actual indicators into the form.");
      $('#toMapBtn').hidden = true;
      pairs.forEach(([numId, rangeId]) => {
        $(`#${rangeId}`).value = $(`#${numId}`).value;
      });
    }, 0);
  });

  $('#presetAimag').addEventListener('change', (e) => {
    const name = e.target.value;
    const yearSel = $('#presetYear');
    if (!name) {
      yearSel.disabled = true;
      yearSel.value = '';
      state.preset = null;
      return;
    }
    yearSel.disabled = false;
    if (!yearSel.value) yearSel.value = String(state.latestYear);
    applyPreset(name, Number(yearSel.value));
  });

  $('#presetYear').addEventListener('change', (e) => {
    const name = $('#presetAimag').value;
    if (name && e.target.value) applyPreset(name, Number(e.target.value));
  });

  $('#editBtn').addEventListener('click', () => {
    $('#predictForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#Total_Livestock').focus({ preventScroll: true });
  });

  $('#toMapBtn').addEventListener('click', () => {
    if (state.preset) {
      state.year = state.preset.year;
      $('#mapYear').value = String(state.year);
      selectAimag(state.preset.aimag, false);
    }
    goTo('map');
    renderAll();
  });
}

function setFieldValues(values) {
  [
    ['Total_Livestock', 'Total_Livestock_range'],
    ['NDVI', 'NDVI_range'],
    ['Temperature_C', 'Temperature_C_range'],
    ['Precipitation_mm', 'Precipitation_mm_range'],
    ['Stocking_Rate', 'Stocking_Rate_range'],
  ].forEach(([numId, rangeId]) => {
    const num = $(`#${numId}`);
    const range = $(`#${rangeId}`);
    const v = values[numId];
    num.value = numId === 'NDVI' || numId === 'Stocking_Rate' ? Number(v.toFixed(3)) : v;
    range.value = clamp(v, Number(range.min), Number(range.max));
    num.closest('.inwrap')?.classList.remove('invalid');
  });
}

function renderPresetHint() {
  const el = $('#presetHint');
  if (!state.preset) {
    el.innerHTML = L('Аймаг, жил сонговол тухайн жилийн бодит үзүүлэлтүүд талбарт орно.', "Choose an aimag and year to load that year's actual indicators into the form.");
    return;
  }
  const { aimag, year } = state.preset;
  el.innerHTML = L(
    `<b>${esc(aimag)} · ${year}</b> оны бодит өгөгдөл талбарт орлоо. Утгыг өөрчилж дахин тооцож болно.`,
    `<b>${esc(aimagName(aimag))} · ${year}</b> actual data loaded into the form. You can change the values and recalculate.`,
  );
}

function applyPreset(name, year) {
  const row = rowOf(name, year);
  if (!row) return;
  state.preset = { aimag: name, year };
  setFieldValues(row);
  $('#presetAimag').value = name;
  $('#presetYear').disabled = false;
  $('#presetYear').value = String(year);
  renderPresetHint();
}

function collectValues() {
  const keys = ['Total_Livestock', 'Precipitation_mm', 'Temperature_C', 'NDVI', 'Stocking_Rate'];
  const values = {};
  const missing = [];
  keys.forEach((k) => {
    const el = $(`#${k}`);
    const v = Number(el.value);
    if (el.value === '' || !Number.isFinite(v)) {
      missing.push(k);
      el.closest('.inwrap')?.classList.add('invalid');
    } else {
      values[k] = v;
    }
  });
  return { values, missing };
}

async function runPrediction(scroll = true) {
  const { values, missing } = collectValues();
  const errBox = $('#predictError');
  if (missing.length) {
    errBox.hidden = false;
    errBox.innerHTML = L('Бүх талбарыг зөв тоон утгаар бөглөнө үү.', 'Please fill every field with a valid number.');
    return;
  }
  errBox.hidden = true;

  const btn = $('#predictBtn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = L('Тооцож байна…', 'Calculating…');
  scanFx($('#results'), 1250);
  scanFx($('#predictForm'), 900);

  try {
    const prevScore = state.lastPredict?.risk_score ?? null;
    const res = await api('/api/predict', { method: 'POST', body: JSON.stringify(values) });
    state.lastPredict = { ...res, preset: state.preset };
    renderPrediction(res, prevScore);
    if (scroll && window.matchMedia('(max-width: 980px)').matches) {
      $('#predictResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    errBox.hidden = false;
    errBox.innerHTML = `<b>${L('Тооцоолол амжилтгүй.', 'Calculation failed.')}</b> ${esc(err.message)}`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = predictLabel();
  }
}

function animateNumber(el, to, decimals = 1) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = to.toFixed(decimals);
    return;
  }
  const duration = 650;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = (to * eased).toFixed(decimals);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(decimals);
  };
  requestAnimationFrame(tick);
}

function renderPrediction(res, prevScore = null) {
  const score = res.risk_score;
  const level = LEVELS[res.level_key] || levelMeta(score);

  $('#predictIntro').hidden = true;
  $('#predictGuide').hidden = true;
  $('#predictResult').hidden = false;
  $('#predictError').hidden = true;

  const banner = $('#banner');
  banner.className = `banner ${level.cls}`;
  $('#bannerBadge').textContent = Math.round(score);
  $('#bannerTitle').textContent = L(`${level.mn} эрсдэл`, `${level.en} risk`);
  const dNat = score - res.national_mean;
  $('#bannerSub').textContent = Math.abs(dNat) < 0.05
    ? L('Улсын дундажтай ойролцоо', 'Close to the national average')
    : L(
      `Улсын дунджаас ${fmt1.format(Math.abs(dNat))} оноогоор ${dNat > 0 ? 'өндөр' : 'бага'}`,
      `${fmt1.format(Math.abs(dNat))} pts ${dNat > 0 ? 'above' : 'below'} the national average`,
    );
  $('#percentileChip').textContent = L(`Түүхэн ${res.percentile}%`, `${ordinal(res.percentile)} percentile`);

  animateNumber($('#ringNum'), score, 1);
  const arc = $('#ringArc');
  arc.style.stroke = level.color;
  arc.style.strokeDasharray = `${(score / 100) * 364.4} 364.4`;
  $('#ringNum').style.color = level.color;

  $('#rangeVal').textContent = `${fmt1.format(res.range[0])}–${fmt1.format(res.range[1])}`;
  $('#natMeanVal').textContent = fmt1.format(res.national_mean);
  $('#percentileVal').textContent = `${res.percentile}%`;
  const notes = [];
  const origin = state.preset ? rowOf(state.preset.aimag, state.preset.year) : null;
  if (origin) {
    const d = score - origin.score;
    if (Math.abs(d) < 0.05) {
      notes.push(L(
        `Сонгосон ${esc(state.preset.aimag)} ${state.preset.year} оны бодит оноотой ойролцоо байна.`,
        `Close to the actual ${esc(aimagName(state.preset.aimag))} ${state.preset.year} score.`,
      ));
    } else {
      const cls = d > 0 ? 'up' : 'down';
      notes.push(L(
        `Сонгосон ${esc(state.preset.aimag)} ${state.preset.year} оны бодит оноо ${fmt1.format(origin.score)} байсан; таны тооцоо <b class="${cls}">${fmt1.format(Math.abs(d))} оноогоор ${d > 0 ? 'өндөр' : 'бага'}</b> байна.`,
        `The actual ${esc(aimagName(state.preset.aimag))} ${state.preset.year} score was ${fmt1.format(origin.score)}; your calculation is <b class="${cls}">${fmt1.format(Math.abs(d))} pts ${d > 0 ? 'higher' : 'lower'}</b>.`,
      ));
    }
  }
  notes.push(L(
    `Боломжит хүрээ нь хамгийн ойр ${res.k} түүхэн тохиолдлын тархалтаас тооцогдов.`,
    `The likely range comes from the spread of the ${res.k} nearest historical cases.`,
  ));
  $('#scoreNote').innerHTML = notes.join(' ');

  const dt = prevScore == null ? null : score - prevScore;
  const de = $('#scoreDelta');
  if (dt == null || Math.abs(dt) < 0.05) {
    de.hidden = true;
  } else {
    de.hidden = false;
    de.className = `scoredelta ${dt > 0 ? 'up' : 'down'}`;
    de.textContent = L(
      `Өмнөх тооцоололтой харьцуулахад ${dt > 0 ? '+' : '−'}${fmt1.format(Math.abs(dt))} оноо (${fmt1.format(prevScore)} → ${fmt1.format(score)})`,
      `Compared with the previous calculation ${dt > 0 ? '+' : '−'}${fmt1.format(Math.abs(dt))} pts (${fmt1.format(prevScore)} → ${fmt1.format(score)})`,
    );
  }

  $('#neighborsHint').textContent = `k = ${res.k} · ${L('зайгаар жинлэсэн', 'distance-weighted')}`;
  $('#neighborRows').innerHTML = res.neighbors.map((n) => `
    <tr>
      <td>${esc(aimagName(n.aimag))}</td>
      <td class="n">${n.year}</td>
      <td class="n"><span class="lvl ${levelKey(n.risk_score).cls}" style="font-family:var(--mono)">${fmt1.format(n.risk_score)}</span></td>
      <td class="n">${fmt2.format(n.distance)}</td>
      <td class="n">${fmt1.format(n.weight_pct)}%</td>
    </tr>`).join('');

  const warnWrap = $('#warningsWrap');
  warnWrap.innerHTML = res.warnings?.length
    ? `<div class="warnbox">${res.warnings.map((w) => `<div class="note"><b>${L('Анхааруулга', 'Warning')}.</b> ${esc(w)}</div>`).join('')}</div>`
    : '';

  const causes = res.causes || [];
  const causeNormal = !causes.length || causes[0].key === 'normal';
  const causesCard = $('#causesCard');
  causesCard.classList.remove('level-high', 'level-mid', 'level-low');
  causesCard.classList.add(`level-${res.level_key}`);
  const causeTitles = causes.slice(0, 2)
    .map((c, i) => {
      const title = i ? c.title.charAt(0).toLowerCase() + c.title.slice(1) : c.title;
      return `<b>${esc(title)}</b>`;
    })
    .join(L(', ', ' and '));
  const levelMn = res.level_key === 'high' ? 'өндөр' : res.level_key === 'mid' ? 'дунд' : 'бага';
  const levelEn = res.level_key === 'high' ? 'high' : res.level_key === 'mid' ? 'medium' : 'low';
  $('#causesSummary').innerHTML = causeNormal
    ? L(
      `Оноо <b>${fmt1.format(score)}</b> — ${levelMn} эрсдэл. Гол шалтгаан тодроогүй.`,
      `Score <b>${fmt1.format(score)}</b> — ${levelEn} risk. No single cause stands out.`,
    )
    : L(
      `Оноо <b>${fmt1.format(score)}</b> болсон гол шалтгаан: ${causeTitles}.`,
      `Why the score is <b>${fmt1.format(score)}</b>: ${causeTitles}.`,
    );

  $('#causeList').innerHTML = causes.map((c, i) => `
    <li style="--i:${i}">
      <span class="cdot ${esc(c.level)}" aria-hidden="true"></span>
      <div class="cbody">
        <div class="crow"><b>${esc(c.title)}</b>${c.metric ? `<span class="cmetric">${esc(c.metric)}</span>` : ''}</div>
        <p>${esc(c.text)}</p>
        ${c.key === 'normal' ? '' : `
        <div class="cbar"><i class="${esc(c.level)}" style="width:${Math.max(5, Math.min(100, c.share))}%"></i></div>
        <span class="ccmp">${esc(c.compare)}</span>`}
      </div>
    </li>`).join('');

  const advice = res.recommendations || [];
  const noise = Math.max(1, state.meta?.metrics?.unseen_aimag_cv?.MAE ?? 5);
  $('#adviceSummary').innerHTML = causeNormal
    ? (res.level_key === 'low'
      ? L('Эрсдэл бага байна. Дараах зүйлсийг үргэлжлүүлээрэй.', 'Risk is low. Keep doing the following.')
      : L('Нэг үзүүлэлт эрс муу биш ч бэлэн байх нь чухал. Дараах алхмуудыг баримтал.', 'No single value is far off, but it pays to be prepared. Follow these steps.'))
    : res.level_key === 'high'
      ? L('Эрсдэл өндөр байна. Дараах алхмуудыг дарааллаар нь хийвэл оноо буурна.', 'Risk is high. Doing these steps in order will lower the score.')
      : L('Эрсдэл дунд байна. Дараах алхмуудыг хийвэл оноо буурч, цаашид муудахаас сэргийлнэ.', 'Risk is medium. These steps will lower the score and help keep it from getting worse.');
  const impactNote = L(
    'Зөвхөн энэ алхмыг хийсэн тохиолдолд загвараар тооцсон онооны бууралт',
    'Model estimate of the score drop if only this step is taken',
  );
  $('#adviceList').innerHTML = advice.map((r, i) => {
    const gain = typeof r.impact === 'number' && r.impact <= -noise;
    const chip = gain
      ? `<span class="aimp" title="${esc(impactNote)}">${L(`−${fmt1.format(Math.abs(r.impact))} оноо`, `−${fmt1.format(Math.abs(r.impact))} pts`)}</span>`
      : '';
    return `
    <li style="--i:${i}">
      <span class="anum">${i + 1}</span>
      <div class="abody">
        <div class="arow"><span class="atag">${esc(r.tag)}</span>${chip}</div>
        <p>${esc(r.text)}</p>
      </div>
    </li>`;
  }).join('');

  renderAllAdvice(res.advice_groups || [], res.advice_total || 0);

  const scenWrap = $('#scenarioCard');
  if (res.scenarios?.length) {
    scenWrap.hidden = false;
    const mae = state.meta?.metrics?.unseen_aimag_cv?.MAE ?? 5;
    const noise = Math.max(1, mae);
    const bestKey = res.scenarios.find((s) => s.delta <= -noise)?.key;
    $('#scenarioNote').innerHTML = L(
      `Одоогийн утгаас нэг үзүүлэлтийг өөрчилбөл эрсдэлийн оноо хэр өөрчлөгдөхийг тооцов. Загварын дундаж алдаа ${fmt1.format(mae)} оноо тул үүнээс бага зөрүүг «≈» гэж тэмдэглэв. «Турших» дарж бүрэн дүнг гаргуулна.`,
      `This shows how the score changes when one indicator is altered. The model's mean error is ${fmt1.format(mae)} pts, so smaller differences are marked «≈». Press «Apply» to load the full result.`,
    );
    $('#scenarioList').innerHTML = res.scenarios.map((s, i) => {
      const signif = Math.abs(s.delta) >= noise;
      const cls = !signif ? 'flat' : s.delta < 0 ? 'down' : 'up';
      const ds = !signif ? '≈' : s.delta < 0 ? '−' : '+';
      return `<div class="scen${s.key === bestKey ? ' best' : ''}" style="--i:${i}">
        <div class="scenmain"><b>${esc(s.label)}${s.key === bestKey ? `<span class="besttag">${L('Хамгийн үр дүнтэй', 'Best result')}</span>` : ''}</b><span>${esc(s.detail)}</span></div>
        <div class="scenscore"><b class="${levelMeta(s.score).cls}">${fmt1.format(s.score)}</b><span class="dchip ${cls}">${ds}${fmt1.format(Math.abs(s.delta))}</span></div>
        <button type="button" class="btn tiny scenbtn" data-scen="${esc(s.key)}">${L('Турших', 'Apply')}</button>
      </div>`;
    }).join('');
    $$('#scenarioList .scenbtn').forEach((b) => {
      b.addEventListener('click', () => applyScenario(res, b.dataset.scen));
    });
  } else {
    scenWrap.hidden = true;
    $('#scenarioList').innerHTML = '';
  }

  const meta = state.meta;
  if (meta) {
    const m = meta.metrics.unseen_aimag_cv;
    $('#modelFoot').textContent = L(
      `Загвар: KNN · k=${res.k} · 20% тестийн MAE ${fmt1.format(m.MAE)} · ангиллын нарийвчлал ${Math.round(m.class_accuracy * 100)}% · ${meta.n_samples} ажиглалт`,
      `Model: KNN · k=${res.k} · 20% test MAE ${fmt1.format(m.MAE)} · class accuracy ${Math.round(m.class_accuracy * 100)}% · ${meta.n_samples} observations`,
    );
  }

  const toMap = $('#toMapBtn');
  toMap.hidden = !res.preset;
  if (res.preset) {
    toMap.textContent = L(
      `${res.preset.aimag} · ${res.preset.year} газрын зураг дээр`,
      `${aimagName(res.preset.aimag)} · ${res.preset.year} on the map`,
    );
  }
}

const ADVICE = { groups: [], total: 0 };

function adviceBtnLabel(open) {
  return open
    ? L('Гол таван зөвлөмжид буцаах', 'Back to the top five')
    : L(`Бүх зөвлөмж үзэх (${ADVICE.total})`, `Show all advice (${ADVICE.total})`);
}

function adviceGroupHtml(g, i) {
  return `
  <section class="agroup ${esc(g.kind)}" style="--i:${i}">
    <div class="aghead">
      <span class="akind">${esc(g.kind_label)}</span>
      <b class="aglabel">${esc(g.label)}</b>
      <span class="acnt">${g.count}</span>
    </div>
    <ol class="alist">${g.items.map((it) => `<li><b>${esc(it.tag)}</b><p>${esc(it.text)}</p></li>`).join('')}</ol>
  </section>`;
}

function renderAllAdvice(groups, total) {
  const btn = $('#allAdviceBtn');
  const wrap = $('#adviceAll');
  if (!btn || !wrap) return;
  ADVICE.groups = groups;
  ADVICE.total = total;
  wrap.innerHTML = '';
  wrap.hidden = true;
  btn.hidden = !total;
  btn.setAttribute('aria-expanded', 'false');
  if (total) btn.textContent = adviceBtnLabel(false);
}

function toggleAllAdvice() {
  const btn = $('#allAdviceBtn');
  const wrap = $('#adviceAll');
  if (!btn || !wrap) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  if (open) {
    wrap.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = adviceBtnLabel(false);
    return;
  }
  if (!wrap.innerHTML) {
    wrap.innerHTML = ADVICE.groups.map(adviceGroupHtml).join('');
    if (!reduceMotion()) scanFx(wrap, 420);
  }
  wrap.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = adviceBtnLabel(true);
}

function applyScenario(res, key) {
  const scen = res.scenarios?.find((s) => s.key === key);
  if (!scen) return;
  Object.entries(scen.apply).forEach(([feature, value]) => {
    const num = $(`#${feature}`);
    const range = $(`#${feature}_range`);
    if (!num) return;
    num.value = value;
    if (range) range.value = clamp(value, Number(range.min), Number(range.max));
    num.closest('.inwrap')?.classList.remove('invalid');
  });
  runPrediction();
}

/* ---------------------------------------------------------------- газрын зураг */
function buildMap() {
  const svg = $('#mapSvg');
  if (!window.MN_MAP) {
    $('#mapEmpty').textContent = L('Газрын зургийн өгөгдөл ачаалагдсангүй.', 'Map data could not be loaded.');
    return false;
  }
  svg.innerHTML = `
    <defs>
      <pattern id="nodataHatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" fill="#DCE4D2"></rect>
        <line x1="0" y1="0" x2="0" y2="5" stroke="#93A184" stroke-width="2"></line>
      </pattern>
    </defs>
    <g id="mapZoom">
      <g id="mapShapes"></g>
      <g id="mapLabels"></g>
    </g>`;
  const shapes = $('#mapShapes');
  const labels = $('#mapLabels');
  const box = $('#mapBox');

  MN_MAP.aimags.forEach((a) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', a.d);
    p.dataset.name = a.name;
    p.setAttribute('class', 'reg');
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    p.setAttribute('aria-label', aimagName(a.name));
    p.addEventListener('pointerenter', (e) => showTip(e, a.name));
    p.addEventListener('pointermove', moveTip);
    p.addEventListener('pointerleave', hideTip);
    p.addEventListener('focus', () => showTipAt(a));
    p.addEventListener('blur', hideTip);
    p.addEventListener('click', () => {
      if (suppressClick) return;
      selectAimag(a.name);
    });
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAimag(a.name);
      }
    });
    shapes.appendChild(p);

    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', a.cx);
    t.setAttribute('y', a.cy);
    t.setAttribute('class', 'reglabel');
    t.textContent = aimagName(a.name);
    t.dataset.name = a.name;
    const shift = LABEL_SHIFT[a.name];
    if (shift) {
      t.setAttribute('x', a.cx + shift.dx);
      t.setAttribute('y', a.cy + shift.dy);
    }
    const off = TINY_AIMAGS[a.name];
    if (off) {
      t.setAttribute('x', a.cx + off.dx);
      t.setAttribute('y', a.cy + off.dy);
      t.setAttribute('text-anchor', 'start');
      t.classList.add('tiny');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', a.cx);
      dot.setAttribute('cy', a.cy);
      dot.setAttribute('r', 2.2);
      dot.setAttribute('class', 'regdot');
      labels.appendChild(dot);
      const lead = document.createElementNS(NS, 'line');
      lead.setAttribute('x1', a.cx);
      lead.setAttribute('y1', a.cy);
      lead.setAttribute('x2', a.cx + off.dx - 3);
      lead.setAttribute('y2', a.cy + off.dy - 3);
      lead.setAttribute('stroke', '#12201A');
      lead.setAttribute('stroke-width', '0.8');
      lead.setAttribute('class', 'regleader');
      labels.appendChild(lead);
    }
    labels.appendChild(t);
  });

  const ping = document.createElementNS(NS, 'circle');
  ping.setAttribute('r', 7);
  ping.setAttribute('class', 'regping');
  ping.setAttribute('cx', -50);
  ping.setAttribute('cy', -50);
  labels.appendChild(ping);

  initMapControls(box);
  state.mapReady = true;
  return true;
}

let suppressClick = false;
function initMapControls(box) {
  let drag = null;
  const svg = $('#mapSvg');
  const apply = () => {
    const { w, h } = MN_MAP;
    const { k, x, y } = state.view;
    $('#mapZoom').setAttribute(
      'transform',
      `translate(${x} ${y}) translate(${w / 2} ${h / 2}) scale(${k}) translate(${-w / 2} ${-h / 2})`,
    );
    $('#mapZoom').classList.toggle('zoomed', k > 1.45);
    positionHoloCard();
  };
  const setZoom = (k) => {
    state.view.k = clamp(k, 1, 4);
    if (state.view.k === 1) { state.view.x = 0; state.view.y = 0; }
    clampPan();
    apply();
  };
  const clampPan = () => {
    const { w, h, k } = { w: MN_MAP.w, h: MN_MAP.h, k: state.view.k };
    const mx = ((k - 1) * w) / 2;
    const my = ((k - 1) * h) / 2;
    state.view.x = clamp(state.view.x, -mx, mx);
    state.view.y = clamp(state.view.y, -my, my);
  };
  $('#zoomIn').addEventListener('click', () => setZoom(state.view.k * 1.35));
  $('#zoomOut').addEventListener('click', () => setZoom(state.view.k / 1.35));
  $('#zoomReset').addEventListener('click', () => {
    state.view = { k: 1, x: 0, y: 0 };
    apply();
  });

  const pdown = (e) => {
    if (e.button !== 0 || e.target.closest('.mapsearch')) return;
    drag = { x: e.clientX, y: e.clientY, tx: state.view.x, ty: state.view.y, moved: false };
    svg.setPointerCapture?.(e.pointerId);
  };
  const pmove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (state.view.k <= 1) return;
    hideTip();
    const scale = MN_MAP.w / svg.getBoundingClientRect().width;
    state.view.x = drag.tx + dx * scale;
    state.view.y = drag.ty + dy * scale;
    clampPan();
    apply();
    box.classList.add('dragging');
  };
  const pup = (e) => {
    if (drag?.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
    svg.releasePointerCapture?.(e.pointerId);
    box.classList.remove('dragging');
  };
  box.addEventListener('pointerdown', pdown);
  box.addEventListener('pointermove', pmove);
  box.addEventListener('pointerup', pup);
  box.addEventListener('pointercancel', pup);
  box.addEventListener('pointerleave', (e) => { if (drag) pup(e); });

  const search = $('#mapSearch');
  const matches = (a, q) => a.name.toLowerCase().includes(q)
    || aimagName(a.name).toLowerCase().includes(q);
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    $$('#mapShapes .reg').forEach((p) => {
      p.classList.toggle('dim', Boolean(q) && !matches({ name: p.dataset.name }, q));
    });
  });
  search.addEventListener('change', () => {
    const q = search.value.trim().toLowerCase();
    const hit = MN_MAP.aimags.find((a) => a.name.toLowerCase() === q || aimagName(a.name).toLowerCase() === q)
      || MN_MAP.aimags.find((a) => a.name.toLowerCase().startsWith(q) || aimagName(a.name).toLowerCase().startsWith(q));
    if (hit) {
      selectAimag(hit.name);
      search.value = aimagName(hit.name);
      $$('#mapShapes .reg').forEach((p) => p.classList.remove('dim'));
    }
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim().toLowerCase();
    const hit = MN_MAP.aimags.find((a) => matches(a, q));
    if (hit) {
      selectAimag(hit.name);
      search.value = aimagName(hit.name);
      $$('#mapShapes .reg').forEach((p) => p.classList.remove('dim'));
      search.blur();
    }
  });
}

function showTipAt(a) {
  const p = $('#mapShapes').querySelector(`[data-name="${CSS.escape(a.name)}"]`);
  const r = p.getBoundingClientRect();
  showTip({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, a.name);
}
function showTip(e, name) {
  const row = rowOf(name, state.year);
  const tip = $('#mapTip');
  const shown = esc(aimagName(name));
  if (!row) {
    tip.innerHTML = `<b>${shown}</b><div class="tiprow"><span class="tiplvl">${L('Өгөгдөл байхгүй', 'No data')}</span></div>`;
  } else {
    const v = valueOf(row);
    const l = levelMeta(v);
    tip.innerHTML = `
      <b>${shown}</b>
      <div class="tiprow"><strong>${fmt1.format(v)}</strong><span class="tiplvl">${L('оноо', 'pts')} · ${l[state.lang]}</span></div>
      <div class="tipmeta">${L('NDVI', 'NDVI')} ${fmt2.format(row.NDVI)} · ${L('Ачаалал', 'Stocking')} ${fmt2.format(row.Stocking_Rate)} · ${fmt0.format(row.Precipitation_mm)} ${L('мм', 'mm')}</div>`;
  }
  tip.classList.add('on');
  moveTip(e);
}
function moveTip(e) {
  const tip = $('#mapTip');
  if (!tip.classList.contains('on')) return;
  const box = $('#mapBox').getBoundingClientRect();
  const w = tip.offsetWidth;
  let left = e.clientX - box.left + 14;
  if (left + w > box.width - 8) left = e.clientX - box.left - w - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, e.clientY - box.top - tip.offsetHeight - 10)}px`;
}
function hideTip() {
  $('#mapTip').classList.remove('on');
}

function selectAimag(name, scroll = true) {
  state.selected = name;
  scanFx($('#mapBox'), 780);
  renderAll();
  syncUrl();
  if (scroll && window.matchMedia('(max-width: 1180px)').matches) {
    $('#sidePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setYear(year) {
  if (!state.years.includes(year)) return;
  state.year = year;
  state.anim = true;
  $('#mapYear').value = String(year);
  scanFx($('#mapBox'), 900);
  scanFx($('#mapKpis'), 900);
  renderAll();
  syncUrl();
}

function renderAll() {
  renderMap();
  renderKpis();
  renderTrend();
  renderRank();
  renderTable();
  renderSide();
  renderMapLabels();
  renderHolo();
  state.anim = false;
}

function renderMapLabels() {
  const sub = $('#mapSub');
  if (!state.year) return;
  sub.textContent = L(`${state.year} он · 21 аймаг`, `${state.year} · 21 aimags`);
  $('#rankYear').textContent = L(`${state.year} · оноогоор`, `${state.year} · by score`);
  $('#tableYear').textContent = L(`${state.year} он`, `${state.year}`);
  $$('#mapLabels .reglabel').forEach((t) => {
    t.textContent = aimagName(t.dataset.name);
  });
}

function renderMap() {
  if (!state.mapReady) return;
  const paths = $$('#mapShapes .reg');
  paths.forEach((p) => {
    const row = rowOf(p.dataset.name, state.year);
    if (!row) {
      p.classList.add('nodata');
      p.style.removeProperty('fill');
      p.classList.remove('sel');
      p.setAttribute('aria-label', L(`${p.dataset.name} — өгөгдөл байхгүй`, `${aimagName(p.dataset.name)} — no data`));
      return;
    }
    const v = valueOf(row);
    p.style.fill = riskColor(v);
    p.classList.remove('nodata');
    p.classList.toggle('sel', state.selected === p.dataset.name);
    p.setAttribute('aria-label', L(
      `${p.dataset.name}: ${fmt1.format(v)} оноо, ${levelMeta(v).mn} эрсдэл`,
      `${aimagName(p.dataset.name)}: ${fmt1.format(v)} pts, ${levelMeta(v).en} risk`,
    ));
  });
  const sel = $('#mapShapes .reg.sel');
  if (sel) $('#mapShapes').appendChild(sel);
  $$('#mapLabels .reglabel').forEach((t) => {
    t.classList.toggle('sel', t.dataset.name === state.selected);
  });
  const ping = $('#mapLabels .regping');
  if (ping) {
    const hit = state.selected && (window.MN_MAP?.aimags || []).find((a) => a.name === state.selected);
    if (hit) {
      ping.setAttribute('cx', hit.cx);
      ping.setAttribute('cy', hit.cy);
      ping.classList.add('on');
    } else {
      ping.classList.remove('on');
    }
  }
}

/** Сонгосон аймгийн мэдээллийн «hologram» цэв — зураг дээрх тухайн цэгт холбогдоно. */
function renderHolo() {
  const card = $('#holoCard');
  if (!card) return;
  const name = state.selected;
  const row = name ? rowOf(name, state.year) : null;
  if (!name || document.body.dataset.page !== 'map') {
    card.classList.remove('show');
    card.hidden = true;
    return;
  }

  $('#holoName').textContent = aimagName(name);
  $('#holoYear').textContent = String(state.year);

  if (!row) {
    $('#holoScore').textContent = '—';
    $('#holoScore').style.color = '';
    $('#holoLevel').textContent = L('Өгөгдөлгүй', 'No data');
    $('#holoLevel').style.color = 'var(--muted)';
    $('#holoRows').innerHTML = `<p class="nodatahint">${L('Энэ нутаг дэвсгэрт бэлчээрийн үзүүлэлт байхгүй.', 'No pasture indicators for this area.')}</p>`;
    $('#holoGo').hidden = true;
  } else {
    const v = valueOf(row);
    const l = levelMeta(v);
    $('#holoLevel').textContent = l[state.lang];
    $('#holoLevel').style.color = l.color;
    animateNumber($('#holoScore'), v, 1);
    $('#holoScore').style.color = l.color;

    const rows = rowsForYear(state.year).sort((a, b) => valueOf(b) - valueOf(a));
    const rank = rows.findIndex((r) => r.aimag === name) + 1;
    const prev = rowOf(name, state.year - 1);
    const d = prev ? v - prev.score : null;
    const specs = [
      ['NDVI', fmt2.format(row.NDVI), row.NDVI],
      [L('Ачаалал', 'Stocking'), fmt2.format(row.Stocking_Rate), row.Stocking_Rate / 3.2],
      [L('Тунадас', 'Rain'), `${fmt0.format(row.Precipitation_mm)} ${L('мм', 'mm')}`, row.Precipitation_mm / 470],
    ];
    $('#holoRows').innerHTML = specs.map(([k, txt, ratio], i) => `
      <div class="holoro"><span>${k}</span><b>${txt}</b><i><s style="--i:${i};width:${clamp(ratio * 100, 4, 100)}%"></s></i></div>`).join('')
      + `<div class="holoro"><span>${L('Байр', 'Rank')}</span><b>${rank} / ${rows.length}</b><i><s style="--i:3;width:${clamp((rows.length - rank + 1) / rows.length * 100, 4, 100)}%"></s></i></div>`
      + (d === null ? '' : `<div class="holoro"><span>${L('Өмнөх жил', 'Previous year')}</span><b>${d > 0 ? '+' : ''}${fmt1.format(d)}</b><i><s style="--i:4;width:${clamp(Math.abs(d) * 6, 4, 100)}%"></s></i></div>`);
    $('#holoGo').hidden = false;
    $('#holoGo').textContent = L('Дэлгэрэнгүй үзэх', 'Open full details');
  }

  card.hidden = false;
  card.classList.remove('show');
  requestAnimationFrame(() => {
    positionHoloCard();
    card.classList.add('show');
  });
}

function renderKpis() {
  const rows = rowsForYear(state.year);
  if (!rows.length) { $('#mapKpis').innerHTML = ''; return; }
  const vals = rows.map(valueOf);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  const highCount = vals.filter((v) => v >= 65).length;
  const l = levelMeta(mean);

  const prevRows = rowsForYear(state.year - 1);
  const prevMean = prevRows.length ? prevRows.reduce((s, r) => s + valueOf(r), 0) / prevRows.length : null;
  const prevHigh = prevRows.length ? prevRows.filter((r) => valueOf(r) >= 65).length : null;
  const dMean = prevMean === null ? null : mean - prevMean;
  const dHigh = prevHigh === null ? null : highCount - prevHigh;
  const cls = (d) => (d === null || Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down');
  const signed = (d) => `${d > 0 ? '+' : ''}${fmt1.format(d)}`;
  const meanDelta = dMean === null ? '' :
    `<span class="kpidelta ${cls(dMean)}">${L(`${signed(dMean)} өмнөх жилээс`, `${signed(dMean)} vs previous year`)}</span>`;
  const highDelta = dHigh === null ? '' :
    `<span class="kpidelta ${cls(dHigh)}">${L(`${dHigh > 0 ? '+' : ''}${dHigh} аймаг өмнөх жилээс`, `${dHigh > 0 ? '+' : ''}${dHigh} aimags vs previous year`)}</span>`;

  $('#mapKpis').innerHTML = `
    <div class="kpi" style="--i:0"><small>${L('Улсын дундаж', 'National average')}</small><b class="${l.cls}" data-to="${mean}" data-dec="1">${fmt1.format(mean)}</b><span>${L(`${l.mn} эрсдэл · ${state.year} он`, `${l.en} risk · ${state.year}`)}</span>${meanDelta}</div>
    <div class="kpi" style="--i:1"><small>${L('Өндөр эрсдэлтэй', 'High risk')}</small><b data-to="${highCount}" data-dec="0">${highCount}<span style="font-size:16px;color:var(--muted)"> / ${rows.length}</span></b><span>${L('65-аас дээш оноо', 'scores above 65')}</span>${highDelta}</div>
    <div class="kpi" style="--i:2"><small>${L('Хамгийн өндөр', 'Highest')}</small><b class="high" style="font-size:22px">${esc(aimagName(top.aimag))}</b><span>${L(`${fmt1.format(valueOf(top))} оноо`, `${fmt1.format(valueOf(top))} pts`)}</span></div>
    <div class="kpi" style="--i:3"><small>${L('Хамгийн бага', 'Lowest')}</small><b class="low" style="font-size:22px">${esc(aimagName(low.aimag))}</b><span>${L(`${fmt1.format(valueOf(low))} оноо`, `${fmt1.format(valueOf(low))} pts`)}</span></div>`;

  if (state.anim && !reduceMotion()) {
    const first = $('#mapKpis .kpi b[data-to]');
    if (first) animateNumber(first, Number(first.dataset.to), Number(first.dataset.dec));
  }
}

function renderTrend() {
  const box = $('#trendStrip');
  if (!box) return;
  const vals = state.years.map((y) => [y, state.nationalByYear[y] ?? meanOfYear(y)]);
  const lo = Math.min(...vals.map((v) => v[1]));
  const hi = Math.max(...vals.map((v) => v[1]));
  const span = Math.max(1, hi - lo);
  box.innerHTML = vals.map(([y, v], i) => {
    const h = 14 + ((v - lo) / span) * 58;
    const on = y === state.year;
    return `<button type="button" class="tbar${on ? ' sel' : ''}${state.anim || reduceMotion() ? '' : ' noanim'}" style="--i:${i}" data-year="${y}" title="${L(`${y} он: улсын дундаж ${fmt1.format(v)} оноо`, `${y}: national average ${fmt1.format(v)} pts`)}"
      aria-label="${L(`${y} он, улсын дундаж ${fmt1.format(v)} оноо`, `${y}, national average ${fmt1.format(v)} pts`)}" aria-pressed="${on}">
      <i style="height:${h}%;background:${riskColor(v)}"></i><span>${String(y).slice(2)}</span></button>`;
  }).join('');
  const cur = state.nationalByYear[state.year] ?? meanOfYear(state.year);
  $('#trendHint').textContent = L(`${state.year} он · ${fmt1.format(cur)} оноо`, `${state.year} · ${fmt1.format(cur)} pts`);
  $$('#trendStrip .tbar').forEach((b) => {
    b.addEventListener('click', () => setYear(Number(b.dataset.year)));
  });
}

function renderRank() {
  const rows = rowsForYear(state.year).sort((a, b) => valueOf(b) - valueOf(a));
  const shown = rows.slice(0, 8);
  $('#rankList').innerHTML = shown.map((r, i) => `
    <button type="button" class="rankrow ${state.selected === r.aimag ? 'sel' : ''} ${reduceMotion() ? 'noanim' : ''}" style="--i:${i}" data-name="${esc(r.aimag)}">
      <span class="rk">${i + 1}</span>
      <span class="nm">${esc(aimagName(r.aimag))}</span>
      <span class="sc">${fmt1.format(valueOf(r))}</span>
      <span class="track"><i style="width:${clamp(valueOf(r), 2, 100)}%;background:${riskColor(valueOf(r))}"></i></span>
    </button>`).join('') + (rows.length > shown.length
      ? `<button type="button" class="rankmore" id="rankMore">${L(`Бүх ${rows.length} аймгийг хүснэгтээс харах ↓`, `See all ${rows.length} aimags in the table ↓`)}</button>`
      : '');
  $$('#rankList .rankrow').forEach((b) => {
    b.addEventListener('click', () => selectAimag(b.dataset.name));
  });
  $('#rankMore')?.addEventListener('click', () => {
    document.querySelector('.tablecard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderTable() {
  const rows = rowsForYear(state.year).sort((a, b) => valueOf(b) - valueOf(a));
  $('#aimagTable').innerHTML = rows.map((r, i) => {
    const prev = rowOf(r.aimag, state.year - 1);
    const d = prev ? r.score - prev.score : null;
    const dTxt = d === null ? '—' : `${d > 0 ? '+' : ''}${fmt1.format(d)}`;
    const dCls = d === null || Math.abs(d) < 0.05 ? '' : d > 0 ? 'up' : 'down';
    return `
      <tr tabindex="0" data-name="${esc(r.aimag)}" class="${state.selected === r.aimag ? 'sel' : ''}" aria-label="${L(`${esc(r.aimag)}, ${fmt1.format(r.score)} оноо`, `${esc(aimagName(r.aimag))}, ${fmt1.format(r.score)} pts`)}">
        <td class="n">${i + 1}</td>
        <td><b>${esc(aimagName(r.aimag))}</b></td>
        <td class="n scorecell">${fmt1.format(r.score)}</td>
        <td>${levelBadge(r.score)}</td>
        <td class="n">${fmt2.format(r.NDVI)}</td>
        <td class="n">${fmt2.format(r.Stocking_Rate)}</td>
        <td class="n">${fmt0.format(r.Precipitation_mm)}</td>
        <td class="n"><span class="delta ${dCls}">${dTxt}</span></td>
      </tr>`;
  }).join('');
  $$('#aimagTable tr').forEach((tr) => {
    const pick = () => selectAimag(tr.dataset.name);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });
}

function historyChart(name) {
  const years = state.years;
  const rows = years.map((y) => rowOf(name, y));
  if (!rows.some(Boolean)) return '';
  const W = 320; const H = 136; const pl = 26; const pr = 6; const pt = 12; const pb = 20;
  const x = (i) => pl + (i * (W - pl - pr)) / (years.length - 1);
  const y = (v) => pt + (1 - v / 100) * (H - pt - pb);
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const actual = rows.map((r, i) => (r ? [x(i), y(r.score)] : null)).filter(Boolean);
  const selIdx = years.indexOf(state.year);

  const grid = [0, 25, 50, 75, 100].map((v) => (
    `<line class="chartgrid" x1="${pl}" y1="${y(v)}" x2="${W - pr}" y2="${y(v)}"></line>`
  )).join('');
  const axis = [0, 50, 100].map((v) => (
    `<text class="chartaxis" x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`
  )).join('');
  const ticks = [...new Set([0, Math.floor((years.length - 1) / 2), years.length - 1])]
    .map((i) => {
      const last = i === years.length - 1;
      const tx = last ? W - 1 : x(i);
      return `<text class="chartaxis" x="${tx}" y="${H - 6}" text-anchor="${last ? 'end' : 'middle'}">${years[i]}</text>`;
    }).join('');
  const dots = rows.map((r, i) => {
    if (!r) return '';
    return `<circle class="chartdot ${i === selIdx ? 'sel' : ''}" cx="${x(i)}" cy="${y(r.score)}" r="${i === selIdx ? 3.4 : 1.8}"><title>${years[i]}: ${fmt1.format(r.score)} ${L('оноо', 'pts')}</title></circle>`;
  }).join('');
  const now = selIdx >= 0 && rows[selIdx]
    ? `<line class="chartnow" x1="${x(selIdx)}" y1="${pt}" x2="${x(selIdx)}" y2="${H - pb}"></line>` : '';
  const len = actual.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - actual[i - 1][0], p[1] - actual[i - 1][1]) : 0), 0);
  const base = H - pb;
  const area = actual.length > 1
    ? `${line(actual)}L${actual[actual.length - 1][0].toFixed(1)},${base}L${actual[0][0].toFixed(1)},${base}Z` : '';

  return `
    <div class="chartbox">
      <div class="ch">
        <span>${L(`${state.years[0]}–${state.years[state.years.length - 1]} оны түүх`, `${state.years[0]}–${state.years[state.years.length - 1]} history`)}</span>
        <span>${L('оноо / 100', 'score / 100')}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L(`${esc(name)} аймгийн эрсдэлийн түүх`, `Risk history of ${esc(aimagName(name))}`)}">
        ${grid}${now}${axis}${ticks}
        ${area ? `<path class="chartarea" d="${area}"></path>` : ''}
        <path class="chartline" style="--len:${Math.round(len) || 1200}" d="${line(actual)}"></path>
        ${dots}
      </svg>
    </div>`;
}

function renderSide() {
  const panel = $('#sidePanel');
  const name = state.selected;
  const row = name ? rowOf(name, state.year) : null;
  $('#rankCard').hidden = false;
  document.body.classList.toggle('has-sel', Boolean(name));

  if (!name) {
    const mean = meanOfYear(state.year);
    const l = levelMeta(mean);
    panel.innerHTML = `
      <div class="sideintro">
        <h2>${L('Аймаг сонгоно уу', 'Select an aimag')}</h2>
        <p class="muted">${L('Зураг дээрх аймаг дээр дарж эсвэл баруун жагсаалтаас сонгож, жилийн үзүүлэлт, түүхийг харна уу.', 'Click an aimag on the map or pick one from the list on the right to see yearly indicators and history.')}</p>
        <div class="introstats">
          <div><span>${L(`${state.year} оны дундаж`, `${state.year} average`)}</span><b style="color:${l.color}">${fmt1.format(mean)}</b></div>
          <div><span>${L('Ажиглалт', 'Observations')}</span><b>${state.data?.rows.length ?? 0}</b></div>
          <div><span>${L('Хамрах жил', 'Years covered')}</span><b>${state.years.length}</b></div>
        </div>
      </div>`;
    return;
  }

  if (!row) {
    panel.innerHTML = `
      <div class="sidehead">
        <div><h2>${esc(aimagName(name))}</h2><p class="sub">${L(`${state.year} он`, `${state.year}`)}</p></div>
        <button type="button" class="iconbtn" id="clearSel" aria-label="${esc(L('Сонголтыг цэвэрлэх', 'Clear selection'))}">×</button>
      </div>
      <p class="note" style="margin-top:14px">${L('Энэ нутаг дэвсгэрийн хувьд өгөгдлийн санд бэлчээрийн үзүүлэлт байхгүй тул эрсдэл тооцогдоогүй.', 'No pasture indicators exist for this area in the dataset, so no risk was calculated.')}</p>`;
    $('#clearSel').addEventListener('click', () => { state.selected = null; renderAll(); });
    return;
  }

  const rows = rowsForYear(state.year).sort((a, b) => valueOf(b) - valueOf(a));
  const rank = rows.findIndex((r) => r.aimag === name) + 1;
  const prev = rowOf(name, state.year - 1);
  const delta = prev ? row.score - prev.score : null;
  const dTxt = delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmt1.format(delta)}`;
  const dCls = delta === null || Math.abs(delta) < 0.05 ? '' : delta > 0 ? 'up' : 'down';
  const l = levelMeta(row.score);
  const mean = meanOfYear(state.year);

  const bars = METRICS.map(([key, label, fmt]) => {
    const [lo, hi] = state.meta?.feature_ranges?.[key] ?? [0, 1];
    const w = clamp(((row[key] - lo) / (hi - lo || 1)) * 100, 3, 100);
    return `
      <div class="mbar">
        <div class="t"><span>${L(label[0], label[1])}</span><span>${fmt(row[key])}</span></div>
        <div class="track"><i style="width:${w}%"></i></div>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="sidehead">
      <div><h2>${esc(aimagName(name))}</h2><p class="sub">${L(`${state.year} он · ${rank}-р байр / ${rows.length}`, `${state.year} · rank ${rank} / ${rows.length}`)}</p></div>
      <button type="button" class="iconbtn" id="clearSel" aria-label="${esc(L('Сонголтыг цэвэрлэх', 'Clear selection'))}">×</button>
    </div>
    <div class="sidescore">
      <b style="color:${l.color}">${fmt1.format(row.score)}</b>
      ${levelBadge(row.score)}
      <span class="delta ${dCls}" title="${esc(L('Өмнөх жилийн оноотой харьцуулсан', 'Compared with the previous year'))}">${dTxt}</span>
    </div>
    <p class="sidesub">${L(`Улсын дундаж ${fmt1.format(mean)}`, `National average ${fmt1.format(mean)}`)}</p>
    <div class="metricbars">${bars}</div>
    ${historyChart(name)}
    <button type="button" class="btn primary block" id="useAimag">${L('Энэ аймгийн утгаар тооцох', "Score this aimag's values")}</button>`;

  $('#clearSel').addEventListener('click', () => { state.selected = null; renderAll(); });
  animateNumber($('.sidescore b', panel), row.score, 1);
  $('#useAimag').addEventListener('click', () => {
    applyPreset(name, state.year);
    goTo('predict');
    setTimeout(() => {
      $('#predictForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      runPrediction();
    }, 120);
  });
}

/* ---------------------------------------------------------------- баримтууд */
function renderIntro() {
  const m = state.meta.metrics.unseen_aimag_cv;
  const labels = state.meta.feature_labels;
  $('#modelChip').textContent = `KNN · MAE ${fmt1.format(m.MAE)}`;
  $('#modelChip').classList.remove('busy');
  $('#modelChip').setAttribute('title', L('Загварын дэлгэрэнгүйг харах', 'View model details'));
  $('#modelBox').innerHTML = `
    <div><small>${L('Алгоритм', 'Algorithm')}</small><b>${L('KNN регрессор', 'KNN regressor')}</b></div>
    <div><small>k</small><b>${state.meta.best_params.n_neighbors}</b></div>
    <div><small>MAE</small><b>${fmt1.format(m.MAE)}</b></div>
    <div><small>${L('Нарийвчлал', 'Accuracy')}</small><b>${Math.round(m.class_accuracy * 100)}%</b></div>
    <div><small>${L('Ажиглалт', 'Observations')}</small><b>${state.meta.n_samples}</b></div>
    <div><small>${L('Жил', 'Years')}</small><b>${state.meta.years[0]}–${state.meta.years[1]}</b></div>
    <div style="grid-column:1/-1"><small>${L('Шинж чанарууд', 'Features')}</small><b>${Object.values(labels).map(esc).join(' · ')}</b></div>`;
  $('#modelNote').textContent = L(
    'Загварыг өгөгдлийн 80%-д сургаж, 20%-д шалгасан. KNN нь шалтгаан-үр дагаврыг биш, түүхэн ижил төстэй байдлыг хэмждэг.',
    'The model was trained on 80% of the data and validated on 20%. KNN measures historical similarity, not causation.',
  );
}

function fillSelects() {
  const aimagSel = $('#presetAimag');
  aimagSel.innerHTML = `<option value="">${L('Аймаг сонгох…', 'Select aimag…')}</option>`
    + state.aimags.map((a) => `<option value="${esc(a)}">${esc(aimagName(a))}</option>`).join('');
  if (state.preset) aimagSel.value = state.preset.aimag;

  const yearSel = $('#presetYear');
  yearSel.innerHTML = state.years.slice().reverse()
    .map((y) => `<option value="${y}"${y === state.latestYear ? ' selected' : ''}>${y}</option>`).join('');
  if (state.preset) yearSel.value = String(state.preset.year);

  const mapYear = $('#mapYear');
  mapYear.innerHTML = state.years.slice().reverse()
    .map((y) => `<option value="${y}"${y === state.latestYear ? ' selected' : ''}>${y}</option>`).join('');
  if (state.year) mapYear.value = String(state.year);
  mapYear.onchange = (e) => setYear(Number(e.target.value));

  $('#aimagOptions').innerHTML = state.aimags.map((a) => `<option value="${esc(aimagName(a))}"></option>`).join('');
}

/* ---------------------------------------------------------------- эхлэл */
function applyUrlState() {
  const q = new URLSearchParams(location.search);
  const year = Number(q.get('year'));
  if (state.years.includes(year) && year !== state.year) {
    state.year = year;
    $('#mapYear').value = String(year);
    renderAll();
  }
  const aimag = q.get('aimag');
  if (aimag && state.byAimag.has(aimag)) selectAimag(aimag, false);
  const page = q.get('page');
  if (PAGES.includes(page)) goTo(page, false);
}

function initialLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'mn') return fromUrl;
  try {
    return localStorage.getItem('belcheer-lang') === 'en' ? 'en' : 'mn';
  } catch {
    return 'mn';
  }
}

function setLangUi(lang) {
  $$('.langswitch button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
}

async function setLanguage(lang) {
  const next = lang === 'en' ? 'en' : 'mn';
  if (next === state.lang) return;
  state.lang = next;
  window.I18N.setLang(next);
  try { localStorage.setItem('belcheer-lang', next); } catch { /* private mode */ }
  setLangUi(next);
  window.I18N.apply();

  if (!state.data) { syncUrl(); return; }

  try {
    const [meta, data] = await Promise.all([api('/api/model-info'), api('/api/dataset')]);
    state.meta = meta;
    state.data = data;
  } catch { /* keep the data already loaded */ }

  fillSelects();
  renderIntro();
  renderAll();
  renderSources();
  renderPresetHint();
  $('#predictBtn').textContent = predictLabel();
  if (!$('#predictResult').hidden) {
    state.lastPredict = null;
    await runPrediction(false);
  }
  syncUrl();
}

async function init() {
  state.lang = initialLang();
  window.I18N.setLang(state.lang);
  setLangUi(state.lang);
  window.I18N.apply();

  initNav();
  initForm();
  $('#allAdviceBtn').addEventListener('click', toggleAllAdvice);
  initToTop();
  initTheme();
  initHoloCard();
  buildBgfx();
  buildBoot();
  buildHeroes();
  buildMap();

  $('#modelChip').classList.add('busy');
  try {
    const [meta, data] = await Promise.all([api('/api/model-info'), api('/api/dataset')]);
    state.meta = meta;
    state.data = data;
    state.years = data.years.slice().sort((a, b) => a - b);
    state.latestYear = data.latest_year;
    state.aimags = data.aimags.slice().sort((a, b) => aimagName(a).localeCompare(aimagName(b)));
    state.year = state.latestYear;
    state.nationalByYear = data.national_mean_by_year ?? {};

    data.rows.forEach((r) => {
      if (!state.byAimag.has(r.aimag)) state.byAimag.set(r.aimag, new Map());
      state.byAimag.get(r.aimag).set(r.year, r);
    });

    fillSelects();
    const defaultAimag = state.byAimag.has('Архангай') ? 'Архангай' : state.aimags[0];
    applyPreset(defaultAimag, state.latestYear);
    renderIntro();
    renderAll();
    renderSources();
    $('#mapEmpty').hidden = true;
    applyUrlState();
    initReveal();
    bootDone();

    // анхны зураг дээр хамгийн өндөр эрсдэлтэй аймгийг сонгохгүй, гэхдээ KPI-г харуулна
  } catch (err) {
    bootDone();
    const box = $('#apiError');
    box.hidden = false;
    box.innerHTML = L(
      `<b>Өгөгдөл ачаалагдсангүй.</b> ${esc(err.message)}. Терминалд <code>python app.py</code> ажиллуулаад <code>http://127.0.0.1:5000</code> хаягаар нээнэ үү.`,
      `<b>Data could not be loaded.</b> ${esc(err.message)}. Run <code>python app.py</code> in the terminal and open <code>http://127.0.0.1:5000</code>.`,
    );
    const chip = $('#modelChip');
    chip.textContent = L('Загвар ачаалагдсангүй', 'Model not loaded');
    chip.classList.remove('busy');
    chip.classList.add('bad');
    $('#predictBtn').disabled = true;
    $('#mapEmpty').textContent = L('Газрын зургийн өгөгдөл ачаалагдсангүй.', 'Map data could not be loaded.');
    $('#mapEmpty').hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  setTimeout(bootDone, 5200);
});
