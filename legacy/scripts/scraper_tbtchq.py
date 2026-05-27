"""
Scraper TB-TCHQ — dùng stdlib (urllib + re), không cần bs4.
"""
import re
import json
import os
import time
import urllib.request


def normalize_hs(raw):
    """Normalize HS code → 8 chữ số, hoặc '' nếu không hợp lệ."""
    if not raw:
        return ''
    # Bỏ dấu cách và dấu chấm
    cleaned = re.sub(r'[\s.]', '', raw.strip())
    # Chỉ chấp nhận chuỗi toàn số
    if not re.fullmatch(r'\d+', cleaned):
        return ''
    if len(cleaned) < 4:
        return ''
    # Pad/trim về 8 chữ số
    return cleaned.ljust(8, '0')[:8]


def parse_record(html):
    """Parse HTML → dict chuẩn. Dùng regex, không cần bs4."""
    if not html or len(html.strip()) < 10:
        return None

    def find(pattern, text, default=''):
        m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else default

    # so_hieu — extract số hiệu dạng XXXX/TB-TCHQ
    raw_h1 = find(r'<h1[^>]*>(.*?)</h1>', html)
    m_so = re.search(r'([\d/\-]+/TB-TCHQ)', raw_h1 or html)
    so_hieu = m_so.group(1) if m_so else raw_h1

    # ngay
    ngay = find(r'Ngày ban hành:\s*([\d/]+)', html)
    if not ngay:
        ngay = find(r'class=["\']date["\'][^>]*>(.*?)</p>', html)

    # nguoi_ky
    nguoi_ky = find(r'Người ký:\s*([^\n<]+)', html)

    # hang_hoa — trade name
    trade_name = find(r'class=["\']trade-name["\'][^>]*>(.*?)</span>', html)
    if not trade_name:
        trade_name = find(r'Tên thương mại[:\s]*([^\n<]+)', html)

    # hs_code
    hs_raw = find(r'class=["\']hs-code["\'][^>]*>(.*?)</span>', html)
    if not hs_raw:
        hs_raw = find(r'(\d{4}\.\d{2}\.\d{2})', html)
    ma_hs = normalize_hs(hs_raw)
    ma_hs_display = hs_raw.strip() if hs_raw else ''

    # summary
    summary = find(r'class=["\']summary["\'][^>]*>(.*?)</div>', html)

    return {
        'so_hieu': so_hieu,
        'ngay_ban_hanh': ngay,
        'nguoi_ky': nguoi_ky,
        'doanh_nghiep': {'ten': '', 'mst': ''},
        'hang_hoa': {'ten_thuong_mai': trade_name, 'ten_ky_thuat': ''},
        'phan_loai': {'ma_hs': ma_hs, 'ma_hs_display': ma_hs_display, 'ly_do': '', 'can_cu': ''},
        'tranh_chap': {'co_tranh_chap': False, 'ma_hs_ban_dau': ''},
        'noi_dung_tom_tat': summary,
        'url': '',
    }


class ScraperTBTCHQ:
    delay_seconds = 1.0

    def __init__(self, output_path):
        self.output_path = output_path

    def fetch_page(self, url):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode('utf-8', errors='ignore')

    def parse_list(self, html):
        """Extract document links từ trang danh sách."""
        return re.findall(r'href=["\']([^"\']*TB-TCHQ[^"\']*)["\']', html)

    def load_existing(self):
        if os.path.exists(self.output_path):
            with open(self.output_path, encoding='utf-8') as f:
                return {item['so_hieu'] for item in json.load(f)}
        return set()

    def empty_record(self):
        return {
            'so_hieu': '',
            'ngay_ban_hanh': '',
            'nguoi_ky': '',
            'doanh_nghiep': {'ten': '', 'mst': ''},
            'hang_hoa': {'ten_thuong_mai': '', 'ten_ky_thuat': ''},
            'phan_loai': {'ma_hs': '', 'ma_hs_display': '', 'ly_do': '', 'can_cu': ''},
            'tranh_chap': {'co_tranh_chap': False, 'ma_hs_ban_dau': ''},
            'noi_dung_tom_tat': '',
            'url': '',
        }

    def run(self, base_url='', max_pages=None):
        existing = self.load_existing()
        results = list(json.load(open(self.output_path, encoding='utf-8'))) \
            if os.path.exists(self.output_path) else []

        page = 1
        while True:
            if max_pages and page > max_pages:
                break
            url = f"{base_url}?page={page}" if base_url else ''
            if not url:
                break
            try:
                html = self.fetch_page(url)
                links = self.parse_list(html)
                if not links:
                    break
                for link in links:
                    detail = self.fetch_page(link)
                    record = parse_record(detail)
                    if record and record['so_hieu'] not in existing:
                        record['url'] = link
                        results.append(record)
                        existing.add(record['so_hieu'])
                        with open(self.output_path, 'w', encoding='utf-8') as f:
                            json.dump(results, f, ensure_ascii=False)
                    time.sleep(self.delay_seconds)
                page += 1
            except Exception as e:
                print(f"Error page {page}: {e}")
                break

        return results
