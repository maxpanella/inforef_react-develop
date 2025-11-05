// Versione migliorata di mockBlueiotClient.js
let listeners = {
  tagPosition: [],
  batteryInfo: [],
  alarm: [],
  heartInfo: [],
  dmData: [],
  baseStData: [],
  personInfo: [],
  areaInfo: [],
  tagIotInfo: [],
  videoChange: [],
  open: [],
  error: [],
  close: [],
};

export const MockBlueiotClient = {
  // Flag interno per tenere traccia dello stato di connessione
  _connected: false,
  _interval: null,
  _mockTags: [
    { id: "TAG001", name: "Mario Rossi", type: "employee" },
    { id: "TAG002", name: "Gru 002", type: "asset" },
  ],

  connect: () => {
    console.log("🔌 Connessione simulata a BlueIOT avviata");

    // Se già connesso, non fare nulla
    if (MockBlueiotClient._connected) {
      console.log("Già connesso, nessuna azione necessaria");
      return;
    }

    MockBlueiotClient._connected = true;

    // Notifica tutti i listener di apertura dopo un breve ritardo
    setTimeout(() => {
      console.log("Connessione simulata completata");
      listeners.open.forEach((callback) => {
        if (typeof callback === "function") {
          callback();
        }
      });

      // Avvia la generazione dei dati simulati
      MockBlueiotClient._startDataGeneration();
    }, 800);
  },

  _startDataGeneration: () => {
    // Cleanup di eventuali intervalli esistenti
    if (MockBlueiotClient._interval) {
      clearInterval(MockBlueiotClient._interval);
    }

    // Avvia l'intervallo per generare dati simulati
    MockBlueiotClient._interval = setInterval(() => {
      if (!MockBlueiotClient._connected) return;

      // Genera posizioni casuali per i tag simulati
      MockBlueiotClient._mockTags.forEach((tag) => {
        // Genera posizione casuale con un po' di movimento graduale
        const x = 25 + Math.random() * 50; // Posizioni tra 25 e 75
        const y = 20 + Math.random() * 40; // Posizioni tra 20 e 60

        const tagPosition = {
          id: tag.id,
          x,
          y,
          z: 0,
          type: tag.type,
          name: tag.name,
        };

        // Notifica tutti i listener di posizione
        listeners.tagPosition.forEach((callback) => {
          if (typeof callback === "function") {
            callback(tagPosition);
          }
        });

        // Occasionalmente invia anche informazioni sulla batteria
        if (Math.random() < 0.1) {
          const batteryInfo = {
            tagid: tag.id,
            cap: Math.floor(Math.random() * 6), // Livello batteria tra 0 e 5
            bcharge: Math.random() < 0.2 ? 1 : 0, // 20% probabilità di essere in carica
          };

          listeners.batteryInfo.forEach((callback) => {
            if (typeof callback === "function") {
              callback(batteryInfo);
            }
          });
        }
      });
    }, 3000);
  },

  on: (event, callback) => {
    if (!listeners[event]) {
      listeners[event] = [];
    }
    listeners[event].push(callback);
  },

  // Rimuove un listener specifico
  off: (event, callback) => {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter((cb) => cb !== callback);
    }
  },

  // Rimuove tutti i listener
  clearListeners: () => {
    Object.keys(listeners).forEach((key) => {
      listeners[key] = [];
    });
  },

  // Metodo per inviare comandi di vibrazione al tag (simulato)
  sendTagVibrate: (tagId, action = "enable") => {
    if (!MockBlueiotClient._connected) {
      console.log("Non connesso, impossibile inviare comando vibrazione");
      return;
    }

    console.log(`[MOCK] Comando vibrazione ${action} inviato al tag ${tagId}`);
  },

  // Metodo per inviare richieste di tracciamento video (simulato)
  sendVideoTrackRequest: (tagId) => {
    if (!MockBlueiotClient._connected) {
      console.log(
        "Non connesso, impossibile inviare richiesta tracciamento video"
      );
      return;
    }

    console.log(`[MOCK] Richiesta tracciamento video inviata per tag ${tagId}`);

    // Simula una risposta di tracciamento video dopo un breve ritardo
    setTimeout(() => {
      const videoResponse = {
        tagid: tagId,
        ip: "192.168.1.100",
        port: "8080",
        user: "admin",
        pwd: "password",
        success: "true",
        type: "1",
        model: "1",
      };

      listeners.videoChange.forEach((callback) => {
        if (typeof callback === "function") {
          callback(videoResponse);
        }
      });
    }, 1000);
  },

  disconnect: () => {
    console.log("🔌 Disconnessione simulata da BlueIOT");

    // Se già disconnesso, non fare nulla
    if (!MockBlueiotClient._connected) {
      console.log("Già disconnesso, nessuna azione necessaria");
      return;
    }

    // Interrompi la simulazione
    if (MockBlueiotClient._interval) {
      clearInterval(MockBlueiotClient._interval);
      MockBlueiotClient._interval = null;
    }

    MockBlueiotClient._connected = false;

    // Notifica tutti i listener di chiusura
    listeners.close.forEach((callback) => {
      if (typeof callback === "function") {
        callback();
      }
    });
  },
};

// Esporta anche una funzione per verificare lo stato di connessione (utile per il debug)
export const isConnected = () => MockBlueiotClient._connected;
