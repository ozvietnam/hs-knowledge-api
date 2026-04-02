// pages/index.js — trang chủ đơn giản
export default function Home() {
  return (
    <div style={{fontFamily:'monospace', padding:'40px', maxWidth:'800px'}}>
      <h1>HS Knowledge Graph API</h1>
      <p>Biểu thuế XNK Việt Nam 2026 — 9 tầng dữ liệu — 11,871 mã HS</p>
      <hr/>
      <h2>Endpoints</h2>
      <ul>
        <li><a href="/api/kg?hs=85167100">/api/kg?hs=85167100</a> — Tra cứu 9 tầng theo mã HS</li>
        <li><a href="/api/kg_search?q=máy+tính">/api/kg_search?q=máy+tính</a> — Tìm kiếm</li>
        <li><a href="/api/kg_chapter?chapter=85">/api/kg_chapter?chapter=85</a> — Toàn bộ 1 chương</li>
        <li><a href="/api/kg_stats">/api/kg_stats</a> — Thống kê tổng quan</li>
      </ul>
    </div>
  );
}
