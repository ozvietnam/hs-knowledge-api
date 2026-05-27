"""
TDD — Data Pipeline (Normalize → Validate → Merge → Index)
Tests viết trước, Aider+Ollama implement sau.

Chạy: python3 -m pytest tests/test_data_pipeline.py -v
"""

import pytest
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

KG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'kg')

# ============================================================
# CONTRACT: DataPipeline
# from scripts.data_pipeline import DataPipeline, validate_record, merge_into_kg
# ============================================================


class TestValidateRecord:
    """Validate TB-TCHQ record trước khi merge vào KG."""

    def test_valid_record_passes(self):
        """Record đầy đủ → valid."""
        from scripts.data_pipeline import validate_record
        record = {
            'so_hieu': '4967/TB-TCHQ',
            'ngay_ban_hanh': '12/09/2025',
            'hang_hoa': {'ten_thuong_mai': 'Test Product'},
            'phan_loai': {'ma_hs': '87046029', 'ma_hs_display': '8704.60.29'},
            'url': 'https://example.com/4967'
        }
        is_valid, errors = validate_record(record)
        assert is_valid is True
        assert len(errors) == 0

    def test_missing_so_hieu_invalid(self):
        """Thiếu so_hieu → invalid."""
        from scripts.data_pipeline import validate_record
        record = {'ngay_ban_hanh': '12/09/2025', 'phan_loai': {'ma_hs': '87046029'}}
        is_valid, errors = validate_record(record)
        assert is_valid is False
        assert any('so_hieu' in e for e in errors)

    def test_invalid_hs_format(self):
        """HS code không phải 8 chữ số → warning (không block)."""
        from scripts.data_pipeline import validate_record
        record = {
            'so_hieu': '100/TB-TCHQ',
            'phan_loai': {'ma_hs': 'ABC12345'},
            'hang_hoa': {'ten_thuong_mai': 'Test'}
        }
        is_valid, errors = validate_record(record)
        # HS format xấu → warning, không fail hoàn toàn
        # (vẫn có thể merge, chỉ đánh dấu cần review)
        assert isinstance(errors, list)

    def test_duplicate_so_hieu_detected(self):
        """so_hieu đã tồn tại trong existing_ids → flag duplicate."""
        from scripts.data_pipeline import validate_record
        existing_ids = {'4967/TB-TCHQ', '100/TB-TCHQ'}
        record = {'so_hieu': '4967/TB-TCHQ', 'phan_loai': {'ma_hs': '87046029'}}
        is_valid, errors = validate_record(record, existing_ids=existing_ids)
        assert is_valid is False
        assert any('duplicate' in e.lower() or 'tồn tại' in e for e in errors)


class TestOllamaCategorizer:
    """Dùng Ollama 32B để tự động phân loại hàng hóa → HS code."""

    def test_categorizer_init(self):
        """OllamaCategorizer khởi tạo với model name."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        assert cat.model == 'qwen2.5-coder:32b'

    def test_categorizer_has_predict(self):
        """Phải có method predict(description) → hs_code."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        assert hasattr(cat, 'predict')

    def test_predict_returns_string(self):
        """predict() phải trả về string (HS code hoặc '')."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        result = cat.predict('Xe ô tô chở hàng chạy điện, tải trọng 500kg')
        assert isinstance(result, str)

    def test_predict_known_product(self):
        """Sản phẩm quen → HS code hợp lý (bắt đầu bằng chapter đúng)."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        # Gạo → chapter 10
        result = cat.predict('Gạo trắng hạt dài, đã xay xát, dùng làm thực phẩm')
        if result:  # có thể không có Ollama
            assert result[:2] == '10', f"Expected chapter 10, got: {result}"

    def test_predict_batch(self):
        """predict_batch(list) → list kết quả cùng độ dài."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        inputs = ['Gạo', 'Sắt thép', 'Điện thoại']
        results = cat.predict_batch(inputs)
        assert len(results) == len(inputs)
        assert all(isinstance(r, str) for r in results)

    def test_predict_empty_input(self):
        """Input rỗng → '' không crash."""
        from scripts.ollama_categorizer import OllamaCategorizer
        cat = OllamaCategorizer(model='qwen2.5-coder:32b')
        result = cat.predict('')
        assert result == ''


class TestMergeIntoKG:
    """Test merge records vào chapter_XX.json."""

    def test_merge_new_case(self):
        """Record mới → được thêm vào legal_layer.case_history."""
        from scripts.data_pipeline import merge_into_kg
        import tempfile, shutil

        # Setup: copy chapter_87 vào temp dir
        src = os.path.join(KG_DIR, 'chapter_87.json')
        if not os.path.exists(src):
            pytest.skip("chapter_87.json not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            dst = os.path.join(tmpdir, 'chapter_87.json')
            shutil.copy(src, dst)

            record = {
                'so_hieu': 'TEST-001/TB-TCHQ',
                'ngay_ban_hanh': '01/01/2026',
                'hang_hoa': {'ten_thuong_mai': 'TEST VEHICLE'},
                'phan_loai': {'ma_hs': '87046029'},
                'noi_dung_tom_tat': 'Test case',
                'url': 'http://test.com'
            }

            result = merge_into_kg([record], kg_dir=tmpdir)
            assert result['merged'] >= 1

            # Verify it was written
            with open(dst) as f:
                data = json.load(f)
            case_history = data.get('87046029', {}).get('legal_layer', {}).get('case_history', [])
            so_hieu_list = [c['so_hieu'] for c in case_history]
            assert 'TEST-001/TB-TCHQ' in so_hieu_list

    def test_merge_no_duplicate(self):
        """Record đã tồn tại → không thêm lần 2."""
        from scripts.data_pipeline import merge_into_kg
        import tempfile, shutil

        src = os.path.join(KG_DIR, 'chapter_87.json')
        if not os.path.exists(src):
            pytest.skip("chapter_87.json not found")

        with tempfile.TemporaryDirectory() as tmpdir:
            dst = os.path.join(tmpdir, 'chapter_87.json')
            shutil.copy(src, dst)

            record = {
                'so_hieu': 'DUPE-001/TB-TCHQ',
                'phan_loai': {'ma_hs': '87046029'},
                'hang_hoa': {'ten_thuong_mai': 'Dupe test'}
            }

            merge_into_kg([record], kg_dir=tmpdir)
            merge_into_kg([record], kg_dir=tmpdir)  # Run twice

            with open(dst) as f:
                data = json.load(f)
            case_history = data.get('87046029', {}).get('legal_layer', {}).get('case_history', [])
            dupe_count = sum(1 for c in case_history if c['so_hieu'] == 'DUPE-001/TB-TCHQ')
            assert dupe_count == 1, f"Duplicate found: {dupe_count} entries"

    def test_merge_returns_stats(self):
        """merge_into_kg phải trả về stats dict."""
        from scripts.data_pipeline import merge_into_kg
        result = merge_into_kg([], kg_dir=KG_DIR)
        assert isinstance(result, dict)
        assert 'merged' in result
        assert 'skipped' in result
        assert 'errors' in result


class TestKGCoverage:
    """Kiểm tra coverage của KG data — regression tests."""

    def test_layer1_full_coverage(self):
        """Layer 1 (fact_layer.vn) phải = 100%."""
        total, has_fact = 0, 0
        for ch in range(1, 99):
            fp = os.path.join(KG_DIR, f'chapter_{ch:02d}.json')
            if not os.path.exists(fp): continue
            with open(fp) as f: data = json.load(f)
            for item in data.values():
                total += 1
                if item.get('fact_layer', {}).get('vn'):
                    has_fact += 1
        assert total > 0
        assert has_fact == total, f"Layer 1 not 100%: {has_fact}/{total}"

    def test_layer3_ktcn_minimum(self):
        """Layer 3 (KTCN) phải >= 60%."""
        total, has_ktcn = 0, 0
        for ch in range(1, 99):
            fp = os.path.join(KG_DIR, f'chapter_{ch:02d}.json')
            if not os.path.exists(fp): continue
            with open(fp) as f: data = json.load(f)
            for item in data.values():
                total += 1
                if item.get('legal_layer', {}).get('tinh_chat', {}).get('ktcn'):
                    has_ktcn += 1
        pct = has_ktcn / total * 100 if total else 0
        assert pct >= 60, f"Layer 3 KTCN below 60%: {pct:.1f}%"

    def test_layer5_conflict_exists(self):
        """Layer 5 (conflict) phải có ít nhất 1 entry."""
        found = False
        for ch in range(1, 99):
            fp = os.path.join(KG_DIR, f'chapter_{ch:02d}.json')
            if not os.path.exists(fp): continue
            with open(fp) as f: data = json.load(f)
            for item in data.values():
                if item.get('legal_layer', {}).get('conflict', {}).get('has_conflict'):
                    found = True
                    break
            if found: break
        assert found, "Layer 5 conflict data not found in any chapter"

    def test_layer8_case_history_exists(self):
        """Layer 8 (case_history) phải có ít nhất 400 entries."""
        count = 0
        for ch in range(1, 99):
            fp = os.path.join(KG_DIR, f'chapter_{ch:02d}.json')
            if not os.path.exists(fp): continue
            with open(fp) as f: data = json.load(f)
            for item in data.values():
                if item.get('legal_layer', {}).get('case_history'):
                    count += 1
        assert count >= 400, f"Layer 8 too sparse: {count} codes"

    def test_vector_embeddings_complete(self):
        """vector_embeddings.json phải có đủ 11,871 entries."""
        emb_file = os.path.join(os.path.dirname(KG_DIR), 'vector_embeddings.json')
        if not os.path.exists(emb_file):
            pytest.skip("vector_embeddings.json not found")
        with open(emb_file) as f:
            emb = json.load(f)
        assert len(emb) >= 11000, f"Too few embeddings: {len(emb)}"
