// verge3d/blueiot-integration.js
// Questo file va nella cartella del tuo progetto Verge3D

// Variabili globali per l'integrazione
window.blueiotData = {
	connector: null,
	selectedEmployee: null,
	selectedAsset: null,
	employeePanel: null,
	assetPanels: {},
	tagToObject: {}, // Mappa tagId -> nome oggetto Verge3D
	objectToTag: {}, // Mappa nome oggetto -> tagId
};

// Funzione principale di inizializzazione
function initBlueIOT(app) {
	console.log('Inizializzazione BlueIOT in Verge3D');

	// Crea il pannello informazioni dipendente (nascosto inizialmente)
	createEmployeePanel();

	// Inizializza il connettore
	const connector = new BlueIOTConnector();
	window.blueiotData.connector = connector;

	// Configura i callback
	connector.onConnect = () => {
		console.log('✅ Connesso a BlueIOT!');
		// Puoi chiamare un puzzle qui
		if (
			window.v3d &&
			window.v3d.puzzles &&
			window.v3d.puzzles.procedures.onBlueIOTConnected
		) {
			window.v3d.puzzles.procedures.onBlueIOTConnected();
		}
	};

	connector.onTagUpdate = (tagId, position, entity) => {
		// Aggiorna oggetto esistente o creane uno nuovo
		updateTagObject(app, tagId, position, entity);
	};

	connector.onAlarm = (alarm) => {
		// Gestisci allarme
		handleAlarmInScene(app, alarm);
	};

	// Handler per messaggi custom da React
	connector.onCustomMessage = (message) => {
		handleCustomMessage(app, message);
	};

	// Inizia la connessione
	connector.init(app);

	// Aggiungi handler per click sugli oggetti
	setupObjectInteractions(app);
}

// Crea il pannello informazioni dipendente
function createEmployeePanel() {
	const panel = document.createElement('div');
	panel.id = 'employee-info-panel';
	panel.className = 'info-panel';
	panel.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        width: 300px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        display: none;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 1000;
    `;

	panel.innerHTML = `
        <button onclick="closeEmployeePanel()" style="
            position: absolute;
            top: 10px;
            right: 10px;
            background: #ff4444;
            border: none;
            color: white;
            padding: 5px 10px;
            border-radius: 5px;
            cursor: pointer;
        ">✕</button>
        
        <h2 id="employee-name" style="margin-top: 0; color: #4CAF50;"></h2>
        <div id="employee-details"></div>
    `;

	document.body.appendChild(panel);
	window.blueiotData.employeePanel = panel;
}

// Mostra informazioni dipendente
function showEmployeeInfo(employee) {
	if (!window.blueiotData.employeePanel) return;

	const panel = window.blueiotData.employeePanel;
	const nameEl = panel.querySelector('#employee-name');
	const detailsEl = panel.querySelector('#employee-details');

	nameEl.textContent = employee.name || 'Dipendente';

	detailsEl.innerHTML = `
        <p><strong>Ruolo:</strong> ${employee.role || 'N/A'}</p>
        <p><strong>Reparto:</strong> ${employee.department || 'N/A'}</p>
        <p><strong>Email:</strong> ${employee.email || 'N/A'}</p>
        <p><strong>Telefono:</strong> ${employee.phone || 'N/A'}</p>
        ${
					employee.isActive
						? '<p style="color: #4CAF50;">✓ Attivo</p>'
						: '<p style="color: #ff4444;">✗ Inattivo</p>'
				}
        ${
					employee.tagId ? `<p><strong>Tag:</strong> ${employee.tagId}</p>` : ''
				}
        ${
					employee.lastPosition
						? `
            <p><strong>Ultima posizione:</strong><br>
            X: ${employee.lastPosition.x.toFixed(2)}, 
            Y: ${employee.lastPosition.y.toFixed(2)}</p>
        `
						: ''
				}
        ${
					employee.formazione && employee.formazione.length > 0
						? `
            <div style="margin-top: 10px;">
                <strong>Formazione:</strong>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    ${employee.formazione
											.map(
												(f) => `<li>${f.courseName} (${f.completionDate})</li>`
											)
											.join('')}
                </ul>
            </div>
        `
						: ''
				}
    `;

	panel.style.display = 'block';
	window.blueiotData.selectedEmployee = employee;
}

// Chiudi pannello dipendente
window.closeEmployeePanel = function () {
	if (window.blueiotData.employeePanel) {
		window.blueiotData.employeePanel.style.display = 'none';
		window.blueiotData.selectedEmployee = null;
	}
};

// Crea pannello per asset
function createAssetPanel(asset, object) {
	const panel = document.createElement('div');
	panel.className = 'asset-label';
	panel.style.cssText = `
        background: rgba(0, 100, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-size: 14px;
        pointer-events: none;
    `;

	panel.innerHTML = `
        <strong>${asset.name}</strong><br>
        <small>${asset.type}</small>
        ${
					asset.isOperational
						? '<br><span style="color: #4CAF50;">✓ Operativo</span>'
						: '<br><span style="color: #ff4444;">✗ Non Operativo</span>'
				}
    `;

	const label = new v3d.CSS2DObject(panel);
	label.position.set(0, 2, 0); // Sopra l'oggetto
	object.add(label);

	return label;
}

// Aggiorna o crea oggetto per tag
function updateTagObject(app, tagId, position, entity) {
	// Controlla se abbiamo un oggetto mappato per questo tag
	const objectName = window.blueiotData.tagToObject[tagId];

	if (objectName) {
		// Usa oggetto esistente nella scena
		const object = app.scene.getObjectByName(objectName);
		if (object) {
			// Aggiorna posizione (se l'oggetto non è statico)
			if (!object.userData.isStatic) {
				object.position.x = position.x;
				object.position.z = -position.y; // Inverti Y per Z
			}

			// Aggiorna dati
			object.userData.tagId = tagId;
			object.userData.entity = entity;
			object.userData.lastUpdate = new Date().toISOString();

			// Aggiorna materiale in base al tipo
			updateObjectAppearance(object, entity);

			// Se è un asset, aggiorna/crea etichetta
			if (entity && entity.type === 'asset' && !object.userData.assetLabel) {
				object.userData.assetLabel = createAssetPanel(entity, object);
			}
		}
	} else {
		// Crea nuovo oggetto dinamico (come prima)
		createDynamicTagObject(app, tagId, position, entity);
	}
}

// Crea oggetto dinamico per tag non mappati
function createDynamicTagObject(app, tagId, position, entity) {
	let geometry, material;

	if (entity && entity.type === 'employee') {
		// Cilindro per dipendenti
		geometry = new v3d.CylinderGeometry(0.3, 0.3, 1.8, 8);
		material = new v3d.MeshPhongMaterial({
			color: 0x2196f3,
			emissive: 0x2196f3,
			emissiveIntensity: 0.2,
		});
	} else if (entity && entity.type === 'asset') {
		// Cubo per asset
		geometry = new v3d.BoxGeometry(1, 1, 1);
		material = new v3d.MeshPhongMaterial({
			color: 0x4caf50,
			emissive: 0x4caf50,
			emissiveIntensity: 0.2,
		});
	} else {
		// Sfera per non assegnati
		geometry = new v3d.SphereGeometry(0.4, 16, 16);
		material = new v3d.MeshPhongMaterial({
			color: 0xffeb3b,
			emissive: 0xffeb3b,
			emissiveIntensity: 0.3,
		});
	}

	const mesh = new v3d.Mesh(geometry, material);
	mesh.name = `BlueIOT_Tag_${tagId}`;
	mesh.position.set(
		position.x,
		entity && entity.type === 'employee' ? 0.9 : 0.5,
		-position.y
	);

	// Aggiungi dati
	mesh.userData.tagId = tagId;
	mesh.userData.entity = entity;
	mesh.userData.isDynamic = true;
	mesh.userData.lastUpdate = new Date().toISOString();

	// Aggiungi etichetta
	const labelDiv = document.createElement('div');
	labelDiv.className = 'tag-label';
	labelDiv.style.cssText = `
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 12px;
        white-space: nowrap;
    `;
	labelDiv.textContent = entity ? entity.name : tagId;

	const label = new v3d.CSS2DObject(labelDiv);
	label.position.set(0, entity && entity.type === 'employee' ? 2.2 : 1.2, 0);
	mesh.add(label);

	// Aggiungi alla scena
	app.scene.add(mesh);

	// Rendilo cliccabile
	if (window.v3d.puzzles && window.v3d.puzzles.objectList) {
		window.v3d.puzzles.objectList.push(mesh.name);
	}
}

// Aggiorna aspetto oggetto
function updateObjectAppearance(object, entity) {
	if (!object.material) return;

	let color, emissive;

	if (entity && entity.type === 'employee') {
		color = 0x2196f3; // Blu
		emissive = 0x2196f3;
	} else if (entity && entity.type === 'asset') {
		color = 0x4caf50; // Verde
		emissive = 0x4caf50;
	} else {
		color = 0xffeb3b; // Giallo
		emissive = 0xffeb3b;
	}

	object.material.color.setHex(color);
	if (object.material.emissive) {
		object.material.emissive.setHex(emissive);
	}
}

// Gestisci messaggi custom da React
function handleCustomMessage(app, message) {
	switch (message.type) {
		case 'show_employee':
			// React ha inviato i dati di un dipendente da mostrare
			showEmployeeInfo(message.data);

			// Se il dipendente ha un tag, evidenzialo nella scena
			if (message.data.tagId) {
				highlightTag(app, message.data.tagId);
			}
			break;

		case 'map_object_to_tag':
			// Associa un oggetto della scena a un tag
			mapObjectToTag(app, message.objectName, message.tagId);
			break;

		case 'update_asset_status':
			// Aggiorna lo stato di un asset
			updateAssetStatus(app, message.assetId, message.status);
			break;
	}
}

// Mappa un oggetto esistente a un tag
function mapObjectToTag(app, objectName, tagId) {
	const object = app.scene.getObjectByName(objectName);
	if (object) {
		// Salva mappatura
		window.blueiotData.tagToObject[tagId] = objectName;
		window.blueiotData.objectToTag[objectName] = tagId;

		// Aggiungi dati all'oggetto
		object.userData.tagId = tagId;
		object.userData.isMapped = true;

		console.log(`Oggetto ${objectName} mappato al tag ${tagId}`);

		// Notifica i puzzle
		if (window.v3d.puzzles && window.v3d.puzzles.procedures.onObjectMapped) {
			window.v3d.puzzles.procedures.onObjectMapped(objectName, tagId);
		}
	}
}

// Evidenzia un tag
function highlightTag(app, tagId) {
	const objectName = window.blueiotData.tagToObject[tagId];
	let object;

	if (objectName) {
		object = app.scene.getObjectByName(objectName);
	} else {
		// Cerca oggetto dinamico
		object = app.scene.getObjectByName(`BlueIOT_Tag_${tagId}`);
	}

	if (object) {
		// Effetto highlight
		const originalEmissive = object.material.emissive
			? object.material.emissive.getHex()
			: 0x000000;
		const originalIntensity = object.material.emissiveIntensity || 0;

		// Animazione pulse
		let intensity = 0;
		let increasing = true;
		const pulseInterval = setInterval(() => {
			if (increasing) {
				intensity += 0.1;
				if (intensity >= 1) {
					increasing = false;
				}
			} else {
				intensity -= 0.1;
				if (intensity <= 0) {
					clearInterval(pulseInterval);
					// Ripristina
					if (object.material.emissive) {
						object.material.emissive.setHex(originalEmissive);
						object.material.emissiveIntensity = originalIntensity;
					}
					return;
				}
			}

			if (object.material.emissive) {
				object.material.emissive.setHex(0xffffff);
				object.material.emissiveIntensity = intensity;
			}
		}, 50);

		// Centra camera
		if (app.controls) {
			app.controls.target.copy(object.position);
			app.controls.update();
		}
	}
}

// Setup interazioni con oggetti
function setupObjectInteractions(app) {
	// Override del click handler di Verge3D
	const originalOnClick = app.onPointerClick;

	app.onPointerClick = function (event) {
		// Prima chiama l'handler originale
		if (originalOnClick) {
			originalOnClick.call(app, event);
		}

		// Poi gestisci click per BlueIOT
		const intersects = app.raycaster.intersectObjects(app.scene.children, true);

		if (intersects.length > 0) {
			const object = intersects[0].object;

			// Risali all'oggetto principale se necessario
			let mainObject = object;
			while (mainObject.parent && mainObject.parent !== app.scene) {
				if (mainObject.userData.tagId || mainObject.userData.entity) {
					break;
				}
				mainObject = mainObject.parent;
			}

			if (mainObject.userData.tagId) {
				// Oggetto con tag
				console.log('Cliccato oggetto con tag:', mainObject.userData.tagId);

				// Invia evento a React
				if (window.blueiotData.connector) {
					window.blueiotData.connector.sendSceneEvent('object_clicked', {
						object: mainObject.name,
						tagId: mainObject.userData.tagId,
						entity: mainObject.userData.entity,
					});
				}

				// Se è un dipendente, mostra info
				if (
					mainObject.userData.entity &&
					mainObject.userData.entity.type === 'employee'
				) {
					// Richiedi dettagli completi a React
					window.blueiotData.connector.send({
						type: 'request_employee_details',
						employeeId: mainObject.userData.entity.id,
					});
				}
			}
		}
	};
}

// Gestisci allarmi nella scena
function handleAlarmInScene(app, alarm) {
	console.log('Allarme ricevuto:', alarm);

	// Trova oggetto associato al tag
	const objectName = window.blueiotData.tagToObject[alarm.tagId];
	let object;

	if (objectName) {
		object = app.scene.getObjectByName(objectName);
	} else {
		object = app.scene.getObjectByName(`BlueIOT_Tag_${alarm.tagId}`);
	}

	if (object) {
		// Effetto allarme
		blinkObject(object, 0xff0000, 10);

		// Mostra notifica
		showAlarmNotification(alarm);
	}
}

// Mostra notifica allarme
function showAlarmNotification(alarm) {
	const notification = document.createElement('div');
	notification.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border-radius: 10px;
        font-size: 18px;
        font-weight: bold;
        z-index: 2000;
        animation: pulse 0.5s infinite alternate;
    `;

	notification.innerHTML = `
        ⚠️ ALLARME: ${alarm.type}<br>
        Tag: ${alarm.tagId}<br>
        <button onclick="this.parentElement.remove()" style="
            margin-top: 10px;
            padding: 5px 15px;
            background: white;
            color: red;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        ">OK</button>
    `;

	// Aggiungi animazione CSS
	const style = document.createElement('style');
	style.textContent = `
        @keyframes pulse {
            from { transform: translate(-50%, -50%) scale(1); }
            to { transform: translate(-50%, -50%) scale(1.05); }
        }
    `;
	document.head.appendChild(style);

	document.body.appendChild(notification);

	// Rimuovi dopo 5 secondi
	setTimeout(() => {
		notification.remove();
	}, 5000);
}

// Funzione helper per lampeggio
function blinkObject(object, color, times) {
	if (!object.material) return;

	const originalColor = object.material.color.getHex();
	const originalEmissive = object.material.emissive
		? object.material.emissive.getHex()
		: 0x000000;
	let count = 0;

	const blink = () => {
		if (count >= times * 2) {
			object.material.color.setHex(originalColor);
			if (object.material.emissive) {
				object.material.emissive.setHex(originalEmissive);
			}
			return;
		}

		if (count % 2 === 0) {
			object.material.color.setHex(color);
			if (object.material.emissive) {
				object.material.emissive.setHex(color);
			}
		} else {
			object.material.color.setHex(originalColor);
			if (object.material.emissive) {
				object.material.emissive.setHex(originalEmissive);
			}
		}

		count++;
		setTimeout(blink, 200);
	};

	blink();
}

// Esporta funzioni per uso nei Puzzles
window.BlueIOT = {
	init: initBlueIOT,
	showEmployeeInfo: showEmployeeInfo,
	mapObjectToTag: mapObjectToTag,
	highlightTag: highlightTag,
	sendCommand: (command, params) => {
		if (window.blueiotData.connector) {
			window.blueiotData.connector.sendCommand(command, params);
		}
	},
	getTagPosition: (tagId) => {
		if (
			window.blueiotData.connector &&
			window.blueiotData.connector.tags[tagId]
		) {
			return window.blueiotData.connector.tags[tagId].position;
		}
		return null;
	},
	getAllTags: () => {
		if (window.blueiotData.connector) {
			return Object.keys(window.blueiotData.connector.tags);
		}
		return [];
	},
};
