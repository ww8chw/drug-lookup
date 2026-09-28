// 搜尋邏輯（純函式，瀏覽器與 node 測試共用）
// 藥品物件欄位見 scripts/merge.py：col[] shp scr impn[] be bz gen nhi[] lic own nhiA ph[]

export function normImprint(s) {
  return (s || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const SHAPE_GROUP = { '多邊形': ['五邊形', '六邊形', '八邊形'] };

function shapeMatch(shapes, shp) {
  for (const s of shapes) {
    if (s === shp) return true;
    if (SHAPE_GROUP[s] && SHAPE_GROUP[s].includes(shp)) return true;
  }
  return false;
}

// q = {colors:Set, shapes:Set, scores:Set, imprint:''}
// 只填刻字時忽略其他條件；各條件之間 AND、同條件內 OR；多色藥命中任一色即可
export function filterDrugs(drugs, q) {
  const imp = normImprint(q.imprint);
  const colors = q.colors || new Set();
  const shapes = q.shapes || new Set();
  const scores = q.scores || new Set();
  const onlyImprint = imp && !colors.size && !shapes.size && !scores.size;
  if (!imp && !colors.size && !shapes.size && !scores.size) return [];
  return drugs.filter((d) => {
    if (imp && !(d.impn || []).some((k) => k.includes(imp))) return false;
    if (onlyImprint) return true;
    if (colors.size && !(d.col || []).some((c) => colors.has(c))) return false;
    if (shapes.size && !shapeMatch(shapes, d.shp)) return false;
    if (scores.size && !scores.has(d.scr)) return false;
    return true;
  });
}

// 本院有 > 現行健保 > 有照片 > 商品名
export function rankDrugs(list) {
  const score = (d) => (d.own ? 4 : 0) + (d.nhiA ? 2 : 0) + ((d.ph || []).length ? 1 : 0);
  return [...list].sort((a, b) => score(b) - score(a) || (a.be || a.bz || '').localeCompare(b.be || b.bz || ''));
}

function hay(d) {
  if (!d._hay) {
    d._hay = [d.be, d.bz, d.gen, d.lic, ...(d.nhi || []), d.cls].join(' ').normalize('NFKC').toUpperCase();
  }
  return d._hay;
}

// 空白分詞、每個詞都要出現（AND）；商品名開頭命中排前面
export function nameSearch(drugs, text) {
  const terms = (text || '').normalize('NFKC').toUpperCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = drugs.filter((d) => terms.every((t) => hay(d).includes(t)));
  const first = terms[0];
  const starts = (d) => ((d.be || '').toUpperCase().startsWith(first) || (d.gen || '').toUpperCase().startsWith(first) || (d.bz || '').startsWith(first) ? 1 : 0);
  return rankDrugs(hits).sort((a, b) => starts(b) - starts(a));
}
