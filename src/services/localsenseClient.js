/* Wrapper BlueIOT */
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
};

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
function emit(event, payload) {
  (listeners[event] || []).forEach(cb => { try { cb(payload); } catch (e) {} });
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
  async connect() {
    try {
      const api = await ensureLoaded();
      bindGlobalRwsEventsOnce();

  const { hostPort } = parseWsUrl(WS_URL);
  const effectiveSalt = runtimeForceUnsalted ? "" : SALT;
  // Always set credentials so we don't accidentally reuse wrong state
  api.SetAccount?.(USER, PASS, effectiveSalt);
  // La maggior parte delle installazioni usa tagid a 32-bit sui frame XY: mantieni 32-bit per allineare il parsing
  api.setTag64CheckedFlag?.(false);
  api.setTag64Show?.(false);

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
        posDiag.jsonFrames += 1;
  const SAFE_ABS = SAFE_ABS_POS; // metri: scarta coordinate implausibili
        const arr = Object.values(posMap || {}).map(p => {
          // Le coordinate JSON della SDK risultano già in metri (es. 0.27, 6.11)
          const xRaw = Number(p.x ?? 0);
          const yRaw = Number(p.y ?? 0);
          const zRaw = Number(p.z ?? 0);
          if (!isFinite(xRaw) || !isFinite(yRaw)) {
            posDiag.droppedNaN += 1;
            return null; // scarta non numerici
          }
          if (runtimeFiltersEnabled && (Math.abs(xRaw) > SAFE_ABS || Math.abs(yRaw) > SAFE_ABS)) {
            posDiag.droppedTooBig += 1;
            return null; // filtra outlier hard
          }
          return ({
            id: String(p.id ?? p.tagid ?? ""),
            x: xRaw,
            y: yRaw,
            z: zRaw,
            cap: p.cap,
            regid: p.regid,
            ts: Date.now(),
          });
        }).filter(Boolean);
        if (arr.length) {
          console.log('[BlueIot] Positions received:', arr.length, 'sample:', arr[0]);
          emit("position", arr);
          posDiag.accepted += arr.length;
          posDiag.lastSample = arr[0];
          positionsEverReceived = true;
          if (!firstPositionAt) firstPositionAt = Date.now();
          lastJsonTs = Date.now();
        }
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
        // Hex-like fields (strip separators)
        const hexCand = (obj && (obj.tag_id_hex || obj.tag_id || obj.tagid_hex || obj.mac || obj.macaddr));
        if (hexCand && typeof hexCand === 'string') {
          const norm = hexCand.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
          if (norm) out.push(norm);
          if (norm.length >= 8) {
            const low = norm.slice(-8);
            try { out.push(String(parseInt(low, 16))); } catch(_) {}
          }
        }
        return Array.from(new Set(out.filter(Boolean)));
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
          // Nota: campi ID alternativi gestiti da collectIdVariants
          if (info && info.map_infos) {
            Object.values(info.map_infos).forEach(m => {
              (m.tags || []).forEach(t => {
                const variants = collectIdVariants(t);
                if (!variants.length) return;
                variants.forEach(v => tagIds.push(v));
                const candidate = t.tag_name || null;
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
          if (tagIds.length) { emit('tagsOnline', { tagIds, raw: info }); }
          if (Object.keys(nameMap).length) { emit('tagNames', nameMap); }
        } catch(e) {}
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
            const list = a && a.area_tag_list ? a.area_tag_list : [];
            for (let ti=0; ti<list.length; ti++) {
              const t = list[ti];
              const variants = collectIdVariants(t);
              let nm = cleanTagName(t.tag_name || '');
              if (variants.length && nm) variants.forEach(v => { nameMap[v] = nm; });
            }
          }
          if (Object.keys(nameMap).length) {
            console.log('[BlueIot] Tag names (rollcall cleaned):', nameMap);
            emit('tagNames', nameMap);
          }
        } catch(e) { console.warn('[BlueIot] rollcall parse error:', e.message); }
      };
      // Config: fallback BIN opzionale; di default ATTIVO per permettere visibilità se il server invia solo binario.
      // Puoi disattivarlo impostando REACT_APP_BLUEIOT_IGNORE_BIN=true
      const IGNORE_BIN = String(process.env.REACT_APP_BLUEIOT_IGNORE_BIN || 'false').toLowerCase() === 'true';
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
                const div = (POS_DIV && isFinite(POS_DIV) && POS_DIV > 0) ? POS_DIV : 100;
                let x = xRaw / div;
                let y = yRaw / div;
                let z = zRaw / div;

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
                arr.push({ ...chosen, ts: Date.now() });
                offset = chosen.next;
              }
              if (arr.length) {
                console.log('[BlueIot][BIN] positions parsed:', arr.length, 'sample:', arr[0]);
                emit('position', arr);
                posDiag.accepted += arr.length;
                posDiag.lastSample = arr[0];
                positionsEverReceived = true;
                if (!firstPositionAt) firstPositionAt = Date.now();
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
    try { api.setPosOutType?.("XY"); } catch {}
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
      runtime: { proto: runtimeBasicProto, forceUnsalted: runtimeForceUnsalted, disableAutoMode: DISABLE_AUTOMODE, filtersEnabled: runtimeFiltersEnabled, safeAbs: SAFE_ABS_POS },
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