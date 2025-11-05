import React, { useEffect, useState } from "react";
import { useData } from "../context/DataContext";
import { DxfViewer } from "../components/DxfViewer";

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
  } = useData();

  const [mapData, setMapData] = useState(null);
  const [enhancedPositions, setEnhancedPositions] = useState({});
  const [selectedTag, setSelectedTag] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Seleziona il primo sito se non ce n'è uno corrente
  useEffect(() => {
    if (!currentSite && sites.length > 0) {
      selectSite(sites[0].id);
    }
  }, [currentSite, sites, selectSite]);

  // Caricamento dei dati della mappa dal localStorage
  useEffect(() => {
    setIsLoading(true);
    try {
      // Tenta di caricare i dati della mappa dal localStorage
      const savedMapData = localStorage.getItem("blueiot_mapData");

      if (savedMapData) {
        console.log("Mappa caricata dal localStorage");
        setMapData(savedMapData);
      } else {
        // Se non ci sono dati salvati, carica esempio
        console.log("Caricamento mappa di esempio");
        fetch("/dxf-examples/example.dxf")
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.text();
          })
          .then((data) => {
            console.log("Mappa di esempio caricata con successo");
            setMapData(data);
            localStorage.setItem("blueiot_mapData", data);
          })
          .catch((error) => {
            console.error("Errore nel caricamento della mappa:", error);
            // Crea un DXF di fallback
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
            setMapData(fallbackDxf);
            localStorage.setItem("blueiot_mapData", fallbackDxf);
          });
      }
    } catch (error) {
      console.error("Errore nel caricamento della mappa:", error);
      setError(
        "Impossibile caricare la mappa. Verifica la configurazione nella sezione Gestione Mappe."
      );
    }
    setIsLoading(false);
  }, [currentSite]);

  // Debug per vedere i dati disponibili
  useEffect(() => {
    console.log("Positions updated:", Object.keys(positions).length);
    console.log("Tag associations:", tagAssociations.length);
    console.log("Employees:", employees.length);
    console.log("Assets:", assets.length);
  }, [positions, tagAssociations, employees, assets]);

  // Aggiorna le posizioni dei tag con informazioni aggiuntive
  useEffect(() => {
    const positionsWithInfo = {};

    // Per ogni posizione, aggiungi informazioni sull'entità associata
    Object.entries(positions).forEach(([tagId, pos]) => {
      // Trova l'associazione per questo tag
      const association = tagAssociations.find((a) => a.tagId === tagId);

      if (association) {
        // Trova l'entità associata (dipendente o asset)
        const entity =
          association.targetType === "employee"
            ? employees.find((e) => e.id === association.targetId)
            : assets.find((a) => a.id === association.targetId);

        if (entity) {
          positionsWithInfo[tagId] = {
            ...pos,
            name: entity.name,
            type: association.targetType,
            entityId: association.targetId,
          };
        } else {
          // Fallback se l'entità non è trovata ma c'è un'associazione
          positionsWithInfo[tagId] = {
            ...pos,
            name: `${association.targetType} #${association.targetId}`,
            type: association.targetType,
            entityId: association.targetId,
          };
        }
      } else {
        // Fallback per tag non associati
        positionsWithInfo[tagId] = {
          ...pos,
          name: `Tag ${tagId}`,
          type: "unknown",
          entityId: null,
        };
      }
    });

    // Aggiunge manualmente tag fissi se non ci sono posizioni (solo per testing)
    if (Object.keys(positionsWithInfo).length === 0 && !isConnected) {
      // Aggiungi alcuni tag fissi per test
      positionsWithInfo["TAG001"] = {
        id: "TAG001",
        x: 31.7,
        y: 62.0,
        z: 0,
        name: "Mario Rossi",
        type: "employee",
        entityId: 1,
      };

      positionsWithInfo["TAG002"] = {
        id: "TAG002",
        x: 65.7,
        y: 42.6,
        z: 0,
        name: "Gru 002",
        type: "asset",
        entityId: 10,
      };
    }

    setEnhancedPositions(positionsWithInfo);
    console.log(
      "Tag positions enhanced:",
      Object.keys(positionsWithInfo).length
    );
  }, [positions, tagAssociations, employees, assets, isConnected]);

  // Gestisce la selezione di un tag
  const handleTagSelect = (tagId) => {
    console.log("Tag selezionato:", tagId);
    setSelectedTag(tagId);

    const association = tagAssociations.find((a) => a.tagId === tagId);
    if (association) {
      const entity =
        association.targetType === "employee"
          ? employees.find((e) => e.id === association.targetId)
          : assets.find((a) => a.id === association.targetId);

      setSelectedEntity(entity);
    } else {
      setSelectedEntity(null);
    }
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
              ) : error ? (
                <div className="h-full flex items-center justify-center bg-red-50 text-red-600">
                  <div className="text-center p-4">
                    <svg
                      className="h-10 w-10 mx-auto mb-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <p>{error}</p>
                  </div>
                </div>
              ) : (
                <DxfViewer
                  data={mapData}
                  height="100%"
                  tagPositions={enhancedPositions}
                  showTagsMessage={true}
                />
              )}
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-500 flex flex-wrap gap-4">
            <div>
              <span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-1"></span>{" "}
              Dipendenti
            </div>
            <div>
              <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1"></span>{" "}
              Asset
            </div>
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

          {selectedTag && selectedEntity ? (
            <div className="mb-4 p-4 bg-blue-50 rounded-md border border-blue-200">
              <h3 className="font-medium text-blue-800">
                {selectedEntity.name}
              </h3>
              <p className="text-sm text-blue-600">Tag: {selectedTag}</p>
              <p className="text-sm text-blue-600">
                Tipo: {selectedEntity.role || selectedEntity.type || "N/A"}
              </p>
              {selectedEntity.email && (
                <p className="text-sm text-blue-600">
                  Email: {selectedEntity.email}
                </p>
              )}
              {selectedEntity.department && (
                <p className="text-sm text-blue-600">
                  Reparto: {selectedEntity.department}
                </p>
              )}
              {selectedEntity.model && (
                <p className="text-sm text-blue-600">
                  Modello: {selectedEntity.model}
                </p>
              )}

              {enhancedPositions[selectedTag] && (
                <p className="text-sm text-blue-600">
                  Posizione: ({enhancedPositions[selectedTag].x.toFixed(2)},{" "}
                  {enhancedPositions[selectedTag].y.toFixed(2)})
                </p>
              )}

              <button
                onClick={() => setSelectedTag(null)}
                className="mt-2 text-xs text-blue-800 hover:text-blue-600"
              >
                Chiudi
              </button>
            </div>
          ) : null}

          <div className="overflow-auto max-h-96">
            {Object.keys(enhancedPositions).length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {Object.entries(enhancedPositions).map(([tagId, info]) => (
                  <li
                    key={tagId}
                    className={`py-3 px-2 cursor-pointer hover:bg-gray-50 ${
                      selectedTag === tagId ? "bg-blue-50" : ""
                    }`}
                    onClick={() => handleTagSelect(tagId)}
                  >
                    <div className="flex items-center">
                      <div
                        className={`w-3 h-3 rounded-full mr-3 ${
                          info.type === "employee"
                            ? "bg-blue-500"
                            : "bg-green-500"
                        }`}
                      ></div>
                      <div>
                        <div className="font-medium">
                          {info.name || `Tag ${tagId}`}
                        </div>
                        <div className="text-sm text-gray-500">
                          {tagId} • ({info.x.toFixed(1)}, {info.y.toFixed(1)})
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-8 text-center text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <p className="mt-2">Nessun tag attivo rilevato</p>
                <p className="mt-1 text-sm">
                  I tag appariranno qui quando saranno online
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
