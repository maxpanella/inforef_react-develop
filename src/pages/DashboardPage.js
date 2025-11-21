import React, { useEffect, useState } from "react";
import { canonicalizeId } from "../services/tagCanonicalizer";
import LZString from "lz-string";
import { useData } from "../context/DataContext";
import { DxfViewer } from "../components/DxfViewer";
import AutoCalibration from "../components/AutoCalibration";
// CalibrationWizard opzionale: se non esiste il componente, commentare questa riga.
// import CalibrationWizard from "../components/CalibrationWizard";
// import { LocalsenseClient } from '../services/localsenseClient'; // non usato direttamente

// Niente tag finti
const SHOW_FAKE_TAGS = false;

const DashboardPage = () => {
  const {
    sites,
    currentSite,
    selectSite,
    employees,
    assets,
    tags,
    tagAssociations,
    positions,
    isConnected,
  // debug RealBlueIOT
  _lastTag,
  _lastRawFrame,
  vibrateTag,
  videoTrack,
    tagNames,
    calibration,
    updateCalibration,
    saveCalibration,
    loadCalibration,
    resetCalibration,
    reloadTags,
    createTag,
    removeTag,
    restoreTag,
    updateTagOverride,
    clearTagOverride,
    calibrationDirty,
    getDiagnostics,
    clearDiagnostics,
    setDiagnosticsPaused,
  } = useData();

  // Set dei tag presenti in anagrafica (DB), canonicalizzati
  const backendTagSet = React.useMemo(() => {
    try {
      const s = new Set();
      (tags || []).forEach(t => {
        try {
          const c = canonicalizeId(t.id);
          if (!c) return;
          s.add(c);
          // add common variant to ease matching (low32 or hex form)
          const hx = String(c).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
          if (hx && /^[0-9A-Fa-f]{8,}$/.test(hx)) {
            // canonical is HEX -> also store low32 decimal
            try { s.add(String(parseInt(hx.slice(-8), 16) >>> 0)); } catch(_) {}
          } else if (/^[0-9]+$/.test(String(c))) {
            // canonical is decimal -> also store 8-char hex
            try { s.add((Number(c)>>>0).toString(16).toUpperCase().padStart(8,'0')); } catch(_) {}
          }
        } catch(_) {}
      });
      return s;
    } catch { return new Set(); }
  }, [tags]);

  // Mappa ID canonico -> nome da anagrafica (DB). Usata come fonte primaria per il display
  const backendTagNameMap = React.useMemo(() => {
    try {
      const m = {};
      (tags || []).forEach(t => {
        try {
          const c = canonicalizeId(t.id);
          const nm = (t && typeof t.name === 'string' && t.name.trim()) ? t.name.trim() : null;
          if (c && nm) m[String(c)] = nm;
        } catch(_) {}
      });
      return m;
    } catch { return {}; }
  }, [tags]);

  const [mapData, setMapData] = useState(null);
  const [enhancedPositions, setEnhancedPositions] = useState({});
  const [selectedTag, setSelectedTag] = useState(null);
  const [mapBounds, setMapBounds] = useState(null); // {min:{x,y}, max:{x,y}} unità DXF raw
  const [toast, setToast] = useState(null); // piccoli messaggi di conferma
  // Diagnostics UI state
  const [diagTagFilter, setDiagTagFilter] = useState("");
  const [diagLimit, setDiagLimit] = useState(200);
  const [diagPaused, setDiagPaused] = useState(false);
  // Suggestion UI state for auto-centering offsets
  const [suggestionVisible, setSuggestionVisible] = useState(false);
  const [suggestedOffsets, setSuggestedOffsets] = useState(null);
  const [autoInitDone, setAutoInitDone] = useState(false);
  const lastBannerRef = React.useRef({ shownAt: 0, hiddenAt: 0, forceHoldUntil: 0 });
  // Tool di calibrazione scala tramite spostamento
  const [calibTagId, setCalibTagId] = useState(""); // cattura A/B dallo stesso tag
  const [ptA, setPtA] = useState(null); // {x,y,ts}
  const [ptB, setPtB] = useState(null); // {x,y,ts}
  const [realDist, setRealDist] = useState(5); // distanza reale misurata (metri) di default
  const rawDist = ptA && ptB ? Math.hypot((ptB.x || 0) - (ptA.x || 0), (ptB.y || 0) - (ptA.y || 0)) : null;
  const suggestedScale = rawDist && isFinite(rawDist) && rawDist > 0 ? (Number(realDist) || 0) / rawDist : null;
  const capturePoint = (which) => {
    const tid = (calibTagId || selectedTag || "").trim();
    if (!tid) { alert("Seleziona o inserisci un Tag ID"); return; }
    const p = positions[tid];
    if (!p) { alert(`Nessuna posizione RAW disponibile per il tag ${tid}`); return; }
    const rec = { x: Number(p.x) || 0, y: Number(p.y) || 0, ts: p.ts || Date.now() };
    if (which === 'A') setPtA(rec); else setPtB(rec);
  };
  const applySuggestedScale = () => {
    if (!suggestedScale || !isFinite(suggestedScale) || suggestedScale <= 0) { alert("Calcolo scala non valido"); return; }
    updateCalibration({ scale: suggestedScale });
    try { setToast({ type: 'success', msg: `Scala aggiornata a ${suggestedScale.toFixed(6)}` }); } catch {}
  };
  // Calibrazione due tag per allineare asse Y: cattura A da tagA e B da tagB
  const [tagAId, setTagAId] = useState("");
  const [tagBId, setTagBId] = useState("");
  const [ptA2, setPtA2] = useState(null); // {x,y,ts}
  const [ptB2, setPtB2] = useState(null);
  const rawDist2 = ptA2 && ptB2 ? Math.hypot((ptB2.x||0)-(ptA2.x||0), (ptB2.y||0)-(ptA2.y||0)) : null;
  const angleDegAB = (() => {
    if (!ptA2 || !ptB2) return null;
    const dx = (ptB2.x||0) - (ptA2.x||0);
    const dy = (ptB2.y||0) - (ptA2.y||0);
    if (!isFinite(dx) || !isFinite(dy) || (dx===0 && dy===0)) return null;
    const phi = Math.atan2(dy, dx); // rad, angolo del vettore rispetto a X
    const theta = (Math.PI/2) - phi; // rotazione necessaria per allineare a +Y
    return theta * 180 / Math.PI;
  })();
  const captureAB = (which) => {
    const tid = (which==='A' ? (tagAId||"") : (tagBId||"")).trim();
    if (!tid) { alert("Inserisci Tag ID per "+which); return; }
    const p = positions[tid];
    if (!p) { alert(`Nessuna posizione RAW per il tag ${tid}`); return; }
    const rec = { x: Number(p.x)||0, y: Number(p.y)||0, ts: p.ts || Date.now() };
    if (which==='A') setPtA2(rec); else setPtB2(rec);
  };
  const applyTwoTagCalibration = () => {
    if (!rawDist2 || !isFinite(rawDist2) || rawDist2<=0) { alert("Distanza RAW non valida (A/B)"); return; }
    if (!angleDegAB || !isFinite(angleDegAB)) { alert("Angolo non disponibile, cattura A e B"); return; }
    const newScale = (Number(realDist)||0) / rawDist2;
    if (!isFinite(newScale) || newScale<=0) { alert("Scala calcolata non valida"); return; }
    let rot = angleDegAB;
    // Se dopo la rotazione il verso risulta negativo lungo Y, ruota di 180°
    // Stima: usa vettore ruotato virtualmente
    const phi = Math.atan2((ptB2.y-ptA2.y),(ptB2.x-ptA2.x));
    const theta = (Math.PI/2) - phi;
  const ry = Math.sin(theta)*(ptB2.x-ptA2.x) + Math.cos(theta)*(ptB2.y-ptA2.y); // componente Y dopo rotazione
  if (ry < 0) rot += 180; // se invertito, aggiusta rotazione
    updateCalibration({ rotationDeg: rot, scale: newScale });
    try { setToast({ type: 'success', msg: `Calibrazione aggiornata: scala=${newScale.toFixed(4)}, rot=${rot.toFixed(2)}°` }); } catch {}
  };
  // Centra tag selezionato adattando gli offset
  const centerSelectedTag = () => {
    if (!selectedTag) return;
    const info = enhancedPositions[selectedTag];
    if (!info) return;
    const targetX = mapBounds ? ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2 : 500;
    const targetY = mapBounds ? ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2 : 400;
    const offsetX_new = (Number(calibration.offsetX) || 0) + (targetX - info.x);
    const offsetY_new = (Number(calibration.offsetY) || 0) + (targetY - info.y);
    updateCalibration({ offsetX: offsetX_new, offsetY: offsetY_new });
  };

  // Centra SOLO il tag selezionato applicando una correzione locale (non sposta gli altri)
  const centerSelectedTagLocal = () => {
    if (!selectedTag) return;
    const info = enhancedPositions[selectedTag];
    if (!info) return;
    const targetX = mapBounds ? ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2 : 500;
    const targetY = mapBounds ? ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2 : 400;
    const dx = targetX - Number(info.x || 0);
    const dy = targetY - Number(info.y || 0);
    const key = String(selectedTag);
    const cur = (calibration && calibration.tagOverrides) ? calibration.tagOverrides : {};
    const prev = cur[key] || { dx: 0, dy: 0 };
    updateTagOverride(key, (Number(prev.dx)||0) + dx, (Number(prev.dy)||0) + dy);
  };

  const placeSelectedTag = () => {
    if (!selectedTag) return;
    const info = enhancedPositions[selectedTag];
    if (!info) return;
    const defX = mapBounds ? ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2 : 500;
  const defY = mapBounds ? ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2 : 400;
    const destStr = window.prompt('Inserisci coordinate destinazione "X,Y"', `${defX},${defY}`);
    if (!destStr) return;
    const parts = destStr.split(/[,; ]+/).map(v => Number(v));
    if (parts.length < 2 || parts.some(v => Number.isNaN(v))) {
      alert('Formato non valido');
      return;
    }
    const [destX, destY] = parts;
    const offsetX_new = (Number(calibration.offsetX) || 0) + (destX - info.x);
    const offsetY_new = (Number(calibration.offsetY) || 0) + (destY - info.y);
    updateCalibration({ offsetX: offsetX_new, offsetY: offsetY_new });
  };

  // Posiziona SOLO il tag selezionato (override locale)
  const placeSelectedTagLocal = () => {
    if (!selectedTag) return;
    const info = enhancedPositions[selectedTag];
    if (!info) return;
    const defX = mapBounds ? ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2 : 500;
    const defY = mapBounds ? ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2 : 400;
    const destStr = window.prompt('Inserisci coordinate destinazione (solo questo tag) "X,Y"', `${defX},${defY}`);
    if (!destStr) return;
    const parts = destStr.split(/[,; ]+/).map(v => Number(v));
    if (parts.length < 2 || parts.some(v => Number.isNaN(v))) { alert('Formato non valido'); return; }
    const [destX, destY] = parts;
    const dx = destX - Number(info.x || 0);
    const dy = destY - Number(info.y || 0);
    const key = String(selectedTag);
    const cur = (calibration && calibration.tagOverrides) ? calibration.tagOverrides : {};
    const prev = cur[key] || { dx: 0, dy: 0 };
    updateTagOverride(key, (Number(prev.dx)||0) + dx, (Number(prev.dy)||0) + dy);
  };

  // Rimuove correzione locale del tag selezionato
  const clearSelectedTagLocal = () => {
    if (!selectedTag) return;
    clearTagOverride(String(selectedTag));
  };

  // Rinomina (imposta/aggiorna nome) di un TAG registrato in anagrafica
  const renameTag = async (rawId) => {
    const canon = canonicalizeId(rawId);
    if (!canon) return;
    let name = window.prompt('Nuovo nome per questo TAG', '');
    if (name === null) return; // annullato
    name = String(name).trim();
    try {
      await createTag(canon, null, name || null);
      await reloadTags();
      setToast({ type: 'success', msg: `Nome aggiornato (${canon})` });
    } catch(e) {
      alert('Errore aggiornamento nome: ' + (e?.message || ''));
    }
  };

  // Ancora l'origine mappa usando il tag selezionato: pivot = RAW del tag, offset = target - pivot
  const anchorSelectedTagAsOrigin = (targetX = 0, targetY = 0) => {
    if (!selectedTag) { alert('Seleziona prima un tag'); return; }
    // Preferisci RAW dalla sorgente posizioni (pre-trasformazione)
    const raw = positions[selectedTag] || positions[canonicalizeId(selectedTag)];
    if (!raw || !isFinite(raw.x) || !isFinite(raw.y)) { alert('Posizione RAW non disponibile per il tag selezionato'); return; }
    const pivX = Number(raw.x) || 0;
    const pivY = Number(raw.y) || 0;
    const offX = Number(targetX) - pivX;
    const offY = Number(targetY) - pivY;
    updateCalibration({ pivotX: pivX, pivotY: pivY, offsetX: offX, offsetY: offY });
    try { setToast?.({ type: 'success', msg: `Ancora origine: pivot=(${pivX.toFixed(2)},${pivY.toFixed(2)}) ⇒ offset=(${offX.toFixed(2)},${offY.toFixed(2)})` }); } catch(_) {}
  };
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [useRawPositions, setUseRawPositions] = useState(false);
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [followSelected, setFollowSelected] = useState(false); // disattiva pan automatico sul click
  const [showRefPoints, setShowRefPoints] = useState(true);

  // Rileva se i tag risultano fuori dalla planimetria e fornisce un'azione rapida di riallineamento offset
  const [offMapInfo, setOffMapInfo] = useState({ total: 0, inMap: 0, nearMap: 0 });
  const [autoAlignedAt, setAutoAlignedAt] = useState(0);
  const [calibChangedAt, setCalibChangedAt] = useState(0);
  useEffect(() => {
    try {
      const total = Object.keys(enhancedPositions).length;
      if (!mapBounds || total === 0) { setOffMapInfo({ total, inMap: 0, nearMap: 0 }); return; }
      const b = mapBounds;
      const marginX = Math.abs((b.max.x - b.min.x) * 0.1);
      const marginY = Math.abs((b.max.y - b.min.y) * 0.1);
      const inRange = (p) => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y;
      const nearRange = (p) => p.x >= (b.min.x - marginX) && p.x <= (b.max.x + marginX) && p.y >= (b.min.y - marginY) && p.y <= (b.max.y + marginY);
      let inMap = 0, nearMap = 0;
      Object.values(enhancedPositions).forEach((p) => {
        if (inRange(p)) inMap += 1; else if (nearRange(p)) nearMap += 1;
      });
      setOffMapInfo({ total, inMap, nearMap });
    } catch(_) {}
  }, [enhancedPositions, mapBounds]);

  // Registra timestamp quando cambia la calibrazione (per auto-offset assistito)
  useEffect(() => {
    try { setCalibChangedAt(Date.now()); } catch(_) {}
  }, [calibration.scale, calibration.offsetX, calibration.offsetY, calibration.rotationDeg, calibration.invertY, calibration.swapXY, calibration.affineEnabled, calibration.affine, calibration.pivotX, calibration.pivotY]);

  // Dopo una calibrazione recente, se tutti i tag sono fuori mappa, autolinea offset una sola volta
  useEffect(() => {
    const now = Date.now();
    const recentMs = 2500;
    if (calibChangedAt && (now - calibChangedAt) < recentMs && offMapInfo.total > 0 && offMapInfo.inMap === 0) {
      if (!autoAlignedAt || (now - autoAlignedAt) > recentMs) {
        try { autoAlignOffsets(); setAutoAlignedAt(now); } catch(_) {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offMapInfo, calibChangedAt]);

  const autoAlignOffsets = () => {
    if (!mapBounds) { alert('Mappa non pronta'); return; }
    const ids = Object.keys(enhancedPositions);
    if (ids.length === 0) { alert('Nessun tag da allineare'); return; }
    const b = mapBounds;
    const xmin = Number(b.min?.x) || 0;
    const xmax = Number(b.max?.x) || 0;
    const ymin = Number(b.min?.y) || 0;
    const ymax = Number(b.max?.y) || 0;

    // Costruisci gli intervalli di offset ammissibili per portare ciascun punto dentro i confini
    const xIntervals = [];
    const yIntervals = [];
    let validCount = 0;
    ids.forEach((id) => {
      const p = enhancedPositions[id];
      if (!p) return;
      const x = Number(p.x); const y = Number(p.y);
      if (!isFinite(x) || !isFinite(y)) return;
      validCount++;
      xIntervals.push([xmin - x, xmax - x]);
      yIntervals.push([ymin - y, ymax - y]);
    });
    if (validCount === 0) { alert('Coordinate non valide per i tag'); return; }

    const sweepMaxOverlap = (intervals) => {
      // Restituisce {bestL, bestR, overlap} dell'intervallo con massima copertura
      const events = [];
      intervals.forEach(([l, r]) => {
        const L = Math.min(l, r), R = Math.max(l, r);
        events.push([L, +1]);
        events.push([R, -1]);
      });
      events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let cur = 0, best = 0, bestL = null, bestR = null;
      for (let i = 0; i < events.length; i++) {
        const [pos, type] = events[i];
        cur += type;
        // In segmento tra questo pos e il prossimo pos
        const nextPos = (i + 1 < events.length) ? events[i + 1][0] : pos;
        if (nextPos > pos) {
          if (cur > best) { best = cur; bestL = pos; bestR = nextPos; }
        }
      }
      return { bestL, bestR, overlap: best };
    };

    const bestX = sweepMaxOverlap(xIntervals);
    const bestY = sweepMaxOverlap(yIntervals);

    // Se riusciamo a coprire almeno metà dei tag, usiamo l'intervallo migliore; altrimenti fallback al baricentro
    const threshold = Math.max(1, Math.ceil(validCount * 0.5));
    let dx, dy;
    if (bestX.overlap >= threshold && bestX.bestL != null) {
      dx = (bestX.bestL + bestX.bestR) / 2;
    }
    if (bestY.overlap >= threshold && bestY.bestL != null) {
      dy = (bestY.bestL + bestY.bestR) / 2;
    }
    if (dx === undefined || dy === undefined) {
      // Fallback: centra il baricentro dei tag
      const cx = (xmin + xmax) / 2;
      const cy = (ymin + ymax) / 2;
      let sumX = 0, sumY = 0; let n = 0;
      ids.forEach(id => { const p = enhancedPositions[id]; if (!p) return; const x = Number(p.x); const y = Number(p.y); if (isFinite(x) && isFinite(y)) { sumX += x; sumY += y; n++; } });
      const avgX = sumX / Math.max(1, n);
      const avgY = sumY / Math.max(1, n);
      if (dx === undefined) dx = cx - avgX;
      if (dy === undefined) dy = cy - avgY;
    }

    // Clamp spostamento per evitare salti esagerati (<= 3 volte dimensione mappa per asse)
    const maxDx = Math.abs((xmax - xmin) * 3);
    const maxDy = Math.abs((ymax - ymin) * 3);
    const safeDx = Math.max(-maxDx, Math.min(maxDx, dx));
    const safeDy = Math.max(-maxDy, Math.min(maxDy, dy));

    updateCalibration({
      offsetX: (Number(calibration.offsetX)||0) + safeDx,
      offsetY: (Number(calibration.offsetY)||0) + safeDy,
    });
    try {
      const covX = bestX.overlap || 0; const covY = bestY.overlap || 0;
      const covered = Math.min(validCount, Math.max(covX, covY));
      setToast({ type: 'success', msg: `Offset aggiornati: riallineati ${covered}/${validCount} tag ai confini` });
    } catch(_) {}
  };

  // Fallback clamp activation if majority outside (>60%)
  const [forceClamp, setForceClamp] = useState(false);
  useEffect(() => {
    try {
      if (!mapBounds) { setForceClamp(false); return; }
      const total = offMapInfo.total || 0;
      if (total > 3) {
        const outside = total - offMapInfo.inMap;
        const frac = outside / Math.max(1,total);
        setForceClamp(frac > 0.6);
      } else {
        setForceClamp(false);
      }
    } catch(_) {}
  }, [offMapInfo, mapBounds]);

  const handleUseRawChange = (checked) => {
    // If enabling RAW and all tags are out of bounds, offer to auto-align
    setUseRawPositions(checked);
    try {
      if (checked && offMapInfo.total > 0 && offMapInfo.inMap === 0) {
        const want = window.confirm('I tag risultano fuori dalla planimetria. Vuoi riallinearli automaticamente aggiornando gli offset?');
        if (want) autoAlignOffsets();
      }
    } catch(_) {}
  };

  // Seleziona il primo sito se non ce n'è uno corrente
  useEffect(() => {
    if (!currentSite && sites.length > 0) {
      selectSite(sites[0].id);
    }
  }, [currentSite, sites, selectSite]);

  // Avviso toast quando calibrazione diventa "dirty"
  useEffect(() => {
    if (calibrationDirty) {
      try { setToast({ type: 'info', msg: 'Calibrazione modificata: premere Salva per fissarla' }); } catch(_) {}
    }
  }, [calibrationDirty]);

  // Carica mappa da localStorage o esempio
  useEffect(() => {
    let cancelled = false;
    const MAP_KEY = 'blueiot_mapData';
    const MAP_COMP_KEY = 'blueiot_mapData_lz';
    const MAP_META_KEY = 'blueiot_mapData_meta';
    const MAP_CHUNK_PREFIX = 'blueiot_mapData_lz_chunk_';
    const safeStoreMap = (raw) => {
      try {
        // Comprimi sempre per risparmiare spazio
        const compressed = LZString.compressToUTF16(raw);
        try {
          localStorage.removeItem(MAP_KEY);
          localStorage.setItem(MAP_COMP_KEY, compressed);
          localStorage.setItem(MAP_META_KEY, JSON.stringify({ cached: true, compressed: true, chunked: false, sizeRaw: raw.length, sizeCompressed: compressed.length, ts: Date.now() }));
          console.warn('[BlueIot][Map] Cached compressed map. raw=', raw.length, 'cmp=', compressed.length);
          return;
        } catch (e1) {
          // Prova salvataggio a chunk
          try {
            localStorage.removeItem(MAP_COMP_KEY);
            const CHUNK_SIZE = 400_000;
            const chunks = [];
            for (let i = 0; i < compressed.length; i += CHUNK_SIZE) {
              chunks.push(compressed.slice(i, i + CHUNK_SIZE));
            }
            chunks.forEach((c, idx) => localStorage.setItem(MAP_CHUNK_PREFIX + idx, c));
            localStorage.setItem(MAP_META_KEY, JSON.stringify({ cached: true, compressed: true, chunked: true, chunkCount: chunks.length, chunkSize: CHUNK_SIZE, sizeRaw: raw.length, sizeCompressed: compressed.length, ts: Date.now() }));
            console.warn('[BlueIot][Map] Cached compressed map in chunks. raw=', raw.length, 'cmp=', compressed.length, 'chunks=', chunks.length);
            return;
          } catch (e2) {
            // cleanup chunk parziali
            try {
              const metaStr = localStorage.getItem(MAP_META_KEY);
              if (metaStr) {
                const meta = JSON.parse(metaStr);
                if (meta && meta.chunked) {
                  for (let i = 0; i < (meta.chunkCount || 0); i++) {
                    localStorage.removeItem(MAP_CHUNK_PREFIX + i);
                  }
                }
              }
            } catch (_) {}
            localStorage.setItem(MAP_META_KEY, JSON.stringify({ cached: false, reason: 'quota', ts: Date.now(), error: e2.message }));
            console.warn('[BlueIot][Map] Skipping cache, quota exceeded even with chunks. raw=', raw.length, 'error=', e2.message);
          }
        }
      } catch (e) {
        console.warn('[BlueIot][Map] localStorage error, not caching map. size=', raw.length, 'error:', e.message);
        try { localStorage.setItem(MAP_META_KEY, JSON.stringify({ cached: false, size: raw.length, reason: 'error', ts: Date.now(), error: e.message })); } catch(_) {}
      }
    };
    const load = async () => {
      setIsLoading(true);
      try {
        let savedMapData = localStorage.getItem(MAP_KEY);
        const savedMapDataCompressed = localStorage.getItem(MAP_COMP_KEY);
        const metaStr = localStorage.getItem(MAP_META_KEY);
        if (!savedMapData && savedMapDataCompressed) {
          try { savedMapData = LZString.decompressFromUTF16(savedMapDataCompressed); } catch(_) {}
        }
        // Prova chunked
        if (!savedMapData && metaStr) {
          try {
            const meta = JSON.parse(metaStr);
            if (meta && meta.compressed && meta.chunked && meta.chunkCount > 0) {
              let concat = '';
              for (let i = 0; i < meta.chunkCount; i++) {
                const part = localStorage.getItem(MAP_CHUNK_PREFIX + i) || '';
                concat += part;
              }
              savedMapData = LZString.decompressFromUTF16(concat);
            }
          } catch(_) {}
        }
        if (savedMapData) {
          console.log("Mappa caricata dal localStorage");
          if (!cancelled) setMapData(savedMapData);
        } else {
          console.log("Caricamento mappa di esempio");
          const response = await fetch("/dxf-examples/example.dxf");
          if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
          const data = await response.text();
          console.log("Mappa di esempio caricata con successo");
          if (!cancelled) {
            setMapData(data);
            safeStoreMap(data);
          }
        }
      } catch (error) {
        console.error("Errore nel caricamento della mappa:", error);
        const fallbackDxf = `0
SECTION
2
ENTITIES
0
LINE
8
Layer_1
10
0
20
0
30
0
11
100
21
0
31
0
0
LINE
8
Layer_1
10
100
20
0
30
0
11
100
21
80
31
0
0
LINE
8
Layer_1
10
100
20
80
30
0
11
0
21
80
31
0
0
LINE
8
Layer_1
10
0
20
80
30
0
11
0
21
0
31
0
0
ENDSEC
0
EOF`;
        console.log("Usando mappa di fallback");
        if (!cancelled) {
          setMapData(fallbackDxf);
          safeStoreMap(fallbackDxf);
          setError("Impossibile caricare la mappa. Verifica la configurazione nella sezione Gestione Mappe.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    // Avvia effettivamente il caricamento
    load();
    return () => { cancelled = true; };
  }, [currentSite]);

  // Debug per vedere i dati disponibili
  useEffect(() => {
    console.log("Positions updated:", Object.keys(positions).length);
    console.log("Tag associations:", tagAssociations.length);
    console.log("Employees:", employees.length);
    console.log("Assets:", assets.length);
    console.log("isConnected:", isConnected);
  }, [positions, tagAssociations, employees, assets, isConnected]);

  // Arricchisci posizioni con info entità (se esistono)
  useEffect(() => {
    const now = Date.now();
    const ACTIVE_WINDOW_MS = 20000; // mostra tag fino a 20s per evitare flicker
    const MAX_TAGS = 50; // limite di sicurezza per UI
    let positionsWithInfo = [];
    // Stabilizza presenza tag anche se timestamp mancante o salta un update
    const lastSeenRef = window.__LAST_SEEN_TAGS || (window.__LAST_SEEN_TAGS = {});

    // Trasformazione coordinate in base alla calibrazione
    const applyTransform = (x, y, idKey) => {
      if (useRawPositions) return { x: Number(x) || 0, y: Number(y) || 0 };
      let xx = Number(x) || 0;
      let yy = Number(y) || 0;
      if (calibration.swapXY) {
        const t = xx; xx = yy; yy = t;
      }
      if (calibration.invertY) yy = -yy;
      // Applica affine se abilitata, altrimenti similarità (rot+scala+trasl)
      if (calibration.affineEnabled && calibration.affine && isFinite(calibration.affine.a)) {
        const A = calibration.affine;
        const x2 = (Number(A.a)||0) * xx + (Number(A.b)||0) * yy + (Number(A.tx)||0);
        const y2 = (Number(A.c)||0) * xx + (Number(A.d)||0) * yy + (Number(A.ty)||0);
        xx = x2; yy = y2;
      } else {
        const rad = (Number(calibration.rotationDeg) || 0) * Math.PI / 180;
        const pivX = Number(calibration.pivotX) || 0;
        const pivY = Number(calibration.pivotY) || 0;
        let rx = xx - pivX;
        let ry = yy - pivY;
        if (rad) {
          const cos = Math.cos(rad), sin = Math.sin(rad);
          const oldX = rx, oldY = ry;
          rx = oldX * cos - oldY * sin;
          ry = oldX * sin + oldY * cos;
        }
        const scale = Number(calibration.scale) || 1;
        rx = rx * scale;
        ry = ry * scale;
        xx = rx + pivX + (Number(calibration.offsetX) || 0);
        yy = ry + pivY + (Number(calibration.offsetY) || 0);
      }
      // Per-tag override (dx,dy) applicato DOPO la calibrazione globale
      try {
        const ov = (calibration && calibration.tagOverrides) ? calibration.tagOverrides : {};
        const key = String(idKey || '');
        if (key && ov[key]) {
          const dx = Number(ov[key].dx) || 0;
          const dy = Number(ov[key].dy) || 0;
          xx += dx; yy += dy;
        }
      } catch(_) {}
      if (typeof window !== 'undefined' && window.__CALIB_TRACE) {
        window.__CALIB_LOG = window.__CALIB_LOG || [];
        if (window.__CALIB_LOG.length > 500) window.__CALIB_LOG.shift();
        window.__CALIB_LOG.push({ ts: Date.now(), raw: { x, y }, id: idKey, final: { x: xx, y: yy }, params: {
          rotDeg: calibration.rotationDeg, scale: calibration.scale, offX: calibration.offsetX, offY: calibration.offsetY,
          invertY: calibration.invertY, swapXY: calibration.swapXY, affine: calibration.affineEnabled ? calibration.affine : null,
          override: (calibration.tagOverrides && idKey && calibration.tagOverrides[idKey]) ? calibration.tagOverrides[idKey] : null
        }});
      }
      return { x: xx, y: yy };
    };

    // Debug breakdown (raw -> pre -> core -> global -> override) for a single tag
    const transformBreakdown = (x, y, idKey) => {
      let rawX = Number(x) || 0; let rawY = Number(y) || 0;
      // pre
      let preX = rawX, preY = rawY;
      if (calibration.swapXY) { const t = preX; preX = preY; preY = t; }
      if (calibration.invertY) preY = -preY;
      // core similarity / affine
      let coreX = preX, coreY = preY;
      let mode = 'similarity';
      if (calibration.affineEnabled && calibration.affine && isFinite(calibration.affine.a)) {
        const A = calibration.affine; mode = 'affine';
        coreX = (Number(A.a)||0) * preX + (Number(A.b)||0) * preY + (Number(A.tx)||0);
        coreY = (Number(A.c)||0) * preX + (Number(A.d)||0) * preY + (Number(A.ty)||0);
      } else {
        const rad = (Number(calibration.rotationDeg) || 0) * Math.PI / 180;
        const pivX = Number(calibration.pivotX) || 0;
        const pivY = Number(calibration.pivotY) || 0;
        let rx = preX - pivX; let ry = preY - pivY;
        if (rad) { const cos = Math.cos(rad), sin = Math.sin(rad); const ox = rx, oy = ry; rx = ox*cos - oy*sin; ry = ox*sin + oy*cos; }
        const scale = Number(calibration.scale) || 1;
        rx *= scale; ry *= scale;
        coreX = rx + pivX; coreY = ry + pivY;
      }
      // global offsets
      let globX = coreX + (Number(calibration.offsetX)||0);
      let globY = coreY + (Number(calibration.offsetY)||0);
      // overrides
      let finalX = globX; let finalY = globY;
      try { const ov = calibration.tagOverrides || {}; const key = String(idKey||''); if (key && ov[key]) { finalX += Number(ov[key].dx)||0; finalY += Number(ov[key].dy)||0; } } catch(_) {}
      return { rawX, rawY, preX, preY, coreX, coreY, globX, globY, finalX, finalY, mode };
    };
    // Filtra per recenti
    // Canonicalizza ID per evitare duplicati usando il canonicalizer centralizzato (preferisce HEX completo)
    const canonicalMap = {}; // canonKey -> entry
    Object.entries(positions).forEach(([tagId, pos]) => {
      if (!pos) return;
      const ts = (pos.ts && isFinite(pos.ts)) ? pos.ts : (lastSeenRef[tagId] || Date.now());
      lastSeenRef[tagId] = ts;
      const age = now - ts;
      // Se mancano aggiornamenti per molto tempo lasciamo comunque il tag visibile più a lungo (60s) prima di rimuoverlo
      const WINDOW = (pos.ts && isFinite(pos.ts)) ? ACTIVE_WINDOW_MS : 60000;
      if (age > WINDOW) return;
      const canon = canonicalizeId(tagId);
      const t = applyTransform(pos.x, pos.y, canon);
      const entry = {
        tagId,
        canonId: canon,
        ...pos,
        x: t.x,
        y: t.y,
        name: `Tag ${tagId}`,
        type: 'unknown',
        entityId: null,
        ageMs: age,
        _blinkAge: age,
      };
      // Se già presente stesso canon, tieni quello più recente
      if (!canonicalMap[canon] || (canonicalMap[canon].ts < entry.ts)) {
        canonicalMap[canon] = entry;
      }
    });
    positionsWithInfo = Object.values(canonicalMap).map(p => {
      if (forceClamp && mapBounds) {
        const b = mapBounds;
        const cx = Math.max(b.min.x, Math.min(b.max.x, p.x));
        const cy = Math.max(b.min.y, Math.min(b.max.y, p.y));
        return { ...p, x: cx, y: cy, __clamped: true };
      }
      return p;
    });

    // Attach breakdown to selected tag for debug overlay (window.__TRANSFORM_DEBUG flag)
    try {
      if (typeof window !== 'undefined' && window.__TRANSFORM_DEBUG && selectedTag) {
        const sel = positionsWithInfo.find(p => p.canonId === selectedTag || p.tagId === selectedTag);
        if (sel) {
          sel.__breakdown = transformBreakdown(sel.rawX ?? sel.x, sel.rawY ?? sel.y, sel.canonId);
          window.__TRANSFORM_LAST = sel.__breakdown;
        }
      }
    } catch(_) {}

    // Ordina per timestamp decrescente
    positionsWithInfo.sort((a, b) => b.ts - a.ts);
    const totalActive = positionsWithInfo.length;
    const truncated = positionsWithInfo.slice(0, MAX_TAGS);

    // Helper: risolvi nome anche provando varianti ID (dec/hex/low32)
    // Primary resolver: prefer DB name by canonical ID, fallback to live names from BlueIOT
    const resolveName = (id) => {
      try {
        const canon = canonicalizeId(id);
        if (backendTagNameMap && backendTagNameMap[canon]) return backendTagNameMap[canon];
      } catch(_) {}
      const names = tagNames || {};
      const variants = new Set();
      const s = String(id || '');
      variants.add(s);
      // Include idHex from the live position if available
      try {
        const idHex = (positions && positions[s] && positions[s].idHex) ? String(positions[s].idHex) : null;
        if (idHex) {
          const up = idHex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
          if (up) {
            variants.add(up);
            if (up.length >= 8) {
              const low = up.slice(-8);
              variants.add(low);
              try { variants.add(String(parseInt(low, 16))); } catch(_) {}
            }
          }
        }
      } catch(_) {}
      // numeric variants
      const num = Number(s);
      if (!Number.isNaN(num)) {
        const u32 = (num >>> 0);
        variants.add(String(num));
        variants.add(String(u32));
        variants.add(u32.toString(16).toUpperCase());
        variants.add(num.toString(16).toUpperCase());
      }
      // hex-like variants (full and low32)
      const hexLike = s.match(/^[0-9A-Fa-f]{8,}$/) ? s : s.replace(/[^0-9A-Fa-f]/g, '');
      if (hexLike && /^[0-9A-Fa-f]{8,}$/.test(hexLike)) {
        const up = hexLike.toUpperCase();
        variants.add(up);
        const lowHex = up.slice(-8);
        try { variants.add(String(parseInt(lowHex, 16))); } catch(_) {}
        variants.add(lowHex);
      }
      for (const k of variants) { if (names[k]) return names[k]; }
      return null;
    };

    // Trasforma in mappa per viewer: usa chiave canonica per evitare cambi ID (hex/dec) nel tempo
    const mapObj = {};
    const rawObj = {};
    const displayId = (p) => {
      // preferisci forma 0xHEX a 8+ cifre se disponibile
      const s = String(p.tagId);
      const hl = s.replace(/[^0-9A-Fa-f]/g,'');
      const hasHexLetter = /[A-Fa-f]/.test(hl);
      if (hasHexLetter && hl.length >= 8) return `0x${hl.toUpperCase()}`;
      const n = Number(s);
      return !Number.isNaN(n) ? `0x${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}` : s;
    };
    truncated.forEach(p => {
      const tName = resolveName(p.canonId || p.tagId);
      const key = p.canonId || p.tagId; // p.canonId è già canonicalizzato sopra
      mapObj[key] = { ...p, id: p.tagId, idHexShown: displayId(p), name: tName || p.name };
      // Mantieni anche RAW per debug (prima della calibrazione) allineato alla chiave canonica
      const orig = positions[p.tagId];
      if (orig) rawObj[key] = { x: Number(orig.x) || 0, y: Number(orig.y) || 0, name: tName || p.name };
    });

    if (Object.keys(mapObj).length === 0 && !isConnected && SHOW_FAKE_TAGS) {
      mapObj["TAG001"] = { id: "TAG001", x: 31.7, y: 62.0, z: 0, name: "Mario Rossi", type: "employee", entityId: 1, ts: now };
      mapObj["TAG002"] = { id: "TAG002", x: 65.7, y: 42.6, z: 0, name: "Gru 002", type: "asset", entityId: 10, ts: now };
    }

    // Evita rimozione/aggiunta rapida che causa lampeggio: conserva ultimo stato e aggiorna solo campi mutati
    setEnhancedPositions(prev => {
      const next = { ...prev };
      // Rimuovi solo se assente da mapObj da oltre 90s
      const now2 = Date.now();
      Object.keys(next).forEach(k => {
        if (!mapObj[k]) {
          const last = (lastSeenRef[k] || now2);
          if (now2 - last > 90000) delete next[k];
        }
      });
      Object.entries(mapObj).forEach(([k,v]) => { next[k] = v; });
      return next;
    });
    try { window.__DEBUG_RAW = rawObj; } catch(_) {}
    console.log("Tag positions enhanced:", Object.keys(mapObj).length, "(active recent=", totalActive, "truncated to", MAX_TAGS, ")");
  }, [positions, tagAssociations, employees, assets, isConnected, tagNames, backendTagNameMap, calibration, useRawPositions, selectedTag, forceClamp, mapBounds]);

  // Auto-hide toast after a short delay
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // Determine if many tags are outside the current map bounds -> show suggestion
  const offMapStats = (() => {
    try {
      const keys = Object.keys(enhancedPositions || {});
      if (!mapBounds || keys.length === 0) return { total: 0, off: 0, frac: 0 };
      const b = mapBounds;
      let off = 0;
      const offList = [];
      keys.forEach(k => {
        const p = enhancedPositions[k];
        if (!p) return;
        if (p.x < b.min.x || p.x > b.max.x || p.y < b.min.y || p.y > b.max.y) {
          off += 1;
          offList.push({ id: k, x: p.x, y: p.y, ts: p.ts });
        }
      });
      return { total: keys.length, off, frac: keys.length ? (off / keys.length) : 0, list: offList };
    } catch (_) { return { total: 0, off: 0, frac: 0 }; }
  })();

  // When fraction high, auto-show suggestion banner (but don't auto-apply)
  // Throttle banner visibility to reduce flicker
  useEffect(() => {
    const now = Date.now();
    const st = lastBannerRef.current;
    const THRESH = 0.5; // fraction outside to trigger
    const MIN_SHOW_MS = 2500; // keep visible at least this long once shown
    const MIN_HIDE_MS = 1500; // delay re-show at least this long after hide
    const trigger = offMapStats.total > 0 && offMapStats.frac >= THRESH;
    if (trigger) {
      // show if not visible and past hide cooldown
      if (!suggestionVisible && (now - st.hiddenAt) > MIN_HIDE_MS) {
        setSuggestionVisible(true);
        st.shownAt = now;
        st.forceHoldUntil = now + MIN_SHOW_MS;
      }
    } else {
      // hide only if minimum show duration elapsed
      if (suggestionVisible && now >= st.forceHoldUntil) {
        setSuggestionVisible(false);
        st.hiddenAt = now;
      }
    }
  }, [offMapStats.total, offMapStats.frac, suggestionVisible]);

  // Auto-initial calibration after a full reset: center raw tag cluster in map
  useEffect(() => {
    if (autoInitDone) return;
    if (!mapBounds) return;
    const keys = Object.keys(positions || {});
    if (keys.length === 0) return;
    const calib = calibration || {};
    const isNearDefault = (
      Math.abs((calib.scale||1) - 1) < 1e-6 &&
      Math.abs(calib.rotationDeg||0) < 1e-6 &&
      Math.abs(calib.offsetX||0) < 1e-6 &&
      Math.abs(calib.offsetY||0) < 1e-6 &&
      !calib.affineEnabled &&
      (!calib.referencePoints || calib.referencePoints.length === 0) &&
      Object.keys(calib.tagOverrides||{}).length === 0
    );
    if (!isNearDefault) return; // non è uno stato post-reset
    // calcola centro cluster RAW
    let sumX=0,sumY=0,n=0;
    keys.forEach(k => { const p = positions[k]; if (!p) return; const x=Number(p.x)||0; const y=Number(p.y)||0; sumX+=x; sumY+=y; n++; });
    if (n === 0) return;
    const cx = sumX / n; const cy = sumY / n;
    const mapCenterX = ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2;
    const mapCenterY = ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2;
    const offsetX = mapCenterX - cx;
    const offsetY = mapCenterY - cy;
    updateCalibration({ offsetX, offsetY, pivotX: cx, pivotY: cy });
    setAutoInitDone(true);
  }, [autoInitDone, calibration, positions, mapBounds, updateCalibration]);

  const computeSuggestedOffsets = () => {
    if (!mapBounds) return null;
    const keys = Object.keys(enhancedPositions || {});
    if (!keys || keys.length === 0) return null;
    // pick the most recent tag (first key) as anchor
    const first = enhancedPositions[keys[0]];
    if (!first) return null;
    const centerX = ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2;
    const centerY = ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2;
    const current = calibration || {};
    const offsetX_new = (Number(current.offsetX) || 0) + (centerX - first.x);
    const offsetY_new = (Number(current.offsetY) || 0) + (centerY - first.y);
    return { offsetX: offsetX_new, offsetY: offsetY_new };
  };

  const onSuggestApply = () => {
    const s = computeSuggestedOffsets();
    if (!s) return;
    updateCalibration(s);
    setSuggestedOffsets(null);
    setSuggestionVisible(false);
    try { setToast({ type: 'success', msg: 'Offset applicati (suggerimento)' }); } catch(_) {}
  };

  const onSuggestPreview = () => {
    const s = computeSuggestedOffsets();
    setSuggestedOffsets(s);
  };

  // Stima scala e offset usando bounding box del cluster RAW
  const autoFitCluster = () => {
    try {
      const keys = Object.keys(positions||{});
      if (!mapBounds || keys.length < 2) { alert('Servono almeno 2 tag attivi per auto-fit'); return; }
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; let sumX=0,sumY=0,n=0;
      keys.forEach(k => { const p=positions[k]; if (!p) return; const x=Number(p.x)||0; const y=Number(p.y)||0; if (x<minX)minX=x; if (y<minY)minY=y; if (x>maxX)maxX=x; if (y>maxY)maxY=y; sumX+=x; sumY+=y; n++; });
      if (n<2) { alert('Cluster insufficiente'); return; }
      const rawW = Math.max(0.0001, maxX-minX);
      const rawH = Math.max(0.0001, maxY-minY);
      const mapW = Math.max(0.0001, (Number(mapBounds.max?.x)||0) - (Number(mapBounds.min?.x)||0));
      const mapH = Math.max(0.0001, (Number(mapBounds.max?.y)||0) - (Number(mapBounds.min?.y)||0));
      // uniform scale fit (riempie l'asse dominante senza superare l'altra) con margine 5%
      const scaleX = mapW / rawW;
      const scaleY = mapH / rawH;
      const scale = Math.min(scaleX, scaleY) * 0.95; // margine
      const cx = sumX / n; const cy = sumY / n;
      const mapCenterX = ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2;
      const mapCenterY = ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2;
      // offset per posizionare il centro trasformato al centro mappa
      // similarity senza rotazione: x' = scale*(x-cx)+cx + offX
      // imponi media x' = mapCenterX => offX = mapCenterX - cx
      const offX = mapCenterX - cx;
      const offY = mapCenterY - cy;
      updateCalibration({ scale, offsetX: offX, offsetY: offY, rotationDeg: 0, pivotX: cx, pivotY: cy, invertY: false, swapXY: false });
      try { setToast({ type:'success', msg:`Auto-fit: scale=${scale.toFixed(3)} offset=(${offX.toFixed(1)},${offY.toFixed(1)})` }); } catch(_) {}
    } catch(e) {
      alert('Auto-fit fallito: '+(e?.message||'')); }
  };

  // Gestisce la selezione di un tag (click da mappa o lista)
  const handleTagSelect = (tagId) => {
    console.log("Tag selezionato:", tagId);
    setSelectedTag(tagId);
  };

  const countByType = (type) =>
    tagAssociations.filter((a) => a.targetType === type).length;

  const countUnassociated = () =>
    tags.filter((t) => !tagAssociations.find((a) => a.tagId === t.id)).length;

  const handleAddTag = async () => {
    let raw = window.prompt('Inserisci ID Tag (dec o hex, es: 12345 o 0x12AB34CD)');
    if (!raw) return;
    raw = raw.trim();
    if (!raw) return;
    const canon = canonicalizeId(raw);
    if (!canon) { alert('ID non valido'); return; }
    // Nome opzionale
    let name = window.prompt('Nome (facoltativo) per questo TAG', '');
    if (name) name = name.trim();
    try {
      await createTag(canon, null, name || null);
      await reloadTags();
      setToast({ type: 'success', msg: `Tag ${canon} aggiunto` });
    } catch(e) {
      alert('Errore nel salvataggio del tag: ' + (e?.message || ''));
    }
  };

  const handleAddSpecificTag = async (rawId) => {
    const canon = canonicalizeId(rawId);
    if (!canon) return;
    try {
      // nome opzionale
      let name = window.prompt('Nome (facoltativo) per questo TAG', '');
      if (name) name = name.trim();
      await createTag(canon, null, name || null);
      await reloadTags();
      setToast({ type: 'success', msg: `Tag ${canon} aggiunto` });
    } catch(e) {
      alert('Errore nel salvataggio del tag: ' + (e?.message || ''));
    }
  };

  const handleRemoveSpecificTag = async (rawId) => {
    const canon = canonicalizeId(rawId);
    if (!canon) return;
    const confirm = window.confirm(`Rimuovere il TAG ${canon}?
• Se non ha assegnazioni o storico: eliminazione definitiva.
• Altrimenti: sarà marcato come dismesso (soft delete).`);
    if (!confirm) return;
    try {
      const res = await removeTag(canon);
      await reloadTags();
      if (res && res.success) {
        if (res.soft) {
          setToast({ type: 'success', msg: `Tag ${res.matchedId || canon} dismesso (soft delete)` });
        } else if ((res.removed || 0) > 0) {
          setToast({ type: 'success', msg: `Tag ${res.matchedId || canon} eliminato definitivamente` });
        } else {
          setToast({ type: 'info', msg: `Nessun tag trovato con ID ${canon}. Prova variante HEX/DEC.` });
        }
      } else {
        setToast({ type: 'info', msg: `Rimozione completata, verifica elenco aggiornata` });
      }
      // se stavi selezionando proprio quel tag e non è più in live, pulisci selezione
      if (selectedTag && canonicalizeId(selectedTag) === canon && !enhancedPositions[canon]) {
        setSelectedTag(null);
      }
    } catch(e) {
      alert('Errore nella rimozione del tag: ' + (e?.message || ''));
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Dashboard {currentSite ? `- ${currentSite.name}` : ""}
      </h1>
      {toast && (
        <div className={`mb-3 text-sm px-3 py-2 rounded border ${toast.type==='success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : toast.type==='info' ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-3 text-sm">
        Stato connessione BlueIot:{" "}
        <span className={isConnected ? "text-green-600" : "text-red-600"}>
          {isConnected ? "Connesso a 192.168.1.11" : "Non connesso a 192.168.1.11"}
        </span>
        {/* Suggestion banner: appare se molti tag risultano fuori dalla planimetria */}
        {suggestionVisible && offMapStats.total > 0 && (
          <div className="mb-3 p-3 rounded border bg-yellow-50 text-sm flex items-center justify-between">
            <div>
              <strong>Rilevate posizioni fuori dalla planimetria.</strong>
              <div className="text-xs text-gray-600">{offMapStats.off} di {offMapStats.total} tag ({Math.round(offMapStats.frac*100)}%) risultano al di fuori dei confini.</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onSuggestPreview} className="px-2 py-1 bg-indigo-600 text-white rounded text-sm">Suggerisci offset</button>
              <button onClick={() => setSuggestionVisible(false)} className="px-2 py-1 bg-gray-200 rounded text-sm">Chiudi</button>
              <button onClick={autoFitCluster} className="px-2 py-1 bg-emerald-600 text-white rounded text-sm" title="Stima scala e offset dal cluster RAW dei tag">Auto-fit cluster</button>
            </div>
          </div>
        )}

        {/* Preview box per la proposta di offset */}
        {suggestedOffsets && (
          <div className="mb-3 p-3 rounded border bg-white text-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">Anteprima offset proposti</div>
                <div className="text-xs text-gray-600 mt-1">offsetX: {Number(suggestedOffsets.offsetX).toFixed(2)} — offsetY: {Number(suggestedOffsets.offsetY).toFixed(2)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onSuggestApply} className="px-2 py-1 bg-emerald-600 text-white rounded text-sm">Applica</button>
                <button onClick={() => setSuggestedOffsets(null)} className="px-2 py-1 bg-gray-200 rounded text-sm">Annulla</button>
              </div>
            </div>
          </div>
        )}
        {simpleMode && (
          <button
            onClick={() => saveCalibration()}
            className="ml-4 px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 text-xs"
            title="Salva su database la calibrazione corrente (offset, scala, rotazione)"
          >Salva configurazione</button>
        )}
      </div>

      {/* Barra superiore semplificata */}
      {calibrationDirty && (
        <div className="mb-3 p-3 border-2 border-amber-500 bg-amber-50 rounded flex items-center justify-between shadow-sm">
          <div className="text-sm font-medium text-amber-800">Calibrazione modificata. Salva per renderla permanente.</div>
          <button
            onClick={() => { saveCalibration().then(ok => { try { setToast({ type: ok?'success':'error', msg: ok?'Calibrazione salvata':'Errore salvataggio' }); } catch(_) {} }); }}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded font-semibold shadow"
          >Salva calibrazione</button>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2">
        <button className="px-3 py-1 bg-gray-700 text-white rounded" onClick={()=> setSimpleMode(!simpleMode)}>
          {simpleMode ? 'Modalità Avanzata' : 'Modalità Semplice'}
        </button>
        <div className="ml-auto text-sm text-gray-600">Stato: <span className={isConnected?"text-green-600":"text-red-600"}>{isConnected?"Connesso" : "Non connesso"}</span></div>
      </div>

      {/* Debug BlueIOT (mostrato solo in modalità Avanzata) */}
      {!simpleMode && (
      <div className="mb-4 text-xs text-gray-700 bg-gray-50 border rounded p-3 space-y-2">
        <div className="font-medium">Debug BlueIOT</div>
        <div>Tag attivi: {Object.keys(enhancedPositions).length}</div>
        {mapBounds && (
          <div>
            Fuori mappa: <span className={offMapStats.off>0? 'text-rose-600 font-semibold':'text-gray-600'}>{offMapStats.off}</span>
            {offMapStats.off>0 && (
              <span className="ml-2 text-[11px] text-gray-600">[{offMapStats.list.slice(0,5).map(o=> o.id).join(', ')}{offMapStats.off>5?'…':''}]</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3 items-center text-xs">
          <span>Calibrazione:</span>
          <label className="flex items-center gap-1 mr-2">
            <input type="checkbox" checked={useRawPositions} onChange={e => handleUseRawChange(e.target.checked)} /> ignora calibrazione (mostra RAW)
          </label>
          <label className="flex items-center gap-1 mr-2"><input type="checkbox" checked={isolateSelected} onChange={e => setIsolateSelected(e.target.checked)} /> mostra solo tag selezionato</label>
          <label className="flex items-center gap-1 mr-2"><input type="checkbox" checked={followSelected} onChange={e => setFollowSelected(e.target.checked)} /> segui spostamento tag</label>
          <label>Scale <input type="number" step="0.01" defaultValue={calibration.scale} className="border px-1 w-16"
            onBlur={e => updateCalibration({ scale: Number(e.target.value) || 1 })} /></label>
          <label>OffsetX <input type="number" step="0.1" defaultValue={calibration.offsetX} className="border px-1 w-16"
            onBlur={e => updateCalibration({ offsetX: Number(e.target.value) || 0 })} /></label>
          <label>OffsetY <input type="number" step="0.1" defaultValue={calibration.offsetY} className="border px-1 w-16"
            onBlur={e => updateCalibration({ offsetY: Number(e.target.value) || 0 })} /></label>
          <label>Rot° <input type="number" step="1" defaultValue={calibration.rotationDeg} className="border px-1 w-14"
            onBlur={e => updateCalibration({ rotationDeg: Number(e.target.value) || 0 })} /></label>
          <label>MapRot° <input type="number" step="1" defaultValue={calibration.visualMapRotationDeg} className="border px-1 w-14"
            onBlur={e => updateCalibration({ visualMapRotationDeg: Number(e.target.value) || 0 })} /></label>
          <button className="px-2 py-1 bg-gray-300 rounded" title="Ruota mappa -90°" onClick={() => updateCalibration({ visualMapRotationDeg: (((calibration.visualMapRotationDeg||0) - 90) % 360 + 360) % 360 })}>⟲ -90°</button>
          <button className="px-2 py-1 bg-gray-300 rounded" title="Ruota mappa +90°" onClick={() => updateCalibration({ visualMapRotationDeg: (((calibration.visualMapRotationDeg||0) + 90) % 360 + 360) % 360 })}>⟳ +90°</button>
          <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={calibration.invertY}
            onChange={e => updateCalibration({ invertY: e.target.checked })} /> invertY</label>
          <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={calibration.swapXY}
            onChange={e => updateCalibration({ swapXY: e.target.checked })} /> swapXY</label>
          <span className="mx-2 h-5 w-px bg-gray-300 inline-block" />
          <span>Tracking:</span>
          <label className="flex items-center gap-1 mr-2"><input type="checkbox" checked={!!calibration.trackingEnabled} onChange={e => updateCalibration({ trackingEnabled: e.target.checked })} /> Kalman</label>
          <label className="flex items-center gap-1">Reattività
            <input type="range" min={0} max={1} step={0.05} defaultValue={calibration.trackingResponsiveness ?? 0.5} className="ml-1"
              onChange={e => updateCalibration({ trackingResponsiveness: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-1">Outlier
            <input type="range" min={0} max={1} step={0.05} defaultValue={calibration.outlierSensitivity ?? 0.5} className="ml-1"
              onChange={e => updateCalibration({ outlierSensitivity: Number(e.target.value) })} />
          </label>
          <label>Deadband cm <input type="number" step="1" defaultValue={Math.round((calibration.deadbandM ?? 0.06)*100)} className="border px-1 w-16"
            onBlur={e => updateCalibration({ deadbandM: Math.max(0, Number(e.target.value)/100) })} /></label>
          <button
            className="px-2 py-1 bg-indigo-600 text-white rounded"
            title="Applica preset consigliato per tracking e outlier"
            onClick={() => updateCalibration({ trackingEnabled: true, trackingResponsiveness: 0.65, outlierSensitivity: 0.7, deadbandM: 0.10 })}
          >Preset tracking</button>
          <div className="flex items-center gap-2 ml-auto">
            <button className="px-2 py-1 bg-emerald-600 text-white rounded" onClick={() => saveCalibration()}>Salva</button>
            <button className="px-2 py-1 bg-sky-600 text-white rounded" onClick={() => loadCalibration()}>Ricarica</button>
            <button className="px-2 py-1 bg-rose-600 text-white rounded" onClick={() => resetCalibration()}>Reset</button>
            <button className="px-2 py-1 bg-yellow-600 text-white rounded" onClick={() => { try { window.LocalsenseClient?.forcePositionSwitch?.(); console.log('forcePositionSwitch called'); console.log(window.getBlueIotDiag()); } catch(e){ console.error(e); } }}>Retry positions</button>
          </div>
        </div>
        <div className="text-[11px] text-gray-600">normScale (auto): {Number(calibration.normalizationScale || 1).toFixed(4)}</div>
        <div>
          Ultimo tag: {_lastTag ? `${_lastTag.id} @ (${Number(_lastTag.x).toFixed(2)}, ${Number(_lastTag.y).toFixed(2)})` : "—"}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input id="dbgSub" className="border px-2 py-1 rounded flex-1 min-w-[200px]" placeholder="ID1:ID2:ID3" />
          <button
            className="px-2 py-1 bg-indigo-600 text-white rounded"
            onClick={() => {
              const v = document.getElementById('dbgSub')?.value?.trim();
              if (v) { try { window.BlueIot?.Send2WS_RssTagClicked?.(v); } catch(_) {} }
            }}
          >
            Subscribe (tag IDs)
          </button>
          <input id="dbgVib" className="border px-2 py-1 rounded w-40" placeholder="Tag ID" />
          <button
            className="px-2 py-1 bg-emerald-600 text-white rounded"
            onClick={() => {
              const v = document.getElementById("dbgVib")?.value?.trim();
              if (v) vibrateTag(v, "enable");
            }}
          >
            Vibrate
          </button>
          <button
            className="px-2 py-1 bg-gray-700 text-white rounded"
            onClick={() => {
              const v = document.getElementById("dbgVib")?.value?.trim();
              if (v) videoTrack(v);
            }}
          >
            Video track
          </button>
        </div>
        <div className="mt-2">
          <div className="font-medium">Ultimo frame grezzo:</div>
          <pre className="whitespace-pre-wrap break-words max-h-40 overflow-auto bg-white border rounded p-2">
            {_lastRawFrame
              ? _lastRawFrame.type === "bin"
                ? `BIN ${_lastRawFrame.byteLen} bytes\n${_lastRawFrame.hexPreview}`
                : _lastRawFrame.text
              : "—"}
          </pre>
        </div>

        {/* Diagnostica posizioni (tabella eventi) */}
        <div className="mt-3 p-3 border rounded bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Diagnostica posizioni</div>
            <div className="flex gap-2">
              <input
                className="border px-2 py-1 rounded w-40"
                placeholder="Filtro Tag (canon)"
                value={diagTagFilter}
                onChange={(e)=> setDiagTagFilter(e.target.value)}
              />
              <input
                type="number"
                className="border px-2 py-1 rounded w-24"
                title="Numero massimo righe"
                value={diagLimit}
                onChange={(e)=> setDiagLimit(Math.max(10, Math.min(2000, Number(e.target.value)||200)))}
              />
              <button
                className={`px-2 py-1 rounded ${diagPaused?'bg-gray-500 text-white':'bg-gray-700 text-white'}`}
                onClick={()=> { setDiagPaused(!diagPaused); setDiagnosticsPaused(!diagPaused); }}
              >{diagPaused? 'Riprendi' : 'Pausa'}</button>
              <button className="px-2 py-1 bg-rose-600 text-white rounded" onClick={()=> clearDiagnostics()}>Pulisci</button>
              <button
                className="px-2 py-1 bg-indigo-600 text-white rounded"
                onClick={()=>{
                  try {
                    const csv = window.__BLUEIOT_POS_DIAG?.exportCSV?.(diagTagFilter||null, 2000) || '';
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `posdiag_${diagTagFilter||'ALL'}_${Date.now()}.csv`;
                    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                  } catch(e) { console.error(e); }
                }}
              >Export CSV</button>
            </div>
          </div>
          {(() => {
            try {
              const rows = getDiagnostics({ tag: diagTagFilter || null, limit: diagLimit });
              return (
                <div className="max-h-60 overflow-auto border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">Ora</th>
                        <th className="text-left px-2 py-1">Tag</th>
                        <th className="text-left px-2 py-1">Azione</th>
                        <th className="text-left px-2 py-1">Filtro</th>
                        <th className="text-left px-2 py-1">Raw (x,y)</th>
                        <th className="text-left px-2 py-1">Smooth (x,y)</th>
                        <th className="text-left px-2 py-1">Jump</th>
                        <th className="text-left px-2 py-1">Speed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => {
                        const t = new Date(r.ts||Date.now());
                        const hh = String(t.getHours()).padStart(2,'0');
                        const mm = String(t.getMinutes()).padStart(2,'0');
                        const ss = String(t.getSeconds()).padStart(2,'0');
                        const ms = String(t.getMilliseconds()).padStart(3,'0');
                        const time = `${hh}:${mm}:${ss}.${ms}`;
                        const warn = r.action === 'reject-outlier';
                        return (
                          <tr key={idx} className={warn? 'bg-rose-50' : ''}>
                            <td className="px-2 py-1 whitespace-nowrap">{time}</td>
                            <td className="px-2 py-1">{r.id}</td>
                            <td className="px-2 py-1">{r.action||''}</td>
                            <td className="px-2 py-1">{r.filter||''}</td>
                            <td className="px-2 py-1">{isFinite(r.raw?.x)?r.raw.x.toFixed(2):''}, {isFinite(r.raw?.y)?r.raw.y.toFixed(2):''}</td>
                            <td className="px-2 py-1">{isFinite(r.smooth?.x)?r.smooth.x.toFixed(2):''}, {isFinite(r.smooth?.y)?r.smooth.y.toFixed(2):''}</td>
                            <td className="px-2 py-1">{isFinite(r.jump)?r.jump.toFixed(2):''}</td>
                            <td className="px-2 py-1">{isFinite(r.speed)?r.speed.toFixed(2):''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            } catch(e) {
              return <div className="text-red-600">Errore diagnostica: {String(e?.message||e)}</div>;
            }
          })()}
        </div>

        {/* Calibrazione scala con misura reale (singolo tag) */}
        <div className="mt-3 p-3 border rounded bg-white">
          <div className="font-medium mb-2">Calibrazione scala (sposta il tag di una distanza nota)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center text-xs">
            <label className="flex items-center gap-2">
              <span>Tag ID</span>
              <input
                className="border px-2 py-1 rounded w-44"
                placeholder="es. 12345"
                value={calibTagId || selectedTag || ''}
                onChange={(e) => setCalibTagId(e.target.value)}
              />
            </label>
            <div className="flex gap-2 flex-wrap">
              <button className="px-2 py-1 bg-gray-700 text-white rounded" onClick={() => capturePoint('A')}>Cattura A (RAW)</button>
              <button className="px-2 py-1 bg-gray-700 text-white rounded" onClick={() => capturePoint('B')}>Cattura B (RAW)</button>
              <button className="px-2 py-1 bg-gray-200 rounded" onClick={() => { setPtA(null); setPtB(null); }}>Reset A/B</button>
            </div>
            <div className="text-[11px] text-gray-600 col-span-1 md:col-span-2">
              {ptA ? `A: (${ptA.x.toFixed(2)}, ${ptA.y.toFixed(2)}) @ ${new Date(ptA.ts).toLocaleTimeString()}` : 'A: —'}
              {"  |  "}
              {ptB ? `B: (${ptB.x.toFixed(2)}, ${ptB.y.toFixed(2)}) @ ${new Date(ptB.ts).toLocaleTimeString()}` : 'B: —'}
            </div>
            <label className="flex items-center gap-2">
              <span>Distanza reale (m)</span>
              <input type="number" step="0.01" className="border px-2 py-1 rounded w-24" value={realDist}
                     onChange={(e) => setRealDist(Number(e.target.value) || 0)} />
            </label>
            <div className="text-[11px] text-gray-700">
              {rawDist ? (
                <>
                  <div>ΔRAW: {rawDist.toFixed(3)} unità</div>
                  <div>Scala suggerita: {(suggestedScale || 0).toFixed(6)}</div>
                </>
              ) : (
                <div>ΔRAW: —</div>
              )}
            </div>
            <div className="col-span-1 md:col-span-2 flex gap-2 items-center">
              <button
                className="px-2 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                disabled={!suggestedScale}
                onClick={applySuggestedScale}
              >Applica scala suggerita</button>
              <div className="text-[11px] text-gray-500">Scala attuale: {Number(calibration.scale || 1).toFixed(6)}</div>
            </div>
            <div className="col-span-1 md:col-span-2 text-[11px] text-gray-500">
              Istruzioni: premi Cattura A, sposta il tag in linea retta di una distanza nota, premi Cattura B, inserisci la distanza reale e applica.
            </div>
          </div>
        </div>

        {/* Calibrazione con due tag a distanza nota (es. 2m su asse Y) */}
        <div className="mt-3 p-3 border rounded bg-white">
          <div className="font-medium mb-2 flex items-center gap-3">
              <span>Calibrazione due tag (allinea AB a Y e scala)</span>
              {rawDist2 && angleDegAB!==null && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-300">pronto per applicare</span>
              )}
            </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center text-xs">
            <label className="flex items-center gap-2">
              <span>Tag A</span>
              <input className="border px-2 py-1 rounded w-44" placeholder="ID tag A" value={tagAId}
                     onChange={(e)=>setTagAId(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span>Tag B</span>
              <input className="border px-2 py-1 rounded w-44" placeholder="ID tag B" value={tagBId}
                     onChange={(e)=>setTagBId(e.target.value)} />
            </label>
            <div className="flex gap-2 flex-wrap">
              <button className="px-2 py-1 bg-gray-700 text-white rounded" onClick={()=>captureAB('A')}>Cattura A (RAW)</button>
              <button className="px-2 py-1 bg-gray-700 text-white rounded" onClick={()=>captureAB('B')}>Cattura B (RAW)</button>
              <button className="px-2 py-1 bg-gray-200 rounded" onClick={()=>{ setPtA2(null); setPtB2(null); }}>Reset A/B</button>
            </div>
            <div className="text-[11px] text-gray-600 col-span-1 md:col-span-2">
              {ptA2 ? `A: (${ptA2.x.toFixed(2)}, ${ptA2.y.toFixed(2)}) @ ${new Date(ptA2.ts).toLocaleTimeString()}` : 'A: —'}
              {"  |  "}
              {ptB2 ? `B: (${ptB2.x.toFixed(2)}, ${ptB2.y.toFixed(2)}) @ ${new Date(ptB2.ts).toLocaleTimeString()}` : 'B: —'}
            </div>
            <label className="flex items-center gap-2">
              <span>Distanza reale AB (m)</span>
              <input type="number" step="0.01" className="border px-2 py-1 rounded w-24" value={realDist}
                     onChange={(e)=>setRealDist(Number(e.target.value)||0)} />
            </label>
            <div className="text-[11px] text-gray-700">
              {rawDist2 ? (
                <>
                  <div className={(rawDist2>0?'':'text-red-600')}>AB ΔRAW: {rawDist2.toFixed(3)} unità</div>
                  <div className={(((Number(realDist)||0)/rawDist2)>0 ? '' : 'text-red-600')}>Scala suggerita: {(((Number(realDist)||0)/rawDist2)||0).toFixed(6)}</div>
                  <div>Rot° per allineare a Y: {angleDegAB!==null ? angleDegAB.toFixed(2) : '—'}</div>
                </>
              ) : (
                <div>AB ΔRAW: —</div>
              )}
            </div>
            <div className="col-span-1 md:col-span-2 flex gap-2 items-center">
              <button className="px-2 py-1 bg-emerald-700 text-white rounded disabled:opacity-50"
                      disabled={!rawDist2 || angleDegAB===null || !isFinite(rawDist2) || !isFinite(((Number(realDist)||0)/rawDist2))}
                      onClick={applyTwoTagCalibration}>Applica allinea+scala</button>
              <button className="px-2 py-1 bg-indigo-600 text-white rounded disabled:opacity-50"
                      disabled={!ptA2 || !ptB2}
                      onClick={() => { setPtA2(null); setPtB2(null); try{ setToast({type:'info', msg:'Campioni A/B azzerati'});}catch(_){} }}>Reset campioni</button>
              <div className="text-[11px] text-gray-500">Scala attuale: {Number(calibration.scale||1).toFixed(6)} • Rot° attuale: {Number(calibration.rotationDeg||0).toFixed(2)}</div>
            </div>
            <div className="col-span-1 md:col-span-2 text-[11px] text-gray-500">
              Posiziona due tag a distanza nota lungo Y; cattura A e B; inserisci distanza reale; applica per orientare e scalare.
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-medium">Dipendenti Presenti</h2>
          <p className="text-2xl">{countByType("employee")}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-medium">Asset Tracciati</h2>
          <p className="text-2xl">{countByType("asset")}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-medium">Tag Disponibili</h2>
            <button onClick={handleAddTag} className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500">Aggiungi TAG</button>
          </div>
          <p className="text-2xl">{countUnassociated()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Map with real-time positions */}
        <div className="lg:col-span-3 bg-white p-4 rounded shadow">
          <h2 className="text-lg font-medium mb-2">Mappa in tempo reale</h2>
          <div className="border rounded p-2 bg-gray-50">
            <div style={{ height: "500px" }}>
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-blue-600 flex items-center">
                    <svg className="animate-spin h-8 w-8 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Caricamento mappa...
                  </div>
                </div>
              ) : error ? (
                <div className="h-full flex items-center justify-center bg-red-50 text-red-600">
                  <div className="text-center p-4">
                    <svg className="h-10 w-10 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p>{error}</p>
                  </div>
                </div>
              ) : (
                <DxfViewer
                  data={mapData}
                  height="100%"
                  visualRotationDeg={calibration.visualMapRotationDeg || 0}
                  tagPositions={isolateSelected && selectedTag && enhancedPositions[selectedTag] ? { [selectedTag]: enhancedPositions[selectedTag] } : enhancedPositions}
                  referencePoints={showRefPoints ? (calibration?.referencePoints || []) : []}
                  debugRawPositions={useRawPositions ? {} : (typeof window !== 'undefined' ? (isolateSelected && selectedTag && window.__DEBUG_RAW && window.__DEBUG_RAW[selectedTag] ? { [selectedTag]: window.__DEBUG_RAW[selectedTag] } : window.__DEBUG_RAW || {}) : {})}
                  showTagsMessage={true}
                  areas={(() => { try { const raw = localStorage.getItem('logicalAreas_v1'); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; } } catch(_) {} return []; })()}
                  focusPoint={(function(){
                    if (!followSelected || !selectedTag) return null;
                    const direct = enhancedPositions[selectedTag];
                    if (direct) return { x: direct.x, y: direct.y, ts: Date.now() };
                    // risolvi tramite varianti id se la chiave è cambiata (dec/hex)
                    const s = String(selectedTag);
                    const alts = [];
                    const stripped = s.replace(/[^0-9A-Fa-f]/g,'').toUpperCase();
                    if (/^[0-9]+$/.test(s)) {
                      try { const n = parseInt(s,10)>>>0; alts.push(String(n)); alts.push(n.toString(16).toUpperCase()); } catch(_) {}
                    }
                    if (stripped) {
                      alts.push(stripped);
                      if (stripped.length>=8) { const low=stripped.slice(-8); alts.push(low); try { alts.push(String(parseInt(low,16))); } catch(_) {} }
                    }
                    for (let i=0;i<alts.length;i++) { const e = enhancedPositions[alts[i]]; if (e) return { x: e.x, y: e.y, ts: Date.now() }; }
                    return null;
                  })()}
                  onTagClick={(tagId) => handleTagSelect(tagId)}
                  onNormalizationChange={(ns) => {
                    // salva il fattore per coerenza futura tra client
                    if (typeof ns === 'number' && isFinite(ns)) {
                      updateCalibration({ normalizationScale: ns });
                    }
                  }}
                  onBoundsChange={(b) => setMapBounds(b)}
                />
              )}
            </div>
          </div>
          {/* Hint: se i tag non ricadono nei confini della mappa, offri un riallineamento rapido */}
          {offMapInfo.total > 0 && offMapInfo.inMap === 0 && (
            <div className="mt-2 p-3 rounded border bg-amber-50 text-amber-800 text-sm flex items-center gap-3">
              <div>
                I tag risultano fuori dalla planimetria{offMapInfo.nearMap>0? ' (vicino ai bordi)':''}. Puoi riallinearli automaticamente aggiornando gli offset.
              </div>
              <button onClick={autoAlignOffsets} className="ml-auto px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-500">
                Allinea automaticamente
              </button>
            </div>
          )}
          {/* Debug trasformazione selezionato */}
          {selectedTag && typeof window !== 'undefined' && window.__TRANSFORM_DEBUG && (
            (() => {
              const bd = window.__TRANSFORM_LAST;
              if (!bd) return null;
              const fmt = (v) => (v===undefined||v===null||!isFinite(v)? '—' : v.toFixed(2));
              return (
                <div className="mt-2 p-2 border rounded bg-white text-[11px]">
                  <div className="font-semibold mb-1">Breakdown trasformazione (tag {selectedTag})</div>
                  <div className="grid grid-cols-6 gap-x-2 gap-y-1">
                    <div className="col-span-2 text-gray-600">Raw</div><div className="col-span-4">{fmt(bd.rawX)}, {fmt(bd.rawY)}</div>
                    <div className="col-span-2 text-gray-600">Pre</div><div className="col-span-4">{fmt(bd.preX)}, {fmt(bd.preY)}</div>
                    <div className="col-span-2 text-gray-600">Core</div><div className="col-span-4">{fmt(bd.coreX)}, {fmt(bd.coreY)} ({bd.mode})</div>
                    <div className="col-span-2 text-gray-600">Glob</div><div className="col-span-4">{fmt(bd.globX)}, {fmt(bd.globY)}</div>
                    <div className="col-span-2 text-gray-600">Finale</div><div className="col-span-4">{fmt(bd.finalX)}, {fmt(bd.finalY)}</div>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">Attiva/disattiva in console: <code>window.__TRANSFORM_DEBUG = false/true</code></div>
                </div>
              );
            })()
          )}
          {/* Pannello accuratezza calibrazione (residui ultimi punti di riferimento) */}
          {calibration && Array.isArray(calibration.lastResiduals) && calibration.lastResiduals.length>0 && (
            (() => {
              const residuals = calibration.lastResiduals;
              const errs = residuals.map(r => Number(r.err)||0);
              const mean = errs.reduce((a,b)=>a+b,0)/errs.length;
              const sorted = errs.slice().sort((a,b)=>a-b);
              const median = sorted[Math.floor(sorted.length/2)] || 0;
              const max = Math.max(...errs);
              const thresh = median * 2;
              const outliers = residuals.filter(r => (r.err||0) > thresh);
              const worst = residuals.slice().sort((a,b)=>b.err - a.err).slice(0,5);
              const recomputeResiduals = () => {
                if (!calibration.referencePoints) return;
                const pts = calibration.referencePoints;
                const newR = [];
                pts.forEach(pt => {
                  const raw = positions[pt.id]; if (!raw) return;
                  let xx = Number(raw.x)||0; let yy = Number(raw.y)||0;
                  if (calibration.swapXY) { const t=xx; xx=yy; yy=t; }
                  if (calibration.invertY) yy = -yy;
                  if (calibration.affineEnabled && calibration.affine && isFinite(calibration.affine.a)) {
                    const A = calibration.affine;
                    const x2 = (Number(A.a)||0)*xx + (Number(A.b)||0)*yy + (Number(A.tx)||0);
                    const y2 = (Number(A.c)||0)*xx + (Number(A.d)||0)*yy + (Number(A.ty)||0);
                    xx = x2; yy = y2;
                  } else {
                    const rad = (Number(calibration.rotationDeg)||0)*Math.PI/180;
                    const pivX = Number(calibration.pivotX)||0; const pivY = Number(calibration.pivotY)||0;
                    let rx = xx - pivX; let ry = yy - pivY;
                    if (rad) { const cos=Math.cos(rad), sin=Math.sin(rad); const ox=rx, oy=ry; rx=ox*cos - oy*sin; ry=ox*sin + oy*cos; }
                    const sc = Number(calibration.scale)||1; rx*=sc; ry*=sc;
                    xx = rx + pivX + (Number(calibration.offsetX)||0);
                    yy = ry + pivY + (Number(calibration.offsetY)||0);
                  }
                  try { const ov=calibration.tagOverrides||{}; const k=String(pt.id); if (ov[k]) { xx+=Number(ov[k].dx)||0; yy+=Number(ov[k].dy)||0; } } catch(_) {}
                  const dx = Number(pt.mapX) - xx; const dy = Number(pt.mapY) - yy;
                  newR.push({ id: pt.id, dx, dy, err: Math.hypot(dx,dy) });
                });
                updateCalibration({ lastResiduals: newR });
              };
              return (
                <div className="mt-2 p-2 border rounded bg-white text-[11px]">
                  <div className="font-semibold mb-1">Accuratezza calibrazione</div>
                  <div className="flex flex-wrap gap-3">
                    <span>Mean: {mean.toFixed(2)}</span>
                    <span>Median: {median.toFixed(2)}</span>
                    <span>Max: {max.toFixed(2)}</span>
                    <span>Outliers (&gt;2×med): {outliers.length}</span>
                  </div>
                  <div className="mt-1">Peggiori (top 5): {worst.map(r => `${r.id}:${r.err.toFixed(2)}${r.err>thresh?'*':''}`).join(' | ')}</div>
                  <div className="mt-1 text-[10px] text-gray-500">'*' = oltre soglia {thresh.toFixed(2)}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="px-2 py-1 bg-indigo-600 text-white rounded" onClick={recomputeResiduals} title="Ricalcola residui sui punti di riferimento memorizzati">Ricalcola precisione</button>
                  </div>
                </div>
              );
            })()
          )}
          {/* Auto calibration block (solo avanzata) */}
          {!simpleMode && <AutoCalibration />}
          {calibration?.referencePoints?.length>0 && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <label className="flex items-center gap-1"><input type="checkbox" checked={showRefPoints} onChange={e=> setShowRefPoints(e.target.checked)} /> Mostra punti riferimento</label>
              <span className="text-gray-500">({calibration.referencePoints.length})</span>
            </div>
          )}
          <div className="mt-2 text-sm text-gray-500 flex flex-wrap gap-4">
            <div><span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-1"></span> Dipendenti</div>
            <div><span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1"></span> Asset</div>
            <div className="flex-1 text-right">
              {Object.keys(enhancedPositions).length === 0 ? (
                <span className="italic">Nessun tag rilevato</span>
              ) : (
                <span>Tag attivi: {Object.keys(enhancedPositions).length}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tag list */}
        <div className="lg:col-span-1 bg-white p-4 rounded shadow">
          <h2 className="text-lg font-medium mb-2">Tag Attivi</h2>

          {selectedTag && (
            <div className="mb-4 p-4 bg-blue-50 rounded-md border border-blue-200 relative">
              <button
                onClick={() => setSelectedTag(null)}
                className="absolute top-1 right-1 text-[10px] text-blue-700 hover:text-blue-500"
                title="Chiudi"
              >✕</button>
              <h3 className="font-medium text-blue-800 pr-4">
                {enhancedPositions[selectedTag]?.name || (() => { const s=String(selectedTag); const hl=s.replace(/[^0-9A-Fa-f]/g,''); const hasHexLetter=/[A-Fa-f]/.test(hl); if (hasHexLetter && hl.length>=8) return `Tag 0x${hl.toUpperCase()}`; const n=Number(s); return !Number.isNaN(n)? `Tag 0x${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}` : `Tag ${s}`; })()}
              </h3>
              <div className="mt-1 grid grid-cols-1 text-xs text-blue-900 gap-y-1">
                <div><span className="font-semibold">ID:</span> {(() => { const s=String(selectedTag); const hl=s.replace(/[^0-9A-Fa-f]/g,''); const hasHexLetter=/[A-Fa-f]/.test(hl); if (hasHexLetter && hl.length>=8) return '0x'+hl.toUpperCase(); const n=Number(s); return !Number.isNaN(n)? ('0x'+(n>>>0).toString(16).toUpperCase().padStart(8,'0')) : s; })()}</div>
                {enhancedPositions[selectedTag] && (
                  <>
                    <div><span className="font-semibold">Pos:</span> {enhancedPositions[selectedTag].x.toFixed(2)}, {enhancedPositions[selectedTag].y.toFixed(2)}</div>
                    {(() => { try { const ov = (calibration && calibration.tagOverrides) ? calibration.tagOverrides[String(selectedTag)] : null; return ov ? (<div><span className="font-semibold">Correzione tag:</span> dx {Number(ov.dx||0).toFixed(2)}, dy {Number(ov.dy||0).toFixed(2)}</div>) : null; } catch(_) { return null; } })()}
                    {typeof enhancedPositions[selectedTag].cap !== 'undefined' && (
                      <div><span className="font-semibold">Batteria:</span> {enhancedPositions[selectedTag].cap}%</div>
                    )}
                    {typeof enhancedPositions[selectedTag].bcharge !== 'undefined' && (
                      <div><span className="font-semibold">Carica:</span> {enhancedPositions[selectedTag].bcharge ? 'Sì' : 'No'}</div>
                    )}
                    {typeof enhancedPositions[selectedTag].sleep !== 'undefined' && (
                      <div><span className="font-semibold">Sleep:</span> {enhancedPositions[selectedTag].sleep ? 'Sì' : 'No'}</div>
                    )}
                    <div><span className="font-semibold">Età frame:</span> {Math.round(enhancedPositions[selectedTag].ageMs || (Date.now() - enhancedPositions[selectedTag].ts))}ms</div>
                  </>
                )}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap text-xs">
                <button onClick={centerSelectedTag} className="px-2 py-1 bg-indigo-600 text-white rounded" title="Centra (offset globale - muove tutti)">Centra (globale)</button>
                <button onClick={placeSelectedTag} className="px-2 py-1 bg-purple-600 text-white rounded" title="Posiziona (offset globale - muove tutti)">Posiziona (globale)</button>
                <button onClick={() => anchorSelectedTagAsOrigin(0,0)} className="px-2 py-1 bg-blue-700 text-white rounded" title="Imposta origine mappa su 0,0 usando il RAW del tag selezionato (pivot=RAW, offset=target-RAW)">Ancora a 0,0</button>
                <span className="inline-block w-px h-5 bg-gray-300 mx-1 align-middle" />
                <button onClick={centerSelectedTagLocal} className="px-2 py-1 bg-emerald-700 text-white rounded" title="Centra solo questo tag (override locale)">Centra solo tag</button>
                <button onClick={placeSelectedTagLocal} className="px-2 py-1 bg-emerald-600 text-white rounded" title="Posiziona solo questo tag (override locale)">Posiziona solo tag</button>
                <button onClick={clearSelectedTagLocal} className="px-2 py-1 bg-rose-600 text-white rounded" title="Rimuove la correzione locale di questo tag">Pulisci correzione tag</button>
                {!backendTagSet.has(canonicalizeId(selectedTag)) && (
                  <button onClick={() => handleAddSpecificTag(selectedTag)} className="px-2 py-1 bg-emerald-700 text-white rounded" title="Aggiungi questo TAG all'anagrafica">Aggiungi TAG</button>
                )}
                {backendTagSet.has(canonicalizeId(selectedTag)) && (
                  <>
                    <button onClick={() => renameTag(selectedTag)} className="px-2 py-1 bg-sky-600 text-white rounded" title="Rinomina questo TAG (anagrafica)">Rinomina</button>
                    <button onClick={() => handleRemoveSpecificTag(selectedTag)} className="px-2 py-1 bg-rose-600 text-white rounded" title="Rimuovi questo TAG dall'anagrafica">Rimuovi TAG</button>
                  </>
                )}
                  {followSelected && (
                    <button onClick={() => { try { if (typeof window !== 'undefined') { window.__DXF_EXIT_FOLLOW = true; } } catch(_){}; setFollowSelected(false); }} className="px-2 py-1 bg-yellow-600 text-black rounded" title="Esci da follow">Esci da follow</button>
                  )}
                {!simpleMode && (
                  <div className="flex items-center gap-3 ml-auto">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={isolateSelected} onChange={e=> setIsolateSelected(e.target.checked)} /> mostra solo questo tag</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={followSelected} onChange={e=> setFollowSelected(e.target.checked)} /> segui</label>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="overflow-auto max-h-96">
            {Object.keys(enhancedPositions).length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {Object.entries(enhancedPositions).map(([tagId, info]) => (
                  <li key={tagId} className={`py-3 px-2 hover:bg-gray-50 ${selectedTag === tagId ? "bg-blue-50" : ""}`}>
                    <div className="flex items-start gap-3" onClick={() => handleTagSelect(tagId)}>
                      <div className={`w-3 h-3 rounded-full mt-1 ${info.type === "employee" ? "bg-blue-500" : "bg-green-500"}`}></div>
                      <div className="flex-1">
                        <div className="font-medium">
                          {info.name || `Tag ${info.idHexShown || tagId}`}
                        </div>
                        <div className="text-xs text-gray-500">
                          {(info.idHexShown || tagId)} / {canonicalizeId(tagId)} • ({info.x.toFixed(1)}, {info.y.toFixed(1)}) • age {Math.round(info.ageMs)}ms
                        </div>
                      </div>
                      {backendTagSet.has(canonicalizeId(tagId)) ? (
                        <div className="flex items-center gap-2">
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] rounded bg-sky-600 text-white hover:bg-sky-500"
                            onClick={(e) => { e.stopPropagation(); renameTag(tagId); }}
                            title="Rinomina TAG"
                          >Rinomina</button>
                          <button
                            className="ml-1 px-2 py-0.5 text-[11px] rounded bg-rose-600 text-white hover:bg-rose-500"
                            onClick={(e) => { e.stopPropagation(); handleRemoveSpecificTag(tagId); }}
                            title="Rimuovi TAG"
                          >Rimuovi</button>
                        </div>
                      ) : (
                        <button
                          className="ml-2 px-2 py-0.5 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          onClick={(e) => { e.stopPropagation(); handleAddSpecificTag(tagId); }}
                          title="Aggiungi questo TAG all'anagrafica"
                        >Aggiungi</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (!isConnected && (tags||[]).length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {(tags||[]).filter(t => !t.decommissionedAt).map(t => {
                  const canon = canonicalizeId(t.id);
                  return (
                    <li key={t.id} className="py-3 px-2 flex items-start gap-3 bg-gray-50">
                      <div className="w-3 h-3 rounded-full mt-1 bg-gray-400" />
                      <div className="flex-1">
                        <div className="font-medium">Tag {canon}</div>
                        <div className="text-xs text-gray-500">Offline • registrato in anagrafica</div>
                      </div>
                      {!backendTagSet.has(canon) && (
                        <button
                          className="ml-2 px-2 py-0.5 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          onClick={(e) => { e.stopPropagation(); handleAddSpecificTag(t.id); }}
                          title="Aggiungi questo TAG all'anagrafica"
                        >Aggiungi</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="py-8 text-center text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="mt-2">Nessun tag attivo rilevato</p>
                <p className="mt-1 text-sm">I tag appariranno qui quando saranno online</p>
              </div>
            ))}
          </div>
        </div>

        {/* Anagrafica TAG (tutti, inclusi offline) */}
        <div className="lg:col-span-1 bg-white p-4 rounded shadow mt-6 lg:mt-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium">Anagrafica TAG</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => reloadTags()} className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Aggiorna</button>
            </div>
          </div>
          {(() => {
            const activeSet = new Set(Object.keys(enhancedPositions || {}).map(k => canonicalizeId(k)));
            const total = (tags || []).length;
            const online = (tags || []).filter(t => activeSet.has(canonicalizeId(t.id))).length;
            const offline = total - online;
            return (
              <div className="text-xs text-gray-600 mb-2">Totali: {total} • Online: {online} • Offline: {offline}</div>
            );
          })()}
          {/* no React state here to avoid rerenders; using dataset flag above */}
          {/* semplice filtro offline/all */}
          <div className="mb-2 text-xs">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" onChange={(e)=>{
                const box = e.target; const cont = box.closest('.anagrafica-wrapper'); if (!cont) return;
                cont.dataset.onlyOffline = box.checked ? '1' : '0';
              }} /> Mostra solo offline
            </label>
          </div>
          <div className="anagrafica-wrapper" data-only-offline="0">
            <ul className="divide-y divide-gray-200 max-h-80 overflow-auto">
              {(tags || []).map((t) => {
                const canon = canonicalizeId(t.id);
                const isOnline = (() => {
                  if (Object.prototype.hasOwnProperty.call(enhancedPositions, canon)) return true;
                  const hx = String(canon).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
                  if (hx && /^[0-9A-Fa-f]{8,}$/.test(hx)) {
                    try { const low = String(parseInt(hx.slice(-8), 16) >>> 0); if (Object.prototype.hasOwnProperty.call(enhancedPositions, low)) return true; } catch(_) {}
                  } else if (/^[0-9]+$/.test(String(canon))) {
                    try { const h8 = (Number(canon)>>>0).toString(16).toUpperCase().padStart(8,'0'); if (Object.prototype.hasOwnProperty.call(enhancedPositions, h8)) return true; } catch(_) {}
                  }
                  return false;
                })();
                const isDecommissioned = !!t.decommissionedAt;
                return (
                  <li key={t.id} className={`py-2 px-1 text-sm flex items-center justify-between ${isDecommissioned ? 'opacity-60' : ''}`}
                      style={{ display: (function(){ try { const wrap = document.querySelector('.anagrafica-wrapper'); const only = wrap && wrap.dataset.onlyOffline==='1'; return (only && isOnline) ? 'none' : ''; } catch(_) { return ''; } })() }}>
                    <div className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${isDecommissioned ? 'bg-rose-400' : (isOnline? 'bg-emerald-500':'bg-gray-400')}`}></span>
                            <span className="font-mono text-[12px]">{canon}</span>
                            {(() => {
                              try {
                                // Compute hex full and low32 variants for display
                                let hexFull = null, low32 = null;
                                const c = String(canon || '');
                                const rawHex = c.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
                                if (/[A-F]/i.test(rawHex) && rawHex.length >= 8) {
                                  hexFull = '0x' + rawHex;
                                  try { low32 = String(parseInt(rawHex.slice(-8), 16) >>> 0); } catch(_) { low32 = null; }
                                } else if (/^[0-9]+$/.test(c)) {
                                  low32 = String(Number(c) >>> 0);
                                  try { hexFull = '0x' + (Number(c)>>>0).toString(16).toUpperCase().padStart(8,'0'); } catch(_) { hexFull = null; }
                                }
                                if (hexFull || low32) {
                                  return (<span className="ml-2 text-[11px] text-gray-500">{hexFull ? hexFull : ''}{hexFull && low32 ? ' • ' : ''}{low32 ? low32 : ''}</span>);
                                }
                              } catch(_) {}
                              return null;
                            })()}
                      {Number.isFinite(Number(t.battery)) && <span className="text-[11px] text-gray-500">{t.battery}%</span>}
                      {isDecommissioned && <span className="text-[11px] text-rose-700 border border-rose-200 bg-rose-50 px-1 rounded">Dismesso</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] ${isDecommissioned ? 'text-rose-700' : (isOnline? 'text-emerald-700':'text-gray-500')}`}>{isDecommissioned ? 'Dismesso' : (isOnline? 'Online':'Offline')}</span>
                      {isDecommissioned ? (
                        <button className="px-2 py-0.5 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-500"
                                onClick={async () => { try { await restoreTag(canon); await reloadTags(); setToast({ type: 'success', msg: `Tag ${canon} ripristinato` }); } catch(e){ alert('Errore nel ripristino: '+(e?.message||'')); } }}
                                title="Ripristina TAG">Ripristina</button>
                      ) : (
                        <button className="px-2 py-0.5 text-[11px] rounded bg-rose-600 text-white hover:bg-rose-500"
                                onClick={() => handleRemoveSpecificTag(t.id)}
                                title="Rimuovi TAG">Rimuovi</button>
                      )}
                    </div>
                  </li>
                );
              })}
              {(tags || []).length === 0 && (
                <li className="py-6 text-center text-gray-500 text-sm">Nessun tag in anagrafica</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;