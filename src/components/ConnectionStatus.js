import React, { useState, useEffect } from "react";
import { BlueiotClient } from "../services/blueiotClient";

const ConnectionStatus = () => {
  const [status, setStatus] = useState("disconnected");
  const [lastError, setLastError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Aggiungi un flag per tenere traccia dei tentativi di riconnessione
  const [isReconnecting, setIsReconnecting] = useState(false);

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

    const handleClose = () => {
      console.log("ConnectionStatus: connessione chiusa");
      setStatus("disconnected");
      setIsReconnecting(false);
    };

    // Registra i listener
    BlueiotClient.on("open", handleOpen);
    BlueiotClient.on("error", handleError);
    BlueiotClient.on("close", handleClose);

    // Cleanup
    return () => {
      BlueiotClient.off("open", handleOpen);
      BlueiotClient.off("error", handleError);
      BlueiotClient.off("close", handleClose);
    };
  }, []);

  // Funzione per tentare la riconnessione
  const handleReconnect = () => {
    console.log("Tentativo di riconnessione a BlueIOT...");
    setIsReconnecting(true);

    // Assicurati di disconnetterti prima di riconnetterti
    BlueiotClient.disconnect();

    // Aggiungi un piccolo ritardo per garantire che la disconnessione sia completata
    setTimeout(() => {
      BlueiotClient.connect();
    }, 500);
  };

  // Funzione per disconnettersi
  const handleDisconnect = () => {
    console.log("Disconnessione da BlueIOT...");
    BlueiotClient.disconnect();
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
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionStatus;
