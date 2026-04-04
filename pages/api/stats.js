// pages/api/stats.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const baseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
    const response = await fetch(`${baseUrl}/kg/kg_index.json`);
    if (!response.ok) throw new Error('Index not found');

    const indexData = await response.json();

    const stats = {
      tong_ma_hs: indexData.length,
      theo_canh_bao: {},
      theo_status: {},
      hang_loai_khac: 0,
      theo_chapter_top10: {}
    };

    const chapterCount = {};
    indexData.forEach(item => {
      stats.theo_canh_bao[item.muc_canh_bao] = (stats.theo_canh_bao[item.muc_canh_bao] || 0) + 1;
      stats.theo_status[item.status] = (stats.theo_status[item.status] || 0) + 1;
      if (item.la_hang_loai_khac) stats.hang_loai_khac++;
      chapterCount[item.chapter] = (chapterCount[item.chapter] || 0) + 1;
    });

    stats.theo_chapter_top10 = Object.entries(chapterCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((acc, [k, v]) => { acc[`chapter_${k}`] = v; return acc; }, {});

    return res.status(200).json(stats);
  } catch (e) {
    return res.status(500).json({ error: 'Lỗi đọc index', detail: e.message });
  }
}
