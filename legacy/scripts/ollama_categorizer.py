"""
Ollama Categorizer — dùng qwen2.5-coder:32b predict HS code từ mô tả hàng hóa.
Dùng /api/generate với stream=False, parse từng JSON line (Ollama trả nhiều dòng).
"""
import json
import re
import urllib.request


SYSTEM_PROMPT = (
    "Bạn là chuyên gia phân loại hàng hóa hải quan Việt Nam. "
    "Cho mô tả hàng hóa, hãy trả về mã HS code 8 chữ số phù hợp nhất. "
    "Chỉ trả về mã số, không giải thích. Ví dụ: 87046029. "
    "Nếu không chắc, trả về chuỗi rỗng."
)


class OllamaCategorizer:
    def __init__(self, model='qwen2.5-coder:32b'):
        self.model = model
        self.base_url = 'http://localhost:11434'

    def _generate(self, prompt):
        """Gọi Ollama /api/generate, handle cả stream và non-stream response."""
        payload = json.dumps({
            'model': self.model,
            'prompt': f"{SYSTEM_PROMPT}\n\nHàng hóa: {prompt}",
            'stream': False,
        }).encode()
        req = urllib.request.Request(
            f'{self.base_url}/api/generate',
            data=payload,
            headers={'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode('utf-8')
            # Ollama có thể trả về nhiều JSON lines — lấy line cuối có 'response'
            text = ''
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if 'response' in obj:
                        text += obj['response']
                    if obj.get('done'):
                        break
                except json.JSONDecodeError:
                    continue
            return text.strip()
        except Exception:
            return ''

    def predict(self, description):
        if not description or len(description.strip()) < 2:
            return ''
        raw = self._generate(description)
        # Extract 8-digit number từ response
        m = re.search(r'\b(\d{8})\b', raw)
        return m.group(1) if m else ''

    def predict_batch(self, descriptions):
        return [self.predict(d) for d in descriptions]
