import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// URL WebSocket da .env (CRA o Vite), fallback a 192.168.1.11:48300
const WS_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BLUEIOT_WS_URL) ||
  process.env.REACT_APP_BLUEIOT_WS_URL ||
  "ws://192.168.1.11:48300";

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export const DataProvider = ({ children }) => {
  const [sites, setSites] = useState([{ id: 1, name: "Sito Principale" }]);
  const [currentSite, setCurrentSite] = useState(sites[0]);
  const selectSite = (id) => setCurrentSite(sites.find((s) => s.id === id) || null);

  const [employees, setEmployees] = useState([]);
  const [assets, setAssets] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagAssociations, setTagAssociations] = useState([]);

  const [positions, setPositions] = useState({});
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const retryRef = useRef(null);
  const retryDelayMs = useRef(2000);

  const connect = () => {
    try {
      console.log("[BlueIot] Connessione a:", WS_URL);
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[BlueIot] WebSocket aperto");
        setIsConnected(true);
        retryDelayMs.current = 2000;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          let nextPositions = null;

          if (Array.isArray(msg.positions)) {
            nextPositions = msg.positions.reduce((acc, p) => {
              const id = p.tagId || p.id || p.tag || p.tid;
              if (!id) return acc;
              acc[id] = {
                id,
                x: Number(p.x ?? p.X ?? 0),
                y: Number(p.y ?? p.Y ?? 0),
                z: Number(p.z ?? p.Z ?? 0),
                ts: p.ts || p.timestamp || Date.now(),
              };
              return acc;
            }, {});
          } else if (msg.positions && typeof msg.positions === "object") {
            nextPositions = Object.entries(msg.positions).reduce((acc, [id, p]) => {
              acc[id] = {
                id,
                x: Number(p.x ?? 0),
                y: Number(p.y ?? 0),
                z: Number(p.z ?? 0),
                ts: p.ts || p.timestamp || Date.now(),
              };
              return acc;
            }, {});
          } else if (Array.isArray(msg.tags)) {
            nextPositions = msg.tags.reduce((acc, t) => {
              const id = t.id || t.tagId || t.tag;
              if (!id) return acc;
              acc[id] = {
                id,
                x: Number(t.x ?? 0),
                y: Number(t.y ?? 0),
                z: Number(t.z ?? 0),
                ts: t.ts || t.timestamp || Date.now(),
              };
              return acc;
            }, {});
          }

          if (nextPositions) {
            setPositions((prev) => ({ ...prev, ...nextPositions }));
          }

          if (Array.isArray(msg.associations)) setTagAssociations(msg.associations);
          if (Array.isArray(msg.employees)) setEmployees(msg.employees);
          if (Array.isArray(msg.assets)) setAssets(msg.assets);
          if (Array.isArray(msg.tags)) setTags((prev) => (prev.length ? prev : msg.tags));
        } catch (e) {
          console.warn("[BlueIot] Messaggio non JSON o formato inatteso:", evt.data);
        }
      };

      ws.onerror = (err) => {
        console.error("[BlueIot] WebSocket errore:", err);
      };

      ws.onclose = () => {
        console.warn("[BlueIot] WebSocket chiuso");
        setIsConnected(false);
        wsRef.current = null;

        clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => {
          retryDelayMs.current = Math.min(retryDelayMs.current * 1.5, 20000);
          connect();
        }, retryDelayMs.current);
      };
    } catch (e) {
      console.error("[BlueIot] Errore apertura WS:", e);
      setIsConnected(false);
      clearTimeout(retryRef.current);
      retryRef.current = setTimeout(connect, retryDelayMs.current);
    }
  };

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [WS_URL]);

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
    }),
    [sites, currentSite, employees, assets, tags, tagAssociations, positions, isConnected]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export default DataContext;