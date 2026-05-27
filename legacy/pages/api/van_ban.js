import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const dataPath = path.join(process.cwd(), 'data', 'van_ban', 'vb_master.json');

  if (!fs.existsSync(dataPath)) {
    return res.status(404).json({ error: 'VB data not found' });
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { q, loai, trang_thai, id } = req.query;

  let results = data;

  // Filter by ID
  if (id) {
    const vb = data.find(v => v.id === id || v.so_hieu === id);
    return vb ? res.json(vb) : res.status(404).json({ error: 'VB not found' });
  }

  // Search by keyword
  if (q) {
    const keyword = q.toLowerCase();
    results = results.filter(v =>
      v.ten.toLowerCase().includes(keyword) ||
      v.so_hieu.toLowerCase().includes(keyword) ||
      (v.tags || []).some(t => t.toLowerCase().includes(keyword))
    );
  }

  // Filter by loai (Luat, Nghi dinh, Thong tu, QCVN)
  if (loai) {
    results = results.filter(v => v.loai.toLowerCase().includes(loai.toLowerCase()));
  }

  // Filter by trang_thai
  if (trang_thai) {
    results = results.filter(v => v.trang_thai === trang_thai);
  }

  res.json({
    total: results.length,
    query: { q, loai, trang_thai },
    data: results
  });
}
