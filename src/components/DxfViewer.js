import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import DxfParser from "dxf-parser";

export function DxfViewer({
  data,
  width = "100%",
  height = "400px",
  tagPositions = {},
  showTagsMessage = true,
  anchors = [], // Predisposizione per le ancore BlueIOT
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Gruppo per i tag
  const tagsRef = useRef(null);

  // Gruppo per le ancore
  const anchorsRef = useRef(null);

  // Rettangolo di delimitazione della mappa
  const mapBoundsRef = useRef({
    min: { x: 0, y: 0 },
    max: { x: 100, y: 100 },
  });

  // Mappa per tenere traccia dei marker dei tag
  const tagMarkersRef = useRef({});

  // Inizializza il renderer Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      setLoading(true);
      console.log("Inizializzazione DxfViewer");

      // Ottieni le dimensioni del container
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      // Inizializza la scena Three.js
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf8f9fa);
      sceneRef.current = scene;

      // Crea un gruppo per i tag e aggiungilo alla scena
      const tagsGroup = new THREE.Group();
      scene.add(tagsGroup);
      tagsRef.current = tagsGroup;

      // Crea un gruppo per le ancore
      const anchorsGroup = new THREE.Group();
      scene.add(anchorsGroup);
      anchorsRef.current = anchorsGroup;

      // Inizializza la camera
      const camera = new THREE.PerspectiveCamera(
        45,
        width / height,
        0.1,
        10000
      );
      camera.position.set(0, 0, 100);
      cameraRef.current = camera;

      // Inizializza il renderer con alta qualità
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Aggiungi controlli per navigazione
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.25;
      controls.screenSpacePanning = true;
      controls.minDistance = 10;
      controls.maxDistance = 5000;
      controls.maxPolarAngle = Math.PI / 2;
      controls.enableRotate = false; // Disabilita rotazione per planimetrie 2D
      controlsRef.current = controls;

      // Aggiungi luci
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(ambientLight);

      // Funzione di animazione
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);
        if (controlsRef.current) controlsRef.current.update();
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      };

      animate();

      // Gestione ridimensionamento finestra
      const handleResize = () => {
        if (!containerRef.current || !rendererRef.current || !cameraRef.current)
          return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();

        rendererRef.current.setSize(width, height);
      };

      window.addEventListener("resize", handleResize);

      setLoading(false);
      console.log("DxfViewer inizializzato con successo");

      // Cleanup
      return () => {
        console.log("Cleanup DxfViewer");
        window.removeEventListener("resize", handleResize);

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        if (rendererRef.current && containerRef.current) {
          if (containerRef.current.contains(rendererRef.current.domElement)) {
            containerRef.current.removeChild(rendererRef.current.domElement);
          }
          rendererRef.current.dispose();
        }

        // Pulisci la scena
        if (sceneRef.current) {
          sceneRef.current.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach((material) => material.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
          sceneRef.current.clear();
        }
      };
    } catch (error) {
      console.error("Errore nell'inizializzazione del visualizzatore:", error);
      setError(`Errore nell'inizializzazione: ${error.message}`);
      setLoading(false);
    }
  }, []);

  // Funzione per limitare le coordinate all'interno del rettangolo della mappa con margine
  const constrainToMapBounds = (x, y) => {
    const bounds = mapBoundsRef.current;

    // Calcola le dimensioni della mappa
    const mapWidth = bounds.max.x - bounds.min.x;
    const mapHeight = bounds.max.y - bounds.min.y;

    // Applica un margine del 5% dai bordi
    const marginX = mapWidth * 0.05;
    const marginY = mapHeight * 0.05;

    // Limita le coordinate all'interno del rettangolo con margine
    const constrained = {
      x: Math.max(bounds.min.x + marginX, Math.min(bounds.max.x - marginX, x)),
      y: Math.max(bounds.min.y + marginY, Math.min(bounds.max.y - marginY, y)),
    };

    // Se le coordinate originali sono molto lontane, spostale verso il centro
    const centerX = (bounds.max.x + bounds.min.x) / 2;
    const centerY = (bounds.max.y + bounds.min.y) / 2;

    // Se il punto è completamente fuori dalla mappa, avvicinalo al centro
    if (
      x < bounds.min.x ||
      x > bounds.max.x ||
      y < bounds.min.y ||
      y > bounds.max.y
    ) {
      // Sposta verso il centro, ma mantieni una certa casualità
      const randomOffset = Math.random() * 0.4 + 0.3; // Tra 0.3 e 0.7
      constrained.x = centerX + (constrained.x - centerX) * randomOffset;
      constrained.y = centerY + (constrained.y - centerY) * randomOffset;
    }

    return constrained;
  };

  // Aggiorna i tag sulla mappa quando le posizioni cambiano
  useEffect(() => {
    if (!tagsRef.current || !sceneRef.current) {
      console.warn("tagsRef o sceneRef non disponibili per aggiornamento tag");
      return;
    }

    const tagCount = Object.keys(tagPositions).length;
    console.log(`Aggiornamento ${tagCount} tag sulla mappa`);

    // Rimuovi i marker non più presenti
    Object.keys(tagMarkersRef.current).forEach((tagId) => {
      if (!tagPositions[tagId]) {
        console.log(`Rimozione marker per tag ${tagId}`);
        const marker = tagMarkersRef.current[tagId];
        if (marker && tagsRef.current) {
          tagsRef.current.remove(marker);
          if (marker.geometry) marker.geometry.dispose();
          if (marker.material) {
            if (Array.isArray(marker.material)) {
              marker.material.forEach((m) => m.dispose());
            } else {
              marker.material.dispose();
            }
          }
          delete tagMarkersRef.current[tagId];
        }
      }
    });

    // Aggiorna o crea nuovi marker
    Object.entries(tagPositions).forEach(([tagId, info]) => {
      try {
        // Limita le coordinate all'interno del rettangolo della mappa
        const constrained = constrainToMapBounds(info.x, info.y);

        // Usa colori diversi in base al tipo (dipendente o asset)
        const color = info.type === "employee" ? 0x3b82f6 : 0x10b981;

        // Se il marker esiste già, aggiorna solo la posizione
        if (tagMarkersRef.current[tagId]) {
          const marker = tagMarkersRef.current[tagId];
          // Posiziona il marker e assicurati che sia visibile sopra la mappa
          marker.position.set(constrained.x, constrained.y, 10); // Aumentato l'asse Z per maggiore sicurezza
          return;
        }

        // MARKER PIÙ GRANDI E VISIBILI
        const markerSize = 5; // Dimensione aumentata

        // Crea un nuovo marker usando forme 3D semplici invece di texture
        const markerGeometry = new THREE.CylinderGeometry(
          markerSize,
          markerSize,
          1,
          16
        );
        const markerMaterial = new THREE.MeshBasicMaterial({ color: color });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);

        // Posiziona il marker e assicurati che sia visibile sopra la mappa
        marker.position.set(constrained.x, constrained.y, 10); // Posizionato più in alto per visibilità
        marker.rotation.x = Math.PI / 2; // Ruota per farlo stare piatto sulla mappa
        marker.userData = { tagId, name: info.name };

        // Aggiungi un bordo bianco più spesso per maggiore visibilità
        const ringGeometry = new THREE.TorusGeometry(markerSize + 1, 1, 8, 24);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2; // Ruota come il marker principale
        marker.add(ring);

        // Aggiungi il marker alla scena e tieni traccia di esso
        tagsRef.current.add(marker);
        tagMarkersRef.current[tagId] = marker;

        console.log(
          `Creato marker per tag ${tagId} a (${constrained.x}, ${constrained.y})`
        );
      } catch (err) {
        console.error(`Errore creazione marker per tag ${tagId}:`, err);
      }
    });
  }, [tagPositions]);

  // Carica e visualizza i dati DXF
  useEffect(() => {
    if (!sceneRef.current || !data) return;

    setLoading(true);
    console.log("Inizio parsing DXF...");

    try {
      // Rimuovi geometrie DXF precedenti
      const entitiesToRemove = [];
      sceneRef.current.traverse((object) => {
        if (object.userData && object.userData.isDxf) {
          entitiesToRemove.push(object);
        }
      });

      entitiesToRemove.forEach((object) => {
        sceneRef.current.remove(object);
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });

      // Reimposta il rettangolo di delimitazione
      const boundingBox = new THREE.Box3(
        new THREE.Vector3(Infinity, Infinity, Infinity),
        new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      );

      // Parse del DXF usando la libreria dxf-parser
      const parser = new DxfParser();
      let dxf;

      try {
        dxf = parser.parseSync(data);
      } catch (err) {
        console.error(
          "Errore nel parsing DXF standard, tentativo con parsing manuale",
          err
        );
        // Se il parser standard fallisce, utilizziamo il nostro parser manuale
        const result = parseSimpleDxf(data, sceneRef.current);

        if (result.entitiesCount > 0) {
          // Il parsing manuale ha funzionato
          // Usa il bounding box dal risultato del parsing manuale
          if (result.boundingBox) {
            boundingBox.copy(result.boundingBox);
          }
          updateMapBounds(boundingBox);
          centerView();
          setLoading(false);
          return;
        } else {
          throw new Error("Impossibile interpretare il file DXF");
        }
      }

      // Se arriviamo qui, il parsing con dxf-parser è riuscito
      console.log("DXF Parsed:", dxf);

      if (!dxf.entities || dxf.entities.length === 0) {
        throw new Error("Nessuna entità trovata nel file DXF");
      }

      // Crea oggetti Three.js per ogni entità
      const group = new THREE.Group();
      group.userData = { isDxf: true };

      // Colore predefinito per le linee
      const defaultColor = 0x333333;

      // Materiale di base per le linee
      const createLineMaterial = (colorCode) => {
        const color = colorCode !== undefined ? colorCode : defaultColor;
        return new THREE.LineBasicMaterial({
          color: color,
          linewidth: 1.5,
        });
      };

      // Processa le entità
      let entitiesCount = 0;

      dxf.entities.forEach((entity) => {
        try {
          switch (entity.type) {
            case "LINE": {
              const geometry = new THREE.BufferGeometry();
              const vertices = [
                entity.vertices[0].x,
                entity.vertices[0].y,
                entity.vertices[0].z || 0,
                entity.vertices[1].x,
                entity.vertices[1].y,
                entity.vertices[1].z || 0,
              ];
              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(vertices, 3)
              );
              const material = createLineMaterial(entity.color);
              const line = new THREE.Line(geometry, material);
              line.userData = { isDxf: true, layer: entity.layer };
              group.add(line);

              // Aggiorna il bounding box
              const point1 = new THREE.Vector3(
                entity.vertices[0].x,
                entity.vertices[0].y,
                entity.vertices[0].z || 0
              );
              const point2 = new THREE.Vector3(
                entity.vertices[1].x,
                entity.vertices[1].y,
                entity.vertices[1].z || 0
              );
              boundingBox.expandByPoint(point1);
              boundingBox.expandByPoint(point2);

              entitiesCount++;
              break;
            }

            case "LWPOLYLINE":
            case "POLYLINE": {
              if (entity.vertices.length < 2) break;

              const geometry = new THREE.BufferGeometry();
              const vertices = [];

              entity.vertices.forEach((vertex) => {
                vertices.push(vertex.x, vertex.y, vertex.z || 0);
                // Aggiorna il bounding box
                boundingBox.expandByPoint(
                  new THREE.Vector3(vertex.x, vertex.y, vertex.z || 0)
                );
              });

              // Chiudi il poligono se necessario
              if (entity.closed && entity.vertices.length > 2) {
                vertices.push(
                  entity.vertices[0].x,
                  entity.vertices[0].y,
                  entity.vertices[0].z || 0
                );
              }

              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(vertices, 3)
              );
              const material = createLineMaterial(entity.color);
              const polyline = new THREE.Line(geometry, material);
              polyline.userData = { isDxf: true, layer: entity.layer };
              group.add(polyline);
              entitiesCount++;
              break;
            }

            case "CIRCLE": {
              const segments = Math.max(32, Math.floor(entity.radius * 4));
              const geometry = new THREE.BufferGeometry();
              const vertices = [];

              for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                const x = entity.center.x + entity.radius * Math.cos(theta);
                const y = entity.center.y + entity.radius * Math.sin(theta);
                const z = entity.center.z || 0;

                vertices.push(x, y, z);

                // Aggiorna il bounding box
                boundingBox.expandByPoint(new THREE.Vector3(x, y, z));
              }

              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(vertices, 3)
              );
              const material = createLineMaterial(entity.color);
              const circle = new THREE.Line(geometry, material);
              circle.userData = { isDxf: true, layer: entity.layer };
              group.add(circle);
              entitiesCount++;
              break;
            }

            case "ARC": {
              const segments = Math.max(32, Math.floor(entity.radius * 3));
              const geometry = new THREE.BufferGeometry();
              const vertices = [];

              const startAngle = entity.startAngle;
              const endAngle = entity.endAngle;
              const angleDiff =
                endAngle > startAngle
                  ? endAngle - startAngle
                  : Math.PI * 2 + endAngle - startAngle;

              for (let i = 0; i <= segments; i++) {
                const theta = startAngle + (i / segments) * angleDiff;
                const x = entity.center.x + entity.radius * Math.cos(theta);
                const y = entity.center.y + entity.radius * Math.sin(theta);
                const z = entity.center.z || 0;

                vertices.push(x, y, z);

                // Aggiorna il bounding box
                boundingBox.expandByPoint(new THREE.Vector3(x, y, z));
              }

              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(vertices, 3)
              );
              const material = createLineMaterial(entity.color);
              const arc = new THREE.Line(geometry, material);
              arc.userData = { isDxf: true, layer: entity.layer };
              group.add(arc);
              entitiesCount++;
              break;
            }
          }
        } catch (err) {
          console.warn(`Errore nel processare l'entità ${entity.type}:`, err);
        }
      });

      if (entitiesCount > 0) {
        sceneRef.current.add(group);
        console.log(`Caricate ${entitiesCount} entità dalla mappa DXF`);

        // Aggiorna i confini della mappa
        updateMapBounds(boundingBox);

        // Visualizza il contorno della mappa (rettangolo di delimitazione)
        visualizeMapBounds();

        // Centra la vista
        centerView();
      } else {
        setError("Nessuna entità visualizzabile nel file DXF");
      }

      setLoading(false);
    } catch (err) {
      console.error("Errore durante l'elaborazione del DXF:", err);
      setError(`Errore durante l'elaborazione del DXF: ${err.message}`);
      setLoading(false);
    }
  }, [data]);

  // Funzione per aggiornare i confini della mappa
  const updateMapBounds = (boundingBox) => {
    if (boundingBox.isEmpty()) {
      console.warn("Bounding box vuoto, uso valori predefiniti");
      mapBoundsRef.current = {
        min: { x: 0, y: 0 },
        max: { x: 100, y: 100 },
      };
    } else {
      // Aggiorna i confini della mappa
      mapBoundsRef.current = {
        min: { x: boundingBox.min.x, y: boundingBox.min.y },
        max: { x: boundingBox.max.x, y: boundingBox.max.y },
      };

      // Debug: stampa i confini calcolati
      console.log("Confini mappa aggiornati:", mapBoundsRef.current);

      // Controlla anche i marker esistenti e spostali se necessario
      Object.entries(tagMarkersRef.current).forEach(([tagId, marker]) => {
        const currentPos = marker.position;
        const constrained = constrainToMapBounds(currentPos.x, currentPos.y);

        if (currentPos.x !== constrained.x || currentPos.y !== constrained.y) {
          marker.position.set(constrained.x, constrained.y, currentPos.z);
        }
      });
    }
  };

  // Visualizza il contorno della mappa (rettangolo di delimitazione)
  const visualizeMapBounds = () => {
    if (!sceneRef.current) return;

    // Recupera i confini
    const bounds = mapBoundsRef.current;

    // Rimuovi eventuali contorni esistenti
    sceneRef.current.traverse((object) => {
      if (object.userData && object.userData.isMapBounds) {
        sceneRef.current.remove(object);
      }
    });

    // Crea un rettangolo che rappresenta i confini della mappa
    const geometry = new THREE.BufferGeometry();
    const vertices = [
      // Rettangolo
      bounds.min.x,
      bounds.min.y,
      1, // z=1 per essere sopra la mappa ma sotto i marker
      bounds.max.x,
      bounds.min.y,
      1,
      bounds.max.x,
      bounds.max.y,
      1,
      bounds.min.x,
      bounds.max.y,
      1,
      bounds.min.x,
      bounds.min.y,
      1, // Chiudi il rettangolo
    ];

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    // Materiale per il contorno (rosso semitrasparente)
    const material = new THREE.LineBasicMaterial({
      color: 0xff0000,
      opacity: 0.6,
      transparent: true,
      linewidth: 2,
    });

    const boundaryLine = new THREE.Line(geometry, material);
    boundaryLine.userData = { isMapBounds: true };
    sceneRef.current.add(boundaryLine);

    // Opzionale: Aggiungi un indicatore per l'origine (punto in basso a sinistra)
    const originGeometry = new THREE.SphereGeometry(2, 16, 16);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const originMarker = new THREE.Mesh(originGeometry, originMaterial);
    originMarker.position.set(bounds.min.x, bounds.min.y, 1);
    originMarker.userData = { isMapBounds: true, isOrigin: true };
    sceneRef.current.add(originMarker);

    console.log("Visualizzazione contorno mappa creata");
  };

  // Parser manuale semplificato per DXF (fallback)
  const parseSimpleDxf = (dxfContent, scene) => {
    const result = {
      entitiesCount: 0,
      errors: [],
      boundingBox: new THREE.Box3(
        new THREE.Vector3(Infinity, Infinity, Infinity),
        new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      ),
    };

    // Verifica se è un file DXF valido
    if (
      !dxfContent ||
      (!dxfContent.includes("SECTION") && !dxfContent.includes("ENTITIES"))
    ) {
      throw new Error("File DXF non valido o formato non riconosciuto");
    }

    try {
      // Estrai la sezione ENTITIES
      let entitiesSection = "";
      const entitiesMatch = dxfContent.match(/ENTITIES([\s\S]*?)ENDSEC/);

      if (entitiesMatch) {
        entitiesSection = entitiesMatch[1];
      } else {
        // Prova un approccio più semplice
        const lines = dxfContent.split("\n");
        let inEntitiesSection = false;

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (inEntitiesSection) {
            if (trimmedLine === "ENDSEC") break;
            entitiesSection += line + "\n";
          } else if (trimmedLine === "ENTITIES") {
            inEntitiesSection = true;
          }
        }

        if (!entitiesSection) {
          result.errors.push("Sezione ENTITIES non trovata");
          return result;
        }
      }

      // Crea un gruppo per tutte le entità
      const group = new THREE.Group();
      group.userData = { isDxf: true };

      // Funzione helper per creare una linea
      const createLine = (points) => {
        const material = new THREE.LineBasicMaterial({
          color: 0x333333,
          linewidth: 1.5,
        });

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        line.userData = { isDxf: true };
        group.add(line);

        // Aggiorna il bounding box
        points.forEach((point) => result.boundingBox.expandByPoint(point));

        result.entitiesCount++;
        return line;
      };

      // LINES - Linee semplici
      parseEntityType(entitiesSection, "LINE", (entityData) => {
        try {
          const x1 = getCoord(entityData, 10);
          const y1 = getCoord(entityData, 20);
          const z1 = getCoord(entityData, 30, 0);
          const x2 = getCoord(entityData, 11);
          const y2 = getCoord(entityData, 21);
          const z2 = getCoord(entityData, 31, 0);

          const points = [
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
          ];

          createLine(points);
        } catch (err) {
          console.log(`Errore nel parsing di LINE: ${err.message}`);
        }
      });

      // LWPOLYLINES e POLYLINES
      parseEntityType(entitiesSection, "LWPOLYLINE", (entityData) => {
        try {
          const vertices = [];
          const coordPattern = /10\s+([-\d.]+)[\s\S]*?20\s+([-\d.]+)/g;
          let coordMatch;

          while ((coordMatch = coordPattern.exec(entityData)) !== null) {
            const x = parseFloat(coordMatch[1]);
            const y = parseFloat(coordMatch[2]);
            vertices.push(new THREE.Vector3(x, y, 0));
          }

          if (vertices.length >= 2) {
            // Controlla se è chiusa
            const closedMatch = entityData.match(/70\s+(\d+)/);
            const isClosed =
              closedMatch && (parseInt(closedMatch[1]) & 1) !== 0;

            if (isClosed && vertices.length > 1) {
              vertices.push(vertices[0].clone());
            }

            createLine(vertices);
          }
        } catch (err) {
          console.log(`Errore nel parsing di LWPOLYLINE: ${err.message}`);
        }
      });

      if (result.entitiesCount > 0) {
        scene.add(group);
      }
    } catch (err) {
      result.errors.push(`Errore generale nel parsing: ${err.message}`);
    }

    return result;
  };

  // Funzione helper per estrarre coordinate
  const getCoord = (entityData, groupCode, defaultValue = null) => {
    const match = entityData.match(new RegExp(`${groupCode}\\s+([-\\d.]+)`));
    if (!match && defaultValue !== null) return defaultValue;
    if (!match) throw new Error(`Gruppo ${groupCode} non trovato`);
    return parseFloat(match[1]);
  };

  // Funzione helper per analizzare le entità di un tipo specifico
  const parseEntityType = (data, entityType, callback) => {
    let startIdx = data.indexOf(entityType);

    while (startIdx !== -1) {
      let endIdx = data.indexOf("\n 0", startIdx + entityType.length);
      if (endIdx === -1) endIdx = data.length;

      const entityData = data.substring(startIdx, endIdx);
      callback(entityData);

      startIdx = data.indexOf(entityType, endIdx);
    }
  };

  // Centra la vista sui contenuti - MIGLIORATO per garantire visibilità
  const centerView = () => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    // Usa il bounding box appena calcolato
    const box = new THREE.Box3();
    sceneRef.current.traverse((child) => {
      if (child.userData && child.userData.isDxf) {
        box.expandByObject(child);
      }
    });

    if (box.isEmpty()) {
      console.warn("Impossibile centrare la vista: nessun oggetto trovato");
      // Imposta una vista predefinita
      cameraRef.current.position.set(50, 40, 100);
      cameraRef.current.lookAt(50, 40, 0);
      controlsRef.current.target.set(50, 40, 0);
      controlsRef.current.update();
      return;
    }

    // Calcola il centro e la dimensione del bounding box
    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);

    // Calcola la distanza per vedere tutto il contenuto
    const maxDim = Math.max(size.x, size.y);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let distance = maxDim / (2 * Math.tan(fov / 2));

    // Aggiungi un po' di spazio extra
    distance *= 1.3;

    // Posiziona la camera
    cameraRef.current.position.set(center.x, center.y, distance);
    cameraRef.current.lookAt(center);
    cameraRef.current.updateProjectionMatrix();

    // Aggiorna i controlli
    controlsRef.current.target.set(center.x, center.y, 0);
    controlsRef.current.update();

    console.log("Vista centrata con successo:", {
      center: center,
      size: size,
      distance: distance,
    });
  };

  // Controlli di zoom
  const zoomIn = () => {
    if (!cameraRef.current) return;
    cameraRef.current.position.z *= 0.8;
    if (controlsRef.current) controlsRef.current.update();
  };

  const zoomOut = () => {
    if (!cameraRef.current) return;
    cameraRef.current.position.z *= 1.2;
    if (controlsRef.current) controlsRef.current.update();
  };

  const zoomReset = () => {
    centerView();
  };

  // Stili per il container
  const containerStyle = {
    width,
    height,
    position: "relative",
    border: "1px solid #e0e0e0",
    borderRadius: "4px",
    overflow: "hidden",
  };

  return (
    <div style={containerStyle} ref={containerRef}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70 z-10">
          <div className="text-blue-600 flex items-center">
            <svg
              className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600"
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
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative max-w-md">
            <strong className="font-bold">Errore!</strong>
            <span className="block sm:inline"> {error}</span>
          </div>
        </div>
      )}

      {!data && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-gray-500">
            Carica un file DXF per visualizzare la planimetria
          </div>
        </div>
      )}

      {/* Controlli di zoom */}
      <div className="absolute bottom-2 right-2 bg-white rounded-md shadow-md p-2 z-20 flex space-x-2">
        <button
          onClick={zoomIn}
          className="bg-gray-200 hover:bg-gray-300 p-1 rounded"
          title="Zoom In"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          onClick={zoomOut}
          className="bg-gray-200 hover:bg-gray-300 p-1 rounded"
          title="Zoom Out"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          onClick={zoomReset}
          className="bg-gray-200 hover:bg-gray-300 p-1 rounded"
          title="Centra Planimetria"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 3a7 7 0 107 7 1 1 0 112 0 9 9 0 11-9-9 1 1 0 010 2zm5.293 5.293a1 1 0 011.414 0l2 2a1 1 0 010 1.414l-2 2a1 1 0 01-1.414-1.414L16.586 11H7a1 1 0 110-2h9.586l-1.293-1.293a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Messaggio di debug per gli ultimi tag rilevati - condizionale in base al parametro showTagsMessage */}
      {showTagsMessage && Object.keys(tagPositions).length === 0 && (
        <div className="absolute bottom-14 left-2 bg-white bg-opacity-90 rounded-md shadow-md px-3 py-1 z-20 text-xs text-gray-600">
          In attesa di tag attivi...
        </div>
      )}

      {/* Info coordinate in basso a sinistra */}
      <div className="absolute bottom-2 left-2 bg-white bg-opacity-90 rounded-md shadow-md px-3 py-1 z-20 text-xs text-gray-600">
        Origine: ({Math.round(mapBoundsRef.current.min.x)},{" "}
        {Math.round(mapBoundsRef.current.min.y)})
      </div>
    </div>
  );
}
