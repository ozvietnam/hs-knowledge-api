// pages/api/chapter.js
export const config = { api: { responseLimit: '8mb' } };

const CDN_BASE = process.env.PRODUCTION_URL
  || 'https://raw.githubusercontent.com/ozvietnam/hs-knowledge-api/main/public';

const _cache = new Map();
async function fetchChapter(chapter) {
  if (_cache.has(chapter)) return _cache.get(chapter);
  const url = `${CDN_BASE}/kg/chapter_${chapter}.json`;
  const headers = { 'User-Agent': 'hs-knowledge-api-internal' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  _cache.set(chapter, data);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { chapter, status } = req.query;
  if (!chapter) {
    return res.status(400).json({ error: 'Thiếu tham số chapter. Ví dụ: /api/chapter?chapter=85' });
  }

  const chap = String(parseInt(chapter)).padStart(2, '0');

  try {
    const chapterData = await fetchChapter(chap);
    let records = Object.values(chapterData);
    if (status) records = records.filter(r => r.meta && r.meta.status === status);

    return res.status(200).json({ chapter: parseInt(chapter), total: records.length, records });
  } catch (e) {
    return res.status(404).json({ error: `Không có dữ liệu Chapter ${chapter}`, detail: e.message });
  }
}
