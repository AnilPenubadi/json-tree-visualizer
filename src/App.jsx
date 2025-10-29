/*
JSON Tree Visualizer - Single-file React component (App.jsx)

How to use:
1. Create a new React project (Vite or CRA).
2. Install dependencies:
   npm install react-flow-renderer html-to-image
   (or yarn add ...)
3. Add Tailwind CSS (optional) or keep the inline classes.
4. Replace src/App.jsx with this file. Start dev server.

Features implemented in this single-file example:
- JSON input + validation + sample placeholder
- Build hierarchical nodes & edges recursively
- React Flow for rendering, with colors for Objects/Arrays/Primitives
- Search by JSON path (supports $.a.b and a[0].b style)
- Highlight matching node and pan/zoom to it
- Zoom controls + fit view
- Clear/Reset
- Dark/Light toggle
- Click node to copy JSON path
- Hover shows tooltip with path and value
- Download as PNG (requires html-to-image)

Notes:
- This is a compact, educational single-file example. For production, split into smaller files.
- The layout algorithm is a simple tree layout (horizontal depth, vertical spacing); it should work well for moderate-sized JSON.
*/

import React, { useCallback, useMemo, useRef, useState } from 'react';
import ReactFlow, { MiniMap, Controls, Background, useNodesState, useEdgesState, addEdge, applyEdgeChanges, applyNodeChanges } from "reactflow";

import { toPng } from 'html-to-image';

const SAMPLE_JSON = `{
  "user": {
    "id": 1,
    "name": "John Doe",
    "address": {
      "city": "New York",
      "country": "USA"
    },
    "items": [
      { "name": "item1" },
      { "name": "item2" }
    ]
  }
}`;

// helpers to build nodes & edges
let idCounter = 1;
const nextId = () => `n_${idCounter++}`;

function buildTree(json, basePath = '$', depth = 0, index = 0, x = 200, y = 50, nodes = [], edges = []) {
  // returns nodeId and increments nodes/edges arrays
  if (json === null || typeof json !== 'object') {
    // primitive value
    const id = nextId();
    nodes.push({
      id,
      type: 'default',
      data: { label: `${basePath.split('.').pop()}: ${String(json)}`, path: basePath, value: json, nodeType: 'primitive' },
      position: { x: depth * 300 + x, y: y + index * 80 },
    });
    return { id, height: 1 };
  }

  if (Array.isArray(json)) {
    const id = nextId();
    nodes.push({
      id,
      type: 'default',
      data: { label: `${basePath.split('.').pop() || 'root'} [array]`, path: basePath, value: json, nodeType: 'array' },
      position: { x: depth * 300 + x, y: y + index * 80 },
    });

    let childIndex = 0;
    let totalHeight = 0;
    for (let i = 0; i < json.length; i++) {
      const childPath = `${basePath}[${i}]`;
      const res = buildTree(json[i], childPath, depth + 1, index + childIndex, x, y, nodes, edges);
      edges.push({ id: `e_${id}_${res.id}`, source: id, target: res.id, animated: false });
      childIndex += res.height;
      totalHeight += res.height;
    }

    if (totalHeight === 0) totalHeight = 1;
    return { id, height: totalHeight };
  }

  // object
  const id = nextId();
  nodes.push({
    id,
    type: 'default',
    data: { label: `${basePath.split('.').pop() || 'root'} {object}`, path: basePath, value: json, nodeType: 'object' },
    position: { x: depth * 300 + x, y: y + index * 80 },
  });

  let childIndex = 0;
  let totalHeight = 0;
  const keys = Object.keys(json);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const childPath = basePath === '$' ? `${basePath}.${key}` : `${basePath}.${key}`;
    const res = buildTree(json[key], childPath, depth + 1, index + childIndex, x, y, nodes, edges);
    edges.push({ id: `e_${id}_${res.id}`, source: id, target: res.id, animated: false });
    childIndex += res.height;
    totalHeight += res.height;
  }
  if (totalHeight === 0) totalHeight = 1;
  return { id, height: totalHeight };
}

// Node style provider
function nodeStyle(nodeType, highlight) {
  const base = {
    padding: 10,
    borderRadius: 8,
    border: highlight ? '2px solid #FF6B35' : '1px solid rgba(0,0,0,0.12)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    background: '#fff',
    minWidth: 120,
  };
  if (nodeType === 'object') base.background = '#EDE9FE'; // purple-ish
  if (nodeType === 'array') base.background = '#E6F4EA'; // green-ish
  if (nodeType === 'primitive') base.background = '#FFF4E6'; // orange-ish
  if (highlight) base.background = '#FFDAB9';
  return base;
}

// Custom Node renderer (simple)
const DefaultNode = ({ data, isConnectable, selected }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={nodeStyle(data.nodeType, data.highlight)}
    >
      <div style={{ fontWeight: 700 }}>{data.label}</div>
      {hover && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
          <div style={{ color: '#333' }}>{data.path}</div>
          {typeof data.value !== 'object' && <div style={{ color: '#555' }}>{String(data.value)}</div>}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [jsonText, setJsonText] = useState(SAMPLE_JSON);
  const [error, setError] = useState('');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [flowInstance, setFlowInstance] = useState(null);
  const [matchMessage, setMatchMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dark, setDark] = useState(false);
  const reactFlowWrapper = useRef(null);

  const nodeTypes = useMemo(() => ({ default: DefaultNode }), []);

  const visualize = useCallback(() => {
    idCounter = 1;
    setError('');
    setMatchMessage('');
    try {
      const parsed = JSON.parse(jsonText);
      const n = [];
      const e = [];
      buildTree(parsed, '$', 0, 0, 100, 30, n, e);
      // enrich node data for react-flow
      const enriched = n.map((nd) => ({ ...nd, data: { ...nd.data, highlight: false } }));
      setNodes(enriched);
      setEdges(e);
      // after rendering, fit view
      setTimeout(() => {
        if (flowInstance) flowInstance.fitView({ padding: 0.2 });
      }, 200);
    } catch (err) {
      setError(err.message);
    }
  }, [jsonText, flowInstance]);

  const onInit = useCallback((instance) => {
    setFlowInstance(instance);
  }, []);

  const doSearch = useCallback(() => {
    if (!searchQuery) {
      setMatchMessage('Enter a path to search');
      return;
    }
    // normalize searchQuery: allow leading '$.' or not
    const q = searchQuery.trim();
    const normalize = (s) => (s.startsWith('$') ? s : s.startsWith('.') ? `$${s}` : `$${'.' + s}`);
    let norm = q;
    if (!q.startsWith('$')) {
      if (q.startsWith('.')) norm = `$${q}`;
      else norm = `$.${q}`;
    }

    let found = null;
    const newNodes = nodes.map((n) => {
      const match = n.data.path === norm || n.data.path === q || n.data.path.endsWith(q.replace(/^\$\./, ''));
      if (match) found = n;
      return { ...n, data: { ...n.data, highlight: !!match } };
    });
    if (!found) {
      setMatchMessage('No match found');
    } else {
      setMatchMessage('Match found');
      setNodes(newNodes);
      // pan/zoom to node
      setTimeout(() => {
        if (flowInstance) {
          flowInstance.setCenter(found.position.x + 50, found.position.y + 20, { duration: 800 });
        }
      }, 150);
    }
  }, [searchQuery, nodes, flowInstance]);

  const clearAll = useCallback(() => {
    setJsonText('');
    setNodes([]);
    setEdges([]);
    setError('');
    setMatchMessage('');
  }, []);

  const onNodeClick = useCallback((event, node) => {
    const path = node.data.path;
    if (navigator.clipboard) navigator.clipboard.writeText(path);
    alert(`Copied path: ${path}`);
  }, []);

  const exportAsImage = useCallback(() => {
    if (!reactFlowWrapper.current) return;
    toPng(reactFlowWrapper.current)
      .then((dataUrl) => {
        const link = document.createElement('a');
        link.download = 'json-tree.png';
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error('export error', err);
        alert('Could not export image');
      });
  }, []);

  const fitView = useCallback(() => {
    if (flowInstance) flowInstance.fitView({ padding: 0.2 });
  }, [flowInstance]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  return (
    <div className={dark ? 'min-h-screen bg-gray-900 text-white p-6' : 'min-h-screen bg-gray-50 text-gray-900 p-6'}>
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">JSON Tree Visualizer</h1>
          <div className="flex gap-2 items-center">
            <button onClick={() => setDark((d) => !d)} className="px-3 py-1 rounded border">
              {dark ? 'Light' : 'Dark'}
            </button>
            <button onClick={() => { setJsonText(SAMPLE_JSON); setError(''); }} className="px-3 py-1 rounded border">Load Sample</button>
            <button onClick={clearAll} className="px-3 py-1 rounded border">Clear</button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <label className="block font-semibold mb-2">Paste JSON</label>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              className="w-full p-3 rounded border bg-white text-sm text-black"
              placeholder={SAMPLE_JSON}
            />
            {error && <div className="text-red-400 mt-2">Error: {error}</div>}
            <div className="flex gap-2 mt-3">
              <button onClick={visualize} className="px-4 py-2 rounded bg-blue-600 text-white">Generate Tree</button>
              <button onClick={exportAsImage} className="px-4 py-2 rounded border">Download PNG</button>
            </div>

            <div className="mt-6">
              <label className="block font-semibold mb-2">Search by path</label>
              <div className="flex gap-2">
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 p-2 rounded border" placeholder="$.user.address.city or user.items[0].name or .user.name" />
                <button onClick={doSearch} className="px-3 py-2 rounded bg-green-600 text-white">Search</button>
              </div>
              <div className="mt-2 text-sm text-gray-500">{matchMessage}</div>
            </div>

            <div className="mt-6 text-sm">
              <p><strong>Tip:</strong> Click a node to copy its JSON path. Hover a node to view path/value.</p>
            </div>
          </div>

          <div className="md:col-span-2">
            <div ref={reactFlowWrapper} className="h-[640px] rounded border" style={{ background: dark ? '#0b1220' : '#fafafa' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onInit={onInit}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                fitView
                attributionPosition="bottom-left"
                style={{ width: '100%', height: '640px' }}
              >
                <Controls />
                <MiniMap nodeStrokeColor={(n) => {
                  if (!n.data) return '#eee';
                  if (n.data.nodeType === 'object') return '#7c3aed';
                  if (n.data.nodeType === 'array') return '#16a34a';
                  if (n.data.nodeType === 'primitive') return '#f59e0b';
                  return '#aaa';
                }} />
                <Background />
              </ReactFlow>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => flowInstance && flowInstance.zoomIn()} className="px-3 py-1 rounded border">Zoom In</button>
              <button onClick={() => flowInstance && flowInstance.zoomOut()} className="px-3 py-1 rounded border">Zoom Out</button>
              <button onClick={fitView} className="px-3 py-1 rounded border">Fit View</button>
            </div>
          </div>
        </div>

        <footer className="mt-6 text-sm text-gray-500">Made with React + React Flow. Export requires html-to-image.</footer>
      </div>
    </div>
  );
}
