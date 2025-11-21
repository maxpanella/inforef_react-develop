import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  getTags as apiGetTags,
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  restoreTag as apiRestoreTag,
  saveAssociation as apiSaveAssociation,
  fetchTagAssociations,
  deleteAssociation as apiDeleteAssociation,
} from "../services/backendClient";
import { LocalsenseClient } from "../services/localsenseClient";

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export const DataProvider = ({ children }) => {
  // Dati base per UI
  const [sites] = useState([{ id: 1, name: "Sito Principale" }]);
  const [currentSite, setCurrentSite] = useState({ id: 1, name: "Sito Principale" });
  const selectSite = (id) => setCurrentSite({ id, name: "Sito Principale" });

  // Anagrafiche (se servono le caricherai altrove)
  const [employees] = useState([]);
  const [assets] = useState([]);
  const [tags, setTags] = useState([]);
    // Load tags registry from backend
    const loadTags = async () => {
      try {
        const list = await apiGetTags();
        setTags(Array.isArray(list) ? list : []);
      } catch (_) {
        setTags([]);
      }
    };
    useEffect(() => { loadTags(); }, []);

    const createTag = async (id, battery = null) => {
      await apiCreateTag(String(id), battery);
      await loadTags();
      return true;
    };

    const removeTag = async (id) => {
      await apiDeleteTag(String(id));
      await loadTags();
      return true;
    };
    const restoreTag = async (id) => {
      await apiRestoreTag(String(id));
      await loadTags();
      return true;
    };
  const [tagAssociations, setTagAssociations] = useState([]);

  const loadTagAssociations = async (siteId) => {
    const effectiveSiteId = siteId ?? currentSite?.id;
    if (!effectiveSiteId) {
      setTagAssociations([]);
      return false;
    }
    try {
      const rows = await fetchTagAssociations(effectiveSiteId);
      setTagAssociations(Array.isArray(rows) ? rows : []);
      return true;
    } catch (error) {
      console.warn('Impossibile caricare le associazioni dei tag', error);
      setTagAssociations([]);
      return false;
    }
  };

  useEffect(() => {
    loadTagAssociations();
  }, [currentSite?.id]);

  const associateTag = async (tagId, targetType, targetId) => {
    const siteId = currentSite?.id;
    if (!siteId) {
      throw new Error('Nessun sito selezionato');
    }
    await apiSaveAssociation(tagId, targetType, targetId, siteId);
    await loadTagAssociations(siteId);
    return true;
  };

  const dissociateTag = async (tagId) => {
    const siteId = currentSite?.id;
    if (!siteId) {
      throw new Error('Nessun sito selezionato');
    }
    await apiDeleteAssociation(siteId, tagId);
    await loadTagAssociations(siteId);
    return true;
  };

  // Realtime
  const [positions, setPositions] = useState({});
  const recentHistoryRef = useRef({}); // tagId -> array of recent samples
  const smoothedPositionsRef = useRef({}); // stable displayed position
  const [isConnected, setIsConnected] = useState(false);

  // Alias tag (mappa ID -> Nome personalizzato), persistiti in localStorage
  // Mappa nomi tag provenienti dal motore di posizione (auto, nessun alias manuale)
  const [tagNames, setTagNames] = useState({});
  useEffect(() => {
    const onNames = (map) => {
      setTagNames(prev => ({ ...prev, ...map }));
    };
    LocalsenseClient.on('tagNames', onNames);
    return () => LocalsenseClient.off('tagNames', onNames);
  }, []);

  // Calibrazione mappa per sito corrente (scala, offset, flip/rotazione)
  // Include anche correzioni per-tag (override locali) applicate DOPO la calibrazione globale
  // Formato: tagOverrides: { [tagKey]: { dx, dy } }
  const defaultCalib = { scale: 1, offsetX: 0, offsetY: 0, invertY: false, swapXY: false, rotationDeg: 0, normalizationScale: 1, tagOverrides: {} };
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
  // reserved for future logging throttling
  // const firstLogsLeft = useRef(5);

  useEffect(() => {
    const onOpen = () => setIsConnected(true);
    const onClose = () => setIsConnected(false);
    const onError = () => setIsConnected(false);
  const onPosition = (list) => {
      const MAX_HISTORY = 8; // samples
      const MAX_JUMP_FACTOR = 4; // reject outlier if movement >> typical
      const now = Date.now();
  const nextLive = { ...smoothedPositionsRef.current };
      const SAFE_ABS = 2000; // metri
      list.forEach(p => {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > SAFE_ABS || Math.abs(p.y) > SAFE_ABS) {
          return; // scarta outlier assoluti
        }
        const id = p.id;
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
        const avgStep = h.length>1 ? totalDist / (h.length-1) : 0;
        const prevSmooth = smoothedPositionsRef.current[id];
        if (prevSmooth) {
          const jump = Math.hypot(p.x - prevSmooth.x, p.y - prevSmooth.y);
          if (avgStep > 0 && jump > avgStep * MAX_JUMP_FACTOR) {
            // discard outlier: keep previous smooth position, update timestamp/battery
            nextLive[id] = { ...prevSmooth, cap: p.cap, regid: p.regid, ts: now };
            return;
          }
        }
        // smoothing: weighted blend (EMA)
        const alpha = 0.35;
        const smooth = prevSmooth ? {
          ...p,
          x: prevSmooth.x + (p.x - prevSmooth.x) * alpha,
          y: prevSmooth.y + (p.y - prevSmooth.y) * alpha,
        } : p;
        smoothedPositionsRef.current[id] = smooth;
        nextLive[id] = smooth;
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
  try { if (typeof window !== 'undefined') { window.__BLUEIOT_LAST_EMITTED_POS = nextLive; console.debug('[DataContext] setPositions count=', Object.keys(nextLive).length); } } catch(_) {}
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

  const value = useMemo(
    () => ({
      sites,
      currentSite,
      selectSite,
      employees,
      assets,
      tags,
      tagAssociations,
      associateTag,
      dissociateTag,
      reloadTagAssociations: loadTagAssociations,
      positions,
      isConnected,
  tagNames,
      calibration,
      updateCalibration,
        updateTagOverride,
        clearTagOverride,
      calibrationDirty,
  saveCalibration,
  loadCalibration,
  resetCalibration,
      // debug
      _lastTag: lastTag,
      _lastRawFrame: lastRawFrame,
      vibrateTag,
      lastVibrateAck,
      videoTrack,
      // tag registry ops
      reloadTags: loadTags,
      createTag,
      removeTag,
      restoreTag,
    }),
    [sites, currentSite, selectSite, employees, assets, tags, tagAssociations, associateTag, dissociateTag, loadTagAssociations, positions, isConnected, tagNames, calibration, updateCalibration, updateTagOverride, clearTagOverride, calibrationDirty, saveCalibration, loadCalibration, resetCalibration, lastTag, lastRawFrame, vibrateTag, lastVibrateAck, videoTrack, loadTags, createTag, removeTag, restoreTag]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export default DataContext;
