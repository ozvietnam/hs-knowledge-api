// API: /api/kg_search?q=bàn+là&limit=10&canh_bao=ORANGE
// Tìm kiếm trong knowledge graph index

import indexData from '../data/kg_index.json';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { q, limit = '20', canh_bao, loai_khac, chapter } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Tham số q phải có ít nhất 2 ký tự' });
  }

  const keyword = q.trim().toLowerCase();
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const isHSQuery = /^\d{4,}/.test(keyword);

  let results = indexData.filter(item => {
    if (canh_bao && item.muc_canh_bao !== canh_bao) return false;
    if (loai_khac === '1' && !item.la_hang_loai_khac) return false;
    if (chapter && item.chapter !== parseInt(chapter)) return false;
    if (isHSQuery) return item.hs.startsWith(keyword.replace(/\./g, ''));
    return item.vn.toLowerCase().includes(keyword);
  }).slice(0, limitNum);

  return res.status(200).json({
    keyword: q,
    total: results.length,
    filters: { canh_bao, loai_khac, chapter },
    results
  });
}
