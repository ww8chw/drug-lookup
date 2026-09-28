import { filterDrugs, rankDrugs, nameSearch } from './search.js';
import { deriveKey, decrypt, gunzipText, rememberKey, loadKey, forgetKey } from './crypto.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HOSP = {
  fda: '食藥署', vghtc: '台中榮總', vghks: '高雄榮總', kmuh: '高醫', femh: '亞東', fjuh: '輔大', cch: '彰基',
  csh: '中山醫', ntuh: '台大', cgmh: '長庚', mmh: '馬偕', cmuh: '中國醫', cgh: '國泰',
};
const COLORS = [['白', '#ffffff'], ['黃', '#f2d24b'], ['橘', '#f0973b'], ['粉', '#f4b6c8'], ['紅', '#d9412f'],
  ['棕', '#8a5a33'], ['綠', '#3f9a54'], ['藍綠', '#2aa198'], ['藍', '#3b78c9'], ['紫', '#8a55b5'],
  ['灰', '#9aa1a8'], ['黑', '#222'], ['透明', '']];
const S = 'fill="none" stroke="#56606b" stroke-width="1.6"';
const SHAPES = [
  ['圓形', `<circle cx="9" cy="7" r="5.5" ${S}/>`],
  ['橢圓形', `<ellipse cx="9" cy="7" rx="8" ry="5" ${S}/>`],
  ['膠囊', `<rect x="1" y="3" width="16" height="8" rx="4" ${S}/><line x1="9" y1="3" x2="9" y2="11" ${S}/>`],
  ['四邊形', `<rect x="3" y="1.5" width="12" height="11" rx="1.5" ${S}/>`],
  ['三角形', `<path d="M9 1.5 L16 12.5 L2 12.5 Z" ${S}/>`],
  ['多邊形', `<path d="M5 1.5 L13 1.5 L17 7 L13 12.5 L5 12.5 L1 7 Z" ${S}/>`],
  ['水滴形', `<path d="M3 7 Q3 2 9 1.5 Q16 2 16 7 Q16 12 9 12.5 Q3 12 3 7 Z M3 7 L1 7" ${S}/>`],
  ['雙圓形', `<circle cx="6" cy="7" r="4.5" ${S}/><circle cx="12" cy="7" r="4.5" ${S}/>`],
  ['其他', `<path d="M9 2 L11 6 L16 6.5 L12 9.5 L13 13 L9 11 L5 13 L6 9.5 L2 6.5 L7 6 Z" ${S}/>`],
];
const SCORES = [['無', '無'], ['直線', '一字'], ['十字', '十字']];
const PAGE = 60;

let META = null;
let KEY = null;
let DRUGS = [];
const imgCache = new Map();

// ---------- 解密與載入 ----------
const KEYNAME = () => 'drug-key-' + META.salt.slice(0, 8);
const base = (p) => (META.base || '') + p;

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下載失敗 ' + r.status);
  return r.arrayBuffer();
}

async function openData(key) {
  let buf;
  try { buf = await fetchBuf(META.data_cdn || base(META.data)); } catch (e) { buf = await fetchBuf(base(META.data) + '?v=' + META.ver); }
  const plain = await decrypt(key, buf);
  return JSON.parse(await gunzipText(plain));
}

function imgURL(path) {
  if (!imgCache.has(path)) {
    imgCache.set(path, fetchBuf(base(path))
      .then((b) => decrypt(KEY, b))
      .then((p) => URL.createObjectURL(new Blob([p], { type: 'image/webp' })))
      .catch(() => ''));
  }
  return imgCache.get(path);
}

// 卡片圖進入畫面才解密
const io = new IntersectionObserver((ents) => {
  for (const e of ents) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const img = e.target;
    imgURL(img.dataset.p).then((u) => { if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('span'), { className: 'none', textContent: '照片載入失敗' })); });
  }
}, { rootMargin: '300px' });

// ---------- 卡片 ----------
function lookText(d) {
  const parts = [];
  if (d.imp && d.imp.length) parts.push('刻字 ' + d.imp.join(' / '));
  const look = [(d.col || []).join('') , d.shp].filter(Boolean).join('');
  if (look) parts.push(look);
  if (d.scr && d.scr !== '無') parts.push(d.scr === '直線' ? '一字刻痕' : '十字刻痕');
  return parts.map(esc).join(' · ') + (d.imps === 'AI判讀' ? '<span class="ai">刻字為 AI 判讀</span>' : '');
}

function card(d) {
  const p = d.ph && d.ph[0];
  const img = p ? `<img alt="" data-p="${esc(p.t)}">` : '<span class="none">無照片</span>';
  return `<button class="card" data-id="${esc(d.id)}">
    <div class="ph">${img}${p ? `<span class="badge src">${esc(HOSP[p.s] || p.s)}</span>` : ''}${d.own ? '<span class="badge own">本院有</span>' : ''}</div>
    <div class="tx">
      <div class="bn">${esc(d.be || d.bz)}</div>
      ${d.be && d.bz ? `<div class="bz">${esc(d.bz)}</div>` : ''}
      <div class="gn">${esc(d.gen)}</div>
      ${d.cls ? `<span class="cl">${esc(d.cls)}</span>` : ''}
      ${d.act ? `<div class="ac">${esc(d.act)}</div>` : ''}
      <div class="mt">${lookText(d)}</div>
    </div></button>`;
}

function makeList(prefix) {
  let items = [];
  let shown = 0;
  const res = $(prefix + '-res');
  const more = $(prefix + '-more');
  function renderMore() {
    const next = items.slice(shown, shown + PAGE);
    res.insertAdjacentHTML('beforeend', next.map(card).join(''));
    shown += next.length;
    res.querySelectorAll('img[data-p]:not([src])').forEach((i) => io.observe(i));
    more.hidden = shown >= items.length;
  }
  more.onclick = renderMore;
  return (list, countText) => {
    items = list;
    shown = 0;
    res.innerHTML = '';
    $(prefix + '-count').textContent = countText;
    renderMore();
  };
}

// ---------- 詳細 ----------
async function openDetail(id) {
  const d = DRUGS.find((x) => x.id === id);
  if (!d) return;
  const ph = d.ph || [];
  const links = (d.links || []).map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener noreferrer">${esc(HOSP[l.h] || l.h)} ↗</a>`).join('');
  $('dlg-body').innerHTML = `<div class="dt">
    <div class="gal">
      <div class="big">${ph.length ? '<img id="bigimg" alt="">' : '<span class="none">無照片</span>'}<span class="src" id="bigsrc"></span></div>
      ${ph.length > 1 ? `<div class="thumbs">${ph.map((p, i) => `<button data-i="${i}"><img alt="" data-t="${esc(p.t)}"></button>`).join('')}</div>` : ''}
    </div>
    <div class="info">
      <h2>${esc(d.be || d.bz)}</h2>
      ${d.be && d.bz ? `<div class="bz">${esc(d.bz)}</div>` : ''}
      <div class="gn">${esc(d.gen)}</div>
      ${d.cls ? `<span class="cl">${esc(d.cls)}</span>` : ''}${d.cls2 ? ` <span class="cl">${esc(d.cls2)}</span>` : ''}
      ${d.act ? `<div class="ac" style="margin-top:4px">${esc(d.act)}</div>` : ''}
      <dl>
        <dt>外觀</dt><dd>${lookText(d) || '—'}${d.size ? ` · ${esc(d.size)} mm` : ''}</dd>
        <dt>劑型</dt><dd>${esc(d.form) || '—'}</dd>
        <dt>ATC</dt><dd>${esc(d.atc) || '—'}</dd>
        <dt>許可證</dt><dd>${esc(d.lic) || '—'}</dd>
        <dt>健保碼</dt><dd>${esc((d.nhi || []).join('、')) || '—'}${d.nhiA ? '' : (d.lic ? '（非現行健保品項）' : '')}</dd>
        <dt>資料來源</dt><dd>${(d.src || []).map((s) => esc(HOSP[s] || s)).join('、')}</dd>
      </dl>
      ${d.ind ? `<div class="ind">${esc(d.ind)}</div>` : ''}
      ${links ? `<p class="links">去醫院網站看：${links}</p>` : ''}
    </div></div>`;
  $('dlg').showModal();
  const show = async (i) => {
    const big = $('bigimg');
    if (!big) return;
    $('bigsrc').textContent = HOSP[ph[i].s] || ph[i].s;
    document.querySelectorAll('.thumbs button').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    big.removeAttribute('src');
    const u = await imgURL(ph[i].l || ph[i].t);
    big.src = u || (await imgURL(ph[i].t));
  };
  document.querySelectorAll('.thumbs button').forEach((b) => { b.onclick = () => show(+b.dataset.i); });
  document.querySelectorAll('.thumbs img[data-t]').forEach(async (im) => { im.src = await imgURL(im.dataset.t); });
  if (ph.length) show(0);
}

// ---------- 外觀反查 ----------
const q = { colors: new Set(), shapes: new Set(), scores: new Set(), imprint: '' };
let showLook;

function chipRow(el, items, set, htmlFor) {
  el.innerHTML = items.map(([v, ...rest]) => `<button class="chip" data-v="${esc(v)}">${htmlFor(v, ...rest)}</button>`).join('');
  el.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.v;
      if (set.has(v)) set.delete(v); else set.add(v);
      b.classList.toggle('on', set.has(v));
      runLook();
    };
  });
}

function runLook() {
  q.imprint = $('imp').value;
  const any = q.imprint.trim() || q.colors.size || q.shapes.size || q.scores.size;
  $('look-hint').hidden = !!any;
  if (!any) { showLook([], ''); return; }
  const r = rankDrugs(filterDrugs(DRUGS, q));
  const onlyImp = q.imprint.trim() && !q.colors.size && !q.shapes.size && !q.scores.size;
  showLook(r, `符合 ${r.length} 項${onlyImp ? '（只依刻字）' : ''}${r.length ? ' · 本院有、健保現行品項排前面' : ' · 試著少選一個條件；刻字資料不完整，可改用顏色＋形狀'}`);
}

function initLook() {
  showLook = makeList('look');
  chipRow($('f-col'), COLORS, q.colors, (v, hex) => `<i class="dot${hex ? '' : ' clear'}" style="${hex ? `background:${hex}` : ''}"></i>${esc(v)}`);
  chipRow($('f-shp'), SHAPES, q.shapes, (v, svg) => `<svg viewBox="0 0 18 14">${svg}</svg>${esc(v)}`);
  chipRow($('f-scr'), SCORES, q.scores, (v, label) => esc(label));
  let t;
  $('imp').oninput = () => { clearTimeout(t); t = setTimeout(runLook, 150); };
  $('clear').onclick = () => {
    q.colors.clear(); q.shapes.clear(); q.scores.clear(); $('imp').value = '';
    document.querySelectorAll('#p-look .chip.on').forEach((b) => b.classList.remove('on'));
    runLook();
  };
}

// ---------- 名稱查詢／本院 ----------
function initName() {
  const show = makeList('name');
  let t;
  $('q').oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const text = $('q').value.trim();
      const r = nameSearch(DRUGS, text);
      show(r, text ? `找到 ${r.length} 項` : '');
    }, 150);
  };
  const own = DRUGS.filter((d) => d.own);
  if (own.length) {
    $('tab-own').hidden = false;
    const showOwn = makeList('own');
    const run = () => {
      const text = $('oq').value.trim();
      const r = text ? nameSearch(own, text) : rankDrugs(own);
      showOwn(r, `本院藥品 ${r.length} 項`);
    };
    $('oq').oninput = run;
    run();
  }
}

function initTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      for (const p of ['look', 'name', 'own']) $('p-' + p).hidden = p !== b.dataset.tab;
      const f = { look: 'imp', name: 'q', own: 'oq' }[b.dataset.tab];
      $(f).focus();
    };
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(c.dataset.id);
  });
  $('dlg-x').onclick = () => $('dlg').close();
  $('dlg').addEventListener('click', (e) => { if (e.target === $('dlg')) $('dlg').close(); });
  $('logout').onclick = () => { forgetKey(KEYNAME()); location.reload(); };
}

function start(data) {
  DRUGS = data.drugs;
  $('gate').hidden = true;
  $('app').hidden = false;
  $('meta').textContent = `${DRUGS.length.toLocaleString()} 項 · 資料更新 ${data.date}`;
  $('foot').innerHTML = `資料來源：${esc(data.sources)}<br>僅供醫療人員辨識參考，最終以實物與原始仿單為準。`;
  initLook(); initName(); initTabs();
  $('imp').focus();
}

// ---------- 啟動 ----------
(async () => {
  META = await fetch('meta.json?t=' + Date.now()).then((r) => r.json());
  const err = $('err');
  const go = $('go');
  const saved = await loadKey(KEYNAME());
  if (saved) {
    go.disabled = true; go.textContent = '開啟中…';
    try { KEY = saved; start(await openData(saved)); return; } catch (e) { forgetKey(KEYNAME()); KEY = null; go.disabled = false; go.textContent = '開啟'; }
  }
  $('gate').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = ''; go.disabled = true; go.textContent = '解密中…';
    try {
      const key = await deriveKey($('pw').value.trim(), META.salt, META.iter);
      const data = await openData(key);
      KEY = key;
      if ($('rem').checked) await rememberKey(KEYNAME(), key);
      start(data);
    } catch (x) {
      err.textContent = x && x.name === 'OperationError' ? '密碼不對，請再試一次' : '開啟失敗：' + (x && x.message || x);
      go.disabled = false; go.textContent = '開啟';
    }
  });
})();
