// Simple canonicalizer for BlueIOT tag IDs.
// Build a reverse lookup from a rollcall map (canonical -> [variants]) and
// provide a canonicalizeId(id) helper used by the parsing pipeline.

const variantToCanon = new Map();

const normHex = (s) => String(s).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

const addVariant = (variant, canon) => {
  if (variant === null || typeof variant === 'undefined') return;
  const s = String(variant).trim();
  if (!s) return;
  try {
    // store raw form
    variantToCanon.set(s, String(canon));
    // if looks hex-like, store normalized hex and low32 decimal
    if (/[A-Fa-f]/.test(s) || s.includes(':') || s.includes('-') || s.startsWith('0x') || s.startsWith('0X')) {
      const hx = normHex(s);
      if (hx) variantToCanon.set(hx, String(canon));
      if (hx && hx.length >= 8) {
        try { variantToCanon.set(String(parseInt(hx.slice(-8), 16) >>> 0), String(canon)); } catch(_) {}
      }
    } else if (/^[0-9]+$/.test(s)) {
      // numeric: also store low32 hex variant
      try {
        const n = Number(s) >>> 0;
        variantToCanon.set(String(n), String(canon));
        const hex = n.toString(16).toUpperCase().padStart(8, '0');
        variantToCanon.set(hex, String(canon));
      } catch(_) {}
    }
  } catch(_) {}
};

export function setRollcallMap(rollcall) {
  variantToCanon.clear();
  if (!rollcall || typeof rollcall !== 'object') return;
  try {
    Object.entries(rollcall).forEach(([canon, variants]) => {
      const c = String(canon);
      // include canonical itself
      addVariant(c, c);
      if (Array.isArray(variants)) {
        variants.forEach(v => addVariant(v, c));
      } else if (typeof variants === 'string') {
        addVariant(variants, c);
      } else if (variants && typeof variants === 'object') {
        // object may contain multiple representations
        Object.values(variants).forEach(v => addVariant(v, c));
      }
    });
  } catch(_) {}
}

export function canonicalizeId(rawId) {
  if (rawId === null || typeof rawId === 'undefined') return String(rawId);
  const s = String(rawId).trim();
  if (!s) return s;
  // direct lookup
  if (variantToCanon.has(s)) return variantToCanon.get(s);
  // try normalized hex
  const hx = normHex(s);
  if (hx) {
    if (variantToCanon.has(hx)) return variantToCanon.get(hx);
    // Prefer full normalized HEX as canonical when available (e.g., 12-byte like C5D566E015E5)
    if (hx.length >= 8) return hx; // keep full hex, not just low32
  }
  // numeric fallback: return low32 decimal string
  if (/^[0-9]+$/.test(s)) {
    try { return String(Number(s) >>> 0); } catch(_) { return s; }
  }
  // last resort: uppercase hex-like
  if (/[A-Fa-f]/.test(s)) return hx || s;
  return s;
}

export function clearCanonicalizer() { variantToCanon.clear(); }
