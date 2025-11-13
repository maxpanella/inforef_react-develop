import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const [tags] = useState([]);
  const [tagAssociations] = useState([]);

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
  const defaultCalib = { scale: 1, offsetX: 0, offsetY: 0, invertY: false, swapXY: false, rotationDeg: 0, normalizationScale: 1 };
  const [calibration, setCalibration] = useState(defaultCalib);
  const loadCalibration = async () => {
    const siteId = currentSite?.id || 'default';
    const key = `blueiot_map_calib_${siteId}`;
    // Try server first
    try {
      const resp = await fetch(`/api/map-config/${siteId}`);
      if (resp.ok) {
        const j = await resp.json();
        if (j && j.config && typeof j.config === 'object') {
          setCalibration({ ...defaultCalib, ...j.config });
          try { localStorage.setItem(key, JSON.stringify(j.config)); } catch(_) {}
          return true;
        }
      }
    } catch(_) {}
    // Fallback local
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      setCalibration(saved && typeof saved === 'object' ? { ...defaultCalib, ...saved } : defaultCalib);
      return true;
    } catch {
      setCalibration(defaultCalib);
      return false;
    }
  };
  useEffect(() => { loadCalibration(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [currentSite?.id]);
  const updateCalibration = (next) => {
    // Mantieni i valori esistenti e sovrascrivi solo i campi passati
    const merged = { ...defaultCalib, ...calibration, ...next };
    setCalibration(merged);
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
      return resp.ok;
    } catch {
      return false;
    }
  };
  const resetCalibration = async () => {
    setCalibration(defaultCalib);
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
  const [lastRawFrame, setLastRawFrame] = useState(null);
  const firstLogsLeft = useRef(5);

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
      positions,
      isConnected,
  tagNames,
      calibration,
      updateCalibration,
  saveCalibration,
  loadCalibration,
  resetCalibration,
      // debug
      _lastTag: lastTag,
      _lastRawFrame: lastRawFrame,
      vibrateTag,
      lastVibrateAck,
      videoTrack,
    }),
    [sites, currentSite, positions, isConnected, tagNames, calibration, lastTag, lastRawFrame, lastVibrateAck]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export default DataContext;