// pages/api/search.js
// v2.0 — Multi-source search + Multi-keyword AND matching
import fs from 'fs';
import path from 'path';

// Helper: multi-keyword AND match
function multiKeywordMatch(text, keywords) {
  const lowerText = text.toLowerCase();
  return keywords.every(kw => lowerText.includes(kw));
}

// Helper: extract snippet around first keyword match
function extractSnippet(text, keywords, maxLen = 120) {
  const lowerText = text.toLowerCase();
  let firstIdx = -1;
  for (const kw of keywords) {
    const idx = lowerText.indexOf(kw);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }
  if (firstIdx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, firstIdx - 30);
  const end = Math.min(text.length, firstIdx + maxLen - 30);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { q, limit = '20', canh_bao, loai_khac, chapter, source } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      error: 'Tham số q phải có ít nhất 2 ký tự',
      sources: ['bieu_thue', 'tb_tchq', 'bao_gom', 'conflict'],
      vi_du: '/api/search?q=bàn+chải+điện&limit=10'
    });
  }

  const keyword = q.trim().toLowerCase();
  const keywords = keyword.split(/\s+/).filter(w => w.length >= 1);
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const isHSQuery = /^\d{4,}/.test(keyword);

  const validSources = ['bieu_thue', 'tb_tchq', 'bao_gom', 'conflict'];
  const requestedSources = source
    ? source.split(',').filter(s => validSources.includes(s))
    : validSources;

  const response = {
    keyword: q,
    search_mode: keywords.length > 1 ? 'multi_keyword_AND' : 'substring',
    sources_searched: requestedSources,
    results: {}
  };

  try {
    // ── SOURCE 1: Biểu thuế (kg_index.json) ──
    if (requestedSources.includes('bieu_thue')) {
      const indexPath = path.join(process.cwd(), 'data', 'kg_index.json');
      const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      const btResults = indexData.filter(item => {
        if (canh_bao && item.muc_canh_bao !== canh_bao) return false;
        if (loai_khac === '1' && !item.la_hang_loai_khac) return false;
        if (chapter && item.chapter !== parseInt(chapter)) return false;
        if (isHSQuery) return item.hs.startsWith(keyword.replace(/\./g, ''));
        return multiKeywordMatch(item.vn, keywords);
      }).slice(0, limitNum);

      response.results.bieu_thue = { total: btResults.length, items: btResults };
    }

    // ── SOURCE 2: TB-TCHQ (tb_tchq_index.json) ──
    if (requestedSources.includes('tb_tchq')) {
      const tbPath = path.join(process.cwd(), 'data', 'tb_tchq_index.json');
      if (fs.existsSync(tbPath)) {
        const tbData = JSON.parse(fs.readFileSync(tbPath, 'utf8'));
        const tbResults = tbData.filter(item => {
          const searchText = [item.hs || '', item.ten_sp || '', item.ten_kt || '', item.so_hieu || '', item.ma_hs || ''].join(' ').toLowerCase();
          if (isHSQuery) return (item.hs || '').startsWith(keyword.replace(/\./g, ''));
          return multiKeywordMatch(searchText, keywords);
        }).slice(0, limitNum);
        response.results.tb_tchq = { total: tbResults.length, items: tbResults };
      } else {
        response.results.tb_tchq = { total: 0, items: [], note: 'Index chưa có' };
      }
    }

    // ── SOURCE 3: Bao gồm / SEN (bao_gom_index.json) ──
    if (requestedSources.includes('bao_gom')) {
      const bgPath = path.join(process.cwd(), 'data', 'bao_gom_index.json');
      if (fs.existsSync(bgPath)) {
        const bgData = JSON.parse(fs.readFileSync(bgPath, 'utf8'));
        const bgResults = bgData.filter(item => {
          const searchText = (item.t || '').toLowerCase();
          if (isHSQuery) return (item.hs || '').startsWith(keyword.replace(/\./g, ''));
          return multiKeywordMatch(searchText, keywords);
        }).slice(0, limitNum).map(item => ({
          ...item,
          snippet: extractSnippet(item.t || '', keywords)
        }));
        response.results.bao_gom = { total: bgResults.length, items: bgResults };
      } else {
        response.results.bao_gom = { total: 0, items: [], note: 'Index chưa có' };
      }
    }

    // ── SOURCE 4: Conflict (conflict_index.json) ──
    if (requestedSources.includes('conflict')) {
      const cfPath = path.join(process.cwd(), 'data', 'conflict_index.json');
      if (fs.existsSync(cfPath)) {
        const cfData = JSON.parse(fs.readFileSync(cfPath, 'utf8'));
        const cfResults = cfData.filter(item => {
          const searchText = [item.hs || '', item.ly_do || '', item.mau_thuan || '', (item.ma_de_nham || []).join(' ')].join(' ').toLowerCase();
          if (isHSQuery) return (item.hs || '').startsWith(keyword.replace(/\./g, ''));
          return multiKeywordMatch(searchText, keywords);
        }).slice(0, limitNum);
        response.results.conflict = { total: cfResults.length, items: cfResults };
      } else {
        response.results.conflict = { total: 0, items: [], note: 'Index chưa có' };
      }
    }

    // Summary
    const totalAll = Object.values(response.results).reduce((sum, r) => sum + r.total, 0);
    response.total_all_sources = totalAll;

    return res.status(200).json(response);

  } catch (e) {
    return res.status(500).json({ error: 'Lỗi đọc index', detail: e.message });
  }
}
