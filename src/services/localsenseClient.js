/* Wrapper BlueIOT */
import { setRollcallMap, canonicalizeId } from './tagCanonicalizer';
const WS_URL = process.env.REACT_APP_BLUEIOT_WS_URL || "ws://192.168.1.11:48300";
const USER = process.env.REACT_APP_BLUEIOT_USERNAME || "admin";
// Default to vendor's documented password if env is missing, to avoid silent auth failures
const PASS = process.env.REACT_APP_BLUEIOT_PASSWORD || "#BlueIOT";
const SALT = process.env.REACT_APP_BLUEIOT_SALT || "abcdefghijklmnopqrstuvwxyz20191107salt"; // vuoto = md5(password)
const FORCE_UNSALTED = String(process.env.REACT_APP_BLUEIOT_FORCE_UNSALTED || "false").toLowerCase() === 'true';
const AUTO_OPEN_CONTROL = String(process.env.REACT_APP_BLUEIOT_OPEN_CONTROL || "false").toLowerCase() === 'true';
const BASIC_SUBPROTO = process.env.REACT_APP_BLUEIOT_BASIC_SUBPROTO || 'localSensePush-protocol'; // 'none' to disable
const RWS_DEBUG = String(process.env.REACT_APP_BLUEIOT_DEBUG_RWS || "false").toLowerCase() === 'true';
const DISABLE_AUTOMODE = String(process.env.REACT_APP_BLUEIOT_DISABLE_AUTOMODE || "false").toLowerCase() === 'true';
// Parsing tuning
const POS_ENDIAN = (process.env.REACT_APP_BLUEIOT_POS_ENDIAN || 'auto').toLowerCase(); // 'auto' | 'be' | 'le'
const POS_DIV = Number(process.env.REACT_APP_BLUEIOT_POS_DIV || 100); // scale divisor for x,y,z (e.g., 100=cm->m, 1000=mm->m)

let loadPromise = null;
let LS = null;
let eventsBound = false;
let openCount = 0;
let sdkOpenSockets = 0; // conteggio canali aperti via callbacks SDK
let frameCounters = { bin: 0, txt: 0 };
let lastOpenTs = 0;
let lastCloseCode = null;
let consecutive1006 = 0;
let runtimeForceUnsalted = FORCE_UNSALTED;
let runtimeBasicProto = BASIC_SUBPROTO;
let autoModeSwitches = 0;
let lastModeSwitchAt = 0;
// (throttle auth frame emission variable removed)
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 8;
let positionsEverReceived = false;
let firstPositionAt = null;
let firstErrorAt = null;
let lastSwitchResult = null;
let controlSwitchAttempts = 0;
// Frame type distribution (binary) collected from SDK console warnings
const frameTypeCounts = {}; // key = hex type string e.g. '0x01'
// Runtime filters toggle and diagnostics
let runtimeFiltersEnabled = false; // di default DISATTIVI per evitare falsi positivi che nascondono i tag
const SAFE_ABS_POS = Number(process.env.REACT_APP_POS_SAFE_ABS || 20000); // metri; soglia hard contro valori implausibili
let posDiag = {
  jsonFrames: 0,
  binFrames: 0,
  accepted: 0,
  droppedTooBig: 0,
  droppedNaN: 0,
  lastSample: null,
  lastFlags: null, // { isGlobal, isGeo }
};
let currentPosOutType = "XY";
// Track already logged variant mismatches to avoid console spam
const seenIdVariantPairs = new Set();

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const already = Array.from(document.getElementsByTagName("script")).some(s => s.src.endsWith(src));
    if (already) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

async function ensureLoaded() {
  if (LS) return LS;
  if (!loadPromise) {
    loadPromise = (async () => {
      await loadScriptOnce("/blueiot/jquery.js");
      await loadScriptOnce("/blueiot/reconnecting-websocket.js");
      await loadScriptOnce("/blueiot/md5.min.js");
      await loadScriptOnce("/blueiot/localsense_websocket_api.js");
      const root = (window.LOCALSENSE || window.localsense || {});
  const api = root.WEBSOCKET_API || root.websocket_api || root.WebsocketApi;
      if (!api) throw new Error("LOCALSENSE.WEBSOCKET_API non disponibile dopo il load");
      try {
        if (window.ReconnectingWebSocket) {
          window.ReconnectingWebSocket.debugAll = !!RWS_DEBUG;
          if (RWS_DEBUG) console.warn('[BlueIot][DBG] ReconnectingWebSocket global debug attivato');
        }
      } catch(e) {}
  try { window.BLUEIOT_BASIC_SUBPROTO = runtimeBasicProto; console.warn('[BlueIot][DBG] BASIC_SUBPROTO =', runtimeBasicProto); } catch(e) {}
      console.log("[BlueIot] API caricata. Funzioni:", {
        RequireBasicInfo: typeof api.RequireBasicInfo,
        RequireExtraInfo: typeof api.RequireExtraInfo,
        RequireControlInfo: typeof api.RequireControlInfo,
        SetAccount: typeof api.SetAccount,
        setPosOutType: typeof api.setPosOutType,
        setTag64CheckedFlag: typeof api.setTag64CheckedFlag,
      });
      return api;
    })();
  }
  LS = await loadPromise;
  return LS;
}

const listeners = { position: [], battery: [], open: [], close: [], error: [], vibrate: [] };
let lastOpenAt = 0;
// Lightweight in-memory event buffer for diagnostics (accessible from console via window.__BLUEIOT_EVENT_LOG)
const __EVENT_LOG = (() => { try { if (typeof window !== 'undefined') { window.__BLUEIOT_EVENT_LOG = window.__BLUEIOT_EVENT_LOG || []; return window.__BLUEIOT_EVENT_LOG; } return []; } catch (_) { return []; } })();
function pushEvent(type, data) {
  try {
    __EVENT_LOG.push({ t: Date.now(), type, data });
    if (__EVENT_LOG.length > 500) __EVENT_LOG.shift();
  } catch (_) {}
}
const LOG_THROTTLE_MS = 300;
let __lastLog = 0;
function dbg(...args) {
  try {
    const now = Date.now();
    if (now - __lastLog > LOG_THROTTLE_MS) {
      // Keep these as debug-level to avoid polluting normal console, but they will show when the user wants
      console.debug('[BlueIot]', ...args);
      __lastLog = now;
    }
    __EVENT_LOG.push({ t: Date.now(), type: 'dbg', msg: args });
    if (__EVENT_LOG.length > 500) __EVENT_LOG.shift();
  } catch (_) {}
}
function emit(event, payload) {
  (listeners[event] || []).forEach(cb => { try { cb(payload); } catch (e) {} });
  try {
    // Simple payload summary to keep event log small
    const summary = (payload && typeof payload === 'object') ? (Array.isArray(payload) ? { len: payload.length } : { keys: Object.keys(payload).length }) : { type: typeof payload };
    pushEvent('emit', { event, summary });
  } catch (_) {}
}
export function on(event, cb) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(cb);
}
export function off(event, cb) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(fn => fn !== cb);
}

function parseWsUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return { host: u.hostname, port: u.port || "48300", hostPort: `${u.hostname}:${u.port || "48300"}` };
  } catch {
    const s = String(urlStr).replace(/^wss?:\/\//i, "");
    const m = s.match(/^([^:/]+):?(\d+)?/);
    return { host: m?.[1] || "127.0.0.1", port: m?.[2] || "48300", hostPort: `${m?.[1]}:${m?.[2] || "48300"}` };
  }
}

function bindGlobalRwsEventsOnce() {
  if (eventsBound) return;
  eventsBound = true;
  window.addEventListener("blueiot:rws-open", () => {
    const prev = openCount;
    openCount += 1;
    lastOpenTs = Date.now();
    if (prev === 0 && openCount > 0) emit("open");
  });
  window.addEventListener("blueiot:rws-close", () => {
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) {
      const gap = Date.now() - lastOpenTs;
      console.warn(`[BlueIot] WS closed after ${gap} ms. frames(bin=${frameCounters.bin}, txt=${frameCounters.txt}) lastCode=${lastCloseCode}`);
      if (lastCloseCode === 1006) {
        consecutive1006 += 1;
        if (consecutive1006 >= 3) console.error("[BlueIot] 1006 repeated >=3. Possible protocol/subprotocol/auth mismatch.");
      } else {
        consecutive1006 = 0;
      }
    }
    if (openCount === 0) emit("close");
  });
  window.addEventListener("blueiot:rws-error", (e) => emit("error", e?.detail));
}

export const LocalsenseClient = {
  on,
  off,
  // Allow external code to seed a rollcall -> variants mapping (helps canonicalization)
  setRollcallMapping: (m) => { try { setRollcallMap(m); } catch(_) {} },
  async connect() {
    try {
      const api = await ensureLoaded();
      bindGlobalRwsEventsOnce();

  const { hostPort } = parseWsUrl(WS_URL);
  const effectiveSalt = runtimeForceUnsalted ? "" : SALT;
  // Always set credentials so we don't accidentally reuse wrong state
  api.SetAccount?.(USER, PASS, effectiveSalt);
  // La maggior parte delle installazioni usa tagid a 32-bit sui frame XY: mantieni 32-bit per allineare il parsing
  // Allow enabling 64-bit tag IDs via env (default true for better name alignment)
  const TAG64_ENABLE = String(process.env.REACT_APP_BLUEIOT_TAG64_ENABLE || 'true').toLowerCase() === 'true';
  try { api.setTag64CheckedFlag?.(!!TAG64_ENABLE); } catch {}
  try { api.setTag64Show?.(false); } catch {}

      // Diagnostic accessor for quick inspection from console
      try {
        if (typeof window !== 'undefined') {
          window.getBlueIotDiag = () => ({ posDiag, positionsEverReceived, frameCounters, lastJsonScaleRefLocal, latestBaseDiv, runtimeFiltersEnabled });
        }
      } catch (_) {}

      let lastJsonTs = 0;
      const handlePosJson = (posMap) => {
        // Alcune build della SDK inviano TAG_POS come stringa JSON o Blob: normalizza qui
        if (typeof posMap === 'string') {
          try {
            const obj = JSON.parse(posMap);
            return handlePosJson(obj);
          } catch (e) {
            console.warn('[BlueIot] TAG_POS string parse failed:', e?.message);
            return;
          }
        }
        if (posMap && typeof Blob !== 'undefined' && posMap instanceof Blob) {
          try {
            // Prima prova: potrebbe essere un frame BIN (header 0xCC 0x5F)
            posMap.arrayBuffer().then(buf => {
              try {
                const u8 = new Uint8Array(buf);
                if (u8.length >= 2 && u8[0] === 0xCC && u8[1] === 0x5F) {
                  // Trattalo come BIN
                  handlePosBin(buf);
                  return;
                }
                // Altrimenti prova come JSON testuale
                const txt = new TextDecoder('utf-8', { fatal: false }).decode(u8);
                try {
                  const obj = JSON.parse(txt);
                  handlePosJson(obj);
                } catch (e2) {
                  console.warn('[BlueIot] TAG_POS blob JSON parse failed:', e2?.message);
                }
              } catch(ei) {
                console.warn('[BlueIot] TAG_POS blob decode error:', ei?.message);
              }
            }).catch(err => console.warn('[BlueIot] TAG_POS blob read failed:', err?.message));
          } catch (e) {
            console.warn('[BlueIot] TAG_POS blob handling error:', e?.message);
          }
          return; // asynchronous re-entry
        }
        // Debug capture (bounded <=50) of raw TAG_POS frames
        try {
          window.__BLUEIOT_RAW_FRAMES = window.__BLUEIOT_RAW_FRAMES || { TAG_POS: [], PERSON_INFO: [], ROLLCALL_DATA: [] };
          const __buf = window.__BLUEIOT_RAW_FRAMES.TAG_POS; __buf.push(posMap); if (__buf.length > 50) __buf.shift();
        } catch(_) {}
        try { pushEvent('rawTAG_POS', { ts: Date.now(), sample: (posMap && Object.keys(posMap || {}).length) || 0 }); } catch(_) {}
        posDiag.jsonFrames += 1;
  const SAFE_ABS = SAFE_ABS_POS; // metri: scarta coordinate implausibili
  const perPosNameMap = {}; // raccoglie eventuali nomi per-tag presenti dentro ogni entry
  const arr = Object.entries(posMap || {}).map(([key, p]) => {
          // Le coordinate JSON della SDK risultano già in metri (es. 0.27, 6.11)
          const xRaw = Number(p.x ?? 0);
          const yRaw = Number(p.y ?? 0);
          const zRaw = Number(p.z ?? 0);
          if (!isFinite(xRaw) || !isFinite(yRaw)) {
            posDiag.droppedNaN += 1;
            return null; // scarta non numerici
          }
          // Se stiamo lavorando in XY e il frame è GEO/GLOBAL, ignora per evitare unità errate in mappa
          const isGlobal = !!p.isGlobalGraphicCoord;
          const isGeo = !!p.isGeoGraphicCoord;
          if (currentPosOutType === 'XY' && (isGlobal || isGeo)) {
            // accetta solo XY puro in modo XY
            return null;
          }
          if (runtimeFiltersEnabled && (Math.abs(xRaw) > SAFE_ABS || Math.abs(yRaw) > SAFE_ABS)) {
            posDiag.droppedTooBig += 1;
            return null; // filtra outlier hard
          }
          // ID handling: keep primary id as string (often 32-bit decimal), carry optional hex for 64-bit safety
          let idPrimary = String(p.id ?? p.tagid ?? "");
          const rawHex = p.tag_id_hex || p.tag_hex || p.mac || p.macaddr || null;
          let idHex = rawHex ? String(rawHex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : undefined;
          // Fallback: if primary id already looks hex, use it as idHex too
          if (!idHex && /^[0-9A-Fa-f]+$/.test(idPrimary)) {
            idHex = idPrimary.toUpperCase();
          }
          // Preserve key as hex id if it looks like one (when payload is a map keyed by hex tag id)
          if (!idHex && typeof key === 'string' && /^[0-9A-Fa-f]{6,}$/.test(key)) {
            idHex = key.toUpperCase();
          }
          // If primary id missing/short and we have a hex key, derive a stable low32 decimal for UI/back-compat
          if ((!idPrimary || idPrimary === '0') && idHex && idHex.length >= 8) {
            try { idPrimary = String(parseInt(idHex.slice(-8), 16)); } catch(_) {}
          }
          // If idHex still missing but idPrimary is numeric, compute low32 hex (8 chars) to improve matching downstream
          if (!idHex) {
            const n = Number(idPrimary);
            if (!Number.isNaN(n)) {
              try { idHex = (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); } catch(_) {}
            }
          }
          // If this entry carries a candidate name (per-tag), collect it for emission
          try {
            const candName = p.tag_name || p.name || p.alias || p.tagAlias;
            if (typeof candName === 'string' && candName.trim()) {
              // Prefer hex when available; fallback to primary id
              const keyId = idHex || idPrimary;
              if (keyId) addNameForIdVariants(perPosNameMap, keyId, candName);
            }
          } catch(_) {}
          return ({
            id: idPrimary,
            idHex,
            x: xRaw,
            y: yRaw,
            z: zRaw,
            cap: p.cap,
            regid: p.regid,
            ts: Date.now(),
            isGlobal,
            isGeo,
            src: 'json'
          });
        }).filter(Boolean);
        if (arr.length) {
          // Per-frame consistency check: confronta id decimale con idHex/low32
          try {
            arr.forEach(p => {
              try {
                const pid = String(p.id ?? '');
                const hx = p.idHex ? String(p.idHex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null;
                if (hx && hx.length >= 8) {
                  const low32 = String(parseInt(hx.slice(-8), 16) >>> 0);
                  if (pid && pid !== low32) {
                    const key = pid + '|' + low32;
                    if (!seenIdVariantPairs.has(key)) {
                      seenIdVariantPairs.add(key);
                      pushEvent('idVariantMismatch', { src: 'json', id: pid, idHex: hx, low32, sample: p });
                      dbg('[BlueIot][CHECK] id mismatch json:', pid, 'vs low32(hex)', low32);
                    }
                  }
                }
              } catch(_) {}
            });
          } catch(_) {}
          // Canonicalize IDs so downstream consumers see a single stable ID form
          try {
            arr.forEach(p => {
              try {
                // Stable strategy: always use low32 decimal if hex present, else raw decimal.
                let baseId;
                const hx = p.idHex ? String(p.idHex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null;
                if (hx && hx.length >= 8) {
                  baseId = String(parseInt(hx.slice(-8), 16) >>> 0);
                } else {
                  baseId = String(p.id);
                }
                const canon = canonicalizeId(baseId);
                if (canon) {
                  p.idRaw = String(p.id);
                  p.id = String(canon);
                } else {
                  p.id = baseId;
                }
              } catch(_) { /* ignore per-entry */ }
            });
          } catch(_) {}
          try { if (typeof window !== 'undefined' && window.__BLUEIOT_VERBOSE) console.log('[BlueIot] Positions received:', arr.length, 'sample:', arr[0]); } catch(_) {}
          // Sanitize positions: drop entries with non-finite or extreme coordinates to avoid breaking the viewer camera
          try {
            const SAFE_ABS = 1e5; // coordinates above this magnitude are considered invalid
            const before = arr.length;
            const filteredArr = arr.filter(p => {
              const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= SAFE_ABS && Math.abs(p.y) <= SAFE_ABS;
              if (!ok) {
                posDiag.droppedInvalid = (posDiag.droppedInvalid || 0) + 1;
                try { pushEvent('positionDroppedInvalid', { sample: p }); } catch(_) {}
              }
              return ok;
            });
            if (filteredArr.length !== before) console.warn('[BlueIot] Some positions dropped for being invalid or too large', before - filteredArr.length);
            // diagnostica magnitudine media (per confronto con BIN)
            try {
              const avgMag = filteredArr.reduce((acc,p)=>acc+Math.hypot(p.x,p.y),0)/(filteredArr.length||1);
              window.__BLUEIOT_SCALE_DIAG = window.__BLUEIOT_SCALE_DIAG || {};
              window.__BLUEIOT_SCALE_DIAG.json = { lastJsonScaleRef: avgMag };
              window.__BLUEIOT_LAST_JSON_MAG = avgMag;
            } catch(_) {}
            emit("position", filteredArr);
            try { pushEvent('positionEmitted', { count: filteredArr.length, sample: filteredArr[0] }); } catch(_) {}
            posDiag.accepted += filteredArr.length;
            posDiag.lastSample = filteredArr[0];
            // salva ultime flag di coordinata per diagnostica
            try { posDiag.lastFlags = { isGlobal: !!filteredArr[0]?.isGlobal, isGeo: !!filteredArr[0]?.isGeo }; } catch {}
            positionsEverReceived = true;
            if (!firstPositionAt) firstPositionAt = Date.now();
            lastJsonTs = Date.now();
          } catch(_) {}
        }
        // Emit per-entry names if discovered (canonicalize keys)
        try {
          if (Object.keys(perPosNameMap).length) {
            const canonMap = {};
            Object.entries(perPosNameMap).forEach(([k, v]) => {
              try { const c = canonicalizeId(k); canonMap[c] = canonMap[c] || v; } catch(_) { canonMap[k] = canonMap[k] || v; }
            });
            emit('tagNames', canonMap);
          }
        } catch(_) {}
        // Se il payload JSON contiene anche una mappa di nomi (es. tag_name: { "33109": "Mario" }) propaga subito i nomi
        // Normalizza le chiavi: genera varianti (hex normalizzato senza separatori, low32 dec) per allineare ai formati degli ID in posizione
        try {
          const tn = posMap && posMap.tag_name;
          if (tn && typeof tn === 'object' && !Array.isArray(tn)) {
            const map = {};
            Object.entries(tn).forEach(([k, v]) => {
              if (typeof v === 'string' && v.trim()) {
                // Usa lo stesso normalizzatore usato altrove per creare tutte le varianti utili (dec, HEX normalizzato, low32)
                try { addNameForIdVariants(map, k, v); } catch(_) { /* fallback grezzo se qualcosa va storto */ map[String(k)] = v.trim(); }
              }
            });
            if (Object.keys(map).length) {
              // canonicalize keys
              const canonMap = {};
              Object.entries(map).forEach(([k,v]) => {
                try { const c = canonicalizeId(k); canonMap[c] = canonMap[c] || v; } catch(_) { canonMap[k] = canonMap[k] || v; }
              });
              try { pushEvent('tagNames', { count: Object.keys(canonMap).length }); } catch(_) {}
              emit('tagNames', canonMap);
            }
          }
        } catch(_) {}
        // Heuristica: se stiamo scartando solo per 'tooBig' e non abbiamo ancora accettato nulla, spegni automaticamente i filtri
        if (runtimeFiltersEnabled && posDiag.accepted === 0 && posDiag.droppedTooBig >= 10) {
          runtimeFiltersEnabled = false;
          console.warn('[BlueIot][Auto] Filtri disattivati automaticamente: molte letture scartate per soglia SAFE_ABS=', SAFE_ABS);
        }
      };
      // Helper: produce multiple ID variants for mapping (decimal, hex, low32-from-hex)
      const collectIdVariants = (obj) => {
          const out = [];
          const add = (v) => { if (v !== null && typeof v !== 'undefined') out.push(String(v)); };
          // Common numeric/string fields
          add(obj?.tag_id); add(obj?.id); add(obj?.tagid); add(obj?.tagid32); add(obj?.tag_id_32);
          // Hex-like fields (strip separators) or explicit hex sources
          const hexCand = (obj && (obj.tag_id_hex || obj.tag_id || obj.tagid_hex || obj.mac || obj.macaddr));
          if (hexCand && typeof hexCand === 'string') {
            const norm = hexCand.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
            if (norm) out.push(norm);
            if (norm.length >= 8) {
              const low = norm.slice(-8);
              try { out.push(String(parseInt(low, 16))); } catch(_) {}
            }
          }
          // Derive hex (low32) variant for purely numeric IDs so UI/idHex matching works even if SDK only emits decimal
          try {
            out.filter(v => /^[0-9]+$/.test(v)).forEach(nStr => {
              const n = Number(nStr);
              if (Number.isFinite(n)) {
                const hex = (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
                if (!out.includes(hex)) out.push(hex);
              }
            });
          } catch(_) {}
          return Array.from(new Set(out.filter(Boolean)));
      };
      // Helper: add name for all ID variants derived from a single id string (dec or hex)
      const addNameForIdVariants = (acc, idStr, name) => {
        try {
          if (!idStr || !name) return;
          const s = String(idStr);
          const obj = {};
          // Ambiguità: stringhe solo numeriche (anche molto lunghe) vanno trattate come decimali, non come hex.
          // Considera "hex-like" solo se contiene lettere A-F/a-f, separatori (: -) o prefisso 0x.
          const hasHexLetter = /[A-Fa-f]/.test(s);
          const hasSepOrPrefix = s.includes(':') || s.includes('-') || s.startsWith('0x') || s.startsWith('0X');
          if (hasHexLetter || hasSepOrPrefix) obj.tag_id_hex = s; else obj.id = s;
          const vars = collectIdVariants(obj) || [];
          const nm = cleanTagName(String(name));
          if (!nm) return;
          vars.forEach(v => { acc[v] = nm; });
        } catch(_) {}
      };
      // Generic deep extractor for names attached to tag IDs in arbitrary payloads
      const extractNamesDeep = (node, acc) => {
        try {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) { node.forEach(n => extractNamesDeep(n, acc)); return; }
          // At this level, look for id fields and candidate name fields
          const variants = collectIdVariants(node);
          if (variants && variants.length) {
            // candidate name fields (vendor variants)
            const cand = node.tag_name || node.name || node.alias || node.tagAlias || node.tagName || node.tagname || node.nick || node.label || node.text;
            const nm = cleanTagName(cand || '');
            if (nm) variants.forEach(v => { acc[v] = nm; });
          }
          // Special-case: node.tag_name may be an object like { "33109": "Braccialetto Test n1" }
          if (node.tag_name && typeof node.tag_name === 'object' && !Array.isArray(node.tag_name)) {
            Object.entries(node.tag_name).forEach(([k, v]) => {
              if (typeof v === 'string') addNameForIdVariants(acc, k, v);
            });
          }
          // Generic map case: object whose keys look like IDs and values are strings
          // Safeguard: only if it has a small number of entries or majority of values are short strings
          const entries = Object.entries(node);
          if (entries.length > 0) {
            let stringCount = 0, idLikeCount = 0;
            for (let i=0;i<Math.min(entries.length, 10);i++) {
              const [k, v] = entries[i];
              const idLike = /^[0-9]+$/.test(k) || /^[0-9A-Fa-f]{6,}$/.test(k);
              if (idLike) idLikeCount++;
              if (typeof v === 'string' && v.length <= 128) stringCount++;
            }
            if (idLikeCount >= 2 && stringCount >= 2) {
              entries.forEach(([k, v]) => {
                if ((/^[0-9]+$/.test(k) || /^[0-9A-Fa-f]{6,}$/.test(k)) && typeof v === 'string') {
                  addNameForIdVariants(acc, k, v);
                }
              });
            }
          }
          // Recurse into known nested containers
          Object.keys(node).forEach(k => {
            const v = node[k];
            if (v && typeof v === 'object') extractNamesDeep(v, acc);
          });
        } catch(_) {}
      };
      const handlePersonInfo = (info) => {
        // Normalizza possibili formati (JSON string / Blob)
        if (typeof info === 'string') {
          try { return handlePersonInfo(JSON.parse(info)); } catch { /* fall through */ }
        }
        if (info && typeof Blob !== 'undefined' && info instanceof Blob) {
          try { info.text().then(t => { try { handlePersonInfo(JSON.parse(t)); } catch(e){} }); } catch(_) {}
          return;
        }
        // PERSON_INFO: map_infos -> { tags: [ { tag_id, tag_name? alias? } ] }
        try {
          const tagIds = [];
          const nameMap = {};
          // Conserva payload grezzo per ispezione da console
          try { window.__BLUEIOT_LAST_PERSON = info; } catch(_) {}
          // Debug capture (bounded <=50) of raw PERSON_INFO frames
          try {
            window.__BLUEIOT_RAW_FRAMES = window.__BLUEIOT_RAW_FRAMES || { TAG_POS: [], PERSON_INFO: [], ROLLCALL_DATA: [] };
            const __pbuf = window.__BLUEIOT_RAW_FRAMES.PERSON_INFO; __pbuf.push(info); if (__pbuf.length > 50) __pbuf.shift();
          } catch(_) {}
          // Nota: campi ID alternativi gestiti da collectIdVariants
          if (info && info.map_infos) {
            Object.values(info.map_infos).forEach(m => {
              (m.tags || []).forEach(t => {
                const variants = collectIdVariants(t);
                if (!variants.length) return;
                variants.forEach(v => tagIds.push(v));
                const candidate = t.tag_name || t.name || t.alias;
                if (candidate) {
                  const nm = cleanTagName(candidate);
                  if (nm) variants.forEach(v => { nameMap[v] = nm; });
                }
              });
            });
            // Auto subscription to maps if positions assenti e non ancora sottoscritto
            try {
              if (!positionsEverReceived && !LocalsenseClient._mapSubscribed) {
                const mapIds = Object.values(info.map_infos).map(mi => mi.map_id).filter(v => v !== null && v !== undefined);
                if (mapIds.length) LocalsenseClient._lastMapIds = Array.from(new Set(mapIds));
                if (mapIds.length) {
                  const unique = Array.from(new Set(mapIds));
                  if (window.BlueIot?.Send2WS_RssMapClicked) {
                    window.BlueIot.Send2WS_RssMapClicked(unique.join(':'));
                    LocalsenseClient._mapSubscribed = true;
                    console.log('[BlueIot][Auto] Map subscription sent for IDs:', unique);
                  }
                }
              }
            } catch(e) { console.warn('[BlueIot][Auto] map subscribe failed:', e?.message); }
          }
          // Deep fallback: scan entire object for id+name pairs
          extractNamesDeep(info, nameMap);
          // Esponi derivazioni per aiuto debug (tag -> varianti)
          try {
            const tagVariantPreview = {};
            if (info && info.map_infos) {
              Object.values(info.map_infos).forEach(m => {
                (m.tags || []).forEach(t => {
                  const vars = collectIdVariants(t);
                  if (vars && vars.length) tagVariantPreview[(t.tag_id||t.id||vars[0])] = vars;
                });
              });
            }
            window.__BLUEIOT_PERSON_TAGS = tagVariantPreview;
            console.log('[BlueIot][DBG] PERSON_INFO variants:', tagVariantPreview);
          } catch(_) {}
          // Emissioni
          if (tagIds.length) {
            const unique = [];
            const seen = new Set();
            for (let i=0;i<tagIds.length;i++) {
              const rawId = tagIds[i];
              try {
                const canon = canonicalizeId(rawId);
                if (!seen.has(canon)) { seen.add(canon); unique.push(canon); }
              } catch(_) {
                if (!seen.has(rawId)) { seen.add(rawId); unique.push(rawId); }
              }
            }
            emit('tagsOnline', { tagIds: unique, raw: info });
          }
          if (Object.keys(nameMap).length) {
            const canonNames = {};
            Object.entries(nameMap).forEach(([k,v]) => {
              try { const c = canonicalizeId(k); canonNames[c] = canonNames[c] || v; } catch(_) { canonNames[k] = canonNames[k] || v; }
            });
            emit('tagNames', canonNames);
          }
          // Emissione raw dedicata per ispezione UI se serve
          emit('personInfoRaw', info);
        } catch(e) {}
      };
      // --- Binary decoders for name-bearing frames (fallback when SDK doesn't parse to JSON) ---
      // Utility: read unsigned integer of N bytes big-endian
      const byteCalcBE = (arr, n, off) => {
        let v = 0; for (let i=0;i<n;i++) { v = (v << 8) + arr[off + i]; } return v >>> 0;
      };
      const readUtf16LEString = (arr, off, byteLen) => {
        // Protocol appears to store chars as 2 bytes little-endian (low, high)
        let s = '';
        for (let i=0;i<byteLen; i+=2) {
          const lo = arr[off + i];
          const hi = arr[off + i + 1];
          if (lo === 0 && hi === 0) continue;
          const code = lo + (hi << 8);
          s += String.fromCharCode(code);
        }
        return s;
      };
      // PERSON_INFO_BIN: accumulate partial map frames and emit when complete (sanitized rewrite)
      let personInfoBinAccum = { map_infos: {}, tag_total: 0, tag_online_total: 0 };
      const handlePersonInfoBin = (rawBuf) => {
        if (!(rawBuf instanceof ArrayBuffer)) return;
        const u8 = new Uint8Array(rawBuf);
        if (u8.length < 12) return;
        let off = 0;
        const totalFrames = (u8[off] << 8) + u8[off + 1]; off += 2;
        const curFrame = (u8[off] << 8) + u8[off + 1]; off += 2;
        const tagTotal = (u8[off] << 8) + u8[off + 1]; off += 2;
        const onlineTotal = (u8[off] << 8) + u8[off + 1]; off += 2;
        // skip mapCount byte (unused in observed frames)
        off += 1;
        const mapId = (u8[off] << 8) + u8[off + 1]; off += 2;
        const nameLen = u8[off]; off += 1;
        const mapName = readUtf16LEString(u8, off, nameLen); off += nameLen;
        const onlineCounts = (u8[off] << 8) + u8[off + 1]; off += 2;
        const tags = [];
        for (let i = 0; i < onlineCounts && off < u8.length; i++) {
          let tagId;
          if (TAG64_ENABLE) { tagId = byteCalcBE(u8, 8, off); off += 8; } else { tagId = byteCalcBE(u8, 4, off); off += 4; }
          tags.push({ tag_id: String(tagId) });
        }
        // reserved 2 bytes (protocol alignment)
        off += 2;
        if (curFrame === 1) personInfoBinAccum = { map_infos: {}, tag_total: tagTotal, tag_online_total: onlineTotal };
        const existing = personInfoBinAccum.map_infos[mapId] || { map_id: mapId, map_name: '', online_counts: 0, tags: [] };
        existing.map_name = mapName || existing.map_name;
        existing.online_counts += onlineCounts;
        existing.tags.push(...tags);
        personInfoBinAccum.map_infos[mapId] = existing;
        if (curFrame === totalFrames) {
          personInfoBinAccum.map_num = Object.keys(personInfoBinAccum.map_infos).length;
          try { window.__BLUEIOT_LAST_PERSON_BIN = personInfoBinAccum; } catch {}
          try { pushEvent('personInfoRaw', { map_num: personInfoBinAccum.map_num }); } catch(_) {}
          emit('personInfoRaw', personInfoBinAccum);
          const tagIds = Object.values(personInfoBinAccum.map_infos).flatMap(m => m.tags.map(t => t.tag_id));
          if (tagIds.length) {
            const unique = [];
            const seen = new Set();
            for (let i=0;i<tagIds.length;i++) {
              const rawId = tagIds[i];
              try {
                const canon = canonicalizeId(rawId);
                if (!seen.has(canon)) { seen.add(canon); unique.push(canon); }
              } catch(_) {
                if (!seen.has(rawId)) { seen.add(rawId); unique.push(rawId); }
              }
            }
            try { pushEvent('tagsOnline', { count: unique.length }); } catch(_) {}
            emit('tagsOnline', { tagIds: unique, raw: personInfoBinAccum });
          }
        }
      };
      // ROLLCALL_DATA_BIN: sanitized best-effort decoder to extract tag names (UTF-16LE) without throwing
      const handleRollcallBin = (rawBuf) => {
        if (!(rawBuf instanceof ArrayBuffer)) return;
        const u8 = new Uint8Array(rawBuf);
        // keep a tiny snapshot for debugging without polluting logs
        try {
          window.__BLUEIOT_RAW_FRAMES = window.__BLUEIOT_RAW_FRAMES || { TAG_POS: [], PERSON_INFO: [], ROLLCALL_DATA: [] };
          const __rbuf = window.__BLUEIOT_RAW_FRAMES.ROLLCALL_DATA; __rbuf.push(u8.slice(0, Math.min(256, u8.length))); if (__rbuf.length > 50) __rbuf.shift();
        } catch(_) {}
        if (u8.length < 6) { try { emit('rollcallRawBin', { byteLength: u8.length }); } catch {} return; }
        let off = 0;
        const nameMap = {};
        // The vendor format varies; we scan conservatively: [tagId(4|8)][nameLen(2)][utf16le name bytes]
        // Repeat until buffer exhausted or guard fails. This is safe and ASCII-clean.
        while (off + 6 <= u8.length) {
          const start = off;
          // Read tag ID (prefer 64 if enabled)
          let tagId = null;
          try {
            if (TAG64_ENABLE && off + 8 <= u8.length) { tagId = byteCalcBE(u8, 8, off); off += 8; }
            else if (off + 4 <= u8.length) { tagId = byteCalcBE(u8, 4, off); off += 4; }
            else break;
          } catch(_) { break; }
          if (off + 2 > u8.length) break;
          const nameLen = (u8[off] << 8) + u8[off + 1]; off += 2;
          if (nameLen > 0 && off + nameLen <= u8.length) {
            let tagName = '';
            try { tagName = readUtf16LEString(u8, off, nameLen); } catch(_) { tagName = ''; }
            off += nameLen;
            if (tagName && tagName.trim()) {
              try { const nm = {}; addNameForIdVariants(nm, String(tagId), tagName); Object.assign(nameMap, nm); } catch(_) {}
            }
          } else {
            // If the structure doesn't match, advance minimally to avoid an infinite loop
            off = Math.max(off, start + (TAG64_ENABLE ? 8 : 4));
          }
          // Soft guard to avoid infinite loops on malformed frames
          if (off <= start) break;
        }
        if (Object.keys(nameMap).length) {
          try {
            const canonNames = {};
            Object.entries(nameMap).forEach(([k,v]) => {
              try { const c = canonicalizeId(k); canonNames[c] = canonNames[c] || v; } catch(_) { canonNames[k] = canonNames[k] || v; }
            });
            emit('tagNames', canonNames);
          } catch {}
        }
        try { emit('rollcallRawBin', { byteLength: u8.length, names: Object.keys(nameMap).length }); } catch {}
      };
      // AREA_INFO_BIN: decode single area entry with tag_name & area_name
      const handleAreaInfoBin = (rawBuf) => {
        if (!(rawBuf instanceof ArrayBuffer)) return;
        const u8 = new Uint8Array(rawBuf);
        if (u8.length < 16) return;
        let off = 0;
        const tagId = TAG64_ENABLE ? byteCalcBE(u8, 8, off) : byteCalcBE(u8, 4, off); off += TAG64_ENABLE ? 8 : 4;
        const tagNameLen = (u8[off] << 8) + u8[off+1]; off += 2;
        const tagName = readUtf16LEString(u8, off, tagNameLen); off += tagNameLen;
        const areaId = byteCalcBE(u8, 8, off); off += 8;
        const areaNameLen = (u8[off] << 8) + u8[off+1]; off += 2;
        const areaName = readUtf16LEString(u8, off, areaNameLen); off += areaNameLen;
        const mapId = byteCalcBE(u8, 2, off); off += 2;
        const mapNameLen = (u8[off] << 8) + u8[off+1]; off += 2;
        const mapName = readUtf16LEString(u8, off, mapNameLen); off += mapNameLen;
        const status = u8[off]; off += 1;
        const timestamp = byteCalcBE(u8, 8, off); off += 8;
        const areaInfo = { tag_id: String(tagId), tag_name: tagName, area_id: String(areaId), area_name: areaName, map_id: mapId, map_name: mapName, status, timestamp };
        emit('areaInfoRawBin', areaInfo);
        if (tagName && tagName.trim()) {
          const nm = {}; addNameForIdVariants(nm, String(tagId), tagName);
          try {
            const canonMap = {};
            Object.entries(nm).forEach(([k,v]) => { try { const c = canonicalizeId(k); canonMap[c] = canonMap[c] || v; } catch(_) { canonMap[k] = canonMap[k] || v; } });
            emit('tagNames', canonMap);
          } catch(_) { emit('tagNames', nm); }
        }
      };
  const cleanTagName = (raw) => {
        if (!raw) return '';
        let s = String(raw);
        // 1) Rimuovi caratteri di controllo
        let noCtrl = '';
        for (let i=0;i<s.length;i++) {
          const code = s.charCodeAt(i);
          if (code >= 32 && code !== 127) noCtrl += s[i];
        }
        // 2) Tieni solo caratteri consentiti (ASCII lettere/numeri, Latin-1 accentati, spazi e punteggiatura semplice)
        let filtered = '';
        for (let i=0;i<noCtrl.length;i++) {
          const ch = noCtrl[i];
          const c = noCtrl.charCodeAt(i);
          const isAsciiLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
          const isDigit = c >= 48 && c <= 57;
          const isLatin1 = (c >= 0x00C0 && c <= 0x00FF); // Latin-1 accented range
          const isAllowedPunct = " _.,'-()[]".indexOf(ch) !== -1;
          filtered += (isAsciiLetter || isDigit || isLatin1 || isAllowedPunct) ? ch : ' ';
        }
    // 3) Collassa spazi multipli, trim
    filtered = filtered.replace(/\s+/g, ' ').trim();
        // 4) Heuristics per tagliare metadati appesi (token noti, doppi spazi, parentesi)
        const upper = filtered.toUpperCase();
        const cutTokens = [' INFOTEL', ' INFO ', ' MODEL', ' SERIAL', ' ID:', ' SN:', ' VER', ' VERSION'];
        for (let i=0;i<cutTokens.length;i++) {
          const idx = upper.indexOf(cutTokens[i]);
          if (idx > 0) { filtered = filtered.slice(0, idx).trim(); break; }
        }
        const dbl = filtered.indexOf('  ');
        if (dbl > 0) filtered = filtered.slice(0, dbl).trim();
        const pIdx = Math.min(...[...[' (',' ['].map(t=>{ const j=filtered.indexOf(t); return j<0?Infinity:j; })]);
        if (pIdx !== Infinity && pIdx > 0) filtered = filtered.slice(0, pIdx).trim();
        // 5) Limita lunghezza
        if (filtered.length > 64) filtered = filtered.slice(0, 64).trim();
        // 6) Preferisci blocco ASCII lungo se presente (tag spesso hanno nome pulito ASCII)
        const asciiBlock = noCtrl.match(/[A-Za-z0-9 _.,'()-]{6,}/);
  if (asciiBlock && (asciiBlock[0].length >= Math.min(filtered.length, 10))) {
          filtered = asciiBlock[0].slice(0,64).trim();
        } else if (filtered.length < 3) {
          // Fallback: estrai sottostringa alfanumerica estesa
          const m = noCtrl.match(/[A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ _.,'()-]{2,}/);
          if (m) filtered = m[0].slice(0, 64).trim();
        }
        // 7) Rimuovi suffissi vendor comuni (es. "Infotel") alla fine del nome
        const up2 = filtered.toUpperCase();
        const baseVendors = ['INFOTEL', 'INFOTEL SRL', 'INFOTEL S.R.L'];
        const seps = [' ', ' - ', ' | ', ' · '];
        for (let vi=0; vi<baseVendors.length; vi++) {
          for (let si=0; si<seps.length; si++) {
            const token = seps[si] + baseVendors[vi];
            if (up2.endsWith(token)) {
              filtered = filtered.slice(0, filtered.length - token.length).trim();
              break;
            }
          }
        }
        return filtered;
      };
  const handleRollcallData = (roll) => {
        if (typeof roll === 'string') {
          try { return handleRollcallData(JSON.parse(roll)); } catch { /* ignore */ }
        }
        if (roll && typeof Blob !== 'undefined' && roll instanceof Blob) {
          try { roll.text().then(t => { try { handleRollcallData(JSON.parse(t)); } catch(e){} }); } catch(_) {}
          return;
        }
        try {
          const areas = Array.isArray(roll) ? roll : [roll];
          const nameMap = {};
          for (let ai=0; ai<areas.length; ai++) {
            const a = areas[ai];
            const list = a && (a.area_tag_list || a.tags) ? (a.area_tag_list || a.tags) : [];
            for (let ti=0; ti<list.length; ti++) {
              const t = list[ti];
              const variants = collectIdVariants(t);
              const cand = t.tag_name || t.name || t.alias || t.tagAlias;
              let nm = cleanTagName(cand || '');
              if (variants.length && nm) variants.forEach(v => { nameMap[v] = nm; });
            }
          }
          // Deep fallback: scan entire structure as last resort
          extractNamesDeep(roll, nameMap);
          if (Object.keys(nameMap).length) {
            try {
              const canonNames = {};
              Object.entries(nameMap).forEach(([k,v]) => {
                try { const c = canonicalizeId(k); canonNames[c] = canonNames[c] || v; } catch(_) { canonNames[k] = canonNames[k] || v; }
              });
              console.log('[BlueIot] (rollcall cleaned):', canonNames);
              emit('tagNames', canonNames);
            } catch(e) { console.log('[BlueIot] (rollcall cleaned) emit failed', e?.message); }
          }
        } catch(e) { console.warn('[BlueIot] rollcall parse error:', e.message); }
      };
      // Config: fallback BIN opzionale; di default ATTIVO per permettere visibilità se il server invia solo binario.
      // Puoi disattivarlo impostando REACT_APP_BLUEIOT_IGNORE_BIN=true
    const IGNORE_BIN = String(process.env.REACT_APP_BLUEIOT_IGNORE_BIN || 'false').toLowerCase() === 'true';
    // Scala dinamica BIN (diagnostica drift vs JSON). Configurabile via env.
    let __binAutoDiv = Number(process.env.REACT_APP_BLUEIOT_BIN_POS_DIV || POS_DIV || 100);
    const BIN_AUTO_ENABLE = String(process.env.REACT_APP_BLUEIOT_BIN_AUTO_SCALE || 'true').toLowerCase() === 'true';
    const BIN_RATIO_HIGH = Number(process.env.REACT_APP_BLUEIOT_BIN_SCALE_HIGH || 2.5);
    const BIN_RATIO_LOW = Number(process.env.REACT_APP_BLUEIOT_BIN_SCALE_LOW || 0.4);
    let lastJsonScaleRefLocal = 0; // aggiornata ad ogni frame JSON
  let latestBaseDiv = null; // aggiornato da parseRecord
      // Log effective position config once for easier diagnostics
      try {
        console.warn('[BlueIot][POSCFG]', { IGNORE_BIN, POS_DIV, BIN_AUTO_ENABLE, BIN_RATIO_LOW, BIN_RATIO_HIGH });
      } catch(_) {}
  const handlePosBin = (buf) => {
  if (IGNORE_BIN) { return; }
        // Se stiamo già ricevendo JSON fresco, evita di sovrascrivere con BIN (che può avere endianness/scala diversa)
        if (Date.now() - (lastJsonTs || 0) < 2000) return;
        const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) :
                   (buf?.buffer ? new Uint8Array(buf.buffer) : null);
        if (!u8) return;
        posDiag.binFrames += 1;
        // console.log("[BlueIot] POS BIN frame:", u8.length);
        // Fallback parser: decodifica frame POS (0xCC 0x5F 0x81 / 0x01) se il callback JSON non ha ancora prodotto dati
        // Header: 0xCC 0x5F, byte 2 = type (bit 0x80 new protocol). After header, structure:
        // tagnum(1), then for each tag: id(4), x(4), y(4), z(2), regid(1), cap(1), flags(1), timestamp(4), reserved(2)
        try {
          if (u8.length >= 10 && u8[0] === 0xCC && u8[1] === 0x5F) {
            const msgType = u8[2] & 0x7F; // strip NEW flag
            if (msgType === 0x01) { // FrameType_POS
              const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
              const arr = [];
              const tagnum = u8[3];
              let offset = 4;

              const parseRecord = (startOff, idBytes) => {
                let off = startOff;
                const need = idBytes + 4 + 4 + 2 + 1 + 1 + 1 + 4 + 2;
                if (off + need > u8.length) return null;
                let id;
                if (idBytes === 8) {
                  // Preferisci le ultime 4 byte (low32) come ID stabile visualizzato
                  /* high 32 bits ignorati: usiamo solo low32 per stabilità visualizzazione */
                  // const idHi = dv.getUint32(off, POS_ENDIAN === 'le');
                  const idLo = dv.getUint32(off + 4, POS_ENDIAN === 'le');
                  id = idLo; // low32
                } else {
                  id = POS_ENDIAN === 'be' ? dv.getUint32(off, false)
                      : POS_ENDIAN === 'le' ? dv.getUint32(off, true)
                      : (dv.getUint32(off, false) || dv.getUint32(off, true));
                }
                off += idBytes;

                const xBE = dv.getInt32(off, false), xLE = dv.getInt32(off, true); off += 4;
                const yBE = dv.getInt32(off, false), yLE = dv.getInt32(off, true); off += 4;
                const zBE = dv.getInt16(off, false), zLE = dv.getInt16(off, true); off += 2;
                const regid = u8[off]; off += 1;
                let cap = u8[off]; off += 1;
                const flagByte = u8[off]; off += 1;
                const sleep = !!(flagByte & 0x10);
                const bcharge = !!(flagByte & 0x01);
                const tsRaw = POS_ENDIAN === 'be' ? dv.getUint32(off, false)
                              : POS_ENDIAN === 'le' ? dv.getUint32(off, true)
                              : (dv.getUint32(off, true) || dv.getUint32(off, false));
                off += 4;
                off += 2; // reserved

                const pick = (a, b) => {
                  if (POS_ENDIAN === 'be') return a;
                  if (POS_ENDIAN === 'le') return b;
                  return Math.abs(a) <= Math.abs(b) ? a : b;
                };
                let xRaw = pick(xBE, xLE);
                let yRaw = pick(yBE, yLE);
                let zRaw = pick(zBE, zLE);

                // Normalizza in metri con divisore configurabile
                const baseDiv = (__binAutoDiv && isFinite(__binAutoDiv) && __binAutoDiv > 0) ? __binAutoDiv : (POS_DIV && isFinite(POS_DIV) && POS_DIV > 0 ? POS_DIV : 100);
                latestBaseDiv = baseDiv;
                let x = xRaw / baseDiv;
                let y = yRaw / baseDiv;
                let z = zRaw / baseDiv;

                // Battery plausibility clamp 0..100
                if (cap > 100 && cap <= 255) cap = Math.min(cap, 100);

                // Scarta letture implausibili: spesso dovute a endianness/scala errata; usa soglia configurabile
                const tooBig = (Math.abs(x) > SAFE_ABS_POS || Math.abs(y) > SAFE_ABS_POS);
                if (runtimeFiltersEnabled && tooBig) {
                  posDiag.droppedTooBig += 1;
                  return { ok: false, next: off };
                }
                return { ok: true, next: off, id: String(id >>> 0), x, y, z, regid, cap, sleep, bcharge, tsHw: tsRaw };
              };

              for (let i = 0; i < tagnum; i++) {
                if (offset + 23 > u8.length) break;
                // Try both 4-byte and 8-byte ID layouts; pick with smaller |x|+|y|
                const cand4 = parseRecord(offset, 4);
                const cand8 = parseRecord(offset, 8);
                let chosen = cand4;
                if (cand8 && cand4) {
                  const s4 = Math.abs(cand4.x) + Math.abs(cand4.y);
                  const s8 = Math.abs(cand8.x) + Math.abs(cand8.y);
                  chosen = s8 < s4 ? cand8 : cand4;
                } else if (cand8 && !cand4) {
                  chosen = cand8;
                }
                if (!chosen || chosen.ok === false) { if (chosen && chosen.next) offset = chosen.next; else break; continue; }
                // Derive hex id from the raw bytes in buffer for stronger 64-bit identity when possible
                try {
                  if (chosen && chosen.next) {
                    const span = u8.slice(offset, offset + (chosen.id && chosen.id.length > 10 ? 8 : 4));
                    const hex = Array.from(span).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
                    arr.push({ ...chosen, idHex: hex, ts: Date.now() });
                  } else {
                    arr.push({ ...chosen, ts: Date.now() });
                  }
                } catch(_) {
                  arr.push({ ...chosen, ts: Date.now() });
                }
                offset = chosen.next;
              }
              if (arr.length) {
                // Magnitudine media per rilevare drift vs ultimo JSON
                let avgMag = 0;
                try { avgMag = arr.reduce((acc,p)=>acc+Math.hypot(p.x,p.y),0)/arr.length; } catch(_) {}
                // Recupera riferimento JSON globale se disponibile
                try { if (window.__BLUEIOT_LAST_JSON_MAG) lastJsonScaleRefLocal = window.__BLUEIOT_LAST_JSON_MAG; } catch(_) {}
                let appliedCorr = 1;
                if (BIN_AUTO_ENABLE && lastJsonScaleRefLocal > 0 && avgMag > 0) {
                  const ratio = avgMag / lastJsonScaleRefLocal;
                  if (ratio > BIN_RATIO_HIGH || ratio < BIN_RATIO_LOW) {
                    // Correggi dimensione riportando magnitudine vicino a quella JSON
                    appliedCorr = ratio;
                    arr.forEach(p => { p.x = p.x / appliedCorr; p.y = p.y / appliedCorr; });
                    avgMag = avgMag / appliedCorr;
                    console.warn('[BlueIot][BIN][AutoScale] ratio', ratio.toFixed(3), 'correzione applicata');
                  }
                }
                // Etichetta sorgente
                try { arr.forEach(p => { p.src = 'bin'; }); } catch(_) {}
                try { if (typeof window !== 'undefined' && window.__BLUEIOT_VERBOSE) console.log('[BlueIot][BIN] positions parsed:', arr.length, 'sample:', arr[0]); } catch(_) {}
                // BIN consistency checks: ensure id/hex agreement and compare magnitude with JSON reference
                try {
                  arr.forEach(p => {
                    try {
                      const pid = String(p.id ?? '');
                      const hx = p.idHex ? String(p.idHex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null;
                      if (hx && hx.length >= 8) {
                        const low32 = String(parseInt(hx.slice(-8), 16) >>> 0);
                        if (pid && pid !== low32) {
                          pushEvent('idVariantMismatch', { src: 'bin', id: pid, idHex: hx, low32, sample: p });
                          dbg('[BlueIot][CHECK] id mismatch bin:', pid, 'vs low32(hex)', low32);
                        }
                      }
                    } catch(_) {}
                  });
                } catch(_) {}
                emit('position', arr);
                posDiag.accepted += arr.length;
                posDiag.lastSample = arr[0];
                positionsEverReceived = true;
                if (!firstPositionAt) firstPositionAt = Date.now();
                try {
                  window.__BLUEIOT_SCALE_DIAG = window.__BLUEIOT_SCALE_DIAG || {};
                  window.__BLUEIOT_SCALE_DIAG.bin = { avgMag, lastJsonScaleRef: lastJsonScaleRefLocal, appliedCorr, baseDiv: latestBaseDiv };
                } catch(_) {}
              }
              // Heuristica: se solo scarti e nessuna accettazione, spegni i filtri
              if (runtimeFiltersEnabled && posDiag.accepted === 0 && posDiag.droppedTooBig >= 10) {
                runtimeFiltersEnabled = false;
                console.warn('[BlueIot][Auto] Filtri disattivati automaticamente (BIN): SAFE_ABS=', SAFE_ABS_POS);
              }
            }
          }
        } catch (e) {
          console.warn('[BlueIot][Fallback] parse error:', e.message);
        }
      };

      const reg = (name, handler) => {
        try {
          const id = api.CB_TYPE?.[name] ?? name;
          api.RegisterCallbackFunc?.(id, handler);
          console.log("[BlueIot] Registrato CB:", name, "->", id);
        } catch (e) { console.warn("[BlueIot] Register err", name, e?.message); }
      };
      reg("TAG_POS", handlePosJson);
  reg("TAG_POS_BIN", handlePosBin);
  reg("PERSON_INFO", handlePersonInfo);
  reg("ROLLCALL_DATA", handleRollcallData);
  // Register BIN handlers to improve name extraction reliability
  reg("ROLLCALL_DATA_BIN", (buf) => { try { handleRollcallBin(buf); } catch(e){} });
  reg("PERSON_INFO_BIN", (buf) => { try { handlePersonInfoBin(buf); } catch(e){} });
  reg("AREA_INFO_BIN", (buf) => { try { handleAreaInfoBin(buf); } catch(e){} });
      // Extra per manuale: battery, area access, physical signs
      reg("TAG_POWER", (data) => {
        try {
          if (typeof data === 'string') data = JSON.parse(data);
          if (data && typeof Blob !== 'undefined' && data instanceof Blob) {
            data.text().then(t => { try { const j = JSON.parse(t); emit('battery', j); } catch {} });
            return;
          }
          emit('battery', data);
        } catch(_) { /* ignore */ }
      });
      reg("AREA_INFO", (data) => {
        const tryExtractNames = (obj) => {
          try {
            const map = {};
            extractNamesDeep(obj, map);
            if (Object.keys(map).length) {
              const canonMap = {};
              Object.entries(map).forEach(([k,v]) => { try { const c = canonicalizeId(k); canonMap[c] = canonMap[c] || v; } catch(_) { canonMap[k] = canonMap[k] || v; } });
              emit('tagNames', canonMap);
            }
          } catch(_) {}
        };
        try {
          if (typeof data === 'string') {
            try { const j = JSON.parse(data); emit('areaInfo', j); tryExtractNames(j); } catch {}
            return;
          }
          if (data && typeof Blob !== 'undefined' && data instanceof Blob) {
            // Prefer textual JSON parse; if it fails, also attempt ArrayBuffer for future binary decoders
            data.text().then(t => { try { const j = JSON.parse(t); emit('areaInfo', j); tryExtractNames(j); } catch {} });
            return;
          }
          emit('areaInfo', data);
          tryExtractNames(data);
        } catch(_) { /* ignore */ }
      });
      reg("SIGN_INFO", (data) => {
        const tryExtractNames = (obj) => {
          try {
            const map = {};
            extractNamesDeep(obj, map);
            if (Object.keys(map).length) {
              const canonMap = {};
              Object.entries(map).forEach(([k,v]) => { try { const c = canonicalizeId(k); canonMap[c] = canonMap[c] || v; } catch(_) { canonMap[k] = canonMap[k] || v; } });
              emit('tagNames', canonMap);
            }
          } catch(_) {}
        };
        try {
          if (typeof data === 'string') {
            try { const j = JSON.parse(data); emit('signInfo', j); tryExtractNames(j); } catch {}
            return;
          }
          if (data && typeof Blob !== 'undefined' && data instanceof Blob) {
            data.text().then(t => { try { const j = JSON.parse(t); emit('signInfo', j); tryExtractNames(j); } catch {} });
            return;
          }
          emit('signInfo', data);
          tryExtractNames(data);
        } catch(_) { /* ignore */ }
      });
      // Useful diagnostics
      reg("WS_SWITCH_RESULT", (res) => {
        try {
          lastSwitchResult = res;
        } catch {}
        console.log("[BlueIot] Switch result:", res);
      });
  reg("ON_ERROR", (e) => { console.warn("[BlueIot] SDK error:", e); if (!firstErrorAt) firstErrorAt = Date.now(); });
      reg("ON_WS_ERROR", (e) => console.warn("[BlueIot] WS error:", e));
      reg("ON_WS_CLOSE", (e) => {
        console.warn("[BlueIot] WS close cb:", e);
        if (e && typeof e.code !== 'undefined') lastCloseCode = e.code;
        // Strategy: if we get repeated 1006, try switching proto/unsalted automatically (bounded attempts)
        const now = Date.now();
        if (e && e.code === 1006) {
          consecutive1006 += 1;
          if (DISABLE_AUTOMODE) {
            console.warn('[BlueIot][AutoMode] disabled by env; not toggling proto/salt');
          } else if (consecutive1006 >= 2 && autoModeSwitches < 4 && now - lastModeSwitchAt > 3000) {
            lastModeSwitchAt = now;
            autoModeSwitches += 1;
            // alternate between toggling proto and salted mode
            if (autoModeSwitches % 2 === 1) {
              // toggle proto between localSensePush-protocol and none
              runtimeBasicProto = (runtimeBasicProto === 'localSensePush-protocol') ? 'none' : 'localSensePush-protocol';
              console.warn('[BlueIot][AutoMode] Switching BASIC subprotocol to', runtimeBasicProto);
            } else {
              runtimeForceUnsalted = !runtimeForceUnsalted;
              console.warn('[BlueIot][AutoMode] Toggling unsalted to', runtimeForceUnsalted);
            }
            try { window.BLUEIOT_BASIC_SUBPROTO = runtimeBasicProto; } catch {}
            // force reconnect sequence
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts += 1;
              console.warn('[BlueIot][Retry] reconnect attempt', reconnectAttempts, 'of', MAX_RECONNECT_ATTEMPTS);
              try { LocalsenseClient.disconnect(); } catch {}
              setTimeout(() => { try { LocalsenseClient.connect(); } catch {} }, 600);
            } else {
              console.error('[BlueIot][Abort] Max reconnect attempts reached. Stopping auto-retry.');
              emit('error', { message: 'Max reconnect attempts reached; check credentials, salt, subprotocol.' });
            }
          }
        } else {
          consecutive1006 = 0;
          reconnectAttempts = 0; // reset attempts when we see a different close code
        }
      });
      reg("ON_CLOSE", (e) => {
        const now = Date.now();
        const durationMs = lastOpenAt ? (now - lastOpenAt) : null;
        console.warn("[BlueIot] API global close:", e);
        sdkOpenSockets = Math.max(0, sdkOpenSockets - 1);
        if (sdkOpenSockets === 0) emit("close", { code: lastCloseCode, durationMs });
      });
      reg("ON_OPEN", (msg) => {
        console.log("[BlueIot] SDK channel opened", msg);
        try { console.log('[BlueIot] Protocol ws1/ws3 (ultima):', window.ReconnectingWebSocket && window.ReconnectingWebSocket.prototype ? 'debug active' : 'n/a'); } catch(e) {}
        const prev = sdkOpenSockets;
        sdkOpenSockets += 1;
        lastOpenTs = Date.now();
        lastOpenAt = lastOpenTs;
        if (prev === 0 && sdkOpenSockets > 0) emit("open");
        // Heuristica: se abbiamo richiesto Control e riceviamo una nuova apertura, consideriamo Control aperto
        if (LocalsenseClient._controlRequested && !LocalsenseClient._controlOpened) {
          LocalsenseClient._controlOpened = true;
          console.log('[BlueIot] Control channel likely opened');
        }
    // Tenta lo switch posizione; se il Control non è aperto, il device potrebbe ignorare la richiesta
    try { controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.('position', 1); } catch {}
        // Se dopo poco non riceviamo posizioni, prova ad aprire anche il canale Control e ripetere lo switch
        setTimeout(() => {
          if (!positionsEverReceived) {
            try {
              console.warn('[BlueIot] Still no positions, retrying position switch');
              controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.('position', 1);
            } catch {}
          }
        }, 2500);
      });
      reg("WS_TAG_SHAKE", (payload) => {
        try {
          const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
          console.log('[BlueIot] Vibrate ACK:', obj);
          emit('vibrate', obj);
        } catch(e) {
          console.log('[BlueIot] Vibrate ACK (raw):', payload);
          emit('vibrate', payload);
        }
      });

      // Monkey patch low-level log counters if ReconnectingWebSocket wrapper logs
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = function(...args) {
        try {
          // Suppress noisy SDK logs when binary blobs are printed as text candidates
          const s0 = args[0];
          if (s0 && typeof s0 === 'string') {
            if (
              s0.includes('ws1 text candidate (from Blob)') ||
              s0.includes('[BlueIot][SDK] ws1 text candidate') ||
              s0.includes('text candidate (from Blob)')
            ) {
              return; // drop this noisy line
            }
          }
          if (args[0] && typeof args[0] === 'string' && args[0].includes('[BlueIot][RWS] msg BIN:')) {
            frameCounters.bin += 1;
          } else if (args[0] && typeof args[0] === 'string' && args[0].includes('[BlueIot][RWS] msg TXT:')) {
            frameCounters.txt += 1;
          } else if (args[0] && typeof args[0] === 'string' && args[0].includes('[BlueIot][RWS] close')) {
            const codeMatch = /close .* (\d{4})/.exec(args[0]);
            lastCloseCode = codeMatch ? Number(codeMatch[1]) : null;
          }
        } catch {}
        return origLog.apply(this, args);
      };
      console.warn = function(...args) {
        try {
          // Apply same suppression to warnings if emitted with warn
          const s0 = args[0];
          if (s0 && typeof s0 === 'string') {
            if (
              s0.includes('ws1 text candidate (from Blob)') ||
              s0.includes('[BlueIot][SDK] ws1 text candidate') ||
              s0.includes('text candidate (from Blob)')
            ) {
              return; // drop this noisy line
            }
          }
          if (args[0] && typeof args[0] === 'string' && args[0].includes('[BlueIot][SDK][BIN] frame header ok type=')) {
            const m = /type=0x([0-9a-fA-F]+)/.exec(args[0]);
            if (m) {
              const key = '0x' + m[1].toLowerCase();
              frameTypeCounts[key] = (frameTypeCounts[key] || 0) + 1;
            }
          }
        } catch {}
        return origWarn.apply(this, args);
      };

      // Apri solo il canale Basic per ridurre il rischio di chiusure immediate;
      // gli altri canali si potranno aprire dopo conferma handshake.
      console.log(`[BlueIot] RequireBasicInfo(${hostPort})`);
      api.RequireBasicInfo?.(hostPort);
  // Diagnostics: show effective options
  console.warn('[BlueIot][CFG]', { hostPort, user: USER, salted: !runtimeForceUnsalted, proto: runtimeBasicProto, disableAutoMode: DISABLE_AUTOMODE });
      // Pianifica apertura canale Control UNA sola volta se non riceviamo posizioni (serve per inviare lo switch 'position')
      if (!LocalsenseClient._controlPlanned) {
        LocalsenseClient._controlPlanned = true;
        setTimeout(() => {
          if (positionsEverReceived) return; // già a posto
          try {
            console.log(`[BlueIot] Opening Control channel (delayed)`);
            LocalsenseClient._controlRequested = true;
            api.RequireControlInfo?.(hostPort);
            // dopo apertura Control, tenta switch posizione con piccoli retry
            let tries = 0;
            const maxTries = 4;
            const doSwitch = () => {
              tries += 1;
              try { console.log('[BlueIot] (control) Send position switch attempt', tries); controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.('position', 1); } catch {}
              if (!positionsEverReceived && tries < maxTries) setTimeout(doSwitch, 1200);
            };
            setTimeout(doSwitch, 800);
          } catch(e) {
            console.warn('[BlueIot] Control open failed (scheduled):', e?.message);
          }
        }, 1400); // attesa per evitare "Insufficient resources" immediati
      }
      // monitor periodic auth resend if socket stays but no frames
      LocalsenseClient._authRetryCount = 0;
      LocalsenseClient._authInterval = setInterval(() => {
        if (!api || !api.Send2WS_RequsetSwitch) return;
        if (sdkOpenSockets === 0) return; // only while open
        LocalsenseClient._authRetryCount += 1;
        if (LocalsenseClient._authRetryCount > 5) { clearInterval(LocalsenseClient._authInterval); return; }
        try {
          console.log('[BlueIot] Re-send position switch attempt', LocalsenseClient._authRetryCount);
          controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.('position', 1);
        } catch(e) {}
      }, 5000);

      // Opzionale: apri Control solo se esplicitamente richiesto via env.
      if (AUTO_OPEN_CONTROL) {
        setTimeout(() => {
          if (sdkOpenSockets > 0) {
            console.log(`[BlueIot] (delayed) RequireControlInfo(${hostPort})`);
            api.RequireControlInfo?.(hostPort);
          }
        }, 2500);
      }

      // Imposta subito il tipo di output e apri ExtraInfo per i nomi; poi attiva lo stream posizione
  try { api.setPosOutType?.("XY"); currentPosOutType = "XY"; } catch {}
      try { console.log(`[BlueIot] RequireExtraInfo(${hostPort})`); api.RequireExtraInfo?.(hostPort); } catch {}
  // Primo tentativo (può fallire finché Control non è aperto)
  setTimeout(() => { try { controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.("position", 1); } catch {} }, 800);

      window.BlueIot = api;
    } catch (e) {
      console.error("[BlueIot] connect() errore:", e?.message);
      emit("error", e);
    }
  },
  disconnect() {
    try {
      // Non abbiamo una close esplicita; disabilitiamo lo streaming posizione se possibile
      window.BlueIot?.Send2WS_RequsetSwitch?.("position", 0);
      if (LocalsenseClient._authInterval) { clearInterval(LocalsenseClient._authInterval); }
    } catch {}
  },
  // Manual helpers for UI
  forcePositionSwitch() {
    try {
      const api = window.BlueIot;
      if (!api) throw new Error('API non disponibile');
      const variants = ['position', 'positionXY', 'position/XY'];
      variants.forEach((v, i) => {
        setTimeout(() => {
          try { controlSwitchAttempts += 1; api.Send2WS_RequsetSwitch?.(v, 1); console.log('[BlueIot][UI] Forced position switch variant', v); } catch {}
        }, i * 250);
      });
    } catch(e) { console.warn('[BlueIot] forcePositionSwitch error:', e?.message); }
  },
  openControlNow() {
    try {
      const { hostPort } = parseWsUrl(WS_URL);
      LocalsenseClient._controlRequested = true;
      window.BlueIot?.RequireControlInfo?.(hostPort);
      console.log('[BlueIot][UI] Control channel open requested');
    } catch(e) { console.warn('[BlueIot] openControlNow error:', e?.message); }
  },
  setTagId64(v) {
    try {
      const api = window.BlueIot;
      if (!api) throw new Error('API non disponibile');
      api.setTag64CheckedFlag?.(!!v);
      api.setTag64Show?.(!!v);
      console.log('[BlueIot][UI] Tag ID 64-bit =', !!v);
    } catch(e) { console.warn('[BlueIot] setTagId64 error:', e?.message); }
  },
  setPosOutType(mode) {
    try {
      const api = window.BlueIot;
      if (!api) throw new Error('API non disponibile');
      const allowed = ["XY", "GLOBAL", "GEO", "XY_GEO", "XY_GLOBAL"];
      const m = allowed.includes(mode) ? mode : "XY";
      api.setPosOutType?.(m);
      currentPosOutType = m;
      console.log('[BlueIot][UI] setPosOutType =', m);
    } catch(e) { console.warn('[BlueIot] setPosOutType error:', e?.message); }
  },
  subscribeMapsNow() {
    try {
      const ids = LocalsenseClient._lastMapIds || [];
      if (ids.length && window.BlueIot?.Send2WS_RssMapClicked) {
        window.BlueIot.Send2WS_RssMapClicked(ids.join(':'));
        LocalsenseClient._mapSubscribed = true;
        console.log('[BlueIot][UI] Map subscription sent for IDs:', ids);
      } else {
        console.warn('[BlueIot] subscribeMapsNow: no map IDs known yet');
      }
    } catch(e) { console.warn('[BlueIot] subscribeMapsNow error:', e?.message); }
  },
  setFiltersEnabled(v) {
    try {
      runtimeFiltersEnabled = !!v;
      console.log('[BlueIot][UI] Filters enabled =', runtimeFiltersEnabled);
    } catch(e) {}
  },
  isConnected() {
    return sdkOpenSockets > 0;
  },
  subscribeTagIds(tagIdsStr) {
    window.BlueIot?.Send2WS_RssTagClicked?.(tagIdsStr);
  },
  vibrateTag(tagId, action = "enable") {
    try {
      const api = window.BlueIot;
      if (!api) throw new Error("API non caricate");
      const { hostPort } = parseWsUrl(WS_URL);
      // Assicurati che il canale Control sia aperto prima di inviare
      if (!LocalsenseClient._controlRequested) {
        LocalsenseClient._controlRequested = true;
        console.log(`[BlueIot] (vibrate) opening Control channel ${hostPort}...`);
        api.RequireControlInfo?.(hostPort);
        // attesa breve per handshake
        setTimeout(() => {
          api.Send2WS_RequsetTagShakeBuzzReq?.("tagvibrateandshake", action, String(tagId));
          console.log(`[BlueIot] Vibrate ${action} sent to ${tagId}`);
        }, 1200);
      } else {
        api.Send2WS_RequsetTagShakeBuzzReq?.("tagvibrateandshake", action, String(tagId));
        console.log(`[BlueIot] Vibrate ${action} sent to ${tagId}`);
      }
    } catch (e) {
      console.warn("[BlueIot] vibrateTag errore:", e?.message);
    }
  }
  ,
  getDiagnostics() {
    return {
      isConnected: sdkOpenSockets > 0,
      frameCounters: { ...frameCounters },
      lastCloseCode,
      consecutive1006,
      runtime: { proto: runtimeBasicProto, forceUnsalted: runtimeForceUnsalted, disableAutoMode: DISABLE_AUTOMODE, filtersEnabled: runtimeFiltersEnabled, safeAbs: SAFE_ABS_POS, posOutType: currentPosOutType },
      firstPositionAt,
      firstErrorAt,
      positionsEverReceived,
      controlRequested: !!LocalsenseClient._controlRequested,
      controlOpened: !!LocalsenseClient._controlOpened,
      switchAttempts: controlSwitchAttempts,
      lastSwitchResult,
      frameTypeCounts: { ...frameTypeCounts },
      posDiag: { ...posDiag },
    };
  }
};

// internals
LocalsenseClient._controlRequested = false;
LocalsenseClient._controlOpened = false;
LocalsenseClient._mapSubscribed = false;
LocalsenseClient._lastMapIds = [];
// Expose for console debugging (dev only)
try {
  if (typeof window !== 'undefined') {
    window.LocalsenseClient = LocalsenseClient;
    window.getBlueIotDiag = () => {
      try { return LocalsenseClient.getDiagnostics(); } catch(e) { return { error: e?.message || String(e) }; }
    };
  }
} catch(_) {}