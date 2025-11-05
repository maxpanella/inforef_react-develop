// parse_test.mjs - test runner ESM per parseTagStats
// Posiziona questo file nella stessa cartella del parser (o adatta modPath).
// Esegui: node parse_test.mjs

console.log("parse_test: starting");

async function run() {
  try {
    // Modifica questo percorso se il tuo parser ha un nome o percorso diverso.
    // Esempi:
    // './parseTagStats_Version3.mjs'
    // './parseTagStats_Version3.js' (se hai dichiarato "type":"module" in package.json)
    const modPath = './parseTagStats_Version3.mjs';
    console.log('Importing parser module from', modPath);

    const mod = await import(modPath);
    // il parser può essere esportato come named export, default, o module.exports (wrapped in default)
    const parseTagStats = mod.parseTagStats || mod.default || mod;
    console.log('Parser loaded, type:', typeof parseTagStats);

    if (typeof parseTagStats !== 'function') {
      console.error('ERROR: parseTagStats non è una funzione. Module exports keys:', Object.keys(mod));
      console.log('Module full export:', mod);
      return;
    }

    // Casi di test
    const tests = [
      { name: 'JSON string', input: '{"tag":"A","count":5}' },
      { name: 'NDJSON string', input: '{"tag":"A","count":5}\\n{"tag":"B","count":2}' },
      { name: 'CSV string', input: 'tag,count\\nA,5\\nB,2' },
      { name: 'Buffer UTF-8', input: Buffer.from(JSON.stringify({ tag: 'C', count: 7 }), 'utf8') },
      { name: 'Uint8Array (browser-like)', input: new Uint8Array(Buffer.from('{"tag":"D","count":9}','utf8')) },
      { name: 'Empty', input: '' },
    ];

    for (const t of tests) {
      try {
        console.log(`\n--- Test: ${t.name} ---`);
        console.log('Input preview:', (typeof t.input === 'string') ? t.input.slice(0,200) : (`[${t.input.constructor.name}] length=${t.input.length}`));
        const out = parseTagStats(t.input);
        console.log('Output (raw):', out);
        try {
          console.log('Output (JSON):', JSON.stringify(out, null, 2));
        } catch (e) {
          console.log('Cannot JSON.stringify output (circular?):', e.message);
        }
      } catch (e) {
        console.error(`Error while parsing test "${t.name}":`, e && e.stack ? e.stack : e);
      }
    }

    console.log('\\nparse_test: completed');
  } catch (err) {
    console.error('Fatal error in parse_test:', err && err.stack ? err.stack : err);
  }
}

run();