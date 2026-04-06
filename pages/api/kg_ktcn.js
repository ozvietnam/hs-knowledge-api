// pages/api/kg_ktcn.js — KTCN (Kiem tra chuyen nganh) lookup
// Fetch data from Vercel static CDN (public/ktcn/)
//
// Endpoints:
//   GET /api/kg_ktcn?hs=04021100        → KTCN details for one HS code
//   GET /api/kg_ktcn?co_quan=BNNPTNT    → All HS codes managed by a ministry
//   GET /api/kg_ktcn?chapter=04         → All KTCN in a chapter
//   GET /api/kg_ktcn?reference          → Full KTCN reference (ministries, procedures)

export const config = { api: { responseLimit: '4mb' } };

const CDN_BASE = process.env.PRODUCTION_URL
  || 'https://hs-knowledge-api.vercel.app';

async function fetchJSON(path) {
  const url = `${CDN_BASE}/ktcn/${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'hs-knowledge-api-internal' }
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { hs, co_quan, chapter, reference } = req.query;

  try {
    // Mode 1: Reference data (ministries, KTCN types, procedures)
    if (reference !== undefined) {
      const ref = await fetchJSON('ktcn_reference.json');
      if (!ref) return res.status(500).json({ error: 'Không đọc được ktcn_reference.json' });
      return res.status(200).json({ found: true, ...ref });
    }

    // Mode 2: Lookup by HS code
    if (hs) {
      const code = hs.replace(/\./g, '').trim().padEnd(8, '0').slice(0, 8);
      const chapterNum = String(parseInt(code.slice(0, 2))).padStart(2, '0');
      const chapterData = await fetchJSON(`ktcn_by_chapter/chapter_${chapterNum}.json`);

      if (!chapterData || !chapterData[code]) {
        // Check index for nearby codes
        const index = await fetchJSON('ktcn_index.json');
        const prefix6 = code.slice(0, 6);
        const related = index
          ? Object.keys(index).filter(k => k.startsWith(prefix6)).slice(0, 5)
          : [];

        return res.status(404).json({
          found: false,
          message: `Mã ${code} không có dữ liệu KTCN`,
          tip: 'Mã này có thể không thuộc diện kiểm tra chuyên ngành',
          go_y_ma_lien_quan: related
        });
      }

      const entry = chapterData[code];

      // Enrich with full reference data for each KTCN type
      const ref = await fetchJSON('ktcn_reference.json');
      const enriched = {
        ...entry,
        ktcn_chi_tiet: entry.ktcn.map(k => {
          const loaiRef = k.loai && ref ? ref.loai_ktcn?.[k.loai] : null;
          return {
            ...k,
            ...(loaiRef ? {
              van_ban_phap_ly: loaiRef.van_ban_phap_ly,
              thu_tuc: loaiRef.thu_tuc,
              luu_y: loaiRef.luu_y
            } : {})
          };
        })
      };

      return res.status(200).json({ found: true, ...enriched });
    }

    // Mode 3: Lookup by co_quan (ministry)
    if (co_quan) {
      const index = await fetchJSON('ktcn_index.json');
      if (!index) return res.status(500).json({ error: 'Không đọc được ktcn_index.json' });

      const matched = Object.entries(index)
        .filter(([_, agencies]) => agencies.includes(co_quan))
        .map(([hs]) => hs);

      const ref = await fetchJSON('ktcn_reference.json');
      const coQuanInfo = ref?.co_quan?.[co_quan];

      return res.status(200).json({
        found: true,
        co_quan: co_quan,
        ten: coQuanInfo?.ten || co_quan,
        don_vi: coQuanInfo?.don_vi || [],
        total: matched.length,
        hs_codes: matched
      });
    }

    // Mode 4: Lookup by chapter
    if (chapter) {
      const padded = String(parseInt(chapter)).padStart(2, '0');
      const chapterData = await fetchJSON(`ktcn_by_chapter/chapter_${padded}.json`);
      if (!chapterData) {
        return res.status(404).json({
          found: false,
          message: `Chương ${chapter} không có dữ liệu KTCN`
        });
      }

      return res.status(200).json({
        found: true,
        chapter: parseInt(chapter),
        total: Object.keys(chapterData).length,
        data: chapterData
      });
    }

    // No params: show usage
    return res.status(400).json({
      error: 'Thiếu tham số',
      usage: {
        by_hs: '/api/kg_ktcn?hs=04021100',
        by_ministry: '/api/kg_ktcn?co_quan=BNNPTNT',
        by_chapter: '/api/kg_ktcn?chapter=04',
        reference: '/api/kg_ktcn?reference'
      },
      co_quan_list: ['BNNPTNT', 'BYT', 'BCT', 'BKHCN', 'BTNMT', 'BCA', 'BQP', 'BTTTT', 'BLDTBXH']
    });

  } catch (e) {
    return res.status(500).json({
      error: 'Lỗi đọc dữ liệu KTCN',
      detail: e.message
    });
  }
}
