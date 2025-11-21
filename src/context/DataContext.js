/* eslint-disable react-hooks/exhaustive-deps */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canonicalizeId } from "../services/tagCanonicalizer";
import { getTags as apiGetTags, createTag as apiCreateTag, deleteTag as apiDeleteTag, deleteTagByInternalId as apiDeleteByInternalId, restoreTag as apiRestoreTag } from "../services/backendClient";
import { LocalsenseClient } from "../services/localsenseClient";

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export const DataProvider = ({ children }) => {
  // Dati base per UI
  const [sites] = useState([{ id: 1, name: "Sito Principale" }]);
  const [currentSite, setCurrentSite] = useState({ id: 1, name: "Sito Principale" });
  const selectSite = useCallback((id) => setCurrentSite({ id, name: "Sito Principale" }), []);

  // Anagrafiche (se servono le caricherai altrove)
  const [employees] = useState([]);
  const [assets] = useState([]);
  const [tags, setTags] = useState([]);
    // Load tags registry from backend
    const loadTags = async () => {
      try {
        const list = await apiGetTags();
        const tagsList = Array.isArray(list) ? list : [];
        setTags(tagsList);
        // Merge DB-stored names into runtime tagNames so live views show the DB name
        try {
          const mapping = {};
          tagsList.forEach(t => {
            if (t && t.id && t.name) {
              try { mapping[canonicalizeId(t.id)] = t.name; } catch(_) { mapping[String(t.id)] = t.name; }
            }
          });
          if (Object.keys(mapping).length) {
            setTagNames(prev => {
              const merged = { ...prev, ...mapping };
              try { localStorage.setItem('blueiot_tag_names', JSON.stringify(merged)); } catch(_) {}
              return merged;
            });
          }
        } catch(_) {}
      } catch (_) {
        setTags([]);
      }
    };

    const syncDbNames = async () => {
      // Force reload and overwrite tagNames strictly with DB names
      try {
        const list = await apiGetTags();
        const tagsList = Array.isArray(list) ? list : [];
        setTags(tagsList);
        const mapping = {};
        tagsList.forEach(t => { if (t && t.id && t.name) { mapping[canonicalizeId(t.id)] = t.name; } });
        setTagNames(mapping);
        try { localStorage.setItem('blueiot_tag_names', JSON.stringify(mapping)); } catch(_) {}
      } catch(e) {
        console.error('Sync DB names failed', e);
      }
    };
    useEffect(() => { loadTags(); }, []);

    const createTag = async (id, battery = null, name = null) => {
      await apiCreateTag(String(id), battery, name);
      await loadTags();
      return true;
    };

    const removeTag = async (id) => {
      // Prefer deletion by internalId (stable) when possible.
      // id may be: internalId (number or numeric string) OR canonical tag id string.
      try {
        const maybeNum = Number(id);
        // If it's an integer, try lookup by internalId first
        if (Number.isInteger(maybeNum) && maybeNum > 0) {
          const byInternal = tags.find(t => Number(t.internalId) === maybeNum);
          if (byInternal) {
            const res = await apiDeleteByInternalId(maybeNum);
            await loadTags();
            return res;
          }
        }
        // Otherwise, try to find the tag object by its stored id and delete by its internalId
        const found = tags.find(t => String(t.id) === String(id));
        if (found && found.internalId) {
          const res = await apiDeleteByInternalId(Number(found.internalId));
          await loadTags();
          return res;
        }
        // Fallback to existing behavior (server will canonicalize)
        const res = await apiDeleteTag(String(id));
        await loadTags();
        return res;
      } catch (e) {
        // On error, still try to refresh tags
        try { await loadTags(); } catch(_) {}
        throw e;
      }
    };
    const restoreTag = async (id) => {
      await apiRestoreTag(String(id));
      await loadTags();
      return true;
    };
  const [tagAssociations] = useState([]);

  // Realtime
  const [positions, setPositions] = useState({});
  const recentHistoryRef = useRef({}); // tagId -> array of recent samples
  const smoothedPositionsRef = useRef({}); // stable displayed position
  const [isConnected, setIsConnected] = useState(false);

  // Alias tag (mappa ID -> Nome personalizzato), persistiti in localStorage
  // Mappa nomi tag provenienti dal motore di posizione (auto, nessun alias manuale)
  const [tagNames, setTagNames] = useState({});
  // Persistenza nomi su localStorage (cache fra riavvii)
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('blueiot_tag_names') || 'null');
      if (cached && typeof cached === 'object') setTagNames(cached);
    } catch(_) {}
    const onNames = (map) => {
      if (!map || typeof map !== 'object') return;
      setTagNames(prev => {
        const merged = { ...prev, ...map };
        try { localStorage.setItem('blueiot_tag_names', JSON.stringify(merged)); } catch(_) {}
        return merged;
      });
      // Auto-crea tag nel backend se non esiste ancora
      try {
        const currentIds = new Set(tags.map(t => String(t.id)));
        Object.keys(map).forEach(id => {
          const sid = String(id);
          if (!currentIds.has(sid)) {
            // crea tag con nome se nuovo (batteria ignota -> null)
            apiCreateTag(sid, null, map[sid]).catch(()=>{});
          }
        });
      } catch(_) {}
    };
    LocalsenseClient.on('tagNames', onNames);
    return () => LocalsenseClient.off('tagNames', onNames);
  }, [tags]);
  const clearCachedTagNames = useCallback(() => {
    try { localStorage.removeItem('blueiot_tag_names'); } catch(_) {}
    setTagNames({});
  }, []);

  // Calibrazione mappa per sito corrente (scala, offset, flip/rotazione)
  // Include anche correzioni per-tag (override locali) applicate DOPO la calibrazione globale
  // Formato: tagOverrides: { [tagKey]: { dx, dy } }
  const defaultCalib = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    invertY: false,
    swapXY: false,
    rotationDeg: 0,
    visualMapRotationDeg: 0, // rotazione solo visuale della mappa/tag (render)
    pivotX: 0,
    pivotY: 0,
    normalizationScale: 1,
    tagOverrides: {},
    // Affine calibration (advanced): x' = a*x + b*y + tx; y' = c*x + d*y + ty
    affineEnabled: false,
    affine: null, // { a,b,c,d,tx,ty }
    // Tracking smoother (Kalman) for tag motion
    trackingEnabled: true,
    trackingResponsiveness: 0.65, // 0=più liscio, 1=più reattivo
    outlierSensitivity: 0.7,      // 0=più tollerante, 1=più severo
    deadbandM: 0.10,              // scatta a misura grezza se differenza < deadband quando fermo
    referencePoints: [],          // [{ id, mapX, mapY }] punti di riferimento inseriti dall'utente per analisi accuratezza
    lastResiduals: [],            // ultima serie di residui calcolati (per pannello accuratezza)
  };
  const [calibration, setCalibration] = useState(defaultCalib);
  const lastSavedCalibRef = useRef(JSON.stringify(defaultCalib));
  const [calibrationDirty, setCalibrationDirty] = useState(false);
  const loadCalibration = async () => {
    const siteId = currentSite?.id || 'default';
    const key = `blueiot_map_calib_${siteId}`;
    // Try server first
    try {
      const resp = await fetch(`/api/map-config/${siteId}`);
      if (resp.ok) {
        const j = await resp.json();
        if (j && j.config && typeof j.config === 'object') {
          const loaded = { ...defaultCalib, ...j.config };
          setCalibration(loaded);
          lastSavedCalibRef.current = JSON.stringify(loaded);
          setCalibrationDirty(false);
          try { localStorage.setItem(key, JSON.stringify(j.config)); } catch(_) {}
          return true;
        }
      }
    } catch(_) {}
    // Fallback local
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      const loaded = saved && typeof saved === 'object' ? { ...defaultCalib, ...saved } : defaultCalib;
      setCalibration(loaded);
      lastSavedCalibRef.current = JSON.stringify(loaded);
      setCalibrationDirty(false);
      return true;
    } catch {
      setCalibration(defaultCalib);
      lastSavedCalibRef.current = JSON.stringify(defaultCalib);
      setCalibrationDirty(false);
      return false;
    }
  };
  useEffect(() => { loadCalibration(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [currentSite?.id]);
  const updateCalibration = (next) => {
    // Mantieni i valori esistenti e sovrascrivi solo i campi passati
    const merged = { ...defaultCalib, ...calibration, ...next };
    setCalibration(merged);
    try {
      const currentJson = JSON.stringify(merged);
      setCalibrationDirty(currentJson !== lastSavedCalibRef.current);
    } catch(_) {}
    const siteId = currentSite?.id || 'default';
    const key = `blueiot_map_calib_${siteId}`;
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch {}
    // Also persist to backend
    try {
      fetch('/api/map-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, config: merged }),
      });
    } catch(_) {}
  };
  // Imposta/aggiorna una correzione locale per un tag specifico (dx,dy in unità mappa)
  const updateTagOverride = (tagKey, dx = 0, dy = 0) => {
    try {
      const key = String(tagKey);
      const cur = (calibration && calibration.tagOverrides) ? calibration.tagOverrides : {};
      const nextMap = { ...cur, [key]: { dx: Number(dx) || 0, dy: Number(dy) || 0 } };
      updateCalibration({ tagOverrides: nextMap });
    } catch (_) {}
  };
  // Rimuove la correzione locale per un tag
  const clearTagOverride = (tagKey) => {
    try {
      const key = String(tagKey);
      const cur = (calibration && calibration.tagOverrides) ? calibration.tagOverrides : {};
      if (!cur[key]) return;
      const nextMap = { ...cur };
      delete nextMap[key];
      updateCalibration({ tagOverrides: nextMap });
    } catch (_) {}
  };
  const saveCalibration = async () => {
    const siteId = currentSite?.id || 'default';
    const key = `blueiot_map_calib_${siteId}`;
    try { localStorage.setItem(key, JSON.stringify(calibration)); } catch {}
    try {
      const resp = await fetch('/api/map-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, config: calibration }),
      });
      if (resp.ok) {
        try {
          lastSavedCalibRef.current = JSON.stringify(calibration);
          setCalibrationDirty(false);
        } catch(_) {}
      }
      return resp.ok;
    } catch {
      return false;
    }
  };
  const resetCalibration = async () => {
    setCalibration(defaultCalib);
    lastSavedCalibRef.current = JSON.stringify(defaultCalib);
    setCalibrationDirty(false);
    const siteId = currentSite?.id || 'default';
    const key = `blueiot_map_calib_${siteId}`;
    try { localStorage.setItem(key, JSON.stringify(defaultCalib)); } catch {}
    try {
      await fetch('/api/map-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, config: defaultCalib }),
      });
    } catch {}
  };

  // Debug
  const [lastTag, setLastTag] = useState(null);
  const [lastRawFrame] = useState(null);
  const kalmanRef = useRef({}); // tagId -> { x,y,vx,vy,P:[[...]] , t }
  const posDiagRef = useRef({ entries: [], byTag: {}, paused: false });
  const DIAG_MAX = 1000; // global max entries
  const DIAG_PER_TAG_MAX = 200;
  const addDiag = (e) => {
    try {
      if (posDiagRef.current.paused) return;
      const entry = e && typeof e === 'object' ? e : null;
      if (!entry) return;
      const arr = posDiagRef.current.entries;
      arr.push(entry);
      if (arr.length > DIAG_MAX) arr.splice(0, arr.length - DIAG_MAX);
      const id = String(entry.id || '');
      if (id) {
        const by = posDiagRef.current.byTag;
        by[id] = by[id] || [];
        by[id].push(entry);
        if (by[id].length > DIAG_PER_TAG_MAX) by[id].splice(0, by[id].length - DIAG_PER_TAG_MAX);
      }
    } catch(_) {}
  };
  // reserved for future logging throttling
  // const firstLogsLeft = useRef(5);

  useEffect(() => {
    const onOpen = () => setIsConnected(true);
    const onClose = () => setIsConnected(false);
    const onError = () => setIsConnected(false);
  const onPosition = (list) => {
      const MAX_HISTORY = 8; // samples
      // Parametri dipendenti dalla configurazione
      const sens = Math.max(0, Math.min(1, Number(calibration?.outlierSensitivity ?? 0.5)));
      const lerp = (a,b,t)=> a + (b-a)*t;
      const MAX_JUMP_FACTOR = lerp(6.0, 2.5, sens);
      const BASE_STEP_M = lerp(0.15, 0.35, sens);
      const ABS_JUMP_REJECT_M = lerp(4.0, 1.0, sens);
      const now = Date.now();
  const nextLive = { ...smoothedPositionsRef.current };
      const SAFE_ABS = 2000; // metri
      list.forEach(p => {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > SAFE_ABS || Math.abs(p.y) > SAFE_ABS) {
          return; // scarta outlier assoluti
        }
        const idRaw = p.id ?? p.tagId ?? p.regid ?? p.hex;
        const id = canonicalizeId(idRaw);
        // build history
        if (!recentHistoryRef.current[id]) recentHistoryRef.current[id] = [];
        recentHistoryRef.current[id].push({ x: p.x, y: p.y, ts: p.ts });
        if (recentHistoryRef.current[id].length > MAX_HISTORY) recentHistoryRef.current[id].shift();
        // compute typical movement
        const h = recentHistoryRef.current[id];
        let totalDist = 0;
        for (let i=1;i<h.length;i++) {
          const dx = h[i].x - h[i-1].x; const dy = h[i].y - h[i-1].y;
          totalDist += Math.hypot(dx, dy);
        }
        let avgStep = h.length>1 ? totalDist / (h.length-1) : 0;
        // quando si parte da fermo avgStep ~0: imponi una base per non scartare i primi passi reali
        if (avgStep < BASE_STEP_M) avgStep = BASE_STEP_M;
        const prevSmooth = smoothedPositionsRef.current[id];
        if (prevSmooth) {
          const jump = Math.hypot(p.x - prevSmooth.x, p.y - prevSmooth.y);
          if (avgStep > 0 && jump > avgStep * MAX_JUMP_FACTOR && jump > ABS_JUMP_REJECT_M) {
            // discard outlier: keep previous smooth position, update timestamp/battery
            try { addDiag({ ts: now, id, idRaw, action: 'reject-outlier', reason: 'jump>threshold', raw: { x: p.x, y: p.y }, prev: { x: prevSmooth.x, y: prevSmooth.y }, avgStep, jump }); } catch(_) {}
            nextLive[id] = { ...prevSmooth, cap: p.cap, regid: p.regid, idRaw, ts: now };
            return;
          }
        }
        // smoothing: Kalman (se abilitato) altrimenti EMA
        if (calibration && calibration.trackingEnabled) {
          // Simple 2D CV Kalman filter
          const F = (dt) => ([
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ]);
          const H = [[1,0,0,0],[0,1,0,0]];
          const resp = Math.max(0, Math.min(1, Number(calibration?.trackingResponsiveness ?? 0.5)));
          const Qbase = Math.max(0.05, 0.2 + 1.0 * resp); // più alto = più reattivo
          const Rmeas = Math.max(0.05, 0.9 - 0.6 * resp); // più basso = più reattivo
          const matMul = (A,B) => A.map((row,i)=> B[0].map((_,j)=> row.reduce((s,_,k)=> s + A[i][k]*B[k][j],0)));
          const matAdd = (A,B) => A.map((r,i)=> r.map((v,j)=> v + B[i][j]));
          const matSub = (A,B) => A.map((r,i)=> r.map((v,j)=> v - B[i][j]));
          const matT = (A) => A[0].map((_,i)=> A.map(row=> row[i]));
          const eye = (n) => Array.from({length:n},(_,i)=> Array.from({length:n},(_,j)=> i===j?1:0));
          const inv2 = (M) => { // invert 2x2
            const a=M[0][0], b=M[0][1], c=M[1][0], d=M[1][1];
            const det = a*d - b*c; if (Math.abs(det)<1e-9) return [[1e9,0],[0,1e9]];
            return [[ d/det, -b/det],[-c/det, a/det]];
          };
          const last = kalmanRef.current[id];
          const tPrev = last?.t || p.ts || now;
          const tNow = p.ts || now;
          let dt = Math.max(0.02, Math.min(0.5, (tNow - tPrev)/1000));
          let x = last?.x ?? p.x, y = last?.y ?? p.y, vx = last?.vx ?? 0, vy = last?.vy ?? 0;
          let P = last?.P || [[1,0,0,0],[0,1,0,0],[0,0,10,0],[0,0,0,10]];
          // Predict
          const Fk = F(dt);
          const state = [[x],[y],[vx],[vy]];
          const statePred = matMul(Fk, state);
          const Ft = matT(Fk);
          const q = Qbase;
          const Qk = [
            [q*dt*dt,0,0,0],
            [0,q*dt*dt,0,0],
            [0,0,q,0],
            [0,0,0,q],
          ];
          const Ppred = matAdd(matMul(matMul(Fk,P), Ft), Qk);
          // Update
          const z = [[p.x],[p.y]];
          const Hk = H, Ht = matT(Hk);
          const S = matAdd(matMul(matMul(Hk,Ppred),Ht), [[Rmeas,0],[0,Rmeas]]);
          const K = matMul(matMul(Ppred, Ht), inv2(S));
          const yk = matSub(z, matMul(Hk, statePred));
          const stateNew = matAdd(statePred, matMul(K, yk));
          const I = eye(4);
          const Pnew = matMul(matSub(I, matMul(K,Hk)), Ppred);
          x = stateNew[0][0]; y = stateNew[1][0]; vx = stateNew[2][0]; vy = stateNew[3][0];
          kalmanRef.current[id] = { x, y, vx, vy, P: Pnew, t: tNow };
          let smooth = { ...p, x, y };
          // Adaptive settle: se il tag rallenta molto, avvicina alla misura grezza per ridurre deriva
          try {
            const prev = prevSmooth;
            const dtSec = prev ? Math.max(0.01, (p.ts - prev.ts) / 1000) : 0;
            const dist = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
            const speed = dtSec ? dist / dtSec : 0;
            const measOffset = Math.hypot(smooth.x - p.x, smooth.y - p.y);
            const deadband = Math.max(0, Number(calibration?.deadbandM ?? 0.06));
            if (speed < 0.15) {
              const settleAlpha = speed < 0.05 ? 1 : 0.65;
              smooth.x = smooth.x + (p.x - smooth.x) * settleAlpha;
              smooth.y = smooth.y + (p.y - smooth.y) * settleAlpha;
              if (speed < 0.03 && measOffset > deadband) {
                smooth.x = p.x;
                smooth.y = p.y;
              }
            }
            try { addDiag({ ts: now, id, idRaw, action: 'smooth', filter: 'kalman', raw: { x: p.x, y: p.y }, prev: prev ? { x: prev.x, y: prev.y } : null, smooth: { x: smooth.x, y: smooth.y }, speed, measOffset }); } catch(_) {}
          } catch(_) {}
          smoothedPositionsRef.current[id] = { ...smooth, idRaw };
          nextLive[id] = { ...smooth, idRaw };
        } else {
          const prev = prevSmooth;
          const resp = Math.max(0, Math.min(1, Number(calibration?.trackingResponsiveness ?? 0.5)));
          const alphaMove = lerp(0.15, 0.7, resp);
          let alpha = alphaMove;
          if (prev) {
            const dtSec = Math.max(0.01, (p.ts - prev.ts) / 1000);
            const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
            const speed = dist / dtSec;
            if (speed < 0.15) alpha = Math.max(alpha, 0.85);
            if (speed < 0.05) alpha = 1;
          }
          let smooth = prev ? {
            ...p,
            x: prev.x + (p.x - prev.x) * alpha,
            y: prev.y + (p.y - prev.y) * alpha,
          } : p;
          try {
            if (prev) {
              const dtSec = Math.max(0.01, (p.ts - prev.ts) / 1000);
              const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
              const speed = dist / dtSec;
              const measOffset = Math.hypot(smooth.x - p.x, smooth.y - p.y);
              const deadband = Math.max(0, Number(calibration?.deadbandM ?? 0.06));
              if (speed < 0.03 && measOffset > deadband) {
                smooth.x = p.x;
                smooth.y = p.y;
              }
              try { addDiag({ ts: now, id, idRaw, action: 'smooth', filter: 'ema', raw: { x: p.x, y: p.y }, prev: prev ? { x: prev.x, y: prev.y } : null, smooth: { x: smooth.x, y: smooth.y }, speed, measOffset, alpha }); } catch(_) {}
            }
          } catch(_) {}
          smoothedPositionsRef.current[id] = { ...smooth, idRaw };
          nextLive[id] = { ...smooth, idRaw };
        }
      });
      // Persist stable positions (do not remove tag immediately if no update)
      // Keep tag visible for a grace period if not updated
      const GRACE_MS = 15000; // 15s
      Object.keys(smoothedPositionsRef.current).forEach(id => {
        if (!nextLive[id]) {
          const s = smoothedPositionsRef.current[id];
          if (s && now - s.ts < GRACE_MS) nextLive[id] = s;
        }
      });
      setPositions(nextLive);
  // Expose last emitted positions for quick debugging and console inspection
  try {
    if (typeof window !== 'undefined') {
      window.__BLUEIOT_LAST_EMITTED_POS = nextLive;
      if (window.__POSLOG_VERBOSE) {
        console.groupCollapsed('[BlueIOT] positions set:', Object.keys(nextLive).length);
        try { console.table(Object.entries(nextLive).slice(0,10).map(([id,v]) => ({ id, x: Number(v.x).toFixed(2), y: Number(v.y).toFixed(2), ts: v.ts })) ); } catch(_) {}
        console.groupEnd();
      }
      if (!window.__POSLOG_SET) {
        window.__POSLOG_VERBOSE = false;
        window.__POSLOG_SET = (v) => { window.__POSLOG_VERBOSE = !!v; return window.__POSLOG_VERBOSE; };
      }
    }
  } catch(_) {}
      // aggiorna info debug ultimo tag
      try {
        if (Array.isArray(list) && list.length > 0) {
          setLastTag(list[list.length - 1]);
        }
      } catch {}
    };

    LocalsenseClient.on("open", onOpen);
    LocalsenseClient.on("close", onClose);
    LocalsenseClient.on("error", onError);
  LocalsenseClient.on("position", onPosition);
    LocalsenseClient.connect();

    return () => {
      // nessun off disponibile nel wrapper minimale
    };
  }, []);

  // API di debug utili
  // Reindirizza le operazioni verso l'SDK ufficiale
  // const subscribeTags = (ids) => LocalsenseClient.subscribeTagIds(ids); // disabilitato finché non necessario per evitare warning unused
  const [lastVibrateAck, setLastVibrateAck] = useState(null);
  useEffect(() => {
    const onVibrate = (ack) => setLastVibrateAck(ack);
    LocalsenseClient.on('vibrate', onVibrate);
    return () => { LocalsenseClient.off('vibrate', onVibrate); };
  }, []);
  const vibrateTag = (id, action = "enable") => {
    setLastVibrateAck(null);
    LocalsenseClient.vibrateTag(id, action);
  };
  const videoTrack = (id) => {
    try { window.BlueIot?.Send2WS_RequsetVideoOpen?.(String(id)); } catch {}
  };

  // Diagnostics API
  const getDiagnostics = ({ tag = null, limit = 200 } = {}) => {
    const t = tag ? String(tag) : null;
    const src = t ? (posDiagRef.current.byTag[t] || []) : posDiagRef.current.entries;
    return src.slice(Math.max(0, src.length - limit));
  };
  const clearDiagnostics = () => { posDiagRef.current = { entries: [], byTag: {}, paused: posDiagRef.current.paused }; };
  const setDiagnosticsPaused = (paused) => { posDiagRef.current.paused = !!paused; };
  // Expose to window for quick export
  try {
    if (typeof window !== 'undefined') {
      window.__BLUEIOT_POS_DIAG = {
        get: getDiagnostics,
        clear: clearDiagnostics,
        pause: () => setDiagnosticsPaused(true),
        resume: () => setDiagnosticsPaused(false),
        exportCSV: (tag = null, limit = 1000) => {
          const rows = getDiagnostics({ tag, limit });
          const hdr = ['ts','id','action','filter','raw_x','raw_y','prev_x','prev_y','smooth_x','smooth_y','speed','avgStep','jump','measOffset','alpha'];
          const csv = [hdr.join(',')].concat(rows.map(r => [r.ts,r.id,r.action||'',r.filter||'',r.raw?.x??'',r.raw?.y??'',r.prev?.x??'',r.prev?.y??'',r.smooth?.x??'',r.smooth?.y??'',r.speed??'',r.avgStep??'',r.jump??'',r.measOffset??'',r.alpha??''].join(','))).join('\n');
          return csv;
        }
      };
    }
  } catch(_) {}

  const value = useMemo(
    () => ({
      sites,
      currentSite,
      selectSite,
      employees,
      assets,
      tags,
      tagAssociations,
      positions,
      isConnected,
  tagNames,
  clearCachedTagNames,
      calibration,
      updateCalibration,
        updateTagOverride,
        clearTagOverride,
      calibrationDirty,
  saveCalibration,
  loadCalibration,
  resetCalibration,
        // diagnostics
        getDiagnostics,
        clearDiagnostics,
        setDiagnosticsPaused,
      // debug
      _lastTag: lastTag,
      _lastRawFrame: lastRawFrame,
      vibrateTag,
      lastVibrateAck,
      videoTrack,
      // tag registry ops
      reloadTags: loadTags,
      syncDbNames,
      createTag,
      removeTag,
      restoreTag,
    }),
    [sites, currentSite, selectSite, employees, assets, tags, tagAssociations, positions, isConnected, tagNames, calibration, updateCalibration, updateTagOverride, clearTagOverride, calibrationDirty, saveCalibration, loadCalibration, resetCalibration, getDiagnostics, clearDiagnostics, setDiagnosticsPaused, lastTag, lastRawFrame, vibrateTag, lastVibrateAck, videoTrack, loadTags, syncDbNames, createTag, removeTag, restoreTag]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export default DataContext;