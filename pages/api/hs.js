// pages/api/hs.js — tra cứu 9 tầng theo mã HS
// Data in public/kg/ — read via fs from build output
import fs from 'fs';
import path from 'path';

export const config = { api: { responseLimit: '8mb' } };

function getChapterData(chapter) {
  // In Vercel, public/ files are copied to .next/server/ or accessible via process.cwd()
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'kg', `chapter_${chapter}.json`),
    path.join(process.cwd(), '.next', 'static', 'kg', `chapter_${chapter}.json`),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

export default function handler(req, res) {
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
    const chapterData = getChapterData(chapter);
    if (!chapterData) {
      return res.status(404).json({ error: `Chapter ${chapter} không tồn tại` });
    }

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
