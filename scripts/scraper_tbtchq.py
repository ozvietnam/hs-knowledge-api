import re

def normalize_hs(hs_code):
    """Normalize HS code to 8 digits."""
    if not hs_code:
        return ''
    # Remove spaces and dots, then pad with zeros to 8 digits
    hs_code = re.sub(r'[.\s]', '', hs_code).ljust(8, '0')
    return hs_code[:8]
import json
from urllib.request import urlopen

def parse_record(html):
    """Parse HTML to a standardized dict."""
    if not html:
        return None

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')

    so_hieu = soup.find('h1').text.strip()
    ngay_ban_hanh = soup.find('p', class_='date').text.replace('Ngày ban hành: ', '').strip()
    nguoi_ky = soup.find('p', class_='signer').text.replace('Người ký: ', '').strip()

    goods_div = soup.find('div', class_='goods')
    trade_name = goods_div.find('span', class_='trade-name').text.strip()
    hs_code = normalize_hs(goods_div.find('span', class_='hs-code').text.strip())

    summary = soup.find('div', class_='summary').text.strip()

    return {
        'so_hieu': so_hieu,
        'ngay_ban_hanh': ngay_ban_hanh,
        'nguoi_ky': nguoi_ky,
        'hang_hoa': {'ten_thuong_mai': trade_name},
        'phan_loai': {'ma_hs': hs_code, 'ma_hs_display': hs_code},
        'noi_dung_tom_tat': summary,
        'url': ''
    }
import time
import os

class ScraperTBTCHQ:
    """Scraper for TB-TCHQ documents."""

    def __init__(self, output_path):
        self.output_path = output_path
        self.delay_seconds = 0.5

    def fetch_page(self, url):
        """Fetch HTML content from a URL."""
        with urlopen(url) as response:
            return response.read().decode('utf-8')

    def parse_list(self, html):
        """Parse list of TB-TCHQ documents from HTML."""
        # Placeholder for parsing list page
        pass

    def run(self):
        """Run the scraper."""
        # Placeholder for running the scraper
        pass

    def load_existing(self):
        """Load existing records from output file."""
        if os.path.exists(self.output_path):
            with open(self.output_path, 'r') as f:
                return {item['so_hieu'] for item in json.load(f)}
        return set()

    def empty_record(self):
        """Return an empty record template."""
        return {
            'so_hieu': '',
            'ngay_ban_hanh': '',
            'nguoi_ky': '',
            'hang_hoa': {'ten_thuong_mai': ''},
            'phan_loai': {'ma_hs': '', 'ma_hs_display': ''},
            'noi_dung_tom_tat': '',
            'url': ''
        }
