"""
TDD — Scraper TB-TCHQ
Tests viết trước, Aider+Ollama implement sau.

Chạy: python3 -m pytest tests/test_scraper_tbtchq.py -v
Implement: aider --model ollama/qwen2.5-coder:32b scripts/scraper_tbtchq.py tests/test_scraper_tbtchq.py
"""

import pytest
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ============================================================
# CONTRACT: ScraperTBTCHQ phải implement các method sau
# ============================================================
# from scripts.scraper_tbtchq import ScraperTBTCHQ, parse_record, normalize_hs

class TestParseRecord:
    """Test parse HTML → dict chuẩn."""

    SAMPLE_HTML = """
    <div class="document-detail">
      <h1>Thông báo 4967/TB-TCHQ</h1>
      <p class="date">Ngày ban hành: 12/09/2025</p>
      <p class="signer">Người ký: Lưu Mạnh Tưởng</p>
      <div class="goods">
        <span class="trade-name">CARRYALL 500 (ELECTRICAL UTILITY VEHICLE)</span>
        <span class="hs-code">8704.60.29</span>
      </div>
      <div class="summary">Xe vận chuyển hàng loại chạy điện, 4 bánh</div>
    </div>
    """

    def test_parse_so_hieu(self):
        """Phải extract số hiệu TB-TCHQ."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record(self.SAMPLE_HTML)
        assert result['so_hieu'] == '4967/TB-TCHQ'

    def test_parse_ngay(self):
        """Phải extract ngày ban hành."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record(self.SAMPLE_HTML)
        assert result['ngay_ban_hanh'] == '12/09/2025'

    def test_parse_hs_code(self):
        """Phải extract và normalize HS code."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record(self.SAMPLE_HTML)
        assert result['phan_loai']['ma_hs'] == '87046029'
        assert result['phan_loai']['ma_hs_display'] == '8704.60.29'

    def test_parse_hang_hoa(self):
        """Phải extract tên hàng hóa."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record(self.SAMPLE_HTML)
        assert 'CARRYALL' in result['hang_hoa']['ten_thuong_mai']

    def test_parse_returns_dict(self):
        """Kết quả phải là dict với các key bắt buộc."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record(self.SAMPLE_HTML)
        required_keys = ['so_hieu', 'ngay_ban_hanh', 'hang_hoa', 'phan_loai', 'url']
        for key in required_keys:
            assert key in result, f"Missing key: {key}"

    def test_parse_empty_html(self):
        """HTML rỗng/lỗi → trả None, không crash."""
        from scripts.scraper_tbtchq import parse_record
        result = parse_record("")
        assert result is None

    def test_parse_missing_hs(self):
        """HTML không có HS code → ma_hs = ''."""
        from scripts.scraper_tbtchq import parse_record
        html = "<div><h1>Thông báo 123/TB-TCHQ</h1><p>Không phân loại</p></div>"
        result = parse_record(html)
        if result:
            assert result['phan_loai']['ma_hs'] == ''


class TestNormalizeHS:
    """Test normalize HS code về dạng 8 chữ số."""

    def test_normalize_dot_format(self):
        """8704.60.29 → 87046029"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('8704.60.29') == '87046029'

    def test_normalize_already_8digit(self):
        """87046029 → 87046029"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('87046029') == '87046029'

    def test_normalize_6digit(self):
        """870460 → 87046000 (pad right)"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('870460') == '87046000'

    def test_normalize_spaces(self):
        """' 8704.60.29 ' → '87046029'"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('  8704.60.29  ') == '87046029'

    def test_normalize_empty(self):
        """'' → ''"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('') == ''

    def test_normalize_invalid(self):
        """Text không phải HS → ''"""
        from scripts.scraper_tbtchq import normalize_hs
        assert normalize_hs('không phân loại') == ''


class TestScraperFlow:
    """Test luồng scraping end-to-end (mock HTTP)."""

    def test_scraper_init(self):
        """ScraperTBTCHQ có thể khởi tạo với output_path."""
        from scripts.scraper_tbtchq import ScraperTBTCHQ
        scraper = ScraperTBTCHQ(output_path='/tmp/test_tb_tchq.json')
        assert scraper is not None

    def test_scraper_has_required_methods(self):
        """ScraperTBTCHQ phải có fetch_page, parse_list, run."""
        from scripts.scraper_tbtchq import ScraperTBTCHQ
        scraper = ScraperTBTCHQ(output_path='/tmp/test_tb_tchq.json')
        assert hasattr(scraper, 'fetch_page')
        assert hasattr(scraper, 'parse_list')
        assert hasattr(scraper, 'run')

    def test_scraper_rate_limit(self):
        """ScraperTBTCHQ phải có delay giữa requests (tránh bị block)."""
        from scripts.scraper_tbtchq import ScraperTBTCHQ
        scraper = ScraperTBTCHQ(output_path='/tmp/test_tb_tchq.json')
        assert hasattr(scraper, 'delay_seconds')
        assert scraper.delay_seconds >= 0.5  # Ít nhất 0.5s giữa requests

    def test_scraper_resume(self):
        """Nếu output_path đã có data → resume từ chỗ dừng, không fetch lại."""
        import json, os
        from scripts.scraper_tbtchq import ScraperTBTCHQ

        existing = [{'so_hieu': '100/TB-TCHQ', 'url': 'http://test.com/100'}]
        with open('/tmp/test_resume.json', 'w') as f:
            json.dump(existing, f)

        scraper = ScraperTBTCHQ(output_path='/tmp/test_resume.json')
        existing_ids = scraper.load_existing()
        assert '100/TB-TCHQ' in existing_ids

        if os.path.exists('/tmp/test_resume.json'):
            os.remove('/tmp/test_resume.json')

    def test_output_schema(self):
        """Record output phải match schema TB-TCHQ chuẩn."""
        from scripts.scraper_tbtchq import ScraperTBTCHQ
        schema_keys = ['so_hieu', 'ngay_ban_hanh', 'nguoi_ky',
                       'doanh_nghiep', 'hang_hoa', 'phan_loai',
                       'tranh_chap', 'noi_dung_tom_tat', 'url']
        scraper = ScraperTBTCHQ(output_path='/tmp/test_schema.json')
        template = scraper.empty_record()
        for key in schema_keys:
            assert key in template, f"Missing schema key: {key}"
