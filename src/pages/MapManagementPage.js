import React, { useState } from "react";
import LZString from "lz-string";
import { useData } from "../context/DataContext";
import { DxfViewer } from "../components/DxfViewer";

const MapManagementPage = () => {
  const { currentSite, updateSite } = useData();
  const [serverIp, setServerIp] = useState(currentSite?.serverIp || "");
  const [serverPort, setServerPort] = useState(
    currentSite?.serverPort || 48300
  );
  const [mapFile, setMapFile] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success"); // 'success' or 'error'
  const [isLoading, setIsLoading] = useState(false);

  const MAP_KEY = 'blueiot_mapData';
  const MAP_NAME_KEY = 'blueiot_mapName';
  const SERVER_IP_KEY = 'blueiot_serverIp';
  const SERVER_PORT_KEY = 'blueiot_serverPort';
  const MAP_META_KEY = 'blueiot_mapData_meta';
  const MAP_COMP_KEY = 'blueiot_mapData_lz';
  const MAP_CHUNK_PREFIX = 'blueiot_mapData_lz_chunk_';

  // Memorizza in modo robusto: prova compresso, poi compresso a chunk
  const safeStoreMap = (raw, name) => {
    try {
      if (typeof raw !== 'string') return { cached: false, reason: 'not_string' };

      // Tenta subito la versione compressa per risparmiare spazio
      const compressed = LZString.compressToUTF16(raw);
      try {
        localStorage.removeItem(MAP_KEY);
        localStorage.setItem(MAP_COMP_KEY, compressed);
        localStorage.setItem(
          MAP_META_KEY,
          JSON.stringify({ cached: true, compressed: true, chunked: false, sizeRaw: raw.length, sizeCompressed: compressed.length, ts: Date.now(), name })
        );
        if (name) localStorage.setItem(MAP_NAME_KEY, name);
        console.warn('[BlueIot][Map] Cached compressed map raw=', raw.length, 'cmp=', compressed.length);
        return { cached: true, compressed: true };
      } catch (e1) {
        // Se fallisce (quota), prova chunked
        try {
          // Pulisci chiavi precedenti
          localStorage.removeItem(MAP_COMP_KEY);
          // Suddividi in chunk da ~400k caratteri
          const CHUNK_SIZE = 400_000;
          const chunks = [];
          for (let i = 0; i < compressed.length; i += CHUNK_SIZE) {
            chunks.push(compressed.slice(i, i + CHUNK_SIZE));
          }
          // Scrivi tutti i chunk
          chunks.forEach((c, idx) => {
            localStorage.setItem(MAP_CHUNK_PREFIX + idx, c);
          });
          localStorage.setItem(
            MAP_META_KEY,
            JSON.stringify({ cached: true, compressed: true, chunked: true, chunkCount: chunks.length, chunkSize: CHUNK_SIZE, sizeRaw: raw.length, sizeCompressed: compressed.length, ts: Date.now(), name })
          );
          if (name) localStorage.setItem(MAP_NAME_KEY, name);
          console.warn('[BlueIot][Map] Cached compressed map in chunks. raw=', raw.length, 'cmp=', compressed.length, 'chunks=', chunks.length);
          return { cached: true, compressed: true, chunked: true };
        } catch (e2) {
          // Cleanup eventuali chunk scritti
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
          localStorage.setItem(
            MAP_META_KEY,
            JSON.stringify({ cached: false, reason: 'quota', ts: Date.now(), error: e2.message, name })
          );
          console.warn('[BlueIot][Map] Skipping cache, quota exceeded even with chunks. raw=', raw.length, 'error=', e2.message);
          return { cached: false, reason: 'quota', error: e2.message };
        }
      }
    } catch (e) {
      console.warn('[BlueIot][Map] localStorage error, not caching map. size=', (raw && raw.length), 'error:', e.message);
      try { localStorage.setItem(MAP_META_KEY, JSON.stringify({ cached: false, size: (raw && raw.length), reason: 'error', ts: Date.now(), error: e.message, name })); } catch(_) {}
      return { cached: false, reason: 'error', error: e.message };
    }
  };

  

  // Carica il file DXF di esempio se non c'è niente
  const loadExampleDxf = () => {
    setIsLoading(true);
    fetch("/dxf-examples/example.dxf")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.text();
      })
      .then((data) => {
        setMapData(data);
        setMapFile({ name: "example.dxf" });
        setMessage("Mappa di esempio caricata con successo");
        setMessageType("success");
        // Salvataggio sicuro nel localStorage
        safeStoreMap(data, 'example.dxf');
      })
      .catch((error) => {
        console.error("Errore nel caricamento della mappa di esempio:", error);
        setMessage(
          `Errore nel caricamento della mappa di esempio: ${error.message}`
        );
        setMessageType("error");

        // Genera una semplice mappa di riserva
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

        setMapData(fallbackDxf);
        setMapFile({ name: "fallback.dxf" });
        // Salvataggio sicuro nel localStorage
        safeStoreMap(fallbackDxf, 'fallback.dxf');
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  // Carica la configurazione salvata
  const loadSavedConfiguration = () => {
    setIsLoading(true);
    try {
      let savedMapData = localStorage.getItem(MAP_KEY);
      const savedMapDataCompressed = localStorage.getItem(MAP_COMP_KEY);
      const metaStr = localStorage.getItem(MAP_META_KEY);
      if (!savedMapData && savedMapDataCompressed) {
        try { savedMapData = LZString.decompressFromUTF16(savedMapDataCompressed); } catch(_) {}
      }
      // Se non trovato, prova chunked
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
  const savedMapName = localStorage.getItem(MAP_NAME_KEY);
  const savedServerIp = localStorage.getItem(SERVER_IP_KEY);
  const savedServerPort = localStorage.getItem(SERVER_PORT_KEY);

      let dataLoaded = false;

      if (savedMapData && savedMapName) {
        setMapData(savedMapData);
        setMapFile({ name: savedMapName });
        dataLoaded = true;
      }

      if (savedServerIp) {
        setServerIp(savedServerIp);
      }

      if (savedServerPort) {
        setServerPort(parseInt(savedServerPort) || 48300);
      }

      if (dataLoaded) {
        setMessage("Configurazione caricata dal localStorage");
        setMessageType("success");
      } else {
        // Se non ci sono dati salvati, carica l'esempio
        loadExampleDxf();
        return;
      }
    } catch (error) {
      console.error("Errore nel caricamento della configurazione:", error);
      setMessage(
        `Errore nel caricamento della configurazione: ${error.message}`
      );
      setMessageType("error");
    }
    setIsLoading(false);
  };

  // Carica la configurazione al montaggio del componente
  React.useEffect(() => {
    loadSavedConfiguration();
  }, [loadSavedConfiguration]);

  // Salva la configurazione corrente
  const saveCurrentConfiguration = () => {
    try {
      if (mapData) {
        safeStoreMap(mapData, mapFile?.name);
      }

      if (mapFile?.name) {
        try { localStorage.setItem(MAP_NAME_KEY, mapFile.name); } catch(_) {}
      }
      try { localStorage.setItem(SERVER_IP_KEY, serverIp); } catch(_) {}
      try { localStorage.setItem(SERVER_PORT_KEY, serverPort.toString()); } catch(_) {}

      // Se l'API updateSite è disponibile nel contesto, aggiorna anche lì
      if (updateSite && currentSite) {
        updateSite({
          ...currentSite,
          serverIp,
          serverPort,
          mapFile: mapFile?.name || currentSite.mapFile,
        });
      }

      setMessage("Configurazione salvata con successo!");
      setMessageType("success");
    } catch (error) {
      console.error("Errore nel salvataggio della configurazione:", error);
      setMessage(
        `Errore nel salvataggio della configurazione: ${error.message}`
      );
      setMessageType("error");
    }
  };

  // Gestisce il caricamento dei file
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);

    if (file.name.toLowerCase().endsWith(".dxf")) {
      setMapFile(file);

      // Usa FileReader per leggere il contenuto del file
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target.result;

        // Verifica base del contenuto
        if (typeof result === "string") {
          setMapData(result);
          setMessage("Mappa caricata correttamente.");
          setMessageType("success");
          // Salva automaticamente il file caricato nel localStorage (in modo sicuro)
          const out = safeStoreMap(result, file.name);
          if (!out.cached) {
            setMessage(`Mappa caricata. Non salvata in cache (${out.reason || 'unknown'})`);
            setMessageType("error");
          }
        } else {
          setMessage("Errore: Il file caricato non è un file di testo valido.");
          setMessageType("error");
        }
        setIsLoading(false);
      };

      reader.onerror = () => {
        setMessage("Errore nella lettura del file.");
        setMessageType("error");
        setIsLoading(false);
      };

      // Leggi come testo per i file DXF
      reader.readAsText(file);
    } else {
      setMessage("Formato file non valido. Caricare un file DXF (.dxf).");
      setMessageType("error");
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    // Salva la configurazione
    saveCurrentConfiguration();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Gestione Mappa</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Configuration Form */}
        <div className="bg-white p-4 rounded shadow space-y-4 lg:col-span-1">
          <h2 className="text-lg font-medium mb-2">Configurazione Server</h2>
          <div className="text-xs text-gray-500">
            <button
              type="button"
              className="inline-block px-2 py-1 border rounded hover:bg-gray-50"
              onClick={() => {
                try {
                  localStorage.removeItem(MAP_KEY);
                  localStorage.removeItem(MAP_COMP_KEY);
                  localStorage.removeItem(MAP_META_KEY);
                  // Rimuovi eventuali chunk
                  try {
                    for (let i = 0; i < 1000; i++) { // limite di sicurezza
                      const k = MAP_CHUNK_PREFIX + i;
                      if (!localStorage.getItem(k)) break;
                      localStorage.removeItem(k);
                    }
                  } catch(_) {}
                  setMessage('Cache mappa pulita.');
                  setMessageType('success');
                } catch(e) {
                  setMessage('Errore nella pulizia cache: ' + e.message);
                  setMessageType('error');
                }
              }}
            >Pulisci cache mappa</button>
          </div>

          {message && (
            <div
              className={`p-3 rounded ${
                messageType === "success"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {message}
            </div>
          )}

          <div>
            <label className="block mb-1 font-medium">Carica file DXF:</label>
            <input
              type="file"
              accept=".dxf"
              onChange={handleFileChange}
              className="w-full border rounded p-2"
            />
            {mapFile && (
              <p className="mt-2 text-sm text-green-600">
                File selezionato: {mapFile.name}
              </p>
            )}
            <button
              onClick={loadExampleDxf}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              disabled={isLoading}
            >
              Carica mappa di esempio
            </button>
          </div>

          <div>
            <label className="block mb-1 font-medium">
              Indirizzo IP Server:
            </label>
            <input
              className="w-full p-2 border rounded"
              value={serverIp}
              onChange={(e) => setServerIp(e.target.value)}
              placeholder="192.168.1.100"
            />
          </div>

          <div>
            <label className="block mb-1 font-medium">Porta Server:</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={serverPort}
              onChange={(e) => setServerPort(parseInt(e.target.value) || 48300)}
              placeholder="48300"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={isLoading}
            className={`bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 w-full ${
              isLoading ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {isLoading ? "Caricamento..." : "Salva Configurazione"}
          </button>
        </div>

        {/* DXF Viewer */}
        <div className="bg-white p-4 rounded shadow lg:col-span-3">
          <h2 className="text-lg font-medium mb-2">
            Planimetria {mapFile?.name ? `(${mapFile.name})` : ""}
          </h2>
          <div className="h-[600px] bg-gray-50 rounded overflow-hidden">
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-blue-600 flex items-center">
                  <svg
                    className="animate-spin h-8 w-8 mr-3"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Caricamento mappa...
                </div>
              </div>
            ) : (
              <DxfViewer data={mapData} height="100%" showTagsMessage={false} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapManagementPage;
