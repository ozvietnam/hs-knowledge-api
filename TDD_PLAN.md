# TDD PLAN — HS Knowledge Graph Data Pipeline
**Stack:** Python + pytest + Aider + Ollama qwen2.5-coder:32b  
**Nguyên tắc:** Tests viết trước → Aider implement → pytest verify → iterate

---

## WORKFLOW

```
1. pytest (RED) → xem test nào fail
2. aider implement → đến khi GREEN
3. pytest lại → đảm bảo không regression
4. repeat
```

**Lệnh chạy tests:**
```bash
cd "CLAUDE DATA SHARE/hs-knowledge-api"
python3 -m pytest tests/ -v --tb=short
```

**Lệnh Aider implement (không tốn token):**
```bash
# Implement scraper
aider --model ollama/qwen2.5-coder:32b \
  scripts/scraper_tbtchq.py \
  tests/test_scraper_tbtchq.py \
  --message "Implement scraper_tbtchq.py để pass tất cả tests"

# Implement data pipeline
aider --model ollama/qwen2.5-coder:32b \
  scripts/data_pipeline.py \
  tests/test_data_pipeline.py \
  --message "Implement data_pipeline.py để pass tất cả tests"

# Implement Ollama categorizer
aider --model ollama/qwen2.5-coder:32b \
  scripts/ollama_categorizer.py \
  tests/test_data_pipeline.py \
  --message "Implement OllamaCategorizer dùng Ollama local để predict HS code"
```

---

## MODULE CẦN IMPLEMENT

### 1. `scripts/scraper_tbtchq.py`
**Tests:** `tests/test_scraper_tbtchq.py`

```python
class ScraperTBTCHQ:
    delay_seconds = 1.0      # rate limiting
    
    def __init__(self, output_path): ...
    def fetch_page(self, url) -> str: ...    # urllib, retry 3x
    def parse_list(self, html) -> list: ...  # extract links từ trang danh sách
    def run(self, max_pages=None): ...       # main loop
    def load_existing(self) -> set: ...     # load so_hieu đã có → resume

def parse_record(html) -> dict | None: ...  # parse 1 trang detail
def normalize_hs(raw) -> str: ...           # '8704.60.29' → '87046029'
```

**Logic scraping:**
```
GET https://luatvietnam.vn/xuat-nhap-khau/?s=TB-TCHQ&page=N
→ extract links từng TB-TCHQ
→ GET từng link
→ parse_record(html) → dict
→ append vào output.json (streaming, không mất data nếu crash)
→ delay 1s giữa requests
→ resume nếu output.json đã có data
```

### 2. `scripts/data_pipeline.py`
**Tests:** `tests/test_data_pipeline.py`

```python
def validate_record(record, existing_ids=None) -> (bool, list[str]): ...
def merge_into_kg(records, kg_dir) -> dict: ...  # returns {merged, skipped, errors}
```

### 3. `scripts/ollama_categorizer.py`
**Tests:** `tests/test_data_pipeline.py::TestOllamaCategorizer`

```python
class OllamaCategorizer:
    """Dùng Ollama 32B để predict HS code từ product description."""
    
    SYSTEM_PROMPT = """
    Bạn là chuyên gia phân loại hàng hóa hải quan Việt Nam.
    Cho mô tả hàng hóa, hãy trả về mã HS code 8 chữ số phù hợp nhất.
    Chỉ trả về mã HS, không giải thích. Ví dụ: 87046029
    Nếu không chắc, trả về chuỗi rỗng.
    """
    
    def __init__(self, model='qwen2.5-coder:32b'): ...
    def predict(self, description: str) -> str: ...
    def predict_batch(self, descriptions: list) -> list: ...
```

---

## PHASE IMPLEMENTATION

### Phase A — Foundation (chạy ngay)
```bash
# 1. Run tests để thấy RED
python3 -m pytest tests/ -v 2>&1 | head -50

# 2. Aider implement normalize_hs + parse_record (đơn giản nhất)
aider --model ollama/qwen2.5-coder:32b \
  scripts/scraper_tbtchq.py \
  tests/test_scraper_tbtchq.py::TestNormalizeHS \
  --message "Implement normalize_hs() và parse_record() để pass TestNormalizeHS và TestParseRecord"

# 3. Verify
python3 -m pytest tests/test_scraper_tbtchq.py::TestNormalizeHS -v
```

### Phase B — Scraper (sau khi có openclaw)
```bash
aider --model ollama/qwen2.5-coder:32b \
  scripts/scraper_tbtchq.py \
  tests/test_scraper_tbtchq.py \
  --message "Implement ScraperTBTCHQ full class để pass TestScraperFlow"

# Chạy thật (thu thập data mới)
python3 scripts/scraper_tbtchq.py \
  --output data/tb_tchq/tb_tchq_new.json \
  --max-pages 50
```

### Phase C — Ollama Categorizer (dùng 32B classify no-HS records)
```bash
aider --model ollama/qwen2.5-coder:32b \
  scripts/ollama_categorizer.py \
  tests/test_data_pipeline.py \
  --message "Implement OllamaCategorizer dùng Ollama /api/generate để predict HS code"

# Dùng categorizer cho 3,164 records không có HS
python3 -c "
from scripts.ollama_categorizer import OllamaCategorizer
import json

cat = OllamaCategorizer()
with open('data/tb_tchq/tb_tchq_full.json') as f:
    data = json.load(f)

no_hs = [r for r in data if not r.get('phan_loai', {}).get('ma_hs', '')]
print(f'Processing {len(no_hs)} records...')
for r in no_hs[:100]:  # test với 100 trước
    desc = r['hang_hoa'].get('ten_thuong_mai', '')
    if desc and len(desc) > 5:
        hs = cat.predict(desc)
        if hs:
            r['phan_loai']['ma_hs'] = hs
            r['phan_loai']['ma_hs_source'] = 'ollama_predicted'
            print(f'{desc[:40]} → {hs}')
"
```

### Phase D — Merge & Validate
```bash
# Merge data mới sau khi scrape/categorize
aider --model ollama/qwen2.5-coder:32b \
  scripts/data_pipeline.py \
  tests/test_data_pipeline.py \
  --message "Implement validate_record() và merge_into_kg() để pass TestMergeIntoKG"

python3 -c "
from scripts.data_pipeline import merge_into_kg
import json

with open('data/tb_tchq/tb_tchq_new.json') as f:
    new_records = json.load(f)

stats = merge_into_kg(new_records, kg_dir='data/kg')
print(f'Merged: {stats}')
"
```

### Phase E — Regression Tests (luôn chạy)
```bash
# Sau mỗi thay đổi data
python3 -m pytest tests/test_data_pipeline.py::TestKGCoverage -v
```

---

## COVERAGE TARGETS

| Layer | Hiện tại | Target | Cách đạt |
|-------|---------|--------|---------|
| L1 fact | 100% | 100% | ✅ Xong |
| L2 agency | 47.6% | 60% | Enrich từ text |
| L3 KTCN | 61.1% | 80% | Fetch thêm KTCN sources |
| L4 chinh_sach | 66.8% | 80% | Parse thêm thông tư |
| L5 conflict | 51.7% | 60% | Thêm rule types |
| L6 chu_giai | 94.5% | 98% | Fill gaps |
| L7 rates | 100% | 100% | ✅ Xong |
| L8 case_history | 4.5% | 30% | Scrape + Ollama categorize |
| L9 AI reasoning | 0% | 50% | Phase sau |

---

## OLLAMA USAGE PATTERNS

```python
# Pattern 1: Generate (qwen2.5-coder:32b) — reasoning tasks
import urllib.request, json

def ollama_generate(prompt, model='qwen2.5-coder:32b'):
    payload = json.dumps({'model': model, 'prompt': prompt, 'stream': False})
    req = urllib.request.Request('http://localhost:11434/api/generate',
                                  data=payload.encode(),
                                  headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['response']

# Pattern 2: Embed (all-minilm) — similarity tasks
def ollama_embed(text, model='all-minilm:l6-v2'):
    payload = json.dumps({'model': model, 'input': text})
    req = urllib.request.Request('http://localhost:11434/api/embed',
                                  data=payload.encode(),
                                  headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['embeddings'][0]

# Pattern 3: Aider batch — code generation
# aider --model ollama/qwen2.5-coder:32b file.py tests/test_file.py \
#   --message "Implement X to pass all tests"
```

---

## QUICK START

```bash
cd "~/Desktop/work/CLAUDE DATA SHARE/hs-knowledge-api"

# Bước 1: Xem test nào đang fail
python3 -m pytest tests/ -v --tb=line 2>&1 | tail -30

# Bước 2: Implement scraper (no token cost)
aider --model ollama/qwen2.5-coder:32b \
  scripts/scraper_tbtchq.py scripts/data_pipeline.py scripts/ollama_categorizer.py \
  tests/test_scraper_tbtchq.py tests/test_data_pipeline.py \
  --message "Implement all scripts to pass all tests. Use urllib (no requests). Use local Ollama at localhost:11434."

# Bước 3: Verify tất cả pass
python3 -m pytest tests/ -v

# Bước 4: Chạy pipeline thật
python3 scripts/scraper_tbtchq.py --output data/tb_tchq/tb_tchq_scraped.json
```
