// parseTagStats_Version3.js
// Parser robusto per "tag statistics" - supporta JSON, NDJSON e CSV (semplice)
// Miglioramento: normalizza sequenze escaped come "\n" -> newline reale prima del parsing.

function bufferToString(buf) {
  if (buf == null) return "";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(buf)) {
    return buf.toString("utf8");
  }
  if (buf instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(buf));
  }
  if (buf instanceof Uint8Array) {
    return new TextDecoder().decode(buf);
  }
  if (typeof buf === "string") return buf;
  try { return JSON.stringify(buf); } catch (e) { return String(buf); }
}

function tryParseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function tryParseNDJSON(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return null;
  const results = [];
  for (const ln of lines) {
    const parsed = tryParseJSON(ln);
    if (parsed === null) return null;
    results.push(parsed);
  }
  return results;
}

function tryParseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (!lines[0].includes(',')) return null;

  const parseLine = (line) => {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' ) {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        res.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    res.push(cur);
    return res.map(s => s.trim());
  };

  const headers = parseLine(lines[0]);
  if (headers.length === 0) return null;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length !== headers.length) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j] || `col${j}`] = cols[j] ?? "";
      }
      rows.push(obj);
    } else {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        let v = cols[j];
        if (v !== '' && !isNaN(v) && v.match(/^[-+]?\d+(\.\d+)?$/)) {
          v = (v.indexOf('.') >= 0) ? parseFloat(v) : parseInt(v, 10);
        }
        obj[headers[j] || `col${j}`] = v;
      }
      rows.push(obj);
    }
  }
  return rows;
}

function toHexSnippet(buf, maxBytes = 64) {
  let u8;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(buf)) {
    u8 = new Uint8Array(buf);
  } else if (buf instanceof ArrayBuffer) {
    u8 = new Uint8Array(buf);
  } else if (buf instanceof Uint8Array) {
    u8 = buf;
  } else {
    const s = bufferToString(buf);
    return s.slice(0, 200);
  }
  const len = Math.min(u8.length, maxBytes);
  const parts = [];
  for (let i = 0; i < len; i++) parts.push(u8[i].toString(16).padStart(2, "0"));
  return parts.join(" ") + (u8.length > maxBytes ? " ..." : "");
}

function normalizeEscapes(text) {
  // Sostituisci le sequenze escaped comuni con i corrispondenti caratteri reali.
  // Gestisce sia \\n (due caratteri) che sequenze reali \r\n già presenti.
  if (!text || typeof text !== 'string') return text;
  // Rimuovi BOM se presente
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Converti sequenze letterali "\r\n" e "\n" (backslash + n) in newline reale
  // Attenzione: questo converte sequenze letterali; se il payload contiene backslash intenzionali,
  // valuta se questa normalizzazione è desiderabile.
  text = text.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return text;
}

export function parseTagStats(buffer) {
  console.log("Received tag statistics data");

  if (buffer == null) {
    console.warn("parseTagStats: buffer is null/undefined");
    return null;
  }

  if (typeof buffer === "object" && !(buffer instanceof ArrayBuffer) && !(buffer instanceof Uint8Array) && !(typeof Buffer !== "undefined" && Buffer.isBuffer(buffer))) {
    return buffer;
  }

  let text = bufferToString(buffer);
  if (text == null) return null;
  // Normalizza sequenze escaped come "\\n" -> newline reale
  text = normalizeEscapes(text).trim();

  if (text === "") {
    console.warn("parseTagStats: empty string after decoding buffer");
    return null;
  }

  const json = tryParseJSON(text);
  if (json !== null) return json;

  const nd = tryParseNDJSON(text);
  if (nd !== null) return nd;

  const csv = tryParseCSV(text);
  if (csv !== null) return csv;

  console.warn("parseTagStats: unrecognized format; returning raw/text preview and hex snippet");
  return {
    rawTextPreview: text.slice(0, 2048),
    hexSnippet: toHexSnippet(buffer),
  };
}