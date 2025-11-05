import React, { createContext, useContext, useState, useEffect } from 'react';
import { env } from '../services/env';
import { BlueiotClient } from '../services/blueiotClient';

const DataContext = createContext();

export const DataProvider = ({ children }) => {
	const [sites, setSites] = useState([]);
	const [currentSite, setCurrentSite] = useState(null);
	const [tags, setTags] = useState([]);
	const [positions, setPositions] = useState({});
	const [employees, setEmployees] = useState([]);
	const [assets, setAssets] = useState([]);
	const [tagAssociations, setTagAssociations] = useState([]);
	const [batteryLevels, setBatteryLevels] = useState({});
	const [alarms, setAlarms] = useState([]);
	const [anchors, setAnchors] = useState([]);
	const [areas, setAreas] = useState([]);
	const [isConnected, setIsConnected] = useState(false);
	const [connectionError, setConnectionError] = useState(null);

	// Tenta di caricare la configurazione al primo avvio
	useEffect(() => {
		// Carica dal localStorage la configurazione salvata
		try {
			const savedSiteId = localStorage.getItem('blueiot_currentSiteId');
			const savedSiteData = localStorage.getItem('blueiot_siteData');

			if (savedSiteData) {
				const parsedSite = JSON.parse(savedSiteData);
				setCurrentSite(parsedSite);

				if (!sites.some((site) => site.id === parsedSite.id)) {
					setSites((prev) => [...prev, parsedSite]);
				}
			}
		} catch (error) {
			console.error(
				'Errore nel caricamento della configurazione dal localStorage:',
				error
			);
		}

		// In modalità mock, inizializza tutto per test
		if (env.useMock === 'true' || env.useMock === true) {
			const mockSite = {
				id: 1,
				name: 'Cantiere Milano',
				serverIp: '127.0.0.1',
				serverPort: 48300,
			};
			setSites([mockSite]);
			setCurrentSite(mockSite);
			setEmployees([
				{ id: 1, name: 'Mario Rossi', role: 'Operaio' },
				{ id: 2, name: 'Lucia Bianchi', role: 'Ingegnere' },
			]);
			setAssets([
				{ id: 10, name: 'Gru 002', type: 'Macchinario' },
				{ id: 11, name: 'Escavatore A', type: 'Veicolo' },
			]);
			setTags([{ id: 'TAG001' }, { id: 'TAG002' }]);
			setTagAssociations([
				{ tagId: 'TAG001', targetType: 'employee', targetId: 1 },
				{ tagId: 'TAG002', targetType: 'asset', targetId: 10 },
			]);
			setAreas([
				{
					id: 1,
					name: 'Area Lavoro A',
					type: 'geofence',
					points: [
						{ x: 10, y: 10 },
						{ x: 90, y: 10 },
						{ x: 90, y: 50 },
						{ x: 10, y: 50 },
					],
				},
			]);
		} else {
			// Fetch real data from backend
			fetchSites();
		}
	}, []);

	const fetchSites = async () => {
		try {
			const response = await fetch(`${env.backendUrl}/api/sites`);
			if (response.ok) {
				const data = await response.json();
				setSites(data);
				if (data.length > 0) {
					setCurrentSite(data[0]);
				}
			}
		} catch (error) {
			console.error('Error fetching sites:', error);
		}
	};

	// Funzione per caricare i dati del sito
	const fetchSiteData = async (site) => {
		if (!site) return;

		try {
			console.log('Caricamento dati per il sito:', site.name);

			// Fetch employees
			const empResponse = await fetch(`${env.backendUrl}/api/users`);
			if (empResponse.ok) {
				const empData = await empResponse.json();
				console.log('Dipendenti caricati:', empData.length);
				setEmployees(empData);
			}

			// Fetch assets
			const assetResponse = await fetch(`${env.backendUrl}/api/assets`);
			if (assetResponse.ok) {
				const assetData = await assetResponse.json();
				console.log('Asset caricati:', assetData.length);
				setAssets(assetData);
			}

			// Fetch tag associations
			const assocResponse = await fetch(
				`${env.backendUrl}/api/associations/${site.id}`
			);
			if (assocResponse.ok) {
				const assocData = await assocResponse.json();
				setTagAssociations(assocData);
			}

			// Fetch areas (geofences)
			const areasResponse = await fetch(
				`${env.backendUrl}/api/areas/${site.id}`
			);
			if (areasResponse.ok) {
				const areasData = await areasResponse.json();
				setAreas(areasData);
			}
		} catch (error) {
			console.error('Error fetching site data:', error);
		}
	};

	// Connessione al server BlueIOT quando cambia il sito corrente
	useEffect(() => {
		if (!currentSite) return;

		// Salva la configurazione in localStorage
		try {
			localStorage.setItem('blueiot_currentSiteId', currentSite.id.toString());
			localStorage.setItem('blueiot_siteData', JSON.stringify(currentSite));
		} catch (error) {
			console.error('Errore nel salvataggio della configurazione:', error);
		}

		// Connetti al server BlueIOT
		console.log(
			`Connessione a ${currentSite.name} (${currentSite.serverIp}:${currentSite.serverPort})`
		);
		BlueiotClient.connect(currentSite.serverIp, currentSite.serverPort);

		// Gestione degli eventi di connessione
		const handleOpen = () => {
			console.log('Connessione stabilita');
			setIsConnected(true);
			setConnectionError(null);
		};

		const handleError = (error) => {
			console.error('Errore di connessione:', error);
			setConnectionError(error.message || 'Errore di connessione');
		};

		const handleClose = () => {
			console.log('Connessione chiusa');
			setIsConnected(false);
		};

		// Configura handler per i dati di posizione
		const tagPositionHandler = (data) => {
			setPositions((prev) => ({
				...prev,
				[data.id]: { x: data.x, y: data.y, z: data.z || 0 },
			}));

			// Se vediamo un nuovo tag, aggiungiamolo alla lista
			setTags((prev) => {
				if (!prev.find((t) => t.id === data.id)) {
					return [...prev, { id: data.id }];
				}
				return prev;
			});
		};

		// Configura handler per i dati della batteria
		const batteryHandler = (data) => {
			setBatteryLevels((prev) => ({
				...prev,
				[data.tagid]: { level: data.cap, charging: data.bcharge === 1 },
			}));
		};

		// Configura handler per gli allarmi
		const alarmHandler = (data) => {
			setAlarms((prev) => {
				const existingIndex = prev.findIndex((a) => a.id === data.id);
				if (existingIndex >= 0) {
					const updated = [...prev];
					updated[existingIndex] = data;
					return updated;
				} else {
					return [...prev, data];
				}
			});
		};

		// Configura handler per lo stato degli anchor
		const anchorHandler = (data) => {
			setAnchors((prev) => {
				const existingIndex = prev.findIndex((a) => a.id === data.id);
				if (existingIndex >= 0) {
					const updated = [...prev];
					updated[existingIndex] = data;
					return updated;
				} else {
					return [...prev, data];
				}
			});
		};

		// Registra i listener
		BlueiotClient.on('open', handleOpen);
		BlueiotClient.on('error', handleError);
		BlueiotClient.on('close', handleClose);
		BlueiotClient.on('tagPosition', tagPositionHandler);
		BlueiotClient.on('batteryInfo', batteryHandler);
		BlueiotClient.on('alarm', alarmHandler);
		BlueiotClient.on('baseStData', anchorHandler);

		// Carica i dati del sito corrente
		if (env.useMock !== 'true' && env.useMock !== true) {
			fetchSiteData(currentSite);
		}

		// Pulisci alla disconnessione
		return () => {
			// Rimuovi esplicitamente i listener individuali
			BlueiotClient.off('open', handleOpen);
			BlueiotClient.off('error', handleError);
			BlueiotClient.off('close', handleClose);
			BlueiotClient.off('tagPosition', tagPositionHandler);
			BlueiotClient.off('batteryInfo', batteryHandler);
			BlueiotClient.off('alarm', alarmHandler);
			BlueiotClient.off('baseStData', anchorHandler);

			// Disconnetti il client
			BlueiotClient.disconnect();
		};
	}, [currentSite]);

	// Associa un tag a un dipendente o asset
	const associateTag = async (tagId, targetType, targetId) => {
		if (!currentSite) return;

		try {
			// In mock mode, just update the state
			if (env.useMock === 'true' || env.useMock === true) {
				const updated = tagAssociations.filter((a) => a.tagId !== tagId);
				if (targetType && targetId) {
					updated.push({ tagId, targetType, targetId });
				}
				setTagAssociations(updated);
				return;
			}

			// Otherwise, send to the backend
			const response = await fetch(`${env.backendUrl}/api/associate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tagId,
					targetType,
					targetId,
					siteId: currentSite.id,
				}),
			});

			if (response.ok) {
				// Update local state after successful API call
				const updated = tagAssociations.filter((a) => a.tagId !== tagId);
				if (targetType && targetId) {
					updated.push({ tagId, targetType, targetId });
				}
				setTagAssociations(updated);
			} else {
				console.error('Failed to associate tag');
			}
		} catch (error) {
			console.error('Error associating tag:', error);
		}
	};

	// Seleziona un sito come corrente
	const selectSite = (id) => {
		const site = sites.find((s) => s.id === id);
		if (site) {
			setCurrentSite(site);

			// Salva la selezione del sito in localStorage
			try {
				localStorage.setItem('blueiot_currentSiteId', id.toString());
				localStorage.setItem('blueiot_siteData', JSON.stringify(site));
			} catch (error) {
				console.error(
					'Errore nel salvataggio della selezione del sito:',
					error
				);
			}
		}
	};

	// Aggiorna le proprietà di un sito esistente
	const updateSite = (updatedSite) => {
		if (!updatedSite || !updatedSite.id) return;

		setSites((prev) =>
			prev.map((site) =>
				site.id === updatedSite.id ? { ...site, ...updatedSite } : site
			)
		);

		if (currentSite && currentSite.id === updatedSite.id) {
			setCurrentSite({ ...currentSite, ...updatedSite });

			// Salva l'aggiornamento in localStorage
			try {
				localStorage.setItem(
					'blueiot_siteData',
					JSON.stringify({ ...currentSite, ...updatedSite })
				);
			} catch (error) {
				console.error(
					"Errore nel salvataggio dell'aggiornamento del sito:",
					error
				);
			}
		}

		// In una vera implementazione, qui invieresti l'aggiornamento al server
		// fetch(`${env.backendUrl}/api/sites/${updatedSite.id}`, {
		//   method: 'PUT',
		//   headers: { 'Content-Type': 'application/json' },
		//   body: JSON.stringify(updatedSite)
		// });
	};

	// Invia comando di vibrazione a un tag
	const vibrateTag = (tagId, action = 'enable') => {
		if (!tagId) return;
		BlueiotClient.sendTagVibrate(tagId, action);
	};

	// Aggiungi un'area (geofence)
	const addArea = async (name, type, points) => {
		if (!currentSite) return;

		const newArea = {
			id: areas.length > 0 ? Math.max(...areas.map((a) => a.id)) + 1 : 1,
			name,
			type,
			points,
			siteId: currentSite.id,
		};

		try {
			// In mock mode, just update the state
			if (env.useMock === 'true' || env.useMock === true) {
				setAreas([...areas, newArea]);
				return newArea;
			}

			// Otherwise, send to the backend
			const response = await fetch(`${env.backendUrl}/api/areas`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newArea),
			});

			if (response.ok) {
				const savedArea = await response.json();
				setAreas([...areas, savedArea]);
				return savedArea;
			} else {
				console.error('Failed to add area');
				return null;
			}
		} catch (error) {
			console.error('Error adding area:', error);
			return null;
		}
	};

	// Rimuovi un'area
	const removeArea = async (areaId) => {
		try {
			// In mock mode, just update the state
			if (env.useMock === 'true' || env.useMock === true) {
				setAreas(areas.filter((a) => a.id !== areaId));
				return true;
			}

			// Otherwise, send to the backend
			const response = await fetch(`${env.backendUrl}/api/areas/${areaId}`, {
				method: 'DELETE',
			});

			if (response.ok) {
				setAreas(areas.filter((a) => a.id !== areaId));
				return true;
			} else {
				console.error('Failed to remove area');
				return false;
			}
		} catch (error) {
			console.error('Error removing area:', error);
			return false;
		}
	};

	// Controlla se un tag è in un'area
	const isTagInArea = (tagId, areaId) => {
		const area = areas.find((a) => a.id === areaId);
		const position = positions[tagId];

		if (!area || !position) return false;

		// Implementazione dell'algoritmo point-in-polygon
		const points = area.points;
		let inside = false;

		for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
			const xi = points[i].x,
				yi = points[i].y;
			const xj = points[j].x,
				yj = points[j].y;

			const intersect =
				yi > position.y !== yj > position.y &&
				position.x < ((xj - xi) * (position.y - yi)) / (yj - yi) + xi;

			if (intersect) inside = !inside;
		}

		return inside;
	};

	// Funzione per aggiornare i dati manualmente
	const refreshData = async () => {
		if (!currentSite) {
			console.warn('No current site selected for refresh');
			return;
		}

		console.log('Refreshing data for site:', currentSite.name);
		await fetchSiteData(currentSite);
	};

	return (
		<DataContext.Provider
			value={{
				sites,
				currentSite,
				selectSite,
				updateSite,
				employees,
				setEmployees,
				assets,
				setAssets,
				tags,
				positions,
				batteryLevels,
				alarms,
				anchors,
				areas,
				addArea,
				removeArea,
				isTagInArea,
				tagAssociations,
				associateTag,
				vibrateTag,
				isConnected,
				connectionError,
				refreshData,
			}}
		>
			{children}
		</DataContext.Provider>
	);
};

export const useData = () => useContext(DataContext);
