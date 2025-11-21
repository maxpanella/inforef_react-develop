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

// Solve affine transform A (a,b,c,d,tx,ty) such that [x',y']^T = [ [a b],[c d] ] [x,y]^T + [tx,ty]^T
// Least squares solution for n>=3 pairs. Returns { ok, a,b,c,d,tx,ty, rmse }
function solveAffine2D(P, Q) {
  const n = P.length;
  if (n !== Q.length || n < 3) return { ok: false, reason: 'need >=3 pairs' };
  // Build normal equations for x' and y' separately
  let Sxx=0,Sxy=0,Sx=0,Syy=0,Sy=0,S1=n;
  let SxX=0,SyX=0,SX=0; // for x'
  let SxY=0,SyY=0,SY=0; // for y'
  for (let i=0;i<n;i++) {
    const x=P[i].x, y=P[i].y, X=Q[i].x, Y=Q[i].y;
    Sxx += x*x; Sxy += x*y; Sx += x; Syy += y*y; Sy += y; SX += X; SY += Y;
    SxX += x*X; SyX += y*X; SxY += x*Y; SyY += y*Y;
  }
  // Solve [ [Sxx Sxy Sx],[Sxy Syy Sy],[Sx Sy S1] ] * [a b tx] = [SxX SyX SX]^T for x'
  const M = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx,  Sy,  S1],
  ];
  const vx = [SxX, SyX, SX];
  const vy = [SxY, SyY, SY];
  const inv3 = (A) => {
    const m=A; const a=m[0][0], b=m[0][1], c=m[0][2], d=m[1][0], e=m[1][1], f=m[1][2], g=m[2][0], h=m[2][1], i=m[2][2];
    const A11 =  (e*i - f*h), A12 = -(b*i - c*h), A13 =  (b*f - c*e);
    const A21 = -(d*i - f*g), A22 =  (a*i - c*g), A23 = -(a*f - c*d);
    const A31 =  (d*h - e*g), A32 = -(a*h - b*g), A33 =  (a*e - b*d);
    const det = a*A11 + b*A21 + c*A31;
    if (Math.abs(det) < 1e-12) return null;
    const inv = [
      [A11/det, A12/det, A13/det],
      [A21/det, A22/det, A23/det],
      [A31/det, A32/det, A33/det],
    ];
    return inv;
  };
  const Minv = inv3(M);
  if (!Minv) return { ok:false, reason:'singular' };
  const mult3 = (A,v) => [
    A[0][0]*v[0] + A[0][1]*v[1] + A[0][2]*v[2],
    A[1][0]*v[0] + A[1][1]*v[1] + A[1][2]*v[2],
    A[2][0]*v[0] + A[2][1]*v[1] + A[2][2]*v[2],
  ];
  const solx = mult3(Minv, vx);
  const soly = mult3(Minv, vy);
  const a=solx[0], b=solx[1], tx=solx[2];
  const c=soly[0], d=soly[1], ty=soly[2];
  // Error
  let err=0;
  for (let i=0;i<n;i++) {
    const xh = a*P[i].x + b*P[i].y + tx;
    const yh = c*P[i].x + d*P[i].y + ty;
    const dx = xh - Q[i].x, dy = yh - Q[i].y;
    err += dx*dx + dy*dy;
  }
  const rmse = Math.sqrt(err/n);
  return { ok:true, a,b,c,d,tx,ty, rmse };
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
  const { positions, tagNames, updateCalibration, updateTagOverride, resetCalibration } = useData();
  const [twoPoint, setTwoPoint] = useState({ aId:'', bId:'', ax:'', ay:'', bx:'', by:'' });
  const [rows, setRows] = useState([
    { tagId: "", mapX: "", mapY: "" },
    { tagId: "", mapX: "", mapY: "" },
    { tagId: "", mapX: "", mapY: "" },
  ]);
  const [result, setResult] = useState(null);
  const [applyLocalResidCorr, setApplyLocalResidCorr] = useState(true);
  const [useAffine, setUseAffine] = useState(false);
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
    const PAIRS = []; // {id,mapX,mapY}
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
      PAIRS.push({ id, mapX: mx, mapY: my });
    });
    if (!useAffine && P.length < 2) { setResult({ error: "Servono almeno 2 tag con coordinate mappa" }); return; }
    if (useAffine && P.length < 3) { setResult({ error: "Affine richiede almeno 3 tag" }); return; }

    // Try candidate pre-transforms and pick minimal RMSE for similarity or affine
    let best = null, bestOpt = 0, bestMode = useAffine ? 'affine' : 'similarity';
    for (let opt = 0; opt < 4; opt++) {
      const P2 = P.map(p => applyPre(p.x, p.y, opt));
      const fit = useAffine ? solveAffine2D(P2, Q) : procrustes2D(P2, Q);
      if (!fit.ok) continue;
      if (!best || fit.rmse < best.rmse) { best = fit; bestOpt = opt; }
    }
    if (!best) { setResult({ error: "Impossibile calcolare una trasformazione valida" }); return; }

    // Calcola pivot (media dei punti P dopo pre-opt scelto) e memorizza per rotazioni future centrando il sistema.
    let pivX = 0, pivY = 0;
    try {
      const Pbest = P.map(p => applyPre(p.x, p.y, bestOpt));
      Pbest.forEach(pt => { pivX += pt.x; pivY += pt.y; });
      if (Pbest.length > 0) { pivX /= Pbest.length; pivY /= Pbest.length; }
    } catch(_) {}
    // (Media Q calcolata ma non più necessaria con formula pivot-based diretta)
    const next = useAffine ? {
      affineEnabled: true,
      affine: { a: best.a, b: best.b, c: best.c, d: best.d, tx: best.tx, ty: best.ty },
      invertY: bestOpt === 1 || bestOpt === 3,
      swapXY: bestOpt === 2 || bestOpt === 3,
      pivotX: pivX,
      pivotY: pivY,
    } : (() => {
      // offset corretta: t + scale*R*pivot - pivot
      const rad = (best.rotDeg || 0) * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const sc = best.scale;
      const offX = best.tx + sc * (c * pivX - s * pivY) - pivX;
      const offY = best.ty + sc * (s * pivX + c * pivY) - pivY;
      return {
        scale: best.scale,
        offsetX: offX,
        offsetY: offY,
        rotationDeg: best.rotDeg,
        invertY: bestOpt === 1 || bestOpt === 3,
        swapXY: bestOpt === 2 || bestOpt === 3,
        pivotX: pivX,
        pivotY: pivY,
      };
    })();
    // Per-residuo: calcola residui per ogni punto inserito
    const resid = [];
    try {
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
        let xh, yh;
        if (useAffine) {
          xh = best.a * p2.x + best.b * p2.y + best.tx;
          yh = best.c * p2.x + best.d * p2.y + best.ty;
        } else {
          const rad = (Number(next.rotationDeg) || 0) * Math.PI / 180;
          const c = Math.cos(rad), s = Math.sin(rad);
          const sc = Number(next.scale) || 1;
          // Ruota/scala intorno al pivot per coerenza visiva
          const rx = p2.x - pivX;
          const ry = p2.y - pivY;
          const rX = sc * (c * rx - s * ry);
          const rY = sc * (s * rx + c * ry);
          xh = rX + pivX + Number(next.offsetX || 0);
          yh = rY + pivY + Number(next.offsetY || 0);
        }
        const dx = Number(Q[i].x) - xh;
        const dy = Number(Q[i].y) - yh;
        resid.push({ id: IDS[i], targetX: Number(Q[i].x), targetY: Number(Q[i].y), predX: xh, predY: yh, dx, dy, err: Math.hypot(dx, dy) });
      }
    } catch(_) {}
    setResult({ ...best, mode: bestMode, chosen: bestOpt, params: next, residuals: resid, pairs: PAIRS });
  };

  // Calcolo robusto con eliminazione outlier basata sulla mediana dei residui iniziali
  const computeRobust = () => {
    const P = []; const Q = []; const IDS = []; const PAIRS = [];
    rows.forEach(r => {
      const id = normalizeInputId(r.tagId); if (!id) return;
      const pos = positions[id]; if (!pos) return;
      const mx = Number(r.mapX), my = Number(r.mapY); if (!isFinite(mx)||!isFinite(my)) return;
      P.push({ x: Number(pos.x)||0, y: Number(pos.y)||0 });
      Q.push({ x: mx, y: my }); IDS.push(id); PAIRS.push({ id, mapX: mx, mapY: my });
    });
    if (P.length < 3) { setResult({ error: 'Robusto richiede >=3 punti' }); return; }
    let best=null, bestOpt=0;
    for (let opt=0; opt<4; opt++) {
      const P2 = P.map(p => applyPre(p.x,p.y,opt));
      const fit = procrustes2D(P2, Q);
      if (!fit.ok) continue;
      if (!best || fit.rmse < best.rmse) { best = fit; bestOpt = opt; }
    }
    if (!best) { setResult({ error: 'Impossibile calcolare similarità iniziale' }); return; }
    const residuals0 = [];
    for (let i=0;i<P.length;i++) {
      const p2 = applyPre(P[i].x, P[i].y, bestOpt);
      const rad = (best.rotDeg||0)*Math.PI/180; const c=Math.cos(rad), s=Math.sin(rad);
      const xh = best.scale*(c*p2.x - s*p2.y) + best.tx;
      const yh = best.scale*(s*p2.x + c*p2.y) + best.ty;
      residuals0.push(Math.hypot(Q[i].x - xh, Q[i].y - yh));
    }
    const sorted = residuals0.slice().sort((a,b)=>a-b);
    const med = sorted[Math.floor(sorted.length/2)] || 0;
    const thresh = med*2.5 + 0.0001;
    const inliers = residuals0.map((e,i)=> ({e,i})).filter(o=> o.e <= thresh).map(o=>o.i);
    if (inliers.length < 2) { setResult({ error: 'Tutti i punti sono outlier (soglia troppo stretta)' }); return; }
    const P_in = inliers.map(i => applyPre(P[i].x, P[i].y, bestOpt));
    const Q_in = inliers.map(i => Q[i]);
    const refit = procrustes2D(P_in, Q_in);
    if (!refit.ok) { setResult({ error: 'Refit fallito sugli inliers' }); return; }
    let pivX=0,pivY=0; P_in.forEach(pt=>{pivX+=pt.x; pivY+=pt.y;}); pivX/=P_in.length; pivY/=P_in.length;
    // Calcola media Q_in per offset pivot-based
    // (Media Q_in non necessaria per offset, formula usa refit.tx/ty)
    const params = (() => {
      const rad = (refit.rotDeg || 0) * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const sc = refit.scale;
      // offset pivot-based coerente col mapping originale
      const offX = refit.tx + sc * (c * pivX - s * pivY) - pivX;
      const offY = refit.ty + sc * (s * pivX + c * pivY) - pivY;
      return {
        scale: refit.scale,
        offsetX: offX,
        offsetY: offY,
        rotationDeg: refit.rotDeg,
        invertY: bestOpt===1 || bestOpt===3,
        swapXY: bestOpt===2 || bestOpt===3,
        pivotX: pivX,
        pivotY: pivY,
      };
    })();
    const residuals = [];
    for (let i=0;i<P.length;i++) {
      const p2 = applyPre(P[i].x, P[i].y, bestOpt);
      const rad = (params.rotationDeg||0)*Math.PI/180; const c=Math.cos(rad), s=Math.sin(rad);
      const rx = p2.x - pivX; const ry = p2.y - pivY;
      const rX = params.scale*(c*rx - s*ry);
      const rY = params.scale*(s*rx + c*ry);
      const xh = rX + pivX + params.offsetX;
      const yh = rY + pivY + params.offsetY;
      const dx = Q[i].x - xh; const dy = Q[i].y - yh;
      residuals.push({ id: IDS[i], targetX: Q[i].x, targetY: Q[i].y, predX: xh, predY: yh, dx, dy, err: Math.hypot(dx,dy), outlier: residuals0[i] > thresh });
    }
    const rmse = Math.sqrt(residuals.reduce((s,r)=> s + r.err*r.err, 0) / residuals.length);
    setResult({ ...refit, rmse, mode:'robust', chosen: bestOpt, params, residuals, inliers: inliers.length, total: P.length, pairs: PAIRS, median: med, thresh });
  };

  const calibrateTwoPoints = () => {
    const { aId, bId, ax, ay, bx, by } = twoPoint;
    const idA = normalizeInputId(aId); const idB = normalizeInputId(bId);
    if (!idA || !idB) { alert('Inserisci due ID validi'); return; }
    const pA = positions[idA]; const pB = positions[idB];
    if (!pA || !pB) { alert('Tag non trovati'); return; }
    const qA = { x: Number(ax), y: Number(ay) }; const qB = { x: Number(bx), y: Number(by) };
    if (!isFinite(qA.x) || !isFinite(qA.y) || !isFinite(qB.x) || !isFinite(qB.y)) { alert('Coordinate mappa non valide'); return; }
    const vP = { x: (Number(pB.x)||0) - (Number(pA.x)||0), y: (Number(pB.y)||0) - (Number(pA.y)||0) };
    const vQ = { x: qB.x - qA.x, y: qB.y - qA.y };
    const dP = Math.hypot(vP.x, vP.y); const dQ = Math.hypot(vQ.x, vQ.y);
    if (dP < 1e-6 || dQ < 1e-6) { alert('Distanze insufficienti'); return; }
    const scale = dQ / dP;
    const angP = Math.atan2(vP.y, vP.x); const angQ = Math.atan2(vQ.y, vQ.x);
    const rot = angQ - angP; const cos = Math.cos(rot), sin = Math.sin(rot);
    const offX = qA.x - scale*(cos*(Number(pA.x)||0) - sin*(Number(pA.y)||0));
    const offY = qA.y - scale*(sin*(Number(pA.x)||0) + cos*(Number(pA.y)||0));
    updateCalibration({ scale, rotationDeg: rot*180/Math.PI, offsetX: offX, offsetY: offY, pivotX: Number(pA.x)||0, pivotY: Number(pA.y)||0, affineEnabled:false });
    setResult({ mode:'twoPoint', scale, rotDeg: rot*180/Math.PI, tx: offX, ty: offY, rmse:0, chosen:0, params:{ scale, rotationDeg: rot*180/Math.PI, offsetX: offX, offsetY: offY, pivotX: Number(pA.x)||0, pivotY: Number(pA.y)||0 } });
  };

  const apply = (withLocal = false) => {
    if (!result || !result.params) return;
    const meta = {};
    if (Array.isArray(result.pairs)) meta.referencePoints = result.pairs;
    if (Array.isArray(result.residuals)) meta.lastResiduals = result.residuals.map(r => ({ id: r.id, dx: r.dx, dy: r.dy, err: r.err }));
    updateCalibration({ ...result.params, ...meta });
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
              <button className="px-2 border rounded text-[11px]" title="Incolla ultimo click mappa" onClick={() => { const p = window.__DXF_LAST_CLICK; if (p) { const vx = (p.rawOriginalX!=null)? p.rawOriginalX : p.x; updateRow(i, 'mapX', String(Number(vx.toFixed ? vx.toFixed(2) : vx))); } }}>
                ⬇X
              </button>
            </div>
            <div className="col-span-4 flex gap-1">
              <input className="flex-1 border rounded px-1 py-0.5" placeholder="Y" value={r.mapY} onChange={e => updateRow(i, 'mapY', e.target.value)} />
              <button className="px-2 border rounded text-[11px]" title="Incolla ultimo click mappa" onClick={() => { const p = window.__DXF_LAST_CLICK; if (p) { const vy = (p.rawOriginalY!=null)? p.rawOriginalY : p.y; updateRow(i, 'mapY', String(Number(vy.toFixed ? vy.toFixed(2) : vy))); } }}>
                ⬇Y
              </button>
            </div>
            <div className="col-span-1 flex flex-col gap-1">
              <button className="text-[11px] text-gray-600 hover:text-gray-800" onClick={() => updateRow(i, 'tagId', positions && Object.keys(positions)[0] ? Object.keys(positions)[0] : r.tagId)} title="Suggerisci un ID">•</button>
              {rows.length>2 && (
                <button className="text-[11px] text-red-600 hover:text-red-800" title="Rimuovi" onClick={() => setRows(prev => prev.filter((_,idx)=> idx!==i))}>✕</button>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="mb-3"><button className="px-2 py-1 bg-gray-200 rounded text-[11px]" onClick={() => setRows(prev => [...prev, { tagId:'', mapX:'', mapY:'' }])}>Aggiungi riga</button></div>

      {/* Calibrazione 2 punti */}
      <div className="mt-4 p-2 border rounded bg-white">
        <div className="text-xs font-semibold mb-1">Calibrazione 2 Punti (lineare)</div>
        <div className="grid grid-cols-12 gap-1 text-[11px] mb-2">
          <input className="col-span-2 border rounded px-1" placeholder="ID A" value={twoPoint.aId} onChange={e=> setTwoPoint(prev=> ({...prev,aId:e.target.value}))} />
          <input className="col-span-2 border rounded px-1" placeholder="Ax" value={twoPoint.ax} onChange={e=> setTwoPoint(prev=> ({...prev,ax:e.target.value}))} />
          <input className="col-span-2 border rounded px-1" placeholder="Ay" value={twoPoint.ay} onChange={e=> setTwoPoint(prev=> ({...prev,ay:e.target.value}))} />
          <input className="col-span-2 border rounded px-1" placeholder="ID B" value={twoPoint.bId} onChange={e=> setTwoPoint(prev=> ({...prev,bId:e.target.value}))} />
          <input className="col-span-2 border rounded px-1" placeholder="Bx" value={twoPoint.bx} onChange={e=> setTwoPoint(prev=> ({...prev,bx:e.target.value}))} />
          <input className="col-span-2 border rounded px-1" placeholder="By" value={twoPoint.by} onChange={e=> setTwoPoint(prev=> ({...prev,by:e.target.value}))} />
        </div>
        <div className="flex gap-2 text-[11px]">
          <button className="px-2 py-1 bg-blue-600 text-white rounded" onClick={()=> {
            const p = window.__DXF_LAST_CLICK; if (p) setTwoPoint(prev=> ({...prev, ax:String(p.rawOriginalX??p.x), ay:String(p.rawOriginalY??p.y)}));
          }}>⬇A</button>
          <button className="px-2 py-1 bg-indigo-600 text-white rounded" onClick={()=> {
            const p = window.__DXF_LAST_CLICK; if (p) setTwoPoint(prev=> ({...prev, bx:String(p.rawOriginalX??p.x), by:String(p.rawOriginalY??p.y)}));
          }}>⬇B</button>
          <button className="px-2 py-1 bg-emerald-600 text-white rounded" onClick={calibrateTwoPoints}>Calibra 2 Punti</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="px-2 py-1 bg-indigo-600 text-white text-sm rounded disabled:opacity-50" disabled={havePairs < 2} onClick={compute}>Calcola</button>
        <button className="px-2 py-1 bg-purple-600 text-white text-sm rounded disabled:opacity-50" disabled={havePairs < 3} onClick={computeRobust} title="Stima robusta con outlier">Calcola Robusto</button>
        <button className="px-2 py-1 bg-emerald-600 text-white text-sm rounded disabled:opacity-50" disabled={!result || !result.params} onClick={() => apply(false)}>
          Applica (solo calibrazione)
        </button>
        <button className="px-2 py-1 bg-emerald-700 text-white text-sm rounded disabled:opacity-50" disabled={!result || !result.params} onClick={() => apply(true)} title="Applica calibrazione globale e correggi i residui dei tag usati con override locali">
          Applica + correggi residui
        </button>
        <button className="px-2 py-1 bg-teal-600 text-white text-sm rounded disabled:opacity-50" disabled={!result || !result.params} onClick={() => {
          if (!result || !Array.isArray(result.residuals) || !result.params) return;
          // Calcola media dei residui (target - predicted) e recentra offset globale
          let sumDx=0,sumDy=0,n=0; result.residuals.forEach(r=> { if (isFinite(r.dx) && isFinite(r.dy)) { sumDx+=r.dx; sumDy+=r.dy; n++; } });
          if (n===0) return;
          const avgDx = sumDx / n; const avgDy = sumDy / n;
          const p = result.params;
          const newParams = { ...p, offsetX: (Number(p.offsetX)||0) + avgDx, offsetY: (Number(p.offsetY)||0) + avgDy };
          const meta = {};
          if (Array.isArray(result.pairs)) meta.referencePoints = result.pairs;
          if (Array.isArray(result.residuals)) meta.lastResiduals = result.residuals.map(r => ({ id: r.id, dx: r.dx, dy: r.dy, err: r.err }));
          updateCalibration({ ...newParams, ...meta });
        }} title="Applica calibrazione e centra usando media dei residui">
          Applica + centra
        </button>
        <button className="px-2 py-1 bg-red-600 text-white text-sm rounded" onClick={() => {
          resetCalibration();
          setResult(null);
          setRows([
            { tagId: "", mapX: "", mapY: "" },
            { tagId: "", mapX: "", mapY: "" },
            { tagId: "", mapX: "", mapY: "" },
          ]);
          setTwoPoint({ aId:'', bId:'', ax:'', ay:'', bx:'', by:'' });
        }} title="Ripristina calibrazione predefinita e svuota i campi">
          Reset totale
        </button>
        <label className="ml-2 text-xs flex items-center gap-1"><input type="checkbox" checked={applyLocalResidCorr} onChange={e=> setApplyLocalResidCorr(e.target.checked)} /> auto-correggi residui</label>
        <label className="ml-4 text-xs flex items-center gap-1"><input type="checkbox" checked={useAffine} onChange={e=> setUseAffine(e.target.checked)} /> Usa Affine (>=3 punti)</label>
        {result && result.rmse !== undefined && (
          <div className="text-xs text-gray-700">
            {result.mode === 'affine' ? (
              <>RMSE: {result.rmse.toFixed(2)} | affine: a={Number(result.a).toFixed(4)} b={Number(result.b).toFixed(4)} c={Number(result.c).toFixed(4)} d={Number(result.d).toFixed(4)} tx={Number(result.tx).toFixed(2)} ty={Number(result.ty).toFixed(2)} | opt: {result.chosen}</>
            ) : (
              <>RMSE: {result.rmse.toFixed(2)} | scale: {result.scale.toFixed(4)} | rot: {result.rotDeg.toFixed(2)}° | off: ({result.tx.toFixed(2)}, {result.ty.toFixed(2)}) | opt: {result.chosen}</>
            )}
            {Array.isArray(result.residuals) && result.residuals.length>0 && (
              <>
                <br/>
                Residui: {result.residuals.map((r)=> `${normalizeInputId(r.id)}:${Math.hypot(r.dx,r.dy).toFixed(2)}${r.outlier?'*':''}`).join(' | ')}
                {result.mode==='robust' && (
                  <><br/>Mediana: {result.median.toFixed(2)} • Soglia: {result.thresh.toFixed(2)} • Inliers: {result.inliers}/{result.total}</>
                )}
                <div className="mt-2 border-t pt-1">
                  <div className="font-semibold">Diagnostica punti:</div>
                  <div className="overflow-auto max-h-40">
                    <table className="min-w-full text-[10px]">
                      <thead>
                        <tr className="text-left">
                          <th className="pr-2">ID</th>
                          <th className="pr-2">TargetX</th>
                          <th className="pr-2">TargetY</th>
                          <th className="pr-2">PredX</th>
                          <th className="pr-2">PredY</th>
                          <th className="pr-2">dX</th>
                          <th className="pr-2">dY</th>
                          <th className="pr-2">Err</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.residuals.map(r => (
                          <tr key={r.id} className={r.outlier? 'text-red-600' : ''}>
                            <td className="pr-2 whitespace-nowrap">{normalizeInputId(r.id)}</td>
                            <td className="pr-2">{r.targetX?.toFixed ? r.targetX.toFixed(2) : r.targetX}</td>
                            <td className="pr-2">{r.targetY?.toFixed ? r.targetY.toFixed(2) : r.targetY}</td>
                            <td className="pr-2">{r.predX?.toFixed ? r.predX.toFixed(2) : r.predX}</td>
                            <td className="pr-2">{r.predY?.toFixed ? r.predY.toFixed(2) : r.predY}</td>
                            <td className="pr-2">{r.dx?.toFixed ? r.dx.toFixed(2) : r.dx}</td>
                            <td className="pr-2">{r.dy?.toFixed ? r.dy.toFixed(2) : r.dy}</td>
                            <td className="pr-2">{r.err?.toFixed ? r.err.toFixed(2) : r.err}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
