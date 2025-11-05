// server/websocket-verge3d.js
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Crea server HTTP
const app = express();
const server = http.createServer(app);

// Crea WebSocket server
const wss = new WebSocket.Server({
	server,
	path: '/verge3d',
});

// Store per i client connessi
const clients = {
	blueiot: new Set(),
	verge3d: new Set(),
};

// Store per l'ultimo stato conosciuto
let lastKnownState = {
	tags: {},
	employees: {},
	assets: {},
	alarms: [],
};

wss.on('connection', (ws, req) => {
	console.log('Nuova connessione WebSocket');

	// Identifica il tipo di client dalla query string
	const urlParams = new URLSearchParams(req.url.split('?')[1]);
	const clientType = urlParams.get('client') || 'unknown';

	console.log(`Client connesso: ${clientType}`);

	// Aggiungi il client alla lista appropriata
	if (clientType === 'blueiot') {
		clients.blueiot.add(ws);
	} else if (clientType === 'verge3d') {
		clients.verge3d.add(ws);

		// Invia lo stato corrente al nuovo client Verge3D
		ws.send(
			JSON.stringify({
				type: 'initial_state',
				data: lastKnownState,
			})
		);
	}

	// Gestione messaggi
	ws.on('message', (message) => {
		try {
			const data = JSON.parse(message);
			console.log(`Messaggio ricevuto da ${clientType}:`, data.type);

			// Router dei messaggi basato sul tipo
			switch (data.type) {
				case 'tag_update':
					handleTagUpdate(data, ws, clientType);
					break;

				case 'alarm':
					handleAlarm(data, ws, clientType);
					break;

				case 'command':
					handleCommand(data, ws, clientType);
					break;

				case 'scene_event':
					handleSceneEvent(data, ws, clientType);
					break;

				case 'request_state':
					ws.send(
						JSON.stringify({
							type: 'state_update',
							data: lastKnownState,
						})
					);
					break;

				default:
					console.log('Tipo di messaggio non riconosciuto:', data.type);
			}
		} catch (error) {
			console.error('Errore nel parsing del messaggio:', error);
		}
	});

	// Gestione disconnessione
	ws.on('close', () => {
		console.log(`Client ${clientType} disconnesso`);
		clients.blueiot.delete(ws);
		clients.verge3d.delete(ws);
	});

	// Gestione errori
	ws.on('error', (error) => {
		console.error(`Errore WebSocket per client ${clientType}:`, error);
	});
});

// Handler per aggiornamenti tag
function handleTagUpdate(data, sender, senderType) {
	// Aggiorna lo stato interno
	if (data.tagId && data.position) {
		lastKnownState.tags[data.tagId] = {
			...lastKnownState.tags[data.tagId],
			position: data.position,
			lastUpdate: new Date().toISOString(),
		};
	}

	// Inoltra a tutti i client Verge3D
	if (senderType === 'blueiot') {
		broadcast(clients.verge3d, {
			type: 'tag_position',
			tagId: data.tagId,
			position: data.position,
			entity: data.entity || null,
		});
	}
}

// Handler per allarmi
function handleAlarm(data, sender, senderType) {
	// Aggiungi allarme allo stato
	const alarm = {
		id: Date.now(),
		...data.alarm,
		timestamp: new Date().toISOString(),
	};

	lastKnownState.alarms.push(alarm);

	// Mantieni solo gli ultimi 100 allarmi
	if (lastKnownState.alarms.length > 100) {
		lastKnownState.alarms = lastKnownState.alarms.slice(-100);
	}

	// Inoltra a tutti i client
	broadcast(clients.verge3d, {
		type: 'alarm',
		alarm: alarm,
	});
}

// Handler per comandi (da Verge3D a BlueIOT)
function handleCommand(data, sender, senderType) {
	if (senderType === 'verge3d') {
		// Inoltra comando ai client BlueIOT
		broadcast(clients.blueiot, {
			type: 'command',
			command: data.command,
			params: data.params,
		});
	}
}

// Handler per eventi della scena 3D
function handleSceneEvent(data, sender, senderType) {
	if (senderType === 'verge3d') {
		console.log('Evento scena 3D:', data.event);

		// Potresti voler processare alcuni eventi specifici
		switch (data.event) {
			case 'object_clicked':
				// Inoltra ai client BlueIOT se necessario
				broadcast(clients.blueiot, {
					type: 'scene_interaction',
					object: data.object,
					action: 'clicked',
				});
				break;

			case 'area_entered':
				// Gestisci l'ingresso in un'area
				console.log(`Oggetto ${data.object} entrato nell'area ${data.area}`);
				break;
		}
	}
}

// Funzione di broadcast
function broadcast(clientSet, message) {
	const messageStr = JSON.stringify(message);
	clientSet.forEach((client) => {
		if (client.readyState === WebSocket.OPEN) {
			client.send(messageStr);
		}
	});
}

// Endpoint HTTP per ottenere lo stato corrente
app.get('/api/state', (req, res) => {
	res.json(lastKnownState);
});

// Endpoint per inviare comandi
app.post('/api/command', express.json(), (req, res) => {
	const { command, params } = req.body;

	// Broadcast del comando a tutti i client
	broadcast(clients.blueiot, {
		type: 'command',
		command,
		params,
	});

	res.json({ success: true });
});

// Avvia il server
const PORT = process.env.VERGE3D_WS_PORT || 4001;
server.listen(PORT, () => {
	console.log(`WebSocket server per Verge3D in ascolto sulla porta ${PORT}`);
});
