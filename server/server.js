// BlueIOT Backend Server - Node.js (Express + SQLite)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const COMPANY_NAME = process.env.COMPANY_NAME;
const COMPANY_ID = process.env.COMPANY_ID;

app.use(cors());
app.use(express.json());

// === Database setup ===
const dbFile = path.resolve(__dirname, 'database.sqlite');
const dbExists = fs.existsSync(dbFile);
const db = new sqlite3.Database(dbFile);

if (!dbExists) {
	console.log('📦 Inizializzazione nuovo database SQLite...');
	db.serialize(() => {
		db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  role TEXT,
  companyId TEXT,
  email TEXT,
  phone TEXT,
  fiscalCode TEXT,
  birthDate TEXT,
  birthCity TEXT,
  birthProvince TEXT,
  hireDate TEXT,
  department TEXT,
  isActive INTEGER DEFAULT 1,
  registrationNumber TEXT,
  gender TEXT,
  nationality TEXT,
  address TEXT,
  city TEXT,
  postalCode TEXT,
  province TEXT,
  contractType TEXT,
  contractExpiry TEXT,
  educationLevel TEXT,
  hours REAL DEFAULT 40,
  doctorName TEXT,
  doctorPhone TEXT,
  underMedicalSurveillance INTEGER DEFAULT 0,
  fragileWorker INTEGER DEFAULT 0,
  usesVdtMoreThan20h INTEGER DEFAULT 0
)`);

		db.run(`CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  name TEXT,
  type TEXT,
  companyId TEXT,
  model TEXT,
  serialNumber TEXT,
  manufacturer TEXT,
  lastMaintenance TEXT,
  nextMaintenance TEXT,
  isOperational INTEGER DEFAULT 1,
  departmentId INTEGER,
  departmentName TEXT
)`);

		db.run(`CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      serverIp TEXT,
      serverPort INTEGER,
      mapFile TEXT,
      mapWidth REAL,
      mapHeight REAL,
      mapCorners TEXT,
      company TEXT,
      companyId TEXT
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      battery INTEGER
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS associations (
      tagId TEXT,
      targetType TEXT,
      targetId INTEGER,
      siteId INTEGER,
      PRIMARY KEY (tagId, siteId)
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT,
      message TEXT,
      siteId INTEGER
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS anchors (
      id TEXT PRIMARY KEY,
      x REAL,
      y REAL,
      z REAL,
      siteId INTEGER,
      status TEXT,
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS tag_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tagId TEXT,
      x REAL,
      y REAL,
      z REAL,
      siteId INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS tag_power (
      tagId TEXT PRIMARY KEY,
      battery INTEGER,
      updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

		db.run(`CREATE TABLE IF NOT EXISTS alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tagId TEXT,
      type TEXT,
      level TEXT,
      message TEXT,
      siteId INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

		if (COMPANY_NAME && COMPANY_ID) {
			db.run(
				`INSERT INTO sites (name, serverIp, serverPort, mapFile, mapWidth, mapHeight, mapCorners, company, companyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					'Cantiere Milano',
					'192.168.1.100',
					48300,
					'mappa.dxf',
					100,
					80,
					JSON.stringify([
						{ x: 0, y: 0 },
						{ x: 100, y: 0 },
						{ x: 100, y: 80 },
						{ x: 0, y: 80 },
					]),
					COMPANY_NAME,
					COMPANY_ID,
				]
			);
		} else {
			console.warn(
				'⚠️ Variabili COMPANY_NAME o COMPANY_ID non definite. Nessun sito demo inserito.'
			);
		}
	});
}

// Ensure auxiliary tables exist even if DB already existed
db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS map_config (
		siteId INTEGER PRIMARY KEY,
		config TEXT,
		updated DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

	// Time-bounded tag assignments history
	db.run(`CREATE TABLE IF NOT EXISTS tag_assignments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tagId TEXT NOT NULL,
		targetType TEXT NOT NULL, -- 'employee' | 'asset'
		targetId INTEGER NOT NULL,
		siteId INTEGER,
		validFrom DATETIME NOT NULL,
		validTo DATETIME,
		created DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);
	// Helpful indexes
	db.run(`CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag ON tag_assignments(tagId)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_tag_assignments_valid ON tag_assignments(tagId, validFrom, validTo)`);

	// Ensure soft-delete column on tags
	try {
		db.all(`PRAGMA table_info(tags)`, [], (err, rows) => {
			if (err) return; // ignore
			const hasDecom = Array.isArray(rows) && rows.some(c => String(c.name).toLowerCase() === 'decommissionedat');
			if (!hasDecom) {
				try { db.run(`ALTER TABLE tags ADD COLUMN decommissionedAt DATETIME`); } catch(_) {}
			}
		});
	} catch(_) {}
});

// === Routes ===

// Avvio server dopo inizializzazione DB
app.listen(PORT, () => {
	console.log(`✅ BlueIOT backend listening on http://localhost:${PORT}`);
});

app.get('/', (req, res) => res.send('BlueIOT backend running'));

app.get('/api/sites', (req, res) => {
	db.all(
		`SELECT * FROM sites WHERE (companyId IS NULL OR companyId = ?)`,
		[COMPANY_ID],
		(err, rows) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			res.json(rows);
		}
	);
});

app.post('/api/users', (req, res) => {
	const {
		id,
		name,
		role,
		email,
		phone,
		fiscalCode,
		birthDate,
		birthCity,
		birthProvince,
		hireDate,
		department,
		isActive,
		registrationNumber,
		gender,
		nationality,
		address,
		city,
		postalCode,
		province,
		contractType,
		contractExpiry,
		educationLevel,
		hours,
		doctorName,
		doctorPhone,
		underMedicalSurveillance,
		fragileWorker,
		usesVdtMoreThan20h,
	} = req.body;

	db.run(
		`REPLACE INTO users (id, name, role, companyId, email, phone, fiscalCode, birthDate, birthCity, birthProvince, 
      hireDate, department, isActive, registrationNumber, gender, nationality, address, city, postalCode, province,
      contractType, contractExpiry, educationLevel, hours, doctorName, doctorPhone, underMedicalSurveillance,
      fragileWorker, usesVdtMoreThan20h) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			name,
			role,
			COMPANY_ID,
			email,
			phone,
			fiscalCode,
			birthDate,
			birthCity,
			birthProvince,
			hireDate,
			department,
			isActive ? 1 : 0,
			registrationNumber,
			gender,
			nationality,
			address,
			city,
			postalCode,
			province,
			contractType,
			contractExpiry,
			educationLevel,
			hours || 40,
			doctorName,
			doctorPhone,
			underMedicalSurveillance ? 1 : 0,
			fragileWorker ? 1 : 0,
			usesVdtMoreThan20h ? 1 : 0,
		],
		(err) => {
			if (err) {
				console.error('Error saving user:', err);
				return res
					.status(500)
					.json({ error: 'DB error', details: err.message });
			}
			res.json({ success: true });
		}
	);
});

app.get('/api/users', (req, res) => {
	db.all(
		`SELECT * FROM users WHERE companyId = ?`,
		[COMPANY_ID],
		(err, rows) => {
			if (err) {
				console.error('Error fetching users:', err);
				return res
					.status(500)
					.json({ error: 'DB error', details: err.message });
			}
			res.json(
				rows.map((row) => ({
					...row,
					isActive: row.isActive === 1,
				}))
			);
		}
	);
});

app.post('/api/assets', (req, res) => {
	const {
		id,
		name,
		type,
		model,
		serialNumber,
		manufacturer,
		lastMaintenance,
		nextMaintenance,
		isOperational,
		departmentId,
		departmentName,
	} = req.body;

	db.run(
		`REPLACE INTO assets (id, name, type, companyId, model, serialNumber, manufacturer, lastMaintenance, 
      nextMaintenance, isOperational, departmentId, departmentName) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			name,
			type,
			COMPANY_ID,
			model,
			serialNumber,
			manufacturer,
			lastMaintenance,
			nextMaintenance,
			isOperational ? 1 : 0,
			departmentId,
			departmentName,
		],
		(err) => {
			if (err) {
				console.error('Error saving asset:', err);
				return res
					.status(500)
					.json({ error: 'DB error', details: err.message });
			}
			res.json({ success: true });
		}
	);
});

app.get('/api/assets', (req, res) => {
	db.all(
		`SELECT * FROM assets WHERE companyId = ?`,
		[COMPANY_ID],
		(err, rows) => {
			if (err) {
				console.error('Error fetching assets:', err);
				return res
					.status(500)
					.json({ error: 'DB error', details: err.message });
			}
			res.json(
				rows.map((row) => ({
					...row,
					isOperational: row.isOperational === 1,
				}))
			);
		}
	);
});

app.post('/api/map-file', (req, res) => {
	const { siteId, mapFile, mapWidth, mapHeight, mapCorners } = req.body;
	db.run(
		`UPDATE sites SET mapFile = ?, mapWidth = ?, mapHeight = ?, mapCorners = ? WHERE id = ?`,
		[mapFile, mapWidth, mapHeight, JSON.stringify(mapCorners), siteId],
		(err) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			res.json({ success: true });
		}
	);
});

app.get('/api/map/:siteId', (req, res) => {
	const siteId = req.params.siteId;
	db.get(
		`SELECT mapFile, mapWidth, mapHeight, mapCorners FROM sites WHERE id = ? AND companyId = ?`,
		[siteId, COMPANY_ID],
		(err, row) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			if (!row) return res.status(404).json({ error: 'Map not found' });
			res.json(row);
		}
	);
});

// Map configuration (calibration etc.)
app.get('/api/map-config/:siteId', (req, res) => {
	const siteId = req.params.siteId;
	db.get(`SELECT config, updated FROM map_config WHERE siteId = ?`, [siteId], (err, row) => {
		if (err) return res.status(500).json({ error: 'DB error' });
		if (!row) return res.json({ config: null });
		try {
			const cfg = JSON.parse(row.config);
			return res.json({ config: cfg, updated: row.updated });
		} catch(e) {
			return res.json({ config: null });
		}
	});
});

// Simple Tag Registry endpoints
app.get('/api/tags', (req, res) => {
	db.all(`SELECT id, battery, decommissionedAt FROM tags ORDER BY id ASC`, [], (err, rows) => {
		if (err) return res.status(500).json({ error: 'DB error' });
		res.json(rows || []);
	});
});

app.post('/api/tags', (req, res) => {
	const { id, battery } = req.body || {};
	if (!id || typeof id !== 'string') {
		return res.status(400).json({ error: 'Missing tag id' });
	}
	// Normalize battery only if a numeric value was explicitly provided (avoid treating null as 0)
	let batt = null;
	if (battery !== null && battery !== undefined && battery !== '') {
		const num = Number(battery);
		if (Number.isFinite(num)) batt = num;
	}
	console.log('[POST /api/tags] incoming', { id, batteryRaw: battery, parsedBattery: batt });
	const sql = batt === null ? `REPLACE INTO tags (id, battery) VALUES (?, COALESCE((SELECT battery FROM tags WHERE id = ?), -1))` : `REPLACE INTO tags (id, battery) VALUES (?, ?)`;
	const params = batt === null ? [id, id] : [id, batt];
	db.run(sql, params, (err) => {
		if (err) return res.status(500).json({ error: 'DB error' });
		res.json({ success: true });
	});
});

app.delete('/api/tags/:id', (req, res) => {
	const id = req.params.id;
	if (!id) return res.status(400).json({ error: 'Missing tag id' });
	console.log('[DELETE /api/tags/:id] requested', id);
	// Hard delete only if no assignments/positions/associations exist; otherwise soft-delete
	db.serialize(() => {
		db.get(`SELECT 1 FROM tag_assignments WHERE tagId = ? LIMIT 1`, [id], (errA, rowA) => {
			if (errA) return res.status(500).json({ error: 'DB error' });
			db.get(`SELECT 1 FROM tag_positions WHERE tagId = ? LIMIT 1`, [id], (errP, rowP) => {
				if (errP) return res.status(500).json({ error: 'DB error' });
				db.get(`SELECT 1 FROM associations WHERE tagId = ? LIMIT 1`, [id], (errS, rowS) => {
					if (errS) return res.status(500).json({ error: 'DB error' });
					const hasHistory = !!(rowA || rowP || rowS);
					if (!hasHistory) {
						// Hard delete - remove dependent records and the tag itself
						db.run(`DELETE FROM associations WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tag_assignments WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tag_power WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tags WHERE id = ?`, [id], function(errDel) {
							if (errDel) return res.status(500).json({ error: 'DB error' });
							return res.json({ success: true, removed: this.changes || 0, soft: false });
						});
					} else {
						// Soft delete - mark decommissioned and clear current association snapshot
						db.run(`UPDATE tags SET decommissionedAt = CURRENT_TIMESTAMP WHERE id = ?`, [id], (errU) => {
							if (errU) return res.status(500).json({ error: 'DB error' });
							db.run(`DELETE FROM associations WHERE tagId = ?`, [id], () => {
								return res.json({ success: true, removed: 0, soft: true });
							});
						});
					}
				});
			});
		});
	});
});

// Fallback for environments where DELETE might be blocked: POST /api/tags/:id/delete
app.post('/api/tags/:id/delete', (req, res) => {
	const id = req.params.id;
	if (!id) return res.status(400).json({ error: 'Missing tag id' });
	console.log('[POST /api/tags/:id/delete] requested', id);
	db.serialize(() => {
		db.get(`SELECT 1 FROM tag_assignments WHERE tagId = ? LIMIT 1`, [id], (errA, rowA) => {
			if (errA) return res.status(500).json({ error: 'DB error' });
			db.get(`SELECT 1 FROM tag_positions WHERE tagId = ? LIMIT 1`, [id], (errP, rowP) => {
				if (errP) return res.status(500).json({ error: 'DB error' });
				db.get(`SELECT 1 FROM associations WHERE tagId = ? LIMIT 1`, [id], (errS, rowS) => {
					if (errS) return res.status(500).json({ error: 'DB error' });
					const hasHistory = !!(rowA || rowP || rowS);
					if (!hasHistory) {
						db.run(`DELETE FROM associations WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tag_assignments WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tag_power WHERE tagId = ?`, [id]);
						db.run(`DELETE FROM tags WHERE id = ?`, [id], function(errDel) {
							if (errDel) return res.status(500).json({ error: 'DB error' });
							return res.json({ success: true, removed: this.changes || 0, soft: false });
						});
					} else {
						db.run(`UPDATE tags SET decommissionedAt = CURRENT_TIMESTAMP WHERE id = ?`, [id], (errU) => {
							if (errU) return res.status(500).json({ error: 'DB error' });
							db.run(`DELETE FROM associations WHERE tagId = ?`, [id], () => {
								return res.json({ success: true, removed: 0, soft: true });
							});
						});
					}
				});
			});
		});
	});
});

app.post('/api/tags/:id/restore', (req, res) => {
	const id = req.params.id;
	if (!id) return res.status(400).json({ error: 'Missing tag id' });
	db.run(`UPDATE tags SET decommissionedAt = NULL WHERE id = ?`, [id], function(err) {
		if (err) return res.status(500).json({ error: 'DB error' });
		res.json({ success: true, restored: this.changes || 0 });
	});
});

app.post('/api/map-config', (req, res) => {
	const { siteId, config } = req.body || {};
	if (!siteId || typeof config === 'undefined') {
		return res.status(400).json({ error: 'Missing siteId or config' });
	}
	try {
		const payload = JSON.stringify(config);
		db.run(`REPLACE INTO map_config (siteId, config, updated) VALUES (?, ?, CURRENT_TIMESTAMP)`, [siteId, payload], (err) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			res.json({ success: true });
		});
	} catch(e) {
		return res.status(400).json({ error: 'Invalid config JSON' });
	}
});

	app.post('/api/associate', (req, res) => {
	const { tagId, targetType, targetId, siteId } = req.body;
	if (!tagId || !targetType || !targetId || !siteId) {
		return res.status(400).json({ error: 'Missing required fields' });
	}
	if (targetType !== 'employee' && targetType !== 'asset') {
		return res.status(400).json({ error: 'Invalid target type' });
	}

	db.get('SELECT id FROM tags WHERE id = ?', [tagId], (err, tagRow) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		if (!tagRow) {
			db.run('INSERT INTO tags (id, battery) VALUES (?, ?)', [tagId, -1]);
		}

		const persistAssociation = () => {
			const nowIso = new Date().toISOString();
			db.serialize(() => {
				db.run(
					`UPDATE tag_assignments SET validTo = ? WHERE tagId = ? AND (siteId IS ? OR siteId = ?) AND (validTo IS NULL OR validTo > CURRENT_TIMESTAMP)`,
					[nowIso, tagId, siteId || null, siteId || null]
				);
				db.run(
					`INSERT INTO tag_assignments (tagId, targetType, targetId, siteId, validFrom, validTo) VALUES (?, ?, ?, ?, ?, NULL)`,
					[tagId, targetType, targetId, siteId, nowIso]
				);
				db.run(
					`REPLACE INTO associations (tagId, targetType, targetId, siteId) VALUES (?, ?, ?, ?)`,
					[tagId, targetType, targetId, siteId],
					(err2) => {
						if (err2) return res.status(500).json({ error: 'Database error' });
						db.run(
							`INSERT INTO logs (type, message, siteId) VALUES (?, ?, ?)`,
							['ASSOCIATION', `Tag ${tagId} associated with ${targetType} ${targetId}`, siteId]
						);
						res.json({ success: true });
					}
				);
			});
		};

		const targetTable = targetType === 'employee' ? 'users' : 'assets';
		db.get(
			`SELECT id FROM ${targetTable} WHERE id = ? AND (companyId IS NULL OR companyId = ?)`,
			[targetId, COMPANY_ID],
			(err2, targetRow) => {
				if (err2) return res.status(500).json({ error: 'Database error' });
				if (!targetRow) {
					console.warn(`Association warning: ${targetType} ${targetId} not found locally, proceeding anyway`);
				}
				persistAssociation();
			}
		);
	});
});

app.delete('/api/associate/:siteId/:tagId', (req, res) => {

	const { siteId, tagId } = req.params;

	if (!siteId || !tagId) {

		return res.status(400).json({ error: 'Missing siteId or tagId' });

	}

	db.run(

		'DELETE FROM associations WHERE siteId = ? AND tagId = ?',

		[siteId, tagId],

		function (err) {

			if (err) return res.status(500).json({ error: 'Database error' });

			db.run(
				`DELETE FROM tag_assignments WHERE tagId = ? AND (siteId IS ? OR siteId = ?)`,
				[tagId, siteId || null, siteId || null]
			);

			db.run(

				`INSERT INTO logs (type, message, siteId) VALUES (?, ?, ?)`,

				['ASSOCIATION', `Tag ${tagId} dissociated`, siteId]

			);

			res.json({ success: true, removed: this.changes || 0 });

		}

	);

});



// Aggiungi anche un endpoint per ottenere le associazioni dei tag
app.get('/api/associations/:siteId', (req, res) => {
	const siteId = req.params.siteId;

	db.all(
		`SELECT a.*, 
      CASE 
        WHEN a.targetType = 'employee' THEN u.name 
        ELSE ast.name 
      END as targetName
    FROM associations a
    LEFT JOIN users u ON a.targetType = 'employee' AND a.targetId = u.id
    LEFT JOIN assets ast ON a.targetType = 'asset' AND a.targetId = ast.id
    WHERE a.siteId = ?`,
		[siteId],
		(err, rows) => {
			if (err) return res.status(500).json({ error: 'Database error' });
			res.json(rows);
		}
	);
});

// === Tag assignments (time-bounded) ===
// List assignments (optionally filter by tagId/siteId). If current=1, only open/current ones
app.get('/api/tag-assignments', (req, res) => {
	const { tagId, siteId, current } = req.query || {};
	const clauses = [];
	const params = [];
	if (tagId) { clauses.push('tagId = ?'); params.push(String(tagId)); }
	if (siteId) { clauses.push('siteId = ?'); params.push(String(siteId)); }
	if (current === '1' || current === 'true') {
		clauses.push('(validTo IS NULL OR validTo > CURRENT_TIMESTAMP)');
	}
	const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
	const sql = `SELECT * FROM tag_assignments ${where} ORDER BY validFrom DESC, id DESC`;
	db.all(sql, params, (err, rows) => {
		if (err) return res.status(500).json({ error: 'DB error' });
		res.json(rows || []);
	});
});

// Create new assignment and automatically close previous open assignment for the same tag/site
app.post('/api/tag-assignments', (req, res) => {
	const { tagId, targetType, targetId, siteId, validFrom, validTo } = req.body || {};
	if (!tagId || !targetType || !targetId) {
		return res.status(400).json({ error: 'Missing tagId/targetType/targetId' });
	}
	if (targetType !== 'employee' && targetType !== 'asset') {
		return res.status(400).json({ error: 'Invalid targetType' });
	}
	const startTs = validFrom ? new Date(validFrom) : new Date();
	if (isNaN(startTs.getTime())) return res.status(400).json({ error: 'Invalid validFrom' });
	const endTs = validTo ? new Date(validTo) : null;

	db.serialize(() => {
		// ensure tag exists
		db.run('INSERT OR IGNORE INTO tags (id, battery) VALUES (?, COALESCE((SELECT battery FROM tags WHERE id=?), -1))', [String(tagId), String(tagId)]);
		// close previous open assignment for this tag/site
		db.run(
			`UPDATE tag_assignments SET validTo = ? WHERE tagId = ? AND (siteId IS ? OR siteId = ?) AND (validTo IS NULL OR validTo > ?)`,
			[startTs.toISOString(), String(tagId), siteId || null, siteId || null, startTs.toISOString()],
			(errClose) => {
				if (errClose) return res.status(500).json({ error: 'DB error' });
				// insert new assignment
				db.run(
					`INSERT INTO tag_assignments (tagId, targetType, targetId, siteId, validFrom, validTo) VALUES (?, ?, ?, ?, ?, ?)`,
					[String(tagId), targetType, Number(targetId), siteId || null, startTs.toISOString(), endTs ? endTs.toISOString() : null],
					function (errIns) {
						if (errIns) return res.status(500).json({ error: 'DB error' });
						res.json({ success: true, id: this.lastID });
					}
				);
			}
		);
	});
});

// Close assignment: by id or by (tagId, siteId) current one
app.post('/api/tag-assignments/close', (req, res) => {
	const { id, tagId, siteId, validTo } = req.body || {};
	const endTs = validTo ? new Date(validTo) : new Date();
	if (isNaN(endTs.getTime())) return res.status(400).json({ error: 'Invalid validTo' });
	if (id) {
		db.run(`UPDATE tag_assignments SET validTo = ? WHERE id = ?`, [endTs.toISOString(), Number(id)], (err) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			res.json({ success: true });
		});
		return;
	}
	if (!tagId) return res.status(400).json({ error: 'Missing id or tagId' });
	db.run(
		`UPDATE tag_assignments SET validTo = ? WHERE tagId = ? AND (siteId IS ? OR siteId = ?) AND (validTo IS NULL OR validTo > CURRENT_TIMESTAMP)`,
		[endTs.toISOString(), String(tagId), siteId || null, siteId || null],
		(err) => {
			if (err) return res.status(500).json({ error: 'DB error' });
			res.json({ success: true });
		}
	);
});

// Current associations derived from assignments
app.get('/api/current-associations/:siteId', (req, res) => {
	const siteId = req.params.siteId;
	const sql = `
		SELECT ta.*, 
			CASE WHEN ta.targetType='employee' THEN u.name ELSE ast.name END AS targetName
		FROM tag_assignments ta
		LEFT JOIN users u ON ta.targetType='employee' AND ta.targetId=u.id
		LEFT JOIN assets ast ON ta.targetType='asset' AND ta.targetId=ast.id
		WHERE (ta.siteId IS ? OR ta.siteId = ?) AND (ta.validTo IS NULL OR ta.validTo > CURRENT_TIMESTAMP)
		ORDER BY ta.tagId ASC
	`;
	db.all(sql, [siteId || null, siteId || null], (err, rows) => {
		if (err) return res.status(500).json({ error: 'DB error' });
		res.json(rows || []);
	});
});
