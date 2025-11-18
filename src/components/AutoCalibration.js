import React, { useMemo, useState } from "react";
import { useData } from "../context/DataContext";
import { canonicalizeId } from "../services/tagCanonicalizer";

// Compute similarity transform (scale s, rotation R, translation t) mapping P -> Q
// Returns { scale, rotDeg, tx, ty, rmse }
function procrustes2D(P, Q) {
  const n = P.length;
  if (n !== Q.length || n < 2) return { ok: false, reason: "need >=2 pairs" };

  // Means
  let meanPx = 0, meanPy = 0, meanQx = 0, meanQy = 0;
  for (let i = 0; i < n; i++) { meanPx += P[i].x; meanPy += P[i].y; meanQx += Q[i].x; meanQy += Q[i].y; }
  meanPx /= n; meanPy /= n; meanQx /= n; meanQy /= n;

  // Centered arrays and sums
  let Sxx = 0, Sxy = 0, Syx = 0, Syy = 0, Spp = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i].x - meanPx, py = P[i].y - meanPy;
    const qx = Q[i].x - meanQx, qy = Q[i].y - meanQy;
    // cross-covariance
    Sxx += px * qx; Sxy += px * qy; Syx += py * qx; Syy += py * qy;
    Spp += px * px + py * py;
  }
  if (Spp === 0) return { ok: false, reason: "degenerate source points" };

  // Rotation via SVD of cross-covariance matrix [ [Sxx, Sxy], [Syx, Syy] ]
  // For 2x2, we can compute R directly using polar decomposition
  const a = Sxx + Syy; // trace
  const b = Sxy - Syx; // off-diagonal skew
  const norm = Math.hypot(a, b);
  let c = 1, s = 0; // cos, sin
  if (norm > 0) { c = a / norm; s = b / norm; }
  // rotation matrix R = [ [c, -s], [s, c] ]

  // Scale
  const trace = c * (Sxx + Syy) + s * (Sxy - Syx); // trace(R^T * S)
  const scale = trace / Spp;

  // Translation t = meanQ - s R meanP
  const tx = meanQx - scale * (c * meanPx - s * meanPy);
  const ty = meanQy - scale * (s * meanPx + c * meanPy);

  // Error
  let err = 0;
  for (let i = 0; i < n; i++) {
    const x = scale * (c * P[i].x - s * P[i].y) + tx;
    const y = scale * (s * P[i].x + c * P[i].y) + ty;
    const dx = x - Q[i].x, dy = y - Q[i].y;
    err += dx * dx + dy * dy;
  }
  const rmse = Math.sqrt(err / n);
  const rotDeg = Math.atan2(s, c) * 180 / Math.PI;
  return { ok: true, scale, rotDeg, tx, ty, rmse };
}

function applyPre(x, y, opt) {
  // opt: 0 none, 1 invertY, 2 swapXY, 3 swap+invert
  switch (opt) {
    case 1: return { x, y: -y };
    case 2: return { x: y, y: x };
    case 3: return { x: y, y: -x };
    default: return { x, y };
  }
}

export default function AutoCalibration() {
  const { positions, tagNames, updateCalibration, updateTagOverride } = useData();
  const [rows, setRows] = useState([
    { tagId: "", mapX: "", mapY: "" },
    { tagId: "", mapX: "", mapY: "" },
    { tagId: "", mapX: "", mapY: "" },
  ]);
  const [result, setResult] = useState(null);
  const [applyLocalResidCorr, setApplyLocalResidCorr] = useState(true);
  const havePairs = useMemo(() => rows.filter(r => r.tagId && r.mapX !== "" && r.mapY !== "").length, [rows]);

  const normalizeInputId = (raw) => {
    if (!raw) return "";
    const s = String(raw).trim();
    if (!s) return "";
    if (positions[s]) return s;
    // Try hex-like forms: remove separators
    const hex = s.replace(/[^0-9A-Fa-f]/g, '');
    if (hex && /^[0-9A-Fa-f]+$/.test(hex)) {
      if (hex.length >= 8) {
        const low = hex.slice(-8);
        try {
          const dec = String(parseInt(low, 16));
          if (positions[dec]) return dec;
        } catch(_) {}
      }
      // uppercase hex as key (unlikely but safe)
      const up = hex.toUpperCase();
      if (positions[up]) return up;
    }
    return s; // fallback
  };

  const compute = () => {
    // Collect pairs present in positions
    const P = []; // engine positions (raw meters)
    const Q = []; // map target coords (DXF units)
    const IDS = []; // normalized ids used
    rows.forEach(r => {
      const id = normalizeInputId(r.tagId);
      if (!id) return;
      const pos = positions[id];
      if (!pos) return;
      const mx = Number(r.mapX), my = Number(r.mapY);
      if (!isFinite(mx) || !isFinite(my)) return;
      P.push({ x: Number(pos.x) || 0, y: Number(pos.y) || 0 });
      Q.push({ x: mx, y: my });
      IDS.push(id);
    });
    if (P.length < 2) { setResult({ error: "Servono almeno 2 tag con coordinate mappa" }); return; }

    // Try candidate pre-transforms and pick minimal RMSE
    let best = null, bestOpt = 0;
    for (let opt = 0; opt < 4; opt++) {
      const P2 = P.map(p => applyPre(p.x, p.y, opt));
      const fit = procrustes2D(P2, Q);
      if (!fit.ok) continue;
      if (!best || fit.rmse < best.rmse) { best = fit; bestOpt = opt; }
    }
    if (!best) { setResult({ error: "Impossibile calcolare una trasformazione valida" }); return; }

    const next = {
      scale: best.scale,
      offsetX: best.tx,
      offsetY: best.ty,
      rotationDeg: best.rotDeg,
      invertY: bestOpt === 1 || bestOpt === 3,
      swapXY: bestOpt === 2 || bestOpt === 3,
    };
    // Per-residuo: calcola residui per ogni punto inserito
    const resid = [];
    try {
      const rad = (Number(next.rotationDeg) || 0) * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const sc = Number(next.scale) || 1;
      for (let i = 0; i < P.length; i++) {
        let px = P[i].x, py = P[i].y;
        // pre-opt reverse check: our bestOpt expresses how we preprocessed P before fitting; emulate same here
        // We applied applyPre before fitting; so to predict Q_hat we must apply the same pre to P
        const ap = (opt) => {
          switch (opt) {
            case 1: return { x: px, y: -py };
            case 2: return { x: py, y: px };
            case 3: return { x: py, y: -px };
            default: return { x: px, y: py };
          }
        };
        const p2 = ap(bestOpt);
        const xh = sc * (c * p2.x - s * p2.y) + Number(next.offsetX || 0);
        const yh = sc * (s * p2.x + c * p2.y) + Number(next.offsetY || 0);
        const dx = Number(Q[i].x) - xh;
        const dy = Number(Q[i].y) - yh;
        resid.push({ id: IDS[i], dx, dy, err: Math.hypot(dx, dy) });
      }
    } catch(_) {}
    setResult({ ...best, chosen: bestOpt, params: next, residuals: resid });
  };

  const apply = (withLocal = false) => {
    if (!result || !result.params) return;
    updateCalibration(result.params);
    if (withLocal && Array.isArray(result.residuals)) {
      // Applica correzione locale per ciascun tag usato, se residuo significativo
      const EPS = 0.01; // soglia minima in unità mappa
      result.residuals.forEach(r => {
        try {
          const canon = canonicalizeId(r.id) || String(r.id);
          const dx = Number(r.dx) || 0, dy = Number(r.dy) || 0;
          if (Math.hypot(dx, dy) >= EPS) updateTagOverride(canon, dx, dy);
        } catch(_) {}
      });
    }
  };

  const updateRow = (i, field, value) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  return (
    <div className="mt-3 p-3 border rounded bg-gray-50">
      <div className="font-medium mb-2">Calibrazione da 2-3 tag</div>
      <div className="text-xs text-gray-600 mb-2">Inserisci 2 o 3 tag attivi e le loro coordinate sulla mappa (DXF). Puoi inserire l'ID decimale oppure l'ID esadecimale (es. 5583E472CBCC); puoi anche cliccare sulla mappa e incollare l'ultimo punto.</div>

      <div className="grid grid-cols-12 gap-2 items-center mb-2 text-xs">
        <div className="col-span-3 font-semibold">Tag ID</div>
        <div className="col-span-4 font-semibold">Map X</div>
        <div className="col-span-4 font-semibold">Map Y</div>
        <div className="col-span-1"></div>
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <input className="col-span-3 border rounded px-1 py-0.5" placeholder="es. 12345 o 5583E472CBCC" value={r.tagId} onChange={e => updateRow(i, 'tagId', e.target.value)} />
            <div className="col-span-4 flex gap-1">
              <input className="flex-1 border rounded px-1 py-0.5" placeholder="X" value={r.mapX} onChange={e => updateRow(i, 'mapX', e.target.value)} />
              <button className="px-2 border rounded text-[11px]" title="Incolla ultimo click mappa" onClick={() => { const p = window.__DXF_LAST_CLICK; if (p) updateRow(i, 'mapX', String(Number(p.x.toFixed ? p.x.toFixed(2) : p.x))); }}>
                ⬇X
              </button>
            </div>
            <div className="col-span-4 flex gap-1">
              <input className="flex-1 border rounded px-1 py-0.5" placeholder="Y" value={r.mapY} onChange={e => updateRow(i, 'mapY', e.target.value)} />
              <button className="px-2 border rounded text-[11px]" title="Incolla ultimo click mappa" onClick={() => { const p = window.__DXF_LAST_CLICK; if (p) updateRow(i, 'mapY', String(Number(p.y.toFixed ? p.y.toFixed(2) : p.y))); }}>
                ⬇Y
              </button>
            </div>
            <button className="col-span-1 text-[11px] text-gray-600 hover:text-gray-800" onClick={() => updateRow(i, 'tagId', positions && Object.keys(positions)[0] ? Object.keys(positions)[0] : r.tagId)} title="Suggerisci un ID">•</button>
          </React.Fragment>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button className="px-2 py-1 bg-indigo-600 text-white text-sm rounded disabled:opacity-50" disabled={havePairs < 2} onClick={compute}>
          Calcola
        </button>
        <button className="px-2 py-1 bg-emerald-600 text-white text-sm rounded disabled:opacity-50" disabled={!result || !result.params} onClick={() => apply(false)}>
          Applica (solo calibrazione)
        </button>
        <button className="px-2 py-1 bg-emerald-700 text-white text-sm rounded disabled:opacity-50" disabled={!result || !result.params} onClick={() => apply(true)} title="Applica calibrazione globale e correggi i residui dei tag usati con override locali">
          Applica + correggi residui
        </button>
        <label className="ml-2 text-xs flex items-center gap-1"><input type="checkbox" checked={applyLocalResidCorr} onChange={e=> setApplyLocalResidCorr(e.target.checked)} /> auto-correggi residui</label>
        {result && result.rmse !== undefined && (
          <div className="text-xs text-gray-700">
            RMSE: {result.rmse.toFixed(2)} | scale: {result.scale.toFixed(4)} | rot: {result.rotDeg.toFixed(2)}° | off: ({result.tx.toFixed(2)}, {result.ty.toFixed(2)}) | opt: {result.chosen}
            {Array.isArray(result.residuals) && result.residuals.length>0 && (
              <>
                <br/>
                Residui: {result.residuals.map((r,i)=> `${normalizeInputId(r.id)}:${Math.hypot(r.dx,r.dy).toFixed(2)}`).join(' | ')}
              </>
            )}
          </div>
        )}
        {result && result.error && (
          <div className="text-xs text-red-600">{result.error}</div>
        )}
      </div>

      <div className="mt-2 text-[11px] text-gray-600">
        <div className="font-medium">Tag attivi visti ora:</div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(positions).slice(0,8).map(id => (
            <span key={id} className="px-2 py-0.5 bg-white border rounded">
              {tagNames?.[id] ? `${tagNames[id]} (${id})` : id}
            </span>
          ))}
        </div>
        <div className="mt-1">Suggerimento: fai clic su un punto della mappa; poi usa i bottoni ⬇X/⬇Y per compilare le coordinate.</div>
      </div>
    </div>
  );
}
