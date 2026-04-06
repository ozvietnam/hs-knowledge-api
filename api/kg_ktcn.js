// API: /api/kg_ktcn
// KTCN (Kiem tra chuyen nganh) lookup — separate lightweight data layer
//
// Endpoints:
//   GET /api/kg_ktcn?hs=04021100        → KTCN details for one HS code
//   GET /api/kg_ktcn?co_quan=BNNPTNT    → All HS codes managed by a ministry
//   GET /api/kg_ktcn?chapter=04         → All KTCN in a chapter
//   GET /api/kg_ktcn?reference          → Full KTCN reference (ministries, procedures)

export const config = { api: { responseLimit: '4mb' } };

// Cache loaded data in memory (Vercel serverless cold start optimization)
let referenceCache = null;
let indexCache = null;

async function loadReference() {
  if (referenceCache) return referenceCache;
  const data = await import('../data/ktcn/ktcn_reference.json');
  referenceCache = data.default || data;
  return referenceCache;
}

async function loadIndex() {
  if (indexCache) return indexCache;
  const data = await import('../data/ktcn/ktcn_index.json');
  indexCache = data.default || data;
  return indexCache;
}

async function loadChapter(chapterNum) {
  const padded = String(chapterNum).padStart(2, '0');
  try {
    const data = await import(`../data/ktcn/ktcn_by_chapter/chapter_${padded}.json`);
    return data.default || data;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { hs, co_quan, chapter, reference } = req.query;

  try {
    // Mode 1: Reference data (ministries, KTCN types, procedures)
    if (reference !== undefined) {
      const ref = await loadReference();
      return res.status(200).json({ found: true, ...ref });
    }

    // Mode 2: Lookup by HS code
    if (hs) {
      const code = hs.replace(/\./g, '').trim().padEnd(8, '0').slice(0, 8);
      const chapterNum = parseInt(code.slice(0, 2));
      const chapterData = await loadChapter(chapterNum);

      if (!chapterData || !chapterData[code]) {
        // Check index for nearby codes
        const index = await loadIndex();
        const prefix6 = code.slice(0, 6);
        const related = Object.keys(index)
          .filter(k => k.startsWith(prefix6))
          .slice(0, 5);

        return res.status(404).json({
          found: false,
          message: `Mã ${code} không có dữ liệu KTCN`,
          tip: 'Mã này có thể không thuộc diện kiểm tra chuyên ngành',
          go_y_ma_lien_quan: related
        });
      }

      const entry = chapterData[code];

      // Enrich with full reference data for each KTCN type
      const ref = await loadReference();
      const enriched = {
        ...entry,
        ktcn_chi_tiet: entry.ktcn.map(k => {
          const loaiRef = k.loai ? ref.loai_ktcn?.[k.loai] : null;
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
      const index = await loadIndex();
      const matched = Object.entries(index)
        .filter(([_, agencies]) => agencies.includes(co_quan))
        .map(([hs]) => hs);

      const ref = await loadReference();
      const coQuanInfo = ref.co_quan?.[co_quan];

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
      const chapterData = await loadChapter(parseInt(chapter));
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
