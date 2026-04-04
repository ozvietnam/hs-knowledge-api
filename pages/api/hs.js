// pages/api/hs.js — tra cứu 9 tầng theo mã HS
// Fetch data from Vercel static CDN (public/kg/) via absolute URL

export const config = {
  api: { responseLimit: '8mb' },
};

// Production URL - static files served from CDN
const CDN_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { hs, fields } = req.query;
  if (!hs) {
    return res.status(400).json({
      error: 'Thiếu tham số hs. Ví dụ: /api/hs?hs=85167100',
      tip: 'Thêm ?fields=fact_layer,legal_layer để lấy tầng cụ thể'
    });
  }

  const code = hs.replace(/\./g, '').trim().padEnd(8, '0').slice(0, 8);
  const chapter = String(parseInt(code.slice(0, 2))).padStart(2, '0');

  try {
    const dataUrl = `${CDN_BASE}/kg/chapter_${chapter}.json`;
    const response = await fetch(dataUrl, {
      headers: { 'User-Agent': 'hs-knowledge-api-internal' }
    });

    if (!response.ok) {
      return res.status(404).json({ error: `Chapter ${chapter} không tồn tại`, debug_url: dataUrl });
    }

    const chapterData = await response.json();
    const record = chapterData[code];

    if (!record) {
      const prefix6 = code.slice(0, 6);
      const related = Object.entries(chapterData)
        .filter(([k]) => k.startsWith(prefix6))
        .slice(0, 5)
        .map(([k, v]) => ({ hs: k, vn: v.fact_layer.vn }));
      return res.status(404).json({
        found: false,
        message: `Không tìm thấy mã ${code}`,
        go_y_ma_lien_quan: related
      });
    }

    if (fields) {
      const fieldList = fields.split(',').map(f => f.trim());
      const filtered = { hs: record.hs, chapter: record.chapter };
      fieldList.forEach(f => { if (record[f]) filtered[f] = record[f]; });
      return res.status(200).json({ found: true, ...filtered });
    }

    return res.status(200).json({ found: true, ...record });

  } catch (e) {
    return res.status(500).json({ error: `Lỗi đọc chapter ${chapter}`, detail: e.message });
  }
}
