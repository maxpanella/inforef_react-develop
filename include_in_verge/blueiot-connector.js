// verge3d/blueiot-connector.js
// Script da includere nel tuo progetto Verge3D

class BlueIOTConnector {
	constructor(wsUrl = 'ws://localhost:4001/verge3d?client=verge3d') {
		this.wsUrl = wsUrl;
		this.ws = null;
		this.isConnected = false;
		this.reconnectInterval = 5000;
		this.tags = {};
		this.tagObjects = {}; // Mappa tagId -> oggetto 3D
		this.app = null; // Riferimento all'app Verge3D

		// Callback handlers
		this.onTagUpdate = null;
		this.onAlarm = null;
		this.onConnect = null;
		this.onDisconnect = null;
	}

	// Inizializza la connessione
	init(app) {
		this.app = app;
		this.connect();
	}

	// Connetti al WebSocket server
	connect() {
		console.log('Connessione a BlueIOT WebSocket...');

		this.ws = new WebSocket(this.wsUrl);

		this.ws.onopen = () => {
			console.log('Connesso a BlueIOT WebSocket');
			this.isConnected = true;

			// Richiedi lo stato iniziale
			this.send({
				type: 'request_state',
			});

			if (this.onConnect) {
				this.onConnect();
			}
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (error) {
				console.error('Errore parsing messaggio:', error);
			}
		};

		this.ws.onclose = () => {
			console.log('Disconnesso da BlueIOT WebSocket');
			this.isConnected = false;

			if (this.onDisconnect) {
				this.onDisconnect();
			}

			// Riconnessione automatica
			setTimeout(() => {
				this.connect();
			}, this.reconnectInterval);
		};

		this.ws.onerror = (error) => {
			console.error('Errore WebSocket:', error);
		};
	}

	// Gestisci i messaggi in arrivo
	handleMessage(data) {
		switch (data.type) {
			case 'initial_state':
			case 'state_update':
				this.updateState(data.data);
				break;

			case 'tag_position':
				this.updateTagPosition(data.tagId, data.position, data.entity);
				break;

			case 'alarm':
				this.handleAlarm(data.alarm);
				break;

			case 'scene_interaction':
				this.handleSceneInteraction(data);
				break;
		}
	}

	// Aggiorna lo stato completo
	updateState(state) {
		console.log('Stato ricevuto:', state);
		this.tags = state.tags || {};

		// Aggiorna le posizioni di tutti i tag
		Object.keys(this.tags).forEach((tagId) => {
			const tag = this.tags[tagId];
			if (tag.position) {
				this.updateTagPosition(tagId, tag.position);
			}
		});
	}

	// Aggiorna la posizione di un tag
	updateTagPosition(tagId, position, entity) {
		// Salva i dati del tag
		this.tags[tagId] = {
			...this.tags[tagId],
			position: position,
			entity: entity,
		};

		// Se abbiamo un oggetto 3D associato, aggiorna la sua posizione
		if (this.tagObjects[tagId]) {
			const obj = this.tagObjects[tagId];

			// Converti le coordinate dal sistema BlueIOT al sistema Verge3D
			// Potrebbe essere necessario adattare la scala e l'orientamento
			obj.position.x = position.x;
			obj.position.y = 0.5; // Altezza fissa o usa position.z
			obj.position.z = -position.y; // Inverti Y per Z in Verge3D

			// Aggiorna il materiale se necessario
			if (entity && entity.type) {
				this.updateTagAppearance(obj, entity.type);
			}
		}

		// Callback personalizzato
		if (this.onTagUpdate) {
			this.onTagUpdate(tagId, position, entity);
		}
	}

	// Crea o ottieni un oggetto 3D per un tag
	createOrGetTagObject(tagId) {
		if (!this.tagObjects[tagId]) {
			// Crea un nuovo oggetto per il tag
			// In un progetto reale, potresti clonare un modello esistente
			const geometry = new v3d.SphereGeometry(0.5, 16, 16);
			const material = new v3d.MeshBasicMaterial({
				color: 0x00ff00,
				emissive: 0x00ff00,
				emissiveIntensity: 0.5,
			});
			const sphere = new v3d.Mesh(geometry, material);

			// Aggiungi etichetta
			const labelDiv = document.createElement('div');
			labelDiv.className = 'tag-label';
			labelDiv.textContent = tagId;
			labelDiv.style.position = 'absolute';
			labelDiv.style.color = 'white';
			labelDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
			labelDiv.style.padding = '2px 5px';
			labelDiv.style.borderRadius = '3px';
			labelDiv.style.fontSize = '12px';
			labelDiv.style.pointerEvents = 'none';

			const label = new v3d.CSS2DObject(labelDiv);
			label.position.set(0, 0.8, 0);
			sphere.add(label);

			// Aggiungi alla scena
			this.app.scene.add(sphere);
			this.tagObjects[tagId] = sphere;

			// Rendi l'oggetto cliccabile
			this.makeObjectClickable(sphere, tagId);
		}

		return this.tagObjects[tagId];
	}

	// Rendi un oggetto cliccabile
	makeObjectClickable(object, tagId) {
		// Aggiungi l'oggetto alla lista degli oggetti cliccabili di Verge3D
		if (this.app.raycaster) {
			// Implementa la logica di click
			object.userData.tagId = tagId;
			object.userData.clickable = true;
		}
	}

	// Aggiorna l'aspetto di un tag basato sul tipo
	updateTagAppearance(object, type) {
		let color;
		switch (type) {
			case 'employee':
				color = 0x0080ff; // Blu per dipendenti
				break;
			case 'asset':
				color = 0x00ff00; // Verde per asset
				break;
			default:
				color = 0xffff00; // Giallo per non assegnati
		}

		if (object.material) {
			object.material.color.setHex(color);
			object.material.emissive.setHex(color);
		}
	}

	// Gestisci allarmi
	handleAlarm(alarm) {
		console.log('Allarme ricevuto:', alarm);

		// Evidenzia il tag che ha generato l'allarme
		if (alarm.tagId && this.tagObjects[alarm.tagId]) {
			const obj = this.tagObjects[alarm.tagId];

			// Lampeggia l'oggetto
			this.blinkObject(obj, 0xff0000, 5);
		}

		if (this.onAlarm) {
			this.onAlarm(alarm);
		}
	}

	// Effetto lampeggio per un oggetto
	blinkObject(object, color, times) {
		const originalColor = object.material.color.getHex();
		const originalEmissive = object.material.emissive.getHex();
		let count = 0;

		const blink = () => {
			if (count >= times * 2) {
				object.material.color.setHex(originalColor);
				object.material.emissive.setHex(originalEmissive);
				return;
			}

			if (count % 2 === 0) {
				object.material.color.setHex(color);
				object.material.emissive.setHex(color);
			} else {
				object.material.color.setHex(originalColor);
				object.material.emissive.setHex(originalEmissive);
			}

			count++;
			setTimeout(blink, 300);
		};

		blink();
	}

	// Invia un messaggio al server
	send(data) {
		if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	// Invia un evento dalla scena
	sendSceneEvent(eventType, data) {
		this.send({
			type: 'scene_event',
			event: eventType,
			...data,
		});
	}

	// Invia un comando
	sendCommand(command, params) {
		this.send({
			type: 'command',
			command: command,
			params: params,
		});
	}

	// Pulisci risorse
	dispose() {
		if (this.ws) {
			this.ws.close();
		}

		// Rimuovi oggetti 3D
		Object.values(this.tagObjects).forEach((obj) => {
			this.app.scene.remove(obj);
			if (obj.geometry) obj.geometry.dispose();
			if (obj.material) obj.material.dispose();
		});

		this.tagObjects = {};
	}
}

// Esempio di utilizzo in Verge3D
function initBlueIOTIntegration(app) {
	// Crea connettore
	const connector = new BlueIOTConnector();

	// Configura callback
	connector.onConnect = () => {
		console.log('Connesso a BlueIOT!');
		// Mostra indicatore di connessione
	};

	connector.onTagUpdate = (tagId, position, entity) => {
		// Crea o aggiorna oggetto 3D per il tag
		const tagObject = connector.createOrGetTagObject(tagId);

		// Potresti voler fare altro, come aggiornare UI
		console.log(`Tag ${tagId} aggiornato:`, position);
	};

	connector.onAlarm = (alarm) => {
		// Mostra notifica allarme
		console.warn('ALLARME:', alarm);

		// Potresti mostrare un popup o cambiare lo stato della scena
	};

	// Inizializza connessione
	connector.init(app);

	// Aggiungi interazioni con oggetti della scena
	app.addOnClickListener((object) => {
		if (object.userData.tagId) {
			// Click su un tag
			connector.sendSceneEvent('object_clicked', {
				object: object.userData.tagId,
				position: object.position,
			});
		}
	});

	// Ritorna il connettore per uso futuro
	return connector;
}

// Esporta per uso in Verge3D
window.BlueIOTConnector = BlueIOTConnector;
window.initBlueIOTIntegration = initBlueIOTIntegration;
