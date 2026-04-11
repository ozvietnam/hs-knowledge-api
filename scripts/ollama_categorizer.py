import json
import urllib.request

class OllamaCategorizer:
    """Ollama categorizer for predicting HS codes."""

    def __init__(self, model):
        self.model = model
        self.base_url = 'http://localhost:11434'

    def predict(self, description):
        """Predict HS code from product description."""
        data = {'model': self.model, 'prompt': description}
        req = urllib.request.Request(f'{self.base_url}/api/generate', json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read())
        return result.get('response', '').strip()

    def predict_batch(self, descriptions):
        """Predict HS codes for a batch of product descriptions."""
        results = []
        for desc in descriptions:
            hs_code = self.predict(desc)
            results.append(hs_code)
        return results
