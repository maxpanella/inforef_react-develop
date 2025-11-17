import React, { useState, useEffect } from "react";
import { LocalsenseClient } from "../services/localsenseClient";

const ConnectionStatus = () => {
  const [status, setStatus] = useState("disconnected");
  const [lastError, setLastError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Aggiungi un flag per tenere traccia dei tentativi di riconnessione
  const [isReconnecting, setIsReconnecting] = useState(false);
  // Diagnostica periodica dal client BlueIOT
  const [diag, setDiag] = useState({
    isConnected: false,
    frameCounters: { bin: 0, txt: 0 },
    lastCloseCode: null,
    consecutive1006: 0,
    positionsEverReceived: false,
  });

  // Usa questo useEffect per gestire la connessione e gli eventi
  useEffect(() => {
    // Funzioni di callback
    const handleOpen = () => {
      console.log("ConnectionStatus: connessione stabilita");
      setStatus("connected");
      setLastError(null);
      setIsReconnecting(false);
    };

    const handleError = (error) => {
      console.log("ConnectionStatus: errore di connessione", error);
      setStatus("error");
      setLastError(error.message || "Errore sconosciuto");
      setIsReconnecting(false);
    };

    const handleClose = (info) => {
      console.log("ConnectionStatus: connessione chiusa", info);
      setStatus("disconnected");
      try {
        if (info && (info.code || info.durationMs)) {
          setLastError(`close code: ${info.code ?? 'n/a'}, duration: ${info.durationMs ?? 'n/a'}ms`);
        }
      } catch {}
      setIsReconnecting(false);
    };

    // Registra i listener (non richiamiamo connect qui per evitare doppia inizializzazione)
    LocalsenseClient.on("open", handleOpen);
    LocalsenseClient.on("error", handleError);
    LocalsenseClient.on("close", handleClose);

    // Poll diagnostica ogni 2s
    const intId = setInterval(() => {
      try {
        const d = LocalsenseClient.getDiagnostics?.();
        if (d) {
          setDiag(d);
          // Se la diagnostica dice connesso, sincronizza lo status mostrato
          if (d.isConnected && !isReconnecting) {
            setStatus('connected');
          } else if (!d.isConnected && status === 'connected') {
            setStatus('disconnected');
          }
        }
      } catch {}
    }, 2000);

    // Cleanup
    return () => {
  LocalsenseClient.off("open", handleOpen);
  LocalsenseClient.off("error", handleError);
  LocalsenseClient.off("close", handleClose);
      clearInterval(intId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Funzione per tentare la riconnessione
  const handleReconnect = () => {
    console.log("Tentativo di riconnessione a BlueIOT...");
    setIsReconnecting(true);

    // Assicurati di disconnetterti prima di riconnetterti
    LocalsenseClient.disconnect();

    // Aggiungi un piccolo ritardo per garantire che la disconnessione sia completata
    setTimeout(() => {
      LocalsenseClient.connect();
    }, 500);
  };

  // Funzione per disconnettersi
  const handleDisconnect = () => {
    console.log("Disconnessione da BlueIOT (stream off)...");
    LocalsenseClient.disconnect();
  };

  const getStatusColor = () => {
    if (isReconnecting) return "bg-yellow-500"; // Giallo durante la riconnessione

    switch (status) {
      case "connected":
        return "bg-green-500";
      case "disconnected":
        return "bg-red-500";
      case "error":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusText = () => {
    if (isReconnecting) return "Riconnessione in corso...";

    switch (status) {
      case "connected":
        return "Connesso a BlueIOT";
      case "disconnected":
        return "Disconnesso da BlueIOT";
      case "error":
        return "Errore di connessione";
      default:
        return "Stato sconosciuto";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`${getStatusColor()} text-white px-4 py-2 rounded-lg shadow-lg cursor-pointer`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center">
          <div className="w-3 h-3 rounded-full bg-white mr-2"></div>
          <span>{getStatusText()}</span>
        </div>

        {expanded && lastError && (
          <div className="mt-2 text-sm">
            <p>Ultimo errore:</p>
            <p className="font-mono">{lastError}</p>
          </div>
        )}

        {expanded && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className={`bg-white text-gray-800 px-2 py-1 rounded text-sm ${
                status === "disconnected" ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                handleDisconnect();
              }}
              disabled={status === "disconnected"}
            >
              Disconnetti
            </button>
            <button
              className={`bg-white text-gray-800 px-2 py-1 rounded text-sm ${
                status === "connected" || isReconnecting
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                handleReconnect();
              }}
              disabled={status === "connected" || isReconnecting}
            >
              Riconnetti
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.openControlNow?.(); }}
            >
              Apri Control
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.forcePositionSwitch?.(); }}
            >
              Forza switch pos
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.subscribeMapsNow?.(); }}
            >
              Subscrivi mappe
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.setFiltersEnabled?.(false); }}
            >
              Filtri pos OFF
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.setFiltersEnabled?.(true); }}
            >
              Filtri pos ON
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.setTagId64?.(true); }}
            >
              ID 64-bit
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => { e.stopPropagation(); LocalsenseClient.setTagId64?.(false); }}
            >
              ID 32-bit
            </button>
            <button
              className="bg-white text-gray-800 px-2 py-1 rounded text-sm"
              onClick={(e) => {
                e.stopPropagation();
                try {
                  const cur = diag?.runtime?.posOutType || 'XY';
                  const order = ['XY', 'XY_GLOBAL', 'GLOBAL', 'GEO', 'XY_GEO'];
                  const idx = order.indexOf(cur);
                  const next = order[(idx + 1) % order.length];
                  LocalsenseClient.setPosOutType?.(next);
                } catch(_) {}
              }}
            >
              Coord mode
            </button>
            <div className="col-span-2 text-[11px] leading-tight bg-white/90 text-gray-800 rounded p-2">
              <div className="font-semibold">Diagnostica BlueIOT</div>
              <div>Frames: BIN {diag.frameCounters?.bin ?? 0} / TXT {diag.frameCounters?.txt ?? 0}</div>
              <div>Positions ever: {diag.positionsEverReceived ? 'sì' : 'no'}</div>
              <div>Control: {diag.controlOpened ? 'aperto' : (diag.controlRequested ? 'richiesto' : 'non richiesto')}</div>
              <div>Switch attempts: {diag.switchAttempts ?? 0}</div>
              {diag.lastSwitchResult && (
                <div>Last switch result: <span className="font-mono break-all">{String(diag.lastSwitchResult)}</span></div>
              )}
              <div className="mt-1">Proto: {diag.runtime?.proto} | Salted: {diag.runtime?.forceUnsalted ? 'no' : 'sì'} | PosOut: {diag.runtime?.posOutType || 'XY'}</div>
              <div>Filtri pos: {diag.runtime?.filtersEnabled ? 'ON' : 'OFF'}{typeof diag.runtime?.safeAbs !== 'undefined' ? ` (SAFE_ABS=${diag.runtime.safeAbs}m)` : ''}</div>
              {diag.frameTypeCounts && (
                <div className="mt-1">Frame types: {Object.entries(diag.frameTypeCounts).map(([k,v]) => `${k}=${v}`).join(' ')}</div>
              )}
              {diag.posDiag && (
                <div className="mt-1">
                  POS diag: jsonFrames {diag.posDiag.jsonFrames ?? 0} / binFrames {diag.posDiag.binFrames ?? 0} | accepted {diag.posDiag.accepted ?? 0} | droppedTooBig {diag.posDiag.droppedTooBig ?? 0} | droppedNaN {diag.posDiag.droppedNaN ?? 0}
                </div>
              )}
              {diag.posDiag?.lastFlags && (
                <div>Coord flags: global={diag.posDiag.lastFlags.isGlobal ? 'true' : 'false'} | geo={diag.posDiag.lastFlags.isGeo ? 'true' : 'false'}</div>
              )}
              {typeof diag.lastCloseCode !== 'undefined' && diag.lastCloseCode !== null && (
                <div>Last close code: {String(diag.lastCloseCode)}</div>
              )}
              {diag.consecutive1006 > 0 && (
                <div>1006 repeats: {diag.consecutive1006}</div>
              )}
              {!diag.positionsEverReceived && (diag.frameCounters?.bin || 0) > 0 && (
                <div className="mt-1 text-amber-600">Ricevo frame binari (es. PERSON_INFO) ma nessuna posizione (TAG_POS). Abilita lo stream "position/XY" sul gateway o libera il canale Control.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionStatus;
