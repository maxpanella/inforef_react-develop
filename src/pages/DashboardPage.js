import React, { useEffect, useState } from "react";
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
  } = useData();

  const [mapData, setMapData] = useState(null);
  const [enhancedPositions, setEnhancedPositions] = useState({});
  const [selectedTag, setSelectedTag] = useState(null);
  const [mapBounds, setMapBounds] = useState(null); // {min:{x,y}, max:{x,y}} unità DXF raw
  const [toast, setToast] = useState(null); // piccoli messaggi di conferma
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
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [useRawPositions, setUseRawPositions] = useState(false);
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [followSelected, setFollowSelected] = useState(false); // disattiva pan automatico sul click

  // Rileva se i tag risultano fuori dalla planimetria e fornisce un'azione rapida di riallineamento offset
  const [offMapInfo, setOffMapInfo] = useState({ total: 0, inMap: 0, nearMap: 0 });
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

  const autoAlignOffsets = () => {
    if (!mapBounds) { alert('Mappa non pronta'); return; }
    const ids = Object.keys(enhancedPositions);
    if (ids.length === 0) { alert('Nessun tag da allineare'); return; }
    const cx = ((Number(mapBounds.min?.x)||0) + (Number(mapBounds.max?.x)||0)) / 2;
    const cy = ((Number(mapBounds.min?.y)||0) + (Number(mapBounds.max?.y)||0)) / 2;
    let sumX = 0, sumY = 0, n = 0;
    ids.forEach(id => { const p = enhancedPositions[id]; if (!p) return; const x = Number(p.x); const y = Number(p.y); if (isFinite(x) && isFinite(y)) { sumX += x; sumY += y; n++; } });
    if (n === 0) { alert('Coordinate non valide per i tag'); return; }
    const avgX = sumX / n;
    const avgY = sumY / n;
    const dx = cx - avgX;
    const dy = cy - avgY;
    updateCalibration({ offsetX: (Number(calibration.offsetX)||0) + dx, offsetY: (Number(calibration.offsetY)||0) + dy });
    try { setToast({ type: 'success', msg: 'Offset aggiornati per centrare i tag sulla mappa' }); } catch(_) {}
  };

  // Seleziona il primo sito se non ce n'è uno corrente
  useEffect(() => {
    if (!currentSite && sites.length > 0) {
      selectSite(sites[0].id);
    }
  }, [currentSite, sites, selectSite]);

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

    // Trasformazione coordinate in base alla calibrazione
    const applyTransform = (x, y) => {
      if (useRawPositions) return { x: Number(x) || 0, y: Number(y) || 0 };
      let xx = Number(x) || 0;
      let yy = Number(y) || 0;
      if (calibration.swapXY) {
        const t = xx; xx = yy; yy = t;
      }
      if (calibration.invertY) yy = -yy;
      const rad = (Number(calibration.rotationDeg) || 0) * Math.PI / 180;
      if (rad) {
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const oldX = xx, oldY = yy;
        xx = oldX * cos - oldY * sin;
        yy = oldX * sin + oldY * cos;
      }
      const scale = Number(calibration.scale) || 1;
      xx = xx * scale + (Number(calibration.offsetX) || 0);
      yy = yy * scale + (Number(calibration.offsetY) || 0);
      return { x: xx, y: yy };
    };
    // Filtra per recenti
    Object.entries(positions).forEach(([tagId, pos]) => {
      if (!pos || !pos.ts) return;
      const age = now - pos.ts;
      if (age <= ACTIVE_WINDOW_MS) {
        const t = applyTransform(pos.x, pos.y);
        positionsWithInfo.push({
          tagId,
          ...pos,
          x: t.x,
          y: t.y,
          name: `Tag ${tagId}`,
          type: "unknown",
          entityId: null,
          ageMs: age,
        });
      }
    });

    // Ordina per timestamp decrescente
    positionsWithInfo.sort((a, b) => b.ts - a.ts);
    const totalActive = positionsWithInfo.length;
    const truncated = positionsWithInfo.slice(0, MAX_TAGS);

    // Helper: risolvi nome anche provando varianti ID (dec/hex/low32)
    const resolveName = (id) => {
      const names = tagNames || {};
      const variants = new Set();
      const s = String(id || '');
      variants.add(s);
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

    // Trasforma in mappa per viewer
    const mapObj = {};
    const rawObj = {};
    truncated.forEach(p => {
      const tName = resolveName(p.tagId);
      mapObj[p.tagId] = { ...p, name: tName || p.name };
      // Mantieni anche RAW per debug (prima della calibrazione)
      const orig = positions[p.tagId];
      if (orig) rawObj[p.tagId] = { x: Number(orig.x) || 0, y: Number(orig.y) || 0, name: tName || p.name };
    });

    if (Object.keys(mapObj).length === 0 && !isConnected && SHOW_FAKE_TAGS) {
      mapObj["TAG001"] = { id: "TAG001", x: 31.7, y: 62.0, z: 0, name: "Mario Rossi", type: "employee", entityId: 1, ts: now };
      mapObj["TAG002"] = { id: "TAG002", x: 65.7, y: 42.6, z: 0, name: "Gru 002", type: "asset", entityId: 10, ts: now };
    }

    setEnhancedPositions(mapObj);
    try { window.__DEBUG_RAW = rawObj; } catch(_) {}
    console.log("Tag positions enhanced:", Object.keys(mapObj).length, "(active recent=", totalActive, "truncated to", MAX_TAGS, ")");
  }, [positions, tagAssociations, employees, assets, isConnected, tagNames, calibration, useRawPositions]);

  // Auto-hide toast after a short delay
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // Gestisce la selezione di un tag (click da mappa o lista)
  const handleTagSelect = (tagId) => {
    console.log("Tag selezionato:", tagId);
    setSelectedTag(tagId);
  };

  const countByType = (type) =>
    tagAssociations.filter((a) => a.targetType === type).length;

  const countUnassociated = () =>
    tags.filter((t) => !tagAssociations.find((a) => a.tagId === t.id)).length;

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
        {simpleMode && (
          <button
            onClick={() => saveCalibration()}
            className="ml-4 px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 text-xs"
            title="Salva su database la calibrazione corrente (offset, scala, rotazione)"
          >Salva configurazione</button>
        )}
      </div>

      {/* Barra superiore semplificata */}
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
        <div className="flex flex-wrap gap-3 items-center text-xs">
          <span>Calibrazione:</span>
          <label className="flex items-center gap-1 mr-2"><input type="checkbox" checked={useRawPositions} onChange={e => setUseRawPositions(e.target.checked)} /> ignora calibrazione (mostra RAW)</label>
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
          <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={calibration.invertY}
            onChange={e => updateCalibration({ invertY: e.target.checked })} /> invertY</label>
          <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={calibration.swapXY}
            onChange={e => updateCalibration({ swapXY: e.target.checked })} /> swapXY</label>
          <div className="flex items-center gap-2 ml-auto">
            <button className="px-2 py-1 bg-emerald-600 text-white rounded" onClick={() => saveCalibration()}>Salva</button>
            <button className="px-2 py-1 bg-sky-600 text-white rounded" onClick={() => loadCalibration()}>Ricarica</button>
            <button className="px-2 py-1 bg-rose-600 text-white rounded" onClick={() => resetCalibration()}>Reset</button>
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
          <h2 className="text-lg font-medium">Tag Disponibili</h2>
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
                  tagPositions={isolateSelected && selectedTag && enhancedPositions[selectedTag] ? { [selectedTag]: enhancedPositions[selectedTag] } : enhancedPositions}
                  debugRawPositions={useRawPositions ? {} : (typeof window !== 'undefined' ? (isolateSelected && selectedTag && window.__DEBUG_RAW && window.__DEBUG_RAW[selectedTag] ? { [selectedTag]: window.__DEBUG_RAW[selectedTag] } : window.__DEBUG_RAW || {}) : {})}
                  showTagsMessage={true}
                  focusPoint={followSelected && selectedTag && enhancedPositions[selectedTag] ? { x: enhancedPositions[selectedTag].x, y: enhancedPositions[selectedTag].y, ts: Date.now() } : null}
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
          {/* Auto calibration block (solo avanzata) */}
          {!simpleMode && <AutoCalibration />}
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
                {enhancedPositions[selectedTag]?.name || (() => { const s=String(selectedTag); const hl=s.replace(/[^0-9A-Fa-f]/g,''); if (/^[0-9A-Fa-f]{8,}$/.test(hl)) return `Tag 0x${hl.toUpperCase()}`; const n=Number(s); return !Number.isNaN(n)? `Tag 0x${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}` : `Tag ${s}`; })()}
              </h3>
              <div className="mt-1 grid grid-cols-1 text-xs text-blue-900 gap-y-1">
                <div><span className="font-semibold">ID:</span> {(() => { const s=String(selectedTag); const hl=s.replace(/[^0-9A-Fa-f]/g,''); if (/^[0-9A-Fa-f]{8,}$/.test(hl)) return '0x'+hl.toUpperCase(); const n=Number(s); return !Number.isNaN(n)? ('0x'+(n>>>0).toString(16).toUpperCase().padStart(8,'0')) : s; })()}</div>
                {enhancedPositions[selectedTag] && (
                  <>
                    <div><span className="font-semibold">Pos:</span> {enhancedPositions[selectedTag].x.toFixed(2)}, {enhancedPositions[selectedTag].y.toFixed(2)}</div>
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
                <button onClick={centerSelectedTag} className="px-2 py-1 bg-indigo-600 text-white rounded" title="Centra il tag e aggiorna Offset">Centra tag</button>
                <button onClick={placeSelectedTag} className="px-2 py-1 bg-purple-600 text-white rounded" title="Imposta destinazione e aggiorna Offset">Posiziona manuale</button>
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
                  <li key={tagId} className={`py-3 px-2 cursor-pointer hover:bg-gray-50 ${selectedTag === tagId ? "bg-blue-50" : ""}`}
                      onClick={() => handleTagSelect(tagId)}>
                    <div className="flex items-start gap-3">
                      <div className={`w-3 h-3 rounded-full mt-1 ${info.type === "employee" ? "bg-blue-500" : "bg-green-500"}`}></div>
                      <div className="flex-1">
                        <div className="font-medium">
                          {info.name || (() => { const s=String(tagId); const hl=s.replace(/[^0-9A-Fa-f]/g,''); if (/^[0-9A-Fa-f]{8,}$/.test(hl)) return `Tag 0x${hl.toUpperCase()}`; const n=Number(s); return !Number.isNaN(n)? `Tag 0x${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}` : `Tag ${s}`; })()}
                        </div>
                        <div className="text-xs text-gray-500">
                          {(() => { const s=String(tagId); const hl=s.replace(/[^0-9A-Fa-f]/g,''); if (/^[0-9A-Fa-f]{8,}$/.test(hl)) return `0x${hl.toUpperCase()}`; const n=Number(s); return !Number.isNaN(n)? `0x${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}` : s; })()} • ({info.x.toFixed(1)}, {info.y.toFixed(1)}) • age {Math.round(info.ageMs)}ms
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;