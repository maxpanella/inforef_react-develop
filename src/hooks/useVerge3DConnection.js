// src/hooks/useVerge3DConnection.js
import { useEffect, useRef, useState } from 'react';
import { useData } from '../context/DataContext';

export const useVerge3DConnection = () => {
	const { positions, tags, tagAssociations, employees, assets, alarms } =
		useData();
	const [isConnected, setIsConnected] = useState(false);
	const wsRef = useRef(null);
	const reconnectTimeoutRef = useRef(null);

	// Connetti al WebSocket server
	const connect = () => {
		const wsUrl =
			process.env.REACT_APP_VERGE3D_WS_URL ||
			'ws://localhost:4001/verge3d?client=blueiot';

		try {
			wsRef.current = new WebSocket(wsUrl);

			wsRef.current.onopen = () => {
				console.log('Connesso al server Verge3D WebSocket');
				setIsConnected(true);

				// Invia stato iniziale
				sendInitialState();
			};

			wsRef.current.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					handleMessage(data);
				} catch (error) {
					console.error('Errore parsing messaggio Verge3D:', error);
				}
			};

			wsRef.current.onclose = () => {
				console.log('Disconnesso dal server Verge3D WebSocket');
				setIsConnected(false);

				// Riconnessione automatica dopo 5 secondi
				reconnectTimeoutRef.current = setTimeout(() => {
					connect();
				}, 5000);
			};

			wsRef.current.onerror = (error) => {
				console.error('Errore WebSocket Verge3D:', error);
			};
		} catch (error) {
			console.error('Errore creazione WebSocket:', error);
		}
	};

	// Invia stato iniziale
	const sendInitialState = () => {
		const state = buildCurrentState();
		send({
			type: 'initial_state',
			data: state,
		});
	};

	// Costruisci lo stato corrente
	const buildCurrentState = () => {
		const state = {
			tags: {},
			employees: {},
			assets: {},
			alarms: alarms.slice(-50), // Ultimi 50 allarmi
		};

		// Costruisci informazioni sui tag
		Object.entries(positions).forEach(([tagId, position]) => {
			const association = tagAssociations.find((a) => a.tagId === tagId);
			let entity = null;

			if (association) {
				if (association.targetType === 'employee') {
					const employee = employees.find((e) => e.id === association.targetId);
					if (employee) {
						entity = {
							type: 'employee',
							id: employee.id,
							name: employee.name,
							role: employee.role,
						};
					}
				} else if (association.targetType === 'asset') {
					const asset = assets.find((a) => a.id === association.targetId);
					if (asset) {
						entity = {
							type: 'asset',
							id: asset.id,
							name: asset.name,
							assetType: asset.type,
						};
					}
				}
			}

			state.tags[tagId] = {
				position,
				entity,
				lastUpdate: new Date().toISOString(),
			};
		});

		// Informazioni su dipendenti e asset
		state.employees = employees.reduce((acc, emp) => {
			acc[emp.id] = {
				name: emp.name,
				role: emp.role,
				department: emp.department,
			};
			return acc;
		}, {});

		state.assets = assets.reduce((acc, asset) => {
			acc[asset.id] = {
				name: asset.name,
				type: asset.type,
				model: asset.model,
			};
			return acc;
		}, {});

		return state;
	};

	// Gestisci messaggi in arrivo
	const handleMessage = (data) => {
		switch (data.type) {
			case 'command':
				handleCommand(data.command, data.params);
				break;

			case 'scene_interaction':
				handleSceneInteraction(data);
				break;

			case 'request_state':
				sendInitialState();
				break;

			default:
				console.log('Messaggio Verge3D non gestito:', data.type);
		}
	};

	// Gestisci comandi da Verge3D
	const handleCommand = (command, params) => {
		console.log('Comando ricevuto da Verge3D:', command, params);

		// Implementa i comandi specifici
		switch (command) {
			case 'vibrate_tag':
				// Implementa vibrazione tag
				console.log('Vibrazione tag:', params.tagId);
				break;

			case 'show_tag_info':
				// Mostra informazioni tag
				console.log('Mostra info tag:', params.tagId);
				break;

			// Aggiungi altri comandi secondo necessità
		}
	};

	// Gestisci interazioni scena
	const handleSceneInteraction = (data) => {
		console.log('Interazione scena:', data);

		if (data.action === 'clicked' && data.object) {
			// L'utente ha cliccato su un tag in Verge3D
			// Potresti voler evidenziare il tag nell'UI React
		}
	};

	// Invia messaggio
	const send = (data) => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(data));
		}
	};

	// Invia aggiornamento posizione tag
	const sendTagUpdate = (tagId, position, entity) => {
		send({
			type: 'tag_update',
			tagId,
			position,
			entity,
		});
	};

	// Invia allarme
	const sendAlarm = (alarm) => {
		send({
			type: 'alarm',
			alarm,
		});
	};

	// Hook per aggiornamenti posizioni
	useEffect(() => {
		if (!isConnected) return;

		// Invia aggiornamenti posizioni
		Object.entries(positions).forEach(([tagId, position]) => {
			const association = tagAssociations.find((a) => a.tagId === tagId);
			let entity = null;

			if (association) {
				if (association.targetType === 'employee') {
					const employee = employees.find((e) => e.id === association.targetId);
					if (employee) {
						entity = {
							type: 'employee',
							id: employee.id,
							name: employee.name,
						};
					}
				} else if (association.targetType === 'asset') {
					const asset = assets.find((a) => a.id === association.targetId);
					if (asset) {
						entity = {
							type: 'asset',
							id: asset.id,
							name: asset.name,
						};
					}
				}
			}

			sendTagUpdate(tagId, position, entity);
		});
	}, [positions, tagAssociations, employees, assets, isConnected]);

	// Hook per allarmi
	useEffect(() => {
		if (!isConnected || alarms.length === 0) return;

		// Invia ultimo allarme
		const lastAlarm = alarms[alarms.length - 1];
		sendAlarm(lastAlarm);
	}, [alarms, isConnected]);

	// Inizializza connessione
	useEffect(() => {
		connect();

		// Cleanup
		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, []);

	return {
		isConnected,
		sendCommand: (command, params) =>
			send({ type: 'command', command, params }),
		sendSceneEvent: (event, data) =>
			send({ type: 'scene_event', event, ...data }),
	};
};
