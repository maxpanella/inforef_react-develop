import { env } from "./env";
import md5 from "blueimp-md5";

let socket;
let reconnectTimer;
let listeners = {
  tagPosition: [],
  batteryInfo: [],
  alarm: [],
  heartInfo: [],
  dmData: [], // Regional statistics
  baseStData: [], // Anchor status
  personInfo: [], // Tag quantity statistics
  areaInfo: [], // Regional access info
  tagIotInfo: [], // User-defined IoT data
  videoChange: [], // Video tracking response
  open: [],
  error: [],
  close: [],
};

export const RealBlueiotClient = {
  connect: (serverIp, serverPort) => {
    const host = `ws://192.168.1.11:48300`;
    console.log("🔌 TEST HARDCODED - Connessione a:", host);
    // Use params if provided, otherwise use env values
    // const host =
    //   serverIp && serverPort
    //     ? `ws://${serverIp}:${serverPort}`
    //     : env.REACT_APP_BLUEIOT_HOST || "ws://192.168.1.11:48300";

    if (socket) {
      socket.close();
    }

    try {
      console.log("🔌 Connessione a BlueIOT WebSocket:", host);
      socket = new WebSocket(host, "localSensePush-protocol");

      socket.onopen = () => {
        console.log("✅ WebSocket BlueIOT connesso");
        // Authenticate with the server
        RealBlueiotClient.authenticate();
        // Notify listeners
        listeners.open.forEach((callback) => {
          if (typeof callback === "function") {
            callback();
          }
        });
      };

      socket.onmessage = (event) => {
        // Handle binary data from BlueIOT
        const data = event.data;
        if (data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            const buffer = new Uint8Array(reader.result);
            // Process the binary data
            RealBlueiotClient.processData(buffer);
          };
          reader.readAsArrayBuffer(data);
        } else if (typeof data === "string") {
          // Handle JSON data
          try {
            const jsonData = JSON.parse(data);
            RealBlueiotClient.processJsonData(jsonData);
          } catch (e) {
            console.error("Error parsing JSON data:", e);
          }
        }
      };

      socket.onclose = (event) => {
        console.log(
          `❌ WebSocket BlueIOT disconnesso: ${event.code} ${event.reason}`
        );

        // Notify listeners
        listeners.close.forEach((callback) => {
          if (typeof callback === "function") {
            callback(event);
          }
        });

        // Attempt to reconnect after a delay
        clearTimeout(reconnectTimer);
        if (!event.wasClean) {
          reconnectTimer = setTimeout(() => {
            console.log("Tentativo di riconnessione...");
            RealBlueiotClient.connect(serverIp, serverPort);
          }, 5000);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);

        // Notify listeners
        listeners.error.forEach((callback) => {
          if (typeof callback === "function") {
            callback(error);
          }
        });
      };
    } catch (error) {
      console.error("Error connecting to WebSocket:", error);
    }
  },

  authenticate: () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("Cannot authenticate: socket not open");
      return;
    }

    const username = env.REACT_APP_BLUEIOT_USERNAME || "admin";
    const password = env.REACT_APP_BLUEIOT_PASSWORD || "#BlueIOT";
    const salt =
      env.REACT_APP_BLUEIOT_SALT || "abcdefghijklmnopqrstuvwxyz20191107salt";

    console.log(`Authenticating with username: ${username}`);

    // Create MD5 hash with salt as described in the protocol
    const passwordMd5 = md5(password);
    const saltedMd5 = md5(passwordMd5 + salt);

    // Build authentication frame as described in protocol
    const frameHeader = new Uint8Array([0xcc, 0x5f]);
    const frameType = new Uint8Array([0x27]);

    // Create username fields
    const usernameBytes = new TextEncoder().encode(username);
    const usernameLengthBytes = new Uint8Array(4);
    const usernameLength = usernameBytes.length;
    usernameLengthBytes[0] = (usernameLength >> 24) & 0xff;
    usernameLengthBytes[1] = (usernameLength >> 16) & 0xff;
    usernameLengthBytes[2] = (usernameLength >> 8) & 0xff;
    usernameLengthBytes[3] = usernameLength & 0xff;

    // Create password fields
    const passwordBytes = new TextEncoder().encode(saltedMd5);
    const passwordLengthBytes = new Uint8Array(4);
    const passwordLength = passwordBytes.length;
    passwordLengthBytes[0] = (passwordLength >> 24) & 0xff;
    passwordLengthBytes[1] = (passwordLength >> 16) & 0xff;
    passwordLengthBytes[2] = (passwordLength >> 8) & 0xff;
    passwordLengthBytes[3] = passwordLength & 0xff;

    // Calculate CRC16
    const dataForCrc = new Uint8Array([
      ...frameType,
      ...usernameLengthBytes,
      ...usernameBytes,
      ...passwordLengthBytes,
      ...passwordBytes,
    ]);
    const crc = RealBlueiotClient.calculateCrc16(dataForCrc);
    const crcBytes = new Uint8Array(2);
    crcBytes[0] = (crc >> 8) & 0xff;
    crcBytes[1] = crc & 0xff;

    // Frame tail
    const frameTail = new Uint8Array([0xaa, 0xbb]);

    // Build complete frame
    const authFrame = new Uint8Array([
      ...frameHeader,
      ...frameType,
      ...usernameLengthBytes,
      ...usernameBytes,
      ...passwordLengthBytes,
      ...passwordBytes,
      ...crcBytes,
      ...frameTail,
    ]);

    // Send authentication frame
    socket.send(authFrame);
    console.log("Richiesta di autenticazione inviata");
  },

  processData: (buffer) => {
    if (buffer.length < 4) return; // Not enough data

    // Check frame header
    if (buffer[0] === 0xcc && buffer[1] === 0x5f) {
      const frameType = buffer[2];

      // Process based on frame type
      switch (frameType) {
        case 0x81: // Tag position
          RealBlueiotClient.parseTagPosition(buffer);
          break;
        case 0x85: // Battery info
          RealBlueiotClient.parseBatteryInfo(buffer);
          break;
        case 0x89: // Alarm info
          RealBlueiotClient.parseAlarmInfo(buffer);
          break;
        case 0x88: // Extended data (heart rate)
          RealBlueiotClient.parseExtendedData(buffer);
          break;
        case 0xa1: // Regional statistics
          RealBlueiotClient.parseRegionalStats(buffer);
          break;
        case 0x87: // Anchor status
          RealBlueiotClient.parseAnchorStatus(buffer);
          break;
        case 0xb1: // Tag quantity statistics
          RealBlueiotClient.parseTagStats(buffer);
          break;
        case 0xb3: // Regional access info
          RealBlueiotClient.parseAreaAccessInfo(buffer);
          break;
        default:
          console.log(`Received frame type ${frameType.toString(16)}`);
      }
    }
  },

  parseTagPosition: (buffer) => {
    // Parse per the protocol (frame type 0x81)
    const numTags = buffer[3];

    for (let i = 0; i < numTags; i++) {
      const offset = 4 + i * 27;

      // Extract tag ID (8 bytes)
      const tagId = Array.from(buffer.slice(offset, offset + 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Extract coordinates (in cm, convert to m)
      const x =
        ((buffer[offset + 8] << 24) |
          (buffer[offset + 9] << 16) |
          (buffer[offset + 10] << 8) |
          buffer[offset + 11]) /
        100;

      const y =
        ((buffer[offset + 12] << 24) |
          (buffer[offset + 13] << 16) |
          (buffer[offset + 14] << 8) |
          buffer[offset + 15]) /
        100;

      const z = ((buffer[offset + 16] << 8) | buffer[offset + 17]) / 100;

      // Extract map ID
      const regid = buffer[offset + 18];

      // Battery power
      const cap = buffer[offset + 19];

      // Sleep/charging status
      const sleepCharge = buffer[offset + 20];
      const sleep = (sleepCharge >> 4) & 0x0f;
      const bcharge = sleepCharge & 0x0f;

      // Timestamp
      const timestamp =
        (buffer[offset + 21] << 24) |
        (buffer[offset + 22] << 16) |
        (buffer[offset + 23] << 8) |
        buffer[offset + 24];

      // Floor number and location indicator
      const floorNumber = buffer[offset + 25];
      const locIndicator = buffer[offset + 26];

      const tagPosition = {
        id: tagId,
        x,
        y,
        z,
        regid: regid.toString(),
        cap,
        sleep,
        bcharge,
        timestamp,
        floorNumber,
        locIndicator,
      };

      // Notify all listeners
      listeners.tagPosition.forEach((callback) => {
        if (typeof callback === "function") {
          callback(tagPosition);
        }
      });
    }
  },

  parseBatteryInfo: (buffer) => {
    // Implement parsing for battery info (frame type 0x85)
    const numTags = buffer[3];

    for (let i = 0; i < numTags; i++) {
      const offset = 4 + i * 10;

      // Extract tag ID (8 bytes)
      const tagId = Array.from(buffer.slice(offset, offset + 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Power state and charging state
      const cap = buffer[offset + 8];
      const bcharge = buffer[offset + 9];

      const batteryInfo = {
        tagid: tagId,
        cap,
        bcharge,
      };

      // Notify all listeners
      listeners.batteryInfo.forEach((callback) => {
        if (typeof callback === "function") {
          callback(batteryInfo);
        }
      });
    }
  },

  parseAlarmInfo: (buffer) => {
    // Basic parsing - would need to be expanded based on protocol
    const alarmType = buffer[3];

    // Extract tag ID (8 bytes)
    const tagId = Array.from(buffer.slice(4, 12))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Alarm time
    const timestamp =
      (buffer[12] << 56) |
      (buffer[13] << 48) |
      (buffer[14] << 40) |
      (buffer[15] << 32) |
      (buffer[16] << 24) |
      (buffer[17] << 16) |
      (buffer[18] << 8) |
      buffer[19];

    // Extract fence ID if it's a fence alarm
    let fenceId = "";
    let fenceName = "";
    let x = 0;
    let y = 0;

    if (alarmType === 1) {
      // Fence alarm
      fenceId = Array.from(buffer.slice(20, 28))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      x =
        ((buffer[28] << 24) |
          (buffer[29] << 16) |
          (buffer[30] << 8) |
          buffer[31]) /
        100;

      y =
        ((buffer[32] << 24) |
          (buffer[33] << 16) |
          (buffer[34] << 8) |
          buffer[35]) /
        100;

      // The fence name is a fixed length string
      const nameBytes = buffer.slice(36, 36 + 34);
      fenceName = new TextDecoder("gb2312").decode(nameBytes).trim();
    }

    const alarmInfo = {
      type: alarmType,
      related_tagid: tagId,
      timestamp,
      self_xpos: x,
      self_ypos: y,
      fence_id: fenceId,
      fence_name: fenceName,
      id: timestamp.toString() + tagId,
      content: "",
    };

    // Notify all listeners
    listeners.alarm.forEach((callback) => {
      if (typeof callback === "function") {
        callback(alarmInfo);
      }
    });
  },

  parseExtendedData: (buffer) => {
    // Extract tag ID (8 bytes)
    const tagId = Array.from(buffer.slice(3, 11))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Data length
    const dataLength = (buffer[11] << 8) | buffer[12];

    // Check if it's heart rate data
    if (dataLength > 0 && buffer[13] === 0xd5) {
      const heartRate = buffer[14];
      const timestamp =
        (buffer[15] << 56) |
        (buffer[16] << 48) |
        (buffer[17] << 40) |
        (buffer[18] << 32) |
        (buffer[19] << 24) |
        (buffer[20] << 16) |
        (buffer[21] << 8) |
        buffer[22];

      const heartInfo = {
        tag_id: tagId,
        type: 213, // 0xD5
        value: heartRate,
        updatetimestamp: timestamp,
      };

      // Notify all listeners
      listeners.heartInfo.forEach((callback) => {
        if (typeof callback === "function") {
          callback(heartInfo);
        }
      });
    }
  },

  parseRegionalStats: (buffer) => {
    console.log("Received regional statistics data");
    // TODO: Implement full parsing for regional statistics
  },

  parseAnchorStatus: (buffer) => {
    // Parse anchor status (frame type 0x87)
    const numAnchors = buffer[3];

    for (let i = 0; i < numAnchors; i++) {
      const offset = 4 + i * 16;

      // Extract anchor ID (4 bytes)
      const anchorId =
        (buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3];

      // Anchor state
      const state = buffer[offset + 4];

      // Coordinates (in cm, convert to m)
      const x =
        ((buffer[offset + 5] << 24) |
          (buffer[offset + 6] << 16) |
          (buffer[offset + 7] << 8) |
          buffer[offset + 8]) /
        100;

      const y =
        ((buffer[offset + 9] << 24) |
          (buffer[offset + 10] << 16) |
          (buffer[offset + 11] << 8) |
          buffer[offset + 12]) /
        100;

      const z = ((buffer[offset + 13] << 8) | buffer[offset + 14]) / 100;

      // Map layer ID
      const regid = buffer[offset + 15];

      const anchorStatus = {
        id: anchorId.toString(),
        state,
        x,
        y,
        z,
        regid: regid.toString(),
      };

      // Notify all listeners
      listeners.baseStData.forEach((callback) => {
        if (typeof callback === "function") {
          callback(anchorStatus);
        }
      });
    }
  },

  parseTagStats: (buffer) => {
    console.log("Received tag statistics data");
    // TODO: Implement full parsing for tag statistics
  },

  parseAreaAccessInfo: (buffer) => {
    console.log("Received area access info");
    // TODO: Implement full parsing for area access information
  },

  processJsonData: (jsonData) => {
    if (jsonData.localsense_video_response) {
      // Notify all listeners
      listeners.videoChange.forEach((callback) => {
        if (typeof callback === "function") {
          callback(jsonData.localsense_video_response);
        }
      });
    }

    // Add other JSON message handlers here
  },

  on: (event, callback) => {
    if (!listeners[event]) {
      listeners[event] = [];
    }
    listeners[event].push(callback);
  },

  off: (event, callback) => {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter((cb) => cb !== callback);
    }
  },

  clearListeners: () => {
    // Reset all listener arrays
    Object.keys(listeners).forEach((key) => {
      listeners[key] = [];
    });
  },

  sendTagSubscription: (tagIds) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("Cannot send subscription: socket not open");
      return;
    }

    if (!tagIds || tagIds.length === 0) return;

    // Convert tag IDs to array if it's a string with colon-separated values
    const tagIdArray =
      typeof tagIds === "string"
        ? tagIds.split(":")
        : Array.isArray(tagIds)
        ? tagIds
        : [tagIds];

    const frameHeader = new Uint8Array([0xcc, 0x5f]);
    const frameType = new Uint8Array([0xa9]);
    const subType = new Uint8Array([0x00, 0x00]); // tag set

    // Number of subscription identifiers
    const numIds = tagIdArray.length;
    const numIdsBytes = new Uint8Array([(numIds >> 8) & 0xff, numIds & 0xff]);

    // Build subscription identifiers
    let subscriptionData = [];
    for (const tagId of tagIdArray) {
      // Convert tag ID to 8-byte array
      const tagIdNum = parseInt(tagId, 10);
      subscriptionData.push(
        (tagIdNum >> 56) & 0xff,
        (tagIdNum >> 48) & 0xff,
        (tagIdNum >> 40) & 0xff,
        (tagIdNum >> 32) & 0xff,
        (tagIdNum >> 24) & 0xff,
        (tagIdNum >> 16) & 0xff,
        (tagIdNum >> 8) & 0xff,
        tagIdNum & 0xff
      );
    }

    // Build data for CRC
    const dataForCrc = new Uint8Array([
      ...frameType,
      ...subType,
      ...numIdsBytes,
      ...subscriptionData,
    ]);

    // Calculate CRC16
    const crc = RealBlueiotClient.calculateCrc16(dataForCrc);
    const crcBytes = new Uint8Array([(crc >> 8) & 0xff, crc & 0xff]);

    // Frame tail
    const frameTail = new Uint8Array([0xaa, 0xbb]);

    // Build complete frame
    const subFrame = new Uint8Array([
      ...frameHeader,
      ...frameType,
      ...subType,
      ...numIdsBytes,
      ...subscriptionData,
      ...crcBytes,
      ...frameTail,
    ]);

    // Send frame
    socket.send(subFrame);
    console.log(`Sottoscrizione inviata per ${numIds} tag`);
  },

  sendTagVibrate: (tagId, action = "enable") => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("Cannot send vibrate command: socket not open");
      return;
    }

    // Create the JSON control message
    const controlMsg = {
      localsense_conf_request: {
        conf_type: "tagvibrateandshake",
        conf_value: action, // enable or disable
        tagid: tagId,
      },
    };

    // Send the JSON message
    socket.send(JSON.stringify(controlMsg));
    console.log(`Comando vibrazione inviato al tag ${tagId}`);
  },

  sendVideoTrackRequest: (tagId) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("Cannot send video track request: socket not open");
      return;
    }

    // Create the JSON video request message
    const videoMsg = {
      localsense_video_request: {
        tagid: tagId,
        track: "true",
      },
    };

    // Send the JSON message
    socket.send(JSON.stringify(videoMsg));
    console.log(`Richiesta di tracciamento video inviata per tag ${tagId}`);
  },

  setPosOutType: (posType) => {
    // Store the position output type preference
    RealBlueiotClient.posOutType = posType;
  },

  calculateCrc16: (bytes) => {
    // CRC-16/MODBUS implementation
    let crc = 0xffff;
    const polynomial = 0xa001;

    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x0001) !== 0) {
          crc >>= 1;
          crc ^= polynomial;
        } else {
          crc >>= 1;
        }
      }
    }

    return crc;
  },

  disconnect: () => {
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.close();
      socket = null;
    }

    // Clear all listeners
    RealBlueiotClient.clearListeners();
  },
};

// Add default position output type
RealBlueiotClient.posOutType = "XY";
