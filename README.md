# HS Knowledge Graph API — Biểu thuế XNK Việt Nam 2026 (9 Tầng)

API tra cứu mã HS với kiến trúc 9 tầng dữ liệu đầy đủ.

**Dữ liệu:** Biểu thuế 2026 · TT31/2022/TT-BTC  
**Hosted:** Vercel

---

## Kiến trúc 9 Tầng

| Tầng | Tên | Trạng thái |
|------|-----|-----------|
| 1 | Fact Layer — Thuế suất | ✅ Đầy đủ |
| 2 | Legal Layer — Chú giải, SEN | 🔄 Đang enrich |
| 3 | Regulatory Layer — Luật hiện hành | 🔄 Đang enrich |
| 4 | Precedent Layer — TB-TCHQ | 🔄 Đang enrich |
| 5 | Conflict Layer — Mâu thuẫn | 🔄 Đang enrich |
| 6 | Classification Layer — GIR | 🔄 Đang enrich |
| 7 | Cross-border Layer — CN/TH mapping | 🔄 Đang enrich |
| 8 | Logistics Layer — Cửa khẩu, giá | 🔄 Đang enrich |
| 9 | AI Layer — Dynamic + Validation | 🔄 Đang enrich |

---

## Endpoints

### 1. Tra cứu theo mã HS (đầy đủ 9 tầng)
```
GET /api/kg?hs=85167100
GET /api/kg?hs=85167100&fields=fact_layer,legal_layer
```

### 2. Tìm kiếm
```
GET /api/kg_search?q=bàn+là
GET /api/kg_search?q=máy+tính&chapter=85&limit=10
GET /api/kg_search?q=nhựa&canh_bao=ORANGE
GET /api/kg_search?q=8516&loai_khac=1
```

### 3. Lấy toàn bộ 1 chương
```
GET /api/kg_chapter?chapter=85
GET /api/kg_chapter?chapter=39&status=raw
```

### 4. Thống kê tổng quan
```
GET /api/kg_stats
```

---

## Cấu trúc dữ liệu

```
data/
  kg/
    chapter_01.json  — 53 mã HS
    chapter_02.json  — 83 mã HS
    ...
    chapter_97.json
  kg_index.json      — Index nhẹ toàn bộ 11,871 mã
```

## Enrich dữ liệu

Để thêm dữ liệu vào bất kỳ tầng nào:
1. Cập nhật `data/kg/chapter_XX.json`
2. Push lên GitHub → Vercel tự redeploy
