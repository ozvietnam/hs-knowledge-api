"""pytest config — skip tests cần Ollama nếu Ollama không chạy."""
import pytest
import urllib.request

def ollama_available():
    try:
        urllib.request.urlopen('http://localhost:11434/api/tags', timeout=2)
        return True
    except:
        return False

def pytest_collection_modifyitems(items):
    skip_ollama = pytest.mark.skip(reason="Ollama not running")
    for item in items:
        if 'ollama' in item.name.lower() or 'categorizer' in item.name.lower():
            if not ollama_available():
                item.add_marker(skip_ollama)
