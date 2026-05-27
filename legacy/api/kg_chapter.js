// API: /api/kg_chapter?chapter=85&status=raw
// Lấy toàn bộ records của 1 chương

export const config = { api: { responseLimit: '8mb' } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { chapter, status } = req.query;
  if (!chapter) {
    return res.status(400).json({ error: 'Thiếu tham số chapter. Ví dụ: /api/kg_chapter?chapter=85' });
  }

  const chap = String(parseInt(chapter)).padStart(2, '0');

  try {
    const chapterData = await import(`../data/kg/chapter_${chap}.json`);
    let records = Object.values(chapterData.default || chapterData);
    
    if (status) records = records.filter(r => r.meta.status === status);

    return res.status(200).json({
      chapter: parseInt(chapter),
      total: records.length,
      records
    });
  } catch(e) {
    return res.status(404).json({ error: `Không có dữ liệu Chapter ${chapter}` });
  }
}
