// pages/api/search.js
// 1 CALL = QUÉT 4 NGUỒN: biểu thuế + TB-TCHQ + bao_gom/SEN + conflict
// Hỗ trợ tiếng Việt có dấu & không dấu

const CDN_BASE = process.env.PRODUCTION_URL
  || 'https://hs-knowledge-api.vercel.app';

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function textMatch(text, kw, kwNorm) {
  const lower = text.toLowerCase();
  if (lower.includes(kw)) return true;
  return removeDiacritics(lower).includes(kwNorm);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q, limit = '20', canh_bao, loai_khac, chapter } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Tham số q phải có ít nhất 2 ký tự' });
  }

  try {
    // Fetch 4 index song song
    const [r1, r2, r3, r4] = await Promise.all([      fetch(`${CDN_BASE}/kg/kg_index.json`),
      fetch(`${CDN_BASE}/kg/tb_tchq_index.json`),
      fetch(`${CDN_BASE}/kg/bao_gom_index.json`),
      fetch(`${CDN_BASE}/kg/conflict_index.json`)
    ]);

    const bieuThue = r1.ok ? await r1.json() : [];
    const tbTchq   = r2.ok ? await r2.json() : [];
    const baoGom   = r3.ok ? await r3.json() : [];
    const conflict = r4.ok ? await r4.json() : [];

    const kw = q.trim().toLowerCase();
    const kwNorm = removeDiacritics(kw);
    const lim = Math.min(parseInt(limit) || 20, 100);
    const isHS = /^\d{4,}/.test(kw);

    // 1. Biểu thuế
    const btResults = bieuThue.filter(item => {
      if (canh_bao && item.muc_canh_bao !== canh_bao) return false;
      if (loai_khac === '1' && !item.la_hang_loai_khac) return false;
      if (chapter && item.chapter !== parseInt(chapter)) return false;
      if (isHS) return item.hs.startsWith(kw.replace(/\./g, ''));
      return textMatch(item.vn, kw, kwNorm);
    }).slice(0, lim);
    // 2. TB-TCHQ — search tên sản phẩm + tên kỹ thuật
    const tbResults = isHS ? [] : tbTchq.filter(tb =>
      textMatch(tb.ten_sp || '', kw, kwNorm) ||
      textMatch(tb.ten_kt || '', kw, kwNorm)
    ).slice(0, lim);

    // 3. Bao gồm / SEN — search trong chú giải liệt kê hàng hóa
    const bgResults = isHS ? [] : baoGom.filter(bg =>
      textMatch(bg.t || '', kw, kwNorm)
    ).map(bg => {
      const lower = bg.t.toLowerCase();
      const idx = lower.indexOf(kw) >= 0 ? lower.indexOf(kw) : removeDiacritics(lower).indexOf(kwNorm);
      const start = Math.max(0, idx - 30);
      const end = Math.min(bg.t.length, idx + kw.length + 80);
      return { hs: bg.hs, snippet: '...' + bg.t.slice(start, end) + '...' };
    }).slice(0, lim);

    // 4. Conflict — mã dễ nhầm (chỉ search khi query là mã HS)
    const cfResults = !isHS ? [] : conflict.filter(cf =>
      cf.hs.startsWith(kw.replace(/\./g, '')) ||
      (cf.ma_de_nham || []).some(m => m.startsWith(kw.replace(/\./g, '')))
    ).slice(0, 10);

    return res.status(200).json({
      keyword: q,
      bieu_thue: { total: btResults.length, results: btResults },
      tb_tchq: tbResults.length > 0 ? { total: tbResults.length, results: tbResults } : undefined,
      chu_giai_bao_gom: bgResults.length > 0 ? { total: bgResults.length, results: bgResults } : undefined,
      conflict: cfResults.length > 0 ? { total: cfResults.length, results: cfResults } : undefined,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Lỗi search', detail: e.message });
  }
}