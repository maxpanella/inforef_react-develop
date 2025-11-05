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

// === Routes ===

// Avvio server dopo inizializzazione DB
app.listen(PORT, () => {
	console.log(`✅ BlueIOT backend listening on http://localhost:${PORT}`);
});

app.get('/', (req, res) => res.send('BlueIOT backend running'));

app.get('/api/sites', (req, res) => {
	db.all(
		`SELECT * FROM sites WHERE companyId = ?`,
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

app.post('/api/associate', (req, res) => {
	const { tagId, targetType, targetId, siteId } = req.body;

	if (!tagId || !targetType || !targetId || !siteId) {
		return res.status(400).json({ error: 'Missing required fields' });
	}

	// Verifica che il tipo di entità sia valido
	if (targetType !== 'employee' && targetType !== 'asset') {
		return res.status(400).json({ error: 'Invalid target type' });
	}

	// Verifica l'esistenza del tag
	db.get('SELECT id FROM tags WHERE id = ?', [tagId], (err, tagRow) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		if (!tagRow) {
			// Il tag non esiste, lo creiamo con batteria sconosciuta
			db.run('INSERT INTO tags (id, battery) VALUES (?, ?)', [tagId, -1]);
		}

		// Verifica che l'entità target esista nella tabella appropriata
		const targetTable = targetType === 'employee' ? 'users' : 'assets';
		db.get(
			`SELECT id FROM ${targetTable} WHERE id = ? AND companyId = ?`,
			[targetId, COMPANY_ID],
			(err, targetRow) => {
				if (err) return res.status(500).json({ error: 'Database error' });
				if (!targetRow)
					return res.status(404).json({ error: `${targetType} not found` });

				// Salva l'associazione
				db.run(
					`REPLACE INTO associations (tagId, targetType, targetId, siteId) VALUES (?, ?, ?, ?)`,
					[tagId, targetType, targetId, siteId],
					(err) => {
						if (err) return res.status(500).json({ error: 'Database error' });

						// Registra l'azione nel log
						db.run(
							`INSERT INTO logs (type, message, siteId) VALUES (?, ?, ?)`,
							[
								'ASSOCIATION',
								`Tag ${tagId} associated with ${targetType} ${targetId}`,
								siteId,
							]
						);

						res.json({ success: true });
					}
				);
			}
		);
	});
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
