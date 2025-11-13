/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import DxfParser from "dxf-parser";

export function DxfViewer({
  data,
  width = "100%",
  height = "400px",
  tagPositions = {},
  debugRawPositions = {},
  showTagsMessage = true,
  anchors = [], // Predisposizione per le ancore BlueIOT
  onTagClick = null, // callback(click) -> tagId
  onMapClick = null, // callback(click) -> {x, y}
  onNormalizationChange = null, // callback(ns) quando la mappa viene normalizzata
  focusPoint = null, // {x,y,ts} opzionale per centrare vista su un punto
  onBoundsChange = null, // callback(boundsRaw) con {min:{x,y}, max:{x,y}} in unità raw DXF (prima della normalizzazione)
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Persistenza camera
  const CAM_STORAGE_KEY = 'dxfViewerCamera_v1';
  const restoreAttemptedRef = useRef(false);
  const saveDebounceRef = useRef(null);

  // Gruppo per i tag
  const tagsRef = useRef(null);

  // Gruppo per le ancore
  const anchorsRef = useRef(null);

  // Gruppo overlay per elementi della mappa (contorni) e fattore di normalizzazione
  const overlayRef = useRef(null);
  const normScaleRef = useRef(1);

  // Rettangolo di delimitazione della mappa
  const mapBoundsRef = useRef({
    min: { x: 0, y: 0 },
    max: { x: 100, y: 100 },
  });

  // Mappa per tenere traccia dei marker dei tag
  const tagMarkersRef = useRef({});
  // Mappa per marker RAW di debug
  const rawMarkersRef = useRef({});

  // Raycaster per click / hover
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const [hoverTagId, setHoverTagId] = useState(null);
  const markerPixelSize = 12; // diametro desiderato in pixel

  // Inizializza il renderer Three.js
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    try {
  const initialContainerEl = containerEl;
      setLoading(true);
      console.log("Inizializzazione DxfViewer");

      // Ottieni le dimensioni del container
  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;

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

  // Overlay group (contorni, info) con stessa scala della mappa
  const overlayGroup = new THREE.Group();
  scene.add(overlayGroup);
  overlayRef.current = overlayGroup;

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
    containerEl.appendChild(renderer.domElement);
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

      // Funzione salvataggio camera
      const persistCamera = () => {
        if (!cameraRef.current || !controlsRef.current) return;
        try {
          const cam = cameraRef.current;
          const target = controlsRef.current.target;
          const payload = {
            pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            target: { x: target.x, y: target.y, z: target.z },
            ts: Date.now(),
            normScale: normScaleRef.current || 1,
          };
          localStorage.setItem(CAM_STORAGE_KEY, JSON.stringify(payload));
        } catch(_) {}
      };
      // Debounce salvataggio durante interazioni
      const scheduleSave = () => {
        if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = setTimeout(persistCamera, 400);
      };
      controls.addEventListener('change', scheduleSave);
      window.addEventListener('beforeunload', persistCamera);

      // Aggiungi luci
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(ambientLight);

      // Funzione di animazione
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);
        if (controlsRef.current) controlsRef.current.update();
        // Mantieni i marker a dimensione costante in pixel
        if (cameraRef.current && tagsRef.current && rendererRef.current) {
          const cam = cameraRef.current;
          const viewH = rendererRef.current.domElement.clientHeight || 1;
          const vFov = cam.fov * Math.PI / 180;
          const tmpScale = new THREE.Vector3();
          tagsRef.current.children.forEach(child => {
            const obj = child; // marker mesh
            const dist = Math.abs(cam.position.z - obj.position.z);
            const worldH = 2 * Math.tan(vFov / 2) * dist;
            const worldPerPx = worldH / viewH;
            const desiredWorld = markerPixelSize * worldPerPx; // diametro in world units desiderato
            const baseRadius = 2; // deve corrispondere a markerSize (raggio locale del cilindro)
            // Correggi per la scala del parent in modo che la dimensione finale in world non dipenda dal normScale del gruppo
            let parentScaleX = 1;
            if (obj.parent) {
              obj.parent.getWorldScale(tmpScale);
              parentScaleX = tmpScale.x;
            }
            const scaleFactor = (desiredWorld / 2) / (baseRadius * parentScaleX);
            if (isFinite(scaleFactor) && scaleFactor > 0) {
              obj.scale.setScalar(scaleFactor);
              // mantieni spessore (asse della altezza del cilindro) minimo
              obj.scale.z = Math.max(0.6, obj.scale.z);
            }
          });
        }
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      };

      animate();

      // Gestione ridimensionamento finestra
      const handleResize = () => {
        if (!rendererRef.current || !cameraRef.current)
          return;

        const width = containerEl.clientWidth;
        const height = containerEl.clientHeight;

        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();

        rendererRef.current.setSize(width, height);
      };

      window.addEventListener("resize", handleResize);

      // Gestione mouse per raycasting su marker
      const handlePointerMove = (e) => {
        if (!rendererRef.current || !cameraRef.current) return;
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        pointerRef.current.set(x, y);
        if (!tagsRef.current) return;
        raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);
        const intersects = raycasterRef.current.intersectObjects(tagsRef.current.children, true);
        if (intersects.length > 0) {
          // Risali al marker base
          let obj = intersects[0].object;
          while (obj && obj.parent && obj.parent !== tagsRef.current && !obj.userData.tagId) obj = obj.parent;
          const tid = obj && obj.userData ? obj.userData.tagId : null;
          setHoverTagId(tid || null);
          if (tid) {
            rendererRef.current.domElement.style.cursor = 'pointer';
          } else {
            rendererRef.current.domElement.style.cursor = 'default';
          }
        } else {
          setHoverTagId(null);
          rendererRef.current.domElement.style.cursor = 'default';
        }
      };
      const handleClick = (e) => {
        const hasTag = !!hoverTagId;
        if (hasTag) {
          if (onTagClick) {
            try { onTagClick(hoverTagId); } catch(_) {}
          }
          return;
        }
        // click sulla mappa: calcola intersezione con piano z=0
        if (rendererRef.current && cameraRef.current) {
          const rect = rendererRef.current.domElement.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          const vec = new THREE.Vector2(x, y);
          raycasterRef.current.setFromCamera(vec, cameraRef.current);
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0
          const hit = new THREE.Vector3();
          if (raycasterRef.current.ray.intersectPlane(plane, hit)) {
            const ns = normScaleRef.current || 1;
            // ritorna coordinate mappa raw (prima della normalizzazione)
            const pt = { x: hit.x / ns, y: hit.y / ns };
            try { window.__DXF_LAST_CLICK = pt; } catch(_) {}
            if (onMapClick) { try { onMapClick(pt); } catch(_) {} }
          }
        }
      };
      rendererRef.current.domElement.addEventListener('mousemove', handlePointerMove);
      rendererRef.current.domElement.addEventListener('click', handleClick);

      setLoading(false);
      console.log("DxfViewer inizializzato con successo");

      // Cleanup
      return () => {
        console.log("Cleanup DxfViewer");
        window.removeEventListener("resize", handleResize);
        try { window.removeEventListener('beforeunload', () => {}); } catch(_) {}
        try { controls.removeEventListener('change', scheduleSave); } catch(_) {}
        if (rendererRef.current) {
          try {
            rendererRef.current.domElement.removeEventListener('mousemove', handlePointerMove);
            rendererRef.current.domElement.removeEventListener('click', handleClick);
          } catch(_) {}
        }

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        if (rendererRef.current && initialContainerEl) {
          if (initialContainerEl.contains(rendererRef.current.domElement)) {
            initialContainerEl.removeChild(rendererRef.current.domElement);
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

  // Conversione coordinate mappa -> mondo (qui identità perché il gruppo tag viene scalato come la mappa)
  const toWorld = (x, y) => ({ x, y });

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
  // Converte coordinate mappa in mondo normalizzato (senza clamp)
  const world = toWorld(info.x, info.y);

        // Avviso di diagnostica se il marker è molto lontano dal centro mappa (potrebbe essere fuori planimetria)
        try {
          const b = mapBoundsRef.current;
          if (b) {
            const cx = (b.min.x + b.max.x) / 2;
            const cy = (b.min.y + b.max.y) / 2;
            const dx = world.x - cx; const dy = world.y - cy;
            const sizeX = Math.abs(b.max.x - b.min.x) || 1;
            const sizeY = Math.abs(b.max.y - b.min.y) || 1;
            const diag = Math.sqrt(sizeX*sizeX + sizeY*sizeY) || 1;
            const dist = Math.hypot(dx, dy);
            if (dist > diag * 3) {
              console.warn(`[DxfViewer] Tag ${tagId} molto lontano dalla planimetria (dist=${dist.toFixed(1)} > ${ (diag*3).toFixed(1)}). Verifica calibrazione/offset.`);
            }
          }
        } catch(_) {}

        // Usa colori diversi in base al tipo (dipendente o asset)
        const color = info.type === "employee" ? 0x3b82f6 : 0x10b981;

        // Se il marker esiste già, aggiorna solo la posizione
        if (tagMarkersRef.current[tagId]) {
          const marker = tagMarkersRef.current[tagId];
          // Posiziona il marker e assicurati che sia visibile sopra la mappa
          marker.position.set(world.x, world.y, 10); // Aumentato l'asse Z per maggiore sicurezza
          return;
        }

  // Marker più piccoli (richiesta utente)
  const markerSize = 2; // raggio base

  // Crea un nuovo marker usando forme 3D semplici invece di texture
  const markerGeometry = new THREE.CylinderGeometry(markerSize, markerSize, 0.8, 20);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: color });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);

        // Posiziona il marker e assicurati che sia visibile sopra la mappa
  marker.position.set(world.x, world.y, 10); // Posizionato più in alto per visibilità
        marker.rotation.x = Math.PI / 2; // Ruota per farlo stare piatto sulla mappa
        marker.userData = { tagId, name: info.name };

        // Aggiungi un bordo bianco più spesso per maggiore visibilità
  // Bordi più discreti: cerchio sottile
  const ringGeometry = new THREE.TorusGeometry(markerSize + 0.7, 0.4, 8, 24);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  marker.add(ring);

        // Amplia l'area di click con un "hit area" trasparente (solo per raycast)
        try {
          const hitSize = markerSize * 4; // area di click più grande della grafica
          const hitGeo = new THREE.CylinderGeometry(hitSize, hitSize, 1, 16);
          const hitMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.001, depthWrite: false });
          const hitMesh = new THREE.Mesh(hitGeo, hitMat);
          hitMesh.rotation.x = Math.PI / 2;
          hitMesh.userData = { tagId, isHit: true };
          marker.add(hitMesh);
        } catch(_) {}

        // Aggiungi il marker alla scena e tieni traccia di esso
        tagsRef.current.add(marker);
        tagMarkersRef.current[tagId] = marker;

        console.log(
          `Creato marker per tag ${tagId} a (${world.x}, ${world.y})`
        );
      } catch (err) {
        console.error(`Errore creazione marker per tag ${tagId}:`, err);
      }
    });
    // Rimuovi RAW marker non più presenti
    Object.keys(rawMarkersRef.current).forEach((tagId) => {
      if (!debugRawPositions || !debugRawPositions[tagId]) {
        const r = rawMarkersRef.current[tagId];
        if (r && tagsRef.current) {
          tagsRef.current.remove(r);
          // BoxGeometry/material verranno GC, ma tentiamo dispose
        }
        delete rawMarkersRef.current[tagId];
      }
    });
    // Aggiorna o crea RAW markers (debug)
    if (debugRawPositions) {
      Object.entries(debugRawPositions).forEach(([tagId, info]) => {
        try {
          const world = toWorld(info.x, info.y);
          if (rawMarkersRef.current[tagId]) {
            const grp = rawMarkersRef.current[tagId];
            grp.position.set(world.x, world.y, 12);
            return;
          }
          const arm = 2;
          const thickness = 0.5;
          const g1 = new THREE.BoxGeometry(arm * 2, thickness, thickness);
          const g2 = new THREE.BoxGeometry(arm * 2, thickness, thickness);
          const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
          const b1 = new THREE.Mesh(g1, mat);
          const b2 = new THREE.Mesh(g2, mat);
          b1.rotation.z = Math.PI / 4;
          b2.rotation.z = -Math.PI / 4;
          const group = new THREE.Group();
          group.add(b1);
          group.add(b2);
          group.position.set(world.x, world.y, 12);
          group.userData = { tagId, isRawDebug: true };
          tagsRef.current.add(group);
          rawMarkersRef.current[tagId] = group;
        } catch (err) {
          console.error(`Errore creazione RAW marker per tag ${tagId}:`, err);
        }
      });
    }
  }, [tagPositions, debugRawPositions]);

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
          // eslint-disable-next-line default-case
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
            default: {
              // Ignora altri tipi di entità non gestiti
              break;
            }
          }
        } catch (err) {
          console.warn(`Errore nel processare l'entità ${entity.type}:`, err);
        }
      });

      if (entitiesCount > 0) {
        // Calcola fattore di normalizzazione per stabilità rendering
        const boxSize = new THREE.Vector3();
        boundingBox.getSize(boxSize);
        const maxDim = Math.max(boxSize.x, boxSize.y) || 1;
        const TARGET = 1000; // dimensione target in world units
  const ns = TARGET / maxDim; // scala tale da portare la dimensione max ~ TARGET
  normScaleRef.current = ns;
  try { if (onNormalizationChange) onNormalizationChange(ns); } catch(_) {}
  // Scala mappa/overlay/ancore e ANCHE il gruppo dei tag per mantenere lo stesso spazio
  group.scale.set(ns, ns, 1);
  if (tagsRef.current) tagsRef.current.scale.set(ns, ns, 1);
  if (anchorsRef.current) anchorsRef.current.scale.set(ns, ns, 1);
  if (overlayRef.current) overlayRef.current.scale.set(ns, ns, 1);

        sceneRef.current.add(group);
        console.log(`Caricate ${entitiesCount} entità dalla mappa DXF`);

        // Aggiorna i confini della mappa
        updateMapBounds(boundingBox);

        // Visualizza il contorno della mappa (rettangolo di delimitazione)
        visualizeMapBounds();

        // Centra la vista
        // Prova ripristino camera salvata (una sola volta). Se fallisce, centra.
        if (!restoreAttemptedRef.current) {
          restoreAttemptedRef.current = true;
          let restored = false;
          try {
            const raw = localStorage.getItem(CAM_STORAGE_KEY);
            if (raw) {
              const saved = JSON.parse(raw);
              if (saved && saved.pos && saved.target) {
                const b = mapBoundsRef.current;
                const within = (p) => {
                  if (!b) return true;
                  const marginX = (b.max.x - b.min.x) * 2 + 1;
                  const marginY = (b.max.y - b.min.y) * 2 + 1;
                  return (
                    p.x >= b.min.x - marginX && p.x <= b.max.x + marginX &&
                    p.y >= b.min.y - marginY && p.y <= b.max.y + marginY
                  );
                };
                if (within(saved.pos) && within(saved.target)) {
                  if (cameraRef.current && controlsRef.current) {
                    cameraRef.current.position.set(saved.pos.x, saved.pos.y, saved.pos.z);
                    controlsRef.current.target.set(saved.target.x, saved.target.y, saved.target.z || 0);
                    cameraRef.current.updateProjectionMatrix();
                    controlsRef.current.update();
                    restored = true;
                    console.log('[DxfViewer] Camera ripristinata da localStorage');
                  }
                }
              }
            }
          } catch(e) { console.warn('[DxfViewer] Ripristino camera fallito:', e.message); }
          if (!restored) centerView();
        } else {
          centerView();
        }
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
  try { if (onBoundsChange) onBoundsChange({ ...mapBoundsRef.current }); } catch(_) {}

      // Aggiorna la posizione dei marker se il fattore di normalizzazione cambia (ricalcolo semplice)
      const ns = normScaleRef.current || 1;
      Object.entries(tagMarkersRef.current).forEach(([tagId, marker]) => {
        // Le posizioni originali non le abbiamo salvate qui: assumiamo che la posizione corrente sia già world.
        // Se volessimo una riconversione accurata dovremmo memorizzare gli x,y raw; per ora niente modifiche.
        marker.position.z = 10; // assicurati sopra la mappa
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
  if (overlayRef.current) overlayRef.current.add(boundaryLine); else sceneRef.current.add(boundaryLine);

    // Opzionale: Aggiungi un indicatore per l'origine (punto in basso a sinistra)
    const originGeometry = new THREE.SphereGeometry(2, 16, 16);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const originMarker = new THREE.Mesh(originGeometry, originMaterial);
    originMarker.position.set(bounds.min.x, bounds.min.y, 1);
    originMarker.userData = { isMapBounds: true, isOrigin: true };
  if (overlayRef.current) overlayRef.current.add(originMarker); else sceneRef.current.add(originMarker);

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
  const setCameraForBounds = (center, size) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    const maxDim = Math.max(size.x, size.y) || 1;
    const diag = Math.sqrt(size.x * size.x + size.y * size.y) || maxDim;
    const fov = cam.fov * (Math.PI / 180);
    let distance = maxDim / (2 * Math.tan(fov / 2));
    distance = Math.max(distance * 1.3, 10);
    // Far/Near adattivi: mantieni un margine ampio ma non infinito per evitare problemi di precisione
    const desiredFar = Math.max(5000, diag * 10 + 200);
    const desiredNear = Math.min(Math.max(0.1, desiredFar / 50000), 5);
    cam.near = desiredNear;
    cam.far = desiredFar;
    cam.updateProjectionMatrix();
    controls.minDistance = Math.max(5, Math.min(distance * 0.05, 200));
    controls.maxDistance = desiredFar * 0.95;
    cam.position.set(center.x, center.y, distance);
    cam.lookAt(center);
    controls.target.set(center.x, center.y, 0);
    controls.update();
  };

  const adjustFarForMap = () => {
    if (!cameraRef.current) return;
    const b = mapBoundsRef.current;
    if (!b) return;
    const size = new THREE.Vector3(Math.abs(b.max.x - b.min.x), Math.abs(b.max.y - b.min.y), 0);
    const diag = Math.sqrt(size.x * size.x + size.y * size.y) || 1;
    const desiredFar = Math.max(5000, diag * 10 + 200);
    if (cameraRef.current.far < desiredFar) {
      cameraRef.current.far = desiredFar;
      cameraRef.current.updateProjectionMatrix();
      if (controlsRef.current) controlsRef.current.maxDistance = desiredFar * 0.95;
    }
  };

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

    setCameraForBounds(center, size);

    console.log("Vista centrata con successo:", {
      center: center,
      size: size,
      distance: cameraRef.current.position.z,
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

  // Centra includendo anche i tag (e marker RAW)
  const centerIncludingTags = () => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;
    // 1) Calcola bounding della mappa DXF
    const mapBox = new THREE.Box3();
    sceneRef.current.traverse((child) => {
      if (child.userData && child.userData.isDxf) mapBox.expandByObject(child);
    });
    if (mapBox.isEmpty()) {
      // Nessuna mappa: fallback al centro standard
      return centerView();
    }
    const mapCenter = new THREE.Vector3();
    const mapSize = new THREE.Vector3();
    mapBox.getCenter(mapCenter);
    mapBox.getSize(mapSize);
    const mapDiag = Math.sqrt(mapSize.x * mapSize.x + mapSize.y * mapSize.y) || 1;
  const safeRadius = mapDiag * 3; // ignora outlier molto lontani

    // 2) Costruisci bounding combinato: mappa + tag entro raggio sicuro
    const box = mapBox.clone();
    if (tagsRef.current) {
      const tmpBox = new THREE.Box3();
      tagsRef.current.children.forEach((c) => {
        tmpBox.setFromObject(c);
        const childCenter = new THREE.Vector3();
        tmpBox.getCenter(childCenter);
        if (childCenter.distanceTo(mapCenter) <= safeRadius) {
          box.union(tmpBox);
        }
      });
    }
    if (box.isEmpty()) return centerView();

    // 3) Posiziona la camera con distanza clampata e far plane adeguato
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    setCameraForBounds(center, size);
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

  // Focus esterno: centra la vista su un punto mantenendo lo zoom attuale
  useEffect(() => {
    if (!focusPoint || !controlsRef.current || !cameraRef.current) return;
    try {
      const target = new THREE.Vector3(Number(focusPoint.x) || 0, Number(focusPoint.y) || 0, 0);
      const cam = cameraRef.current;
      const controls = controlsRef.current;
      // Evita di seguire target fuori dai confini (con un margine): se fuori, ignora
      const b = mapBoundsRef.current;
      if (b) {
        const sizeX = Math.abs(b.max.x - b.min.x) || 1;
        const sizeY = Math.abs(b.max.y - b.min.y) || 1;
        const marginX = sizeX * 0.15; // 15% margine
        const marginY = sizeY * 0.15;
        const within = (p) => (
          p.x >= (b.min.x - marginX) && p.x <= (b.max.x + marginX) &&
          p.y >= (b.min.y - marginY) && p.y <= (b.max.y + marginY)
        );
        if (!within(target)) {
          // Non spostare la camera fuori dalla planimetria
          return;
        }
      }
      // Pan verso il target mantenendo lo zoom
      const prevTarget = controls.target.clone();
      const camOffset = cam.position.clone().sub(prevTarget);
      controls.target.copy(target);
      cam.position.copy(target.clone().add(camOffset));
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      controls.update();
      adjustFarForMap();
    } catch(_) {}
  }, [focusPoint]);

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
          onClick={centerIncludingTags}
          className="bg-gray-200 hover:bg-gray-300 p-1 rounded"
          title="Centra Mappa + Tag"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M4 4h4v2H6v2H4V4zm12 0v4h-2V6h-2V4h4zM4 16v-4h2v2h2v2H4zm12 0h-4v-2h2v-2h2v4z" />
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
      {hoverTagId && tagPositions[hoverTagId] && (
        (() => {
          const info = tagPositions[hoverTagId];
          const toHex = (id) => {
            const s = String(id ?? '');
            const hexLike = s.replace(/[^0-9A-Fa-f]/g,'');
            if (/^[0-9A-Fa-f]{8,}$/.test(hexLike)) return '0x' + hexLike.toUpperCase();
            const num = Number(s);
            if (!Number.isNaN(num)) return '0x' + (num >>> 0).toString(16).toUpperCase().padStart(8,'0');
            return s;
          };
          const hexId = toHex(hoverTagId);
          return (
        <div className="absolute top-2 left-2 bg-white bg-opacity-95 shadow-lg rounded-md px-3 py-2 z-30 text-xs max-w-xs cursor-pointer"
             onClick={() => { try { onTagClick && onTagClick(hoverTagId); } catch(_) {} }}
        >
          <div className="font-semibold mb-1">{info.name || `Tag ${hexId}`}</div>
          <div>ID: {hexId}</div>
          <div>Pos: {info.x.toFixed(2)}, {info.y.toFixed(2)}</div>
          {typeof info.cap !== 'undefined' && (
            <div>Batteria: {info.cap}%</div>
          )}
          {typeof info.bcharge !== 'undefined' && (
            <div>Charging: {info.bcharge ? 'Yes' : 'No'}</div>
          )}
          <div>Age: {Math.round(info.ageMs || (Date.now() - info.ts))}ms</div>
          <div className="mt-1 text-[10px] text-gray-500">Click per fissare nel pannello dettagli</div>
        </div>
          );
        })()
      )}
      {/* Debug overlay nomi/varianti (attivabile impostando window.__DXF_DEBUG_NAMES = true) */}
      {typeof window !== 'undefined' && window.__DXF_DEBUG_NAMES && (
        <div className="absolute top-2 right-2 max-h-64 overflow-auto bg-white bg-opacity-90 text-[10px] p-2 rounded shadow z-30 w-56">
          <div className="font-semibold mb-1">Debug Tag Names</div>
          {Object.entries(tagPositions).map(([tid, info]) => {
            const variants = [];
            const s = String(tid);
            variants.push(s);
            const num = Number(s);
            if (!Number.isNaN(num)) {
              const u32 = (num >>> 0);
              variants.push(String(u32));
              variants.push(num.toString(16).toUpperCase());
              variants.push(u32.toString(16).toUpperCase());
            }
            const hexLike = s.replace(/[^0-9A-Fa-f]/g,'');
            if (/^[0-9A-Fa-f]{8,}$/.test(hexLike)) {
              const up = hexLike.toUpperCase();
              variants.push(up);
              const lowHex = up.slice(-8);
              variants.push(lowHex);
              try { variants.push(String(parseInt(lowHex,16))); } catch(_) {}
            }
            const uniq = Array.from(new Set(variants));
            return (
              <div key={tid} className="mb-1 border-b border-gray-200 pb-1">
                <div className="font-medium">{info.name || `Tag ${tid}`}</div>
                <div className="truncate">ID: {tid}</div>
                <div className="truncate">Varianti: {uniq.join(' | ')}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
