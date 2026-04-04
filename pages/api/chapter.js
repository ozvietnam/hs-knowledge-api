// pages/api/chapter.js
import fs from 'fs';
import path from 'path';

export const config = { api: { responseLimit: '8mb' } };

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { chapter, status } = req.query;
  if (!chapter) {
    return res.status(400).json({ error: 'Thiếu tham số chapter. Ví dụ: /api/chapter?chapter=85' });
  }

  const chap = String(parseInt(chapter)).padStart(2, '0');

  try {
    const filePath = path.join(process.cwd(), 'public', 'kg', `chapter_${chap}.json`);
    const chapterData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let records = Object.values(chapterData);
    if (status) records = records.filter(r => r.meta && r.meta.status === status);

    return res.status(200).json({
      chapter: parseInt(chapter),
      total: records.length,
      records
    });
  } catch (e) {
    return res.status(404).json({ error: `Không có dữ liệu Chapter ${chapter}`, detail: e.message });
  }
}
