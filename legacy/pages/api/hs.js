// pages/api/hs.js — tra cứu 9 tầng theo mã HS
// Fetch data from Vercel static CDN (public/kg/) via absolute URL

export const config = {
  api: { responseLimit: '8mb' },
};

// CDN: public/kg/ served via GitHub raw (excluded from Vercel deployment to reduce size)
const CDN_BASE = process.env.PRODUCTION_URL
  || 'https://raw.githubusercontent.com/ozvietnam/hs-knowledge-api/main/public';

// Module-level cache: avoids re-fetching the same chapter file within a warm instance
const _chapterCache = new Map();

async function fetchChapter(chapter) {
  if (_chapterCache.has(chapter)) return _chapterCache.get(chapter);
  const url = `${CDN_BASE}/kg/chapter_${chapter}.json`;
  const headers = { 'User-Agent': 'hs-knowledge-api-internal' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const data = await res.json();
  _chapterCache.set(chapter, data);
  return data;
}

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
    let chapterData;
    try {
      chapterData = await fetchChapter(chapter);
    } catch {
      return res.status(404).json({ error: `Chapter ${chapter} không tồn tại` });
    }
    let record = chapterData[code];

    // Prefix matching: if exact code not found (e.g. 04012000),
    // return first matching sub-code (04012010) with related codes
    if (!record) {
      const prefix6 = code.slice(0, 6);
      const related = Object.entries(chapterData)
        .filter(([k]) => k.startsWith(prefix6))
        .slice(0, 5)
        .map(([k, v]) => ({ hs: k, vn: v.fact_layer?.vn }));

      if (related.length > 0) {
        // Return first sub-code data with note about prefix match
        const firstCode = related[0].hs;
        record = chapterData[firstCode];
        if (record) {
          const result = { found: true, prefix_match: true, queried: code, ...record };
          result.go_y_ma_lien_quan = related;
          return res.status(200).json(result);
        }
      }

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
