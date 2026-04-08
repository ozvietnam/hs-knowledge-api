import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const dataPath = path.join(process.cwd(), 'data', 'van_ban', 'vb_graph.json');

  if (!fs.existsSync(dataPath)) {
    return res.status(404).json({ error: 'Graph data not found' });
  }

  const graph = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { node, type } = req.query;

  // Filter edges for a specific node
  if (node) {
    const edges = graph.edges.filter(e => e.from === node || e.to === node);
    const relatedIds = new Set(edges.map(e => e.from === node ? e.to : e.from));
    const relatedNodes = graph.nodes.filter(n => relatedIds.has(n.id) || n.id === node);
    return res.json({ node, edges, related: relatedNodes });
  }

  // Filter edges by relationship type
  if (type) {
    const edges = graph.edges.filter(e => e.type === type);
    return res.json({ type, total: edges.length, edges });
  }

  res.json({
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    nodes: graph.nodes,
    edges: graph.edges
  });
}
