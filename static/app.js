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
  ['Total_Livestock', 'Нийт мал', (v) => `${fmt0.format(v)} толгой`],
  ['NDVI', 'NDVI', (v) => fmt2.format(v)],
  ['Precipitation_mm', 'Хур тунадас', (v) => `${fmt0.format(v)} мм`],
  ['Temperature_C', 'Температур', (v) => `${fmt1.format(v)} °C`],
  ['Stocking_Rate', 'Ачаалал', (v) => fmt2.format(v)],
];

const state = {
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
  return `<span class="lvl ${l.cls}">${l.mn}</span>`;
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
  const res = await fetch(path, {
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

function formatFeature(key, v) {
  if (key === 'Total_Livestock') return fmt0.format(v);
  if (key === 'Precipitation_mm') return fmt0.format(v);
  if (key === 'Temperature_C') return fmt1.format(v);
  if (key === 'NDVI') return fmt2.format(v);
  return fmt2.format(v);
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

/* ---------------------------------------------------------------- цэс */
const PAGES = ['predict', 'map', 'facts', 'help'];

function syncUrl() {
  if (!state.data) return;
  const page = document.body.dataset.page || 'predict';
  const p = new URLSearchParams();
  if (page !== 'predict') p.set('page', page);
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

  const nav = $('nav');
  const cue = () => {
    nav.classList.toggle('can-left', nav.scrollLeft > 2);
    nav.classList.toggle('can-right', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
  };
  nav.addEventListener('scroll', cue, { passive: true });
  window.addEventListener('resize', cue);
  cue();
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
      $('#presetHint').innerHTML = 'Аймаг, жил сонговол тухайн жилийн бодит үзүүлэлтүүд талбарт орно.';
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

function applyPreset(name, year) {
  const row = rowOf(name, year);
  if (!row) return;
  state.preset = { aimag: name, year };
  setFieldValues(row);
  $('#presetAimag').value = name;
  $('#presetYear').disabled = false;
  $('#presetYear').value = String(year);
  $('#presetHint').innerHTML = `<b>${esc(name)} · ${year}</b> оны бодит өгөгдөл талбарт орлоо. Утгыг өөрчилж дахин тооцож болно.`;
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

async function runPrediction() {
  const { values, missing } = collectValues();
  const errBox = $('#predictError');
  if (missing.length) {
    errBox.hidden = false;
    errBox.innerHTML = 'Бүх талбарыг зөв тоон утгаар бөглөнө үү.';
    return;
  }
  errBox.hidden = true;

  const btn = $('#predictBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Тооцож байна…';

  try {
    const prevScore = state.lastPredict?.risk_score ?? null;
    const res = await api('/api/predict', { method: 'POST', body: JSON.stringify(values) });
    state.lastPredict = { ...res, preset: state.preset };
    renderPrediction(res, prevScore);
    if (window.matchMedia('(max-width: 980px)').matches) {
      $('#predictResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    errBox.hidden = false;
    errBox.innerHTML = `<b>Тооцоолол амжилтгүй.</b> ${esc(err.message)}`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = original;
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
  $('#bannerTitle').textContent = `${level.mn} эрсдэл`;
  const dNat = score - res.national_mean;
  $('#bannerSub').textContent = Math.abs(dNat) < 0.05
    ? 'Улсын дундажтай ойролцоо'
    : `Улсын дунджаас ${fmt1.format(Math.abs(dNat))} оноогоор ${dNat > 0 ? 'өндөр' : 'бага'}`;
  $('#percentileChip').textContent = `Түүхэн ${res.percentile}%`;

  animateNumber($('#ringNum'), score, 1);
  const arc = $('#ringArc');
  arc.style.stroke = level.color;
  arc.style.strokeDasharray = `${(score / 100) * 364.4} 364.4`;
  $('#ringNum').style.color = level.color;

  $('#rangeVal').textContent = `${fmt1.format(res.range[0])}–${fmt1.format(res.range[1])}`;
  $('#natMeanVal').textContent = fmt1.format(res.national_mean);
  $('#percentileVal').textContent = `${res.percentile}%`;
  const top = res.factors[0];
  const sign = top.effect >= 0 ? '+' : '';
  const notes = [];
  notes.push(top && Math.abs(top.effect) >= 1
    ? `Хамгийн их нөлөөлж буй хүчин зүйл: <b>${esc(top.label)}</b> (медиантай харьцуулахад ${sign}${fmt1.format(top.effect)} оноо, эрсдэлийг ${top.effect >= 0 ? 'нэмэгдүүлж' : 'бууруулж'} байна).`
    : 'Оруулсан утгууд медиан утгуудтай ойролцоо байгаа тул хүчин зүйлсийн нөлөө бага байна.');
  const origin = state.preset ? rowOf(state.preset.aimag, state.preset.year) : null;
  if (origin) {
    const d = score - origin.score;
    if (Math.abs(d) < 0.05) {
      notes.push(`Сонгосон ${esc(state.preset.aimag)} ${state.preset.year} оны бодит оноотой ойролцоо байна.`);
    } else {
      const cls = d > 0 ? 'up' : 'down';
      notes.push(`Сонгосон ${esc(state.preset.aimag)} ${state.preset.year} оны бодит оноо ${fmt1.format(origin.score)} байсан; таны тооцоо <b class="${cls}">${fmt1.format(Math.abs(d))} оноогоор ${d > 0 ? 'өндөр' : 'бага'}</b> байна.`);
    }
  }
  notes.push(`Боломжит хүрээ нь хамгийн ойр ${res.k} түүхэн тохиолдлын тархалтаас тооцогдов.`);
  $('#scoreNote').innerHTML = notes.join(' ');

  const dt = prevScore == null ? null : score - prevScore;
  const de = $('#scoreDelta');
  if (dt == null || Math.abs(dt) < 0.05) {
    de.hidden = true;
  } else {
    de.hidden = false;
    de.className = `scoredelta ${dt > 0 ? 'up' : 'down'}`;
    de.textContent = `Өмнөх тооцоололтой харьцуулахад ${dt > 0 ? '+' : '−'}${fmt1.format(Math.abs(dt))} оноо (${fmt1.format(prevScore)} → ${fmt1.format(score)})`;
  }

  const maxAbs = Math.max(0.1, ...res.factors.map((f) => Math.abs(f.effect)));
  $('#factorList').innerHTML = res.factors.map((f) => {
    const pos = f.effect >= 0;
    const width = Math.max(2, (Math.abs(f.effect) / maxAbs) * 100);
    return `
      <div class="factor">
        <div class="frow">
          <span>${esc(f.label)}</span>
          <span class="fv">${formatFeature(f.feature, f.value)} · медиан ${formatFeature(f.feature, f.median)}</span>
          <span class="fe ${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}${fmt1.format(f.effect)}</span>
        </div>
        <div class="bar" title="${esc(f.label)}: ${pos ? '+' : ''}${fmt1.format(f.effect)} оноо">
          <i class="${pos ? 'pos' : 'neg'}" style="width:${width}%"></i>
        </div>
      </div>`;
  }).join('');

  $('#neighborsHint').textContent = `k = ${res.k} · зайгаар жинлэсэн`;
  $('#neighborRows').innerHTML = res.neighbors.map((n) => `
    <tr>
      <td>${esc(n.aimag)}</td>
      <td class="n">${n.year}</td>
      <td class="n"><span class="lvl ${levelKey(n.risk_score).cls}" style="font-family:var(--mono)">${fmt1.format(n.risk_score)}</span></td>
      <td class="n">${fmt2.format(n.distance)}</td>
      <td class="n">${fmt1.format(n.weight_pct)}%</td>
    </tr>`).join('');

  const warnWrap = $('#warningsWrap');
  warnWrap.innerHTML = res.warnings?.length
    ? `<div class="warnbox">${res.warnings.map((w) => `<div class="note"><b>Анхааруулга.</b> ${esc(w)}</div>`).join('')}</div>`
    : '';

  const boosts = res.factors.filter((f) => f.effect >= 1).slice(0, 2);
  const shortLabel = (s) => esc(String(s).replace(/\s*\([^)]*\)\s*$/, ''));
  $('#findSummary').innerHTML = boosts.length
    ? `Эрсдэлд хамгийн их нөлөөлж буй хүчин зүйл: ${boosts.map((f) => `<b>${shortLabel(f.label)}</b>`).join(', ')}. Дараах арга хэмжээг тэргүүлэхийг зөвлөж байна.`
    : 'Оруулсан утгууд түүхэн медианаас ихээхэн зөрүүгүй байна. Дараах хяналтын арга хэмжээг баримтална уу.';

  $('#findList').innerHTML = res.recommendations.map((r, i) => {
    const lead = i === 0 && r.level !== 'low';
    return `
    <li class="${lead ? 'lead' : ''}">
      <i class="${esc(r.level || '')}">${i + 1}</i>
      <div>
        <span class="tag">${esc(r.tag)}</span>${lead ? '<span class="leadtag">Тэргүүлэх</span>' : ''}
        <p>${esc(r.text)}</p>
      </div>
    </li>`;
  }).join('');

  const scenWrap = $('#scenarioCard');
  if (res.scenarios?.length) {
    scenWrap.hidden = false;
    const mae = state.meta?.metrics?.unseen_aimag_cv?.MAE ?? 5;
    const noise = Math.max(1, mae);
    const bestKey = res.scenarios.find((s) => s.delta <= -noise)?.key;
    $('#scenarioNote').innerHTML = `Одоогийн утгаас нэг үзүүлэлтийг өөрчилбөл эрсдэлийн оноо хэр өөрчлөгдөхийг тооцов. Загварын дундаж алдаа ${fmt1.format(mae)} оноо тул үүнээс бага зөрүүг «≈» гэж тэмдэглэв. «Турших» дарж бүрэн дүнг гаргуулна.`;
    $('#scenarioList').innerHTML = res.scenarios.map((s) => {
      const signif = Math.abs(s.delta) >= noise;
      const cls = !signif ? 'flat' : s.delta < 0 ? 'down' : 'up';
      const ds = !signif ? '≈' : s.delta < 0 ? '−' : '+';
      return `<div class="scen${s.key === bestKey ? ' best' : ''}">
        <div class="scenmain"><b>${esc(s.label)}${s.key === bestKey ? '<span class="besttag">Хамгийн үр дүнтэй</span>' : ''}</b><span>${esc(s.detail)}</span></div>
        <div class="scenscore"><b class="${levelMeta(s.score).cls}">${fmt1.format(s.score)}</b><span class="dchip ${cls}">${ds}${fmt1.format(Math.abs(s.delta))}</span></div>
        <button type="button" class="btn tiny scenbtn" data-scen="${esc(s.key)}">Турших</button>
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
    $('#modelFoot').textContent = `Загвар: KNN · k=${res.k} · 20% тестийн MAE ${fmt1.format(m.MAE)} · ангиллын нарийвчлал ${Math.round(m.class_accuracy * 100)}% · ${meta.n_samples} ажиглалт`;
  }

  const toMap = $('#toMapBtn');
  toMap.hidden = !res.preset;
  if (res.preset) toMap.textContent = `${res.preset.aimag} · ${res.preset.year} газрын зураг дээр`;
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
    $('#mapEmpty').textContent = 'Газрын зургийн өгөгдөл ачаалагдсангүй.';
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
    p.setAttribute('aria-label', a.name);
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
    t.textContent = a.name;
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
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    $$('#mapShapes .reg').forEach((p) => {
      p.classList.toggle('dim', Boolean(q) && !p.dataset.name.toLowerCase().includes(q));
    });
  });
  search.addEventListener('change', () => {
    const q = search.value.trim().toLowerCase();
    const hit = MN_MAP.aimags.find((a) => a.name.toLowerCase() === q)
      || MN_MAP.aimags.find((a) => a.name.toLowerCase().startsWith(q));
    if (hit) {
      selectAimag(hit.name);
      search.value = hit.name;
      $$('#mapShapes .reg').forEach((p) => p.classList.remove('dim'));
    }
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim().toLowerCase();
    const hit = MN_MAP.aimags.find((a) => a.name.toLowerCase().includes(q));
    if (hit) {
      selectAimag(hit.name);
      search.value = hit.name;
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
  if (!row) {
    tip.innerHTML = `<b>${esc(name)}</b><div class="tiprow"><span class="tiplvl">Өгөгдөл байхгүй</span></div>`;
  } else {
    const v = valueOf(row);
    const l = levelMeta(v);
    tip.innerHTML = `<b>${esc(name)}</b><div class="tiprow"><strong>${fmt1.format(v)}</strong><span class="tiplvl">оноо · ${l.mn}</span></div>`;
  }
  tip.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  const tip = $('#mapTip');
  if (tip.style.display !== 'block') return;
  const box = $('#mapBox').getBoundingClientRect();
  const w = tip.offsetWidth;
  let left = e.clientX - box.left + 14;
  if (left + w > box.width - 8) left = e.clientX - box.left - w - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, e.clientY - box.top - tip.offsetHeight - 10)}px`;
}
function hideTip() {
  $('#mapTip').style.display = 'none';
}

function selectAimag(name, scroll = true) {
  state.selected = name;
  renderAll();
  syncUrl();
  if (scroll && window.matchMedia('(max-width: 1180px)').matches) {
    $('#sidePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setYear(year) {
  if (!state.years.includes(year)) return;
  state.year = year;
  $('#mapYear').value = String(year);
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
}

function renderMapLabels() {
  const sub = $('#mapSub');
  if (!state.year) return;
  sub.textContent = `${state.year} он · 21 аймаг`;
  $('#rankYear').textContent = `${state.year} · оноогоор`;
  $('#tableYear').textContent = `${state.year} он`;
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
      p.setAttribute('aria-label', `${p.dataset.name} — өгөгдөл байхгүй`);
      return;
    }
    const v = valueOf(row);
    p.style.fill = riskColor(v);
    p.classList.remove('nodata');
    p.classList.toggle('sel', state.selected === p.dataset.name);
    p.setAttribute('aria-label', `${p.dataset.name}: ${fmt1.format(v)} оноо, ${levelMeta(v).mn} эрсдэл`);
  });
  const sel = $('#mapShapes .reg.sel');
  if (sel) $('#mapShapes').appendChild(sel);
  $$('#mapLabels .reglabel').forEach((t) => {
    t.classList.toggle('sel', t.dataset.name === state.selected);
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
  const meanDelta = dMean === null ? '' :
    `<span class="kpidelta ${cls(dMean)}">${fmt1.format(dMean)} өмнөх жилээс</span>`;
  const highDelta = dHigh === null ? '' :
    `<span class="kpidelta ${cls(dHigh)}">${dHigh > 0 ? '+' : ''}${dHigh} аймаг өмнөх жилээс</span>`;

  $('#mapKpis').innerHTML = `
    <div class="kpi"><small>Улсын дундаж</small><b class="${l.cls}">${fmt1.format(mean)}</b><span>${l.mn} эрсдэл · ${state.year} он</span>${meanDelta}</div>
    <div class="kpi"><small>Өндөр эрсдэлтэй</small><b>${highCount}<span style="font-size:16px;color:var(--muted)"> / ${rows.length}</span></b><span>65-аас дээш оноо</span>${highDelta}</div>
    <div class="kpi"><small>Хамгийн өндөр</small><b class="high" style="font-size:22px">${esc(top.aimag)}</b><span>${fmt1.format(valueOf(top))} оноо</span></div>
    <div class="kpi"><small>Хамгийн бага</small><b class="low" style="font-size:22px">${esc(low.aimag)}</b><span>${fmt1.format(valueOf(low))} оноо</span></div>`;
}

function renderTrend() {
  const box = $('#trendStrip');
  if (!box) return;
  const vals = state.years.map((y) => [y, state.nationalByYear[y] ?? meanOfYear(y)]);
  const lo = Math.min(...vals.map((v) => v[1]));
  const hi = Math.max(...vals.map((v) => v[1]));
  const span = Math.max(1, hi - lo);
  box.innerHTML = vals.map(([y, v]) => {
    const h = 14 + ((v - lo) / span) * 58;
    const on = y === state.year;
    return `<button type="button" class="tbar${on ? ' sel' : ''}" data-year="${y}" title="${y} он: улсын дундаж ${fmt1.format(v)} оноо"
      aria-label="${y} он, улсын дундаж ${fmt1.format(v)} оноо" aria-pressed="${on}">
      <i style="height:${h}%;background:${riskColor(v)}"></i><span>${String(y).slice(2)}</span></button>`;
  }).join('');
  const cur = state.nationalByYear[state.year] ?? meanOfYear(state.year);
  $('#trendHint').textContent = `${state.year} он · ${fmt1.format(cur)} оноо`;
  $$('#trendStrip .tbar').forEach((b) => {
    b.addEventListener('click', () => setYear(Number(b.dataset.year)));
  });
}

function renderRank() {
  const rows = rowsForYear(state.year).sort((a, b) => valueOf(b) - valueOf(a));
  const shown = rows.slice(0, 8);
  $('#rankList').innerHTML = shown.map((r, i) => `
    <button type="button" class="rankrow ${state.selected === r.aimag ? 'sel' : ''}" data-name="${esc(r.aimag)}">
      <span class="rk">${i + 1}</span>
      <span class="nm">${esc(r.aimag)}</span>
      <span class="sc">${fmt1.format(valueOf(r))}</span>
      <span class="track"><i style="width:${clamp(valueOf(r), 2, 100)}%;background:${riskColor(valueOf(r))}"></i></span>
    </button>`).join('') + (rows.length > shown.length
      ? `<button type="button" class="rankmore" id="rankMore">Бүх ${rows.length} аймгийг хүснэгтээс харах ↓</button>`
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
      <tr tabindex="0" data-name="${esc(r.aimag)}" class="${state.selected === r.aimag ? 'sel' : ''}" aria-label="${esc(r.aimag)}, ${fmt1.format(r.score)} оноо">
        <td class="n">${i + 1}</td>
        <td><b>${esc(r.aimag)}</b></td>
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
    .map((i) => `<text class="chartaxis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${years[i]}</text>`).join('');
  const dots = rows.map((r, i) => {
    if (!r) return '';
    return `<circle class="chartdot ${i === selIdx ? 'sel' : ''}" cx="${x(i)}" cy="${y(r.score)}" r="${i === selIdx ? 3.4 : 1.8}"><title>${years[i]}: ${fmt1.format(r.score)} оноо</title></circle>`;
  }).join('');
  const now = selIdx >= 0 && rows[selIdx]
    ? `<line class="chartnow" x1="${x(selIdx)}" y1="${pt}" x2="${x(selIdx)}" y2="${H - pb}"></line>` : '';

  return `
    <div class="chartbox">
      <div class="ch">
        <span>${state.years[0]}–${state.years[state.years.length - 1]} оны түүх</span>
        <span>оноо / 100</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} аймгийн эрсдэлийн түүх">
        ${grid}${now}${axis}${ticks}
        <path class="chartline" d="${line(actual)}"></path>
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
        <h2>Аймаг сонгоно уу</h2>
        <p class="muted">Зураг дээрх аймаг дээр дарж эсвэл доорх жагсаалтаас сонгож, тухайн жилийн үзүүлэлт, 2010–2025 оны түүхийг харна уу.</p>
        <div class="introstats">
          <div><span>${state.year} оны дундаж</span><b style="color:${l.color}">${fmt1.format(mean)}</b></div>
          <div><span>Ажиглалт</span><b>${state.data?.rows.length ?? 0}</b></div>
          <div><span>Хамрах жил</span><b>${state.years.length}</b></div>
        </div>
      </div>`;
    return;
  }

  if (!row) {
    panel.innerHTML = `
      <div class="sidehead">
        <div><h2>${esc(name)}</h2><p class="sub">${state.year} он</p></div>
        <button type="button" class="iconbtn" id="clearSel" aria-label="Сонголтыг цэвэрлэх">×</button>
      </div>
      <p class="note" style="margin-top:14px">Энэ нутаг дэвсгэрийн хувьд өгөгдлийн санд бэлчээрийн үзүүлэлт байхгүй тул эрсдэл тооцогдоогүй.</p>`;
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
        <div class="t"><span>${label}</span><span>${fmt(row[key])}</span></div>
        <div class="track"><i style="width:${w}%"></i></div>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="sidehead">
      <div><h2>${esc(name)}</h2><p class="sub">${state.year} он · ${rank}-р байр / ${rows.length}</p></div>
      <button type="button" class="iconbtn" id="clearSel" aria-label="Сонголтыг цэвэрлэх">×</button>
    </div>
    <div class="sidescore">
      <b style="color:${l.color}">${fmt1.format(row.score)}</b>
      ${levelBadge(row.score)}
      <span class="delta ${dCls}" title="Өмнөх жилийн оноотой харьцуулсан">${dTxt}</span>
    </div>
    <p class="sidesub">Улсын дундаж ${fmt1.format(mean)}</p>
    <div class="metricbars">${bars}</div>
    ${historyChart(name)}
    <button type="button" class="btn primary block" id="useAimag">Энэ аймгийн утгаар тооцох</button>`;

  $('#clearSel').addEventListener('click', () => { state.selected = null; renderAll(); });
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
  $('#modelChip').setAttribute('title', 'Загварын дэлгэрэнгүйг харах');
  $('#modelBox').innerHTML = `
    <div><small>Алгоритм</small><b>KNN регрессор</b></div>
    <div><small>k</small><b>${state.meta.best_params.n_neighbors}</b></div>
    <div><small>MAE</small><b>${fmt1.format(m.MAE)}</b></div>
    <div><small>Нарийвчлал</small><b>${Math.round(m.class_accuracy * 100)}%</b></div>
    <div><small>Ажиглалт</small><b>${state.meta.n_samples}</b></div>
    <div><small>Жил</small><b>${state.meta.years[0]}–${state.meta.years[1]}</b></div>
    <div style="grid-column:1/-1"><small>Шинж чанарууд</small><b>${Object.values(labels).map(esc).join(' · ')}</b></div>`;
  $('#modelNote').textContent = `Загварыг өгөгдлийн 80%-д сургаж, 20%-д шалгасан. KNN нь шалтгаан-үр дагаврыг биш, түүхэн ижил төстэй байдлыг хэмждэг.`;
}

function fillSelects() {
  const aimagSel = $('#presetAimag');
  aimagSel.innerHTML = '<option value="">Аймаг сонгох…</option>'
    + state.aimags.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

  const yearSel = $('#presetYear');
  yearSel.innerHTML = state.years.slice().reverse()
    .map((y) => `<option value="${y}"${y === state.latestYear ? ' selected' : ''}>${y}</option>`).join('');

  const mapYear = $('#mapYear');
  mapYear.innerHTML = state.years.slice().reverse()
    .map((y) => `<option value="${y}"${y === state.latestYear ? ' selected' : ''}>${y}</option>`).join('');
  mapYear.addEventListener('change', (e) => setYear(Number(e.target.value)));

  $('#aimagOptions').innerHTML = state.aimags.map((a) => `<option value="${esc(a)}"></option>`).join('');
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

async function init() {
  initNav();
  initForm();
  buildMap();

  $('#modelChip').classList.add('busy');
  try {
    const [meta, data] = await Promise.all([api('/api/model-info'), api('/api/dataset')]);
    state.meta = meta;
    state.data = data;
    state.years = data.years.slice().sort((a, b) => a - b);
    state.latestYear = data.latest_year;
    state.aimags = data.aimags.slice().sort((a, b) => a.localeCompare(b, 'mn'));
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
    $('#mapEmpty').hidden = true;
    applyUrlState();

    // анхны зураг дээр хамгийн өндөр эрсдэлтэй аймгийг сонгохгүй, гэхдээ KPI-г харуулна
  } catch (err) {
    const box = $('#apiError');
    box.hidden = false;
    box.innerHTML = `<b>Өгөгдөл ачаалагдсангүй.</b> ${esc(err.message)}. Терминалд <code>python app.py</code> ажиллуулаад <code>http://127.0.0.1:5000</code> хаягаар нээнэ үү.`;
    const chip = $('#modelChip');
    chip.textContent = 'Загвар ачаалагдсангүй';
    chip.classList.remove('busy');
    chip.classList.add('bad');
    $('#predictBtn').disabled = true;
    $('#mapEmpty').textContent = 'Газрын зургийн өгөгдөл ачаалагдсангүй.';
    $('#mapEmpty').hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
