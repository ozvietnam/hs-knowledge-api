// pages/api/chapter.js
export const config = { api: { responseLimit: '8mb' } };

const CDN_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { chapter, status } = req.query;
  if (!chapter) {
    return res.status(400).json({ error: 'Thiếu tham số chapter. Ví dụ: /api/chapter?chapter=85' });
  }

  const chap = String(parseInt(chapter)).padStart(2, '0');

  try {
    const response = await fetch(`${CDN_BASE}/kg/chapter_${chap}.json`);
    if (!response.ok) throw new Error('Not found');
    const chapterData = await response.json();
    let records = Object.values(chapterData);
    if (status) records = records.filter(r => r.meta && r.meta.status === status);

    return res.status(200).json({ chapter: parseInt(chapter), total: records.length, records });
  } catch (e) {
    return res.status(404).json({ error: `Không có dữ liệu Chapter ${chapter}`, detail: e.message });
  }
}
