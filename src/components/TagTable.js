import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import { canonicalizeId } from '../services/tagCanonicalizer';

// Tabella semplice dei tag: ID, Nome, X, Y, Ultimo aggiornamento (s), Batteria
export default function TagTable({ max = 200 }) {
  const { positions, tagNames, tags } = useData();
  const rows = useMemo(() => {
    const now = Date.now();
    return Object.entries(positions || {})
      .slice(0, max)
      .map(([id, p]) => {
        const canon = canonicalizeId(id);
        const tagObj = (tags || []).find(t => canonicalizeId(t.id) === canon);
        return {
          id,
          internalId: tagObj?.internalId || null,
          dbName: tagObj?.name || '',
          name: tagNames[canon] || tagNames[id] || tagObj?.name || '',
          x: Number(p.x).toFixed(2),
          y: Number(p.y).toFixed(2),
          age: ((now - (p.ts || now)) / 1000).toFixed(1),
          cap: (p.cap != null && p.cap !== '') ? p.cap : ''
        };
      });
  }, [positions, tagNames, tags, max]);

  if (!rows.length) return <div style={{ fontSize: 12 }}>Nessun tag attivo.</div>;

  return (
    <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #ccc', borderRadius: 4, padding: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={th}>Internal#</th>
            <th style={th}>ID</th>
            <th style={th}>Nome</th>
            <th style={th}>X</th>
            <th style={th}>Y</th>
            <th style={th}>Età(s)</th>
            <th style={th}>Batt</th>
            <th style={th}>Copy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={td}>{r.internalId ? `#${r.internalId}` : ''}</td>
              <td style={td}>{r.id}</td>
              <td style={td}>{r.name || <span style={{ opacity: 0.5 }}>—</span>}</td>
              <td style={td}>{r.x}</td>
              <td style={td}>{r.y}</td>
              <td style={td}>{r.age}</td>
              <td style={td}>{r.cap}</td>
              <td style={td}>
                {r.internalId && (
                  <button
                    style={{ fontSize: 10, padding: '2px 4px', border: '1px solid #ccc', borderRadius: 3, background: '#f9f9f9', cursor: 'pointer' }}
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(String(r.internalId));
                      } catch(_) {}
                    }}
                    title="Copia internalId"
                  >Copy</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = { padding: '4px 6px', textAlign: 'left', borderBottom: '1px solid #ddd', position: 'sticky', top: 0 };
const td = { padding: '3px 6px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' };
