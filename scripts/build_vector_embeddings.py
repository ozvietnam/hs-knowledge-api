"""
build_vector_embeddings.py — Create vector embeddings cho 11,871 HS codes dùng Ollama all-minilm.

Embeddings: 384-dim vectors từ all-minilm:l6-v2
Input: fact_layer.vn + legal_layer.chu_giai_nhom
Output: vector_embeddings.json { hs_code: [384-dim vector] }

Performance: ~10 min cho first 3 chapters (test run)
"""
import json
import urllib.request
import urllib.error
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
KG_DIR = SCRIPT_DIR.parent / "data" / "kg"
OUTPUT_DIR = SCRIPT_DIR.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "vector_embeddings.json"

# Ollama endpoint
OLLAMA_URL = "http://localhost:11434/api/embed"
MODEL = "all-minilm:l6-v2"

def get_description(item: dict) -> str:
    """Extract description từ HS code item."""
    texts = []
    
    # Fact layer description
    fact_vn = item.get("fact_layer", {}).get("vn", "")
    if fact_vn:
        texts.append(fact_vn)
    
    # Legal layer chú giải
    chu_giai = item.get("legal_layer", {}).get("chu_giai_nhom", "")
    if chu_giai:
        texts.append(chu_giai[:200])  # Limit to first 200 chars
    
    return " ".join(texts).strip()


def embed_text(text: str):
    """Call Ollama all-minilm để tạo embedding."""
    if not text:
        return [0.0] * 384
    
    try:
        payload = json.dumps({"model": MODEL, "input": text}).encode('utf-8')
        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get("embeddings", [[0.0] * 384])[0]
    except Exception as e:
        return [0.0] * 384


def process_chapter(chapter_num: str) -> dict:
    """Process 1 chapter."""
    ch_key = f"{chapter_num:02d}"
    kg_file = KG_DIR / f"chapter_{ch_key}.json"
    
    if not kg_file.exists():
        return {"chapter": ch_key, "status": "SKIP", "count": 0}
    
    with open(kg_file, "r", encoding="utf-8") as f:
        kg_data = json.load(f)
    
    embeddings = {}
    
    for hs_code, item in kg_data.items():
        text = get_description(item)
        embedding = embed_text(text)
        embeddings[hs_code] = embedding
    
    return {
        "chapter": ch_key,
        "status": "OK" if embeddings else "EMPTY",
        "count": len(embeddings),
        "embeddings": embeddings
    }


if __name__ == "__main__":
    import sys
    
    # Check Ollama
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL.rsplit('/', 1)[0]}/tags", timeout=5) as response:
            print("✓ Ollama is running\n")
    except (urllib.error.URLError, Exception):
        print("✗ Ollama not running at http://localhost:11434")
        print("  Start: ollama serve")
        sys.exit(1)
    
    print(f"Building embeddings with {MODEL}...\n")
    
    all_embeddings = {}
    results = []
    
    for ch_num in range(1, 99):
        result = process_chapter(ch_num)
        results.append(result)
        
        status_mark = "✓" if result["status"] == "OK" else "⊘"
        print(f"  {status_mark} Ch{result['chapter']}: {result['count']} embeddings")
        
        if result["status"] == "OK":
            all_embeddings.update(result["embeddings"])
    
    ok_count = sum(1 for r in results if r["status"] == "OK")
    total_count = sum(r["count"] for r in results)
    
    print(f"\n=== EMBEDDING STATS ===")
    print(f"Chapters: {ok_count} processed")
    print(f"Total HS codes embedded: {total_count}")
    print(f"Vector dimension: 384 (all-minilm:l6-v2)")
    
    # Save
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_embeddings, f)
    print(f"\nSaved to: {OUTPUT_FILE}")
