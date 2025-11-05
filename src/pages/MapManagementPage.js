import React, { useState, useEffect } from "react";
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

        // Salva nel localStorage
        localStorage.setItem("blueiot_mapData", data);
        localStorage.setItem("blueiot_mapName", "example.dxf");
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

        // Salva nel localStorage
        localStorage.setItem("blueiot_mapData", fallbackDxf);
        localStorage.setItem("blueiot_mapName", "fallback.dxf");
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  // Carica la configurazione salvata
  const loadSavedConfiguration = () => {
    setIsLoading(true);
    try {
      const savedMapData = localStorage.getItem("blueiot_mapData");
      const savedMapName = localStorage.getItem("blueiot_mapName");
      const savedServerIp = localStorage.getItem("blueiot_serverIp");
      const savedServerPort = localStorage.getItem("blueiot_serverPort");

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
  }, []);

  // Salva la configurazione corrente
  const saveCurrentConfiguration = () => {
    try {
      if (mapData) {
        localStorage.setItem("blueiot_mapData", mapData);
      }

      if (mapFile?.name) {
        localStorage.setItem("blueiot_mapName", mapFile.name);
      }

      localStorage.setItem("blueiot_serverIp", serverIp);
      localStorage.setItem("blueiot_serverPort", serverPort.toString());

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

          // Salva automaticamente il file caricato nel localStorage
          localStorage.setItem("blueiot_mapData", result);
          localStorage.setItem("blueiot_mapName", file.name);
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
