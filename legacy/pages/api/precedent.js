// pages/api/precedent.js — API phục vụ TB-TCHQ precedent_layer data
// Endpoints:
// - /api/precedent?so_hieu=1238/TB-TCHQ — Tra cứu theo số TB
// - /api/precedent?hs=87046029 — Tra cứu theo mã HS
// - /api/precedent?enterprise=Apple — Tìm kiếm theo doanh nghiệp
// - /api/precedent?stats=1 — Lấy thống kê

import fs from 'fs';
import path from 'path';

// Cache data at module load time
let tbTchqData = null;
let tbTchqIndexes = null;

function loadData() {
  if (!tbTchqData) {
    try {
      const dataPath = path.join(process.cwd(), 'data/tb_tchq/tb_tchq_full.json');
      const indexPath = path.join(process.cwd(), 'data/tb_tchq/tb_tchq_indexes.json');

      tbTchqData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      tbTchqIndexes = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch (err) {
      console.error('Error loading TB-TCHQ data:', err.message);
      return false;
    }
  }
  return true;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!loadData()) {
    return res.status(500).json({
      error: 'Không thể tải dữ liệu TB-TCHQ',
      detail: 'File data không tồn tại hoặc lỗi đọc file'
    });
  }

  const { so_hieu, hs, enterprise, stats } = req.query;

  try {
    // 1. Tra cứu theo số TB
    if (so_hieu) {
      const clean_so_hieu = String(so_hieu).trim().toUpperCase();
      const record = tbTchqIndexes.by_so_hieu?.[clean_so_hieu];

      if (record) {
        return res.status(200).json({
          found: true,
          source: 'precedent_layer',
          data: record,
          related_by_hs: tbTchqIndexes.by_hs_code?.[record.phan_loai?.ma_hs] || []
        });
      } else {
        return res.status(404).json({
          found: false,
          message: `Không tìm thấy TB ${clean_so_hieu}`,
          tip: 'Thử /api/precedent?stats=1 để xem tổng số TB'
        });
      }
    }

    // 2. Tra cứu theo mã HS
    if (hs) {
      const clean_hs = hs.replace(/\./g, '').trim().padEnd(8, '0').slice(0, 8);
      const records_by_hs = tbTchqIndexes.by_hs_code?.[clean_hs] || [];

      if (records_by_hs.length > 0) {
        const details = records_by_hs.map(so =>
          tbTchqIndexes.by_so_hieu?.[so]
        ).filter(Boolean);

        return res.status(200).json({
          found: true,
          hs: clean_hs,
          total_precedents: details.length,
          precedents: details.slice(0, 10), // Return top 10
          message: details.length > 10 ? `Có ${details.length} TB, hiển thị 10 mục đầu` : null
        });
      } else {
        return res.status(404).json({
          found: false,
          message: `Không có TB-TCHQ cho mã HS ${clean_hs}`
        });
      }
    }

    // 3. Tìm kiếm theo doanh nghiệp
    if (enterprise) {
      const search_term = String(enterprise).toLowerCase().trim();
      const matching_sns = Object.entries(tbTchqIndexes.by_enterprise || {})
        .filter(([name]) => name.toLowerCase().includes(search_term))
        .slice(0, 5); // Top 5 enterprises

      if (matching_sns.length > 0) {
        const results = {};
        matching_sns.forEach(([dn_name, so_list]) => {
          results[dn_name] = so_list.slice(0, 5); // Max 5 TB per enterprise
        });

        return res.status(200).json({
          found: true,
          search_term,
          results,
          total_enterprises: Object.keys(tbTchqIndexes.by_enterprise || {}).length
        });
      } else {
        return res.status(404).json({
          found: false,
          message: `Không tìm thấy doanh nghiệp chứa "${search_term}"`,
          tip: 'Thử với từ khóa ngắn hơn'
        });
      }
    }

    // 4. Lấy thống kê
    if (stats) {
      const stats_data = tbTchqIndexes.stats || {};
      return res.status(200).json({
        stats: {
          total_records: stats_data.total,
          with_hs_code: stats_data.with_hs,
          with_conflicts: stats_data.with_tranh_chap,
          unique_hs_codes: Object.keys(tbTchqIndexes.by_hs_code || {}).length,
          unique_enterprises: Object.keys(tbTchqIndexes.by_enterprise || {}).length,
          year_range: stats_data.years ? `${Math.min(...Object.keys(stats_data.years).map(Number))}-${Math.max(...Object.keys(stats_data.years).map(Number))}` : 'N/A',
          years: stats_data.years
        }
      });
    }

    // No valid query parameter
    return res.status(400).json({
      error: 'Thiếu tham số truy vấn',
      examples: [
        '/api/precedent?so_hieu=1238/TB-TCHQ — Tra cứu theo số TB',
        '/api/precedent?hs=87046029 — Tra cứu theo mã HS',
        '/api/precedent?enterprise=Apple — Tìm theo doanh nghiệp',
        '/api/precedent?stats=1 — Lấy thống kê'
      ]
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Lỗi xử lý yêu cầu',
      detail: error.message
    });
  }
}
