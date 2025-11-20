// Initial logical areas configuration (example). Coordinates are in map raw units (DXF space pre-normalization).
// Each area is a polygon (array of [x,y]) or rectangle helper.
// You can edit or extend; persisted copy stored in localStorage key 'logicalAreas_v1'.

export const initialAreas = [
  {
    id: 'RECEPTION',
    label: 'Reception',
    color: '#f59e0b',
    polygon: [ [0,0],[0,40],[40,40],[40,0] ],
    offset: { dx:0, dy:0 }
  },
];

export function loadAreas() {
  try {
    const raw = localStorage.getItem('logicalAreas_v1');
    if (!raw) return initialAreas.slice();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch(_) {}
  return initialAreas.slice();
}

export function saveAreas(list) {
  try { localStorage.setItem('logicalAreas_v1', JSON.stringify(list)); } catch(_) {}
}
