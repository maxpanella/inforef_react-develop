// src/components/Verge3DControl.js
import React, { useEffect } from 'react';
import { useVerge3DConnection } from '../hooks/useVerge3DConnection';
import { useData } from '../context/DataContext';

const Verge3DControl = () => {
	const { isConnected, sendCommand, sendSceneEvent } = useVerge3DConnection();
	const { tags, positions, tagAssociations, employees, assets, tagNames } = useData();
	// Helper: resolve human-friendly name from tagNames using id and idHex variants
	const resolveName = (id) => {
		try {
			const names = tagNames || {};
			const variants = new Set();
			const s = String(id || '');
			variants.add(s);
			// include idHex from position if present
			const hx = positions && positions[s] && positions[s].idHex ? String(positions[s].idHex) : null;
			if (hx) {
				const up = hx.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
				if (up) {
					variants.add(up);
					if (up.length >= 8) {
						const low = up.slice(-8);
						variants.add(low);
						try { variants.add(String(parseInt(low, 16))); } catch(_) {}
					}
				}
			}
			// numeric variants
			const num = Number(s);
			if (!Number.isNaN(num)) {
				const u32 = (num >>> 0);
				variants.add(String(num));
				variants.add(String(u32));
				variants.add(u32.toString(16).toUpperCase());
				variants.add(num.toString(16).toUpperCase());
			}
			// hex-like variants
			const hexLike = s.match(/^[0-9A-Fa-f]{8,}$/) ? s : s.replace(/[^0-9A-Fa-f]/g, '');
			if (hexLike && /^[0-9A-Fa-f]{8,}$/.test(hexLike)) {
				const up = hexLike.toUpperCase();
				variants.add(up);
				const lowHex = up.slice(-8);
				try { variants.add(String(parseInt(lowHex, 16))); } catch(_) {}
				variants.add(lowHex);
			}
			for (const k of variants) { if (names[k]) return names[k]; }
			return null;
		} catch {
			return null;
		}
	};

	// Invia comando di test
	const handleTestCommand = () => {
		sendCommand('test_command', {
			message: 'Ciao da React!',
			timestamp: new Date().toISOString(),
		});
	};

	// Evidenzia un tag specifico in Verge3D
	const handleHighlightTag = (tagId) => {
		sendCommand('highlight_tag', {
			tagId: tagId,
			duration: 3000, // millisecondi
		});
	};

	// Centra la camera su un tag
	const handleFocusTag = (tagId) => {
		const position = positions[tagId];
		if (position) {
			sendCommand('focus_camera', {
				tagId: tagId,
				position: position,
			});
		}
	};

	// Mostra/nascondi tutti i tag di un tipo
	const handleToggleTagType = (type) => {
		sendCommand('toggle_tag_type', {
			type: type,
			visible: true, // o false per nascondere
		});
	};

	// Simula un allarme
	const handleSimulateAlarm = () => {
		const tagIds = Object.keys(positions);
		if (tagIds.length > 0) {
			const randomTag = tagIds[Math.floor(Math.random() * tagIds.length)];
			sendCommand('simulate_alarm', {
				tagId: randomTag,
				type: 'emergency',
				severity: 'high',
			});
		}
	};

	return (
		<div className='bg-white rounded-lg shadow p-4'>
			<h3 className='text-lg font-semibold mb-4'>Controllo Verge3D</h3>

			{/* Stato connessione */}
			<div className='mb-4'>
				<div className='flex items-center'>
					<div
						className={`w-3 h-3 rounded-full mr-2 ${
							isConnected ? 'bg-green-500' : 'bg-red-500'
						}`}
					></div>
					<span className='text-sm'>
						{isConnected ? 'Connesso a Verge3D' : 'Disconnesso da Verge3D'}
					</span>
				</div>
			</div>

			{/* Controlli generali */}
			<div className='space-y-2 mb-4'>
				<button
					onClick={handleTestCommand}
					className='w-full bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600 text-sm'
					disabled={!isConnected}
				>
					Invia Comando Test
				</button>

				<button
					onClick={handleSimulateAlarm}
					className='w-full bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600 text-sm'
					disabled={!isConnected || Object.keys(positions).length === 0}
				>
					Simula Allarme
				</button>
			</div>

			{/* Controlli visibilità */}
			<div className='mb-4'>
				<h4 className='text-sm font-medium mb-2'>Visibilità Tag</h4>
				<div className='space-y-1'>
					<button
						onClick={() => handleToggleTagType('employee')}
						className='w-full bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm'
						disabled={!isConnected}
					>
						Mostra/Nascondi Dipendenti
					</button>
					<button
						onClick={() => handleToggleTagType('asset')}
						className='w-full bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm'
						disabled={!isConnected}
					>
						Mostra/Nascondi Asset
					</button>
				</div>
			</div>

			{/* Lista tag attivi */}
			<div>
				<h4 className='text-sm font-medium mb-2'>Tag Attivi</h4>
				<div className='max-h-48 overflow-y-auto space-y-1'>
					{Object.entries(positions).map(([tagId, position]) => {
						const association = tagAssociations.find((a) => a.tagId === tagId);
						let entityName = 'Non assegnato';
						let entityType = 'unknown';

						if (association) {
							if (association.targetType === 'employee') {
								const employee = employees.find(
									(e) => e.id === association.targetId
								);
								if (employee) {
									entityName = employee.name;
									entityType = 'employee';
														}
														// Fallback: show device name if provided by engine (tagNames)
														if (entityName === 'Non assegnato') {
															const nm = resolveName(tagId);
															if (nm) entityName = nm;
														}
							} else if (association.targetType === 'asset') {
								const asset = assets.find((a) => a.id === association.targetId);
								if (asset) {
									entityName = asset.name;
									entityType = 'asset';
								}
							}
						}

						return (
							<div
								key={tagId}
								className='flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100'
							>
								<div className='flex items-center'>
									<div
										className={`w-2 h-2 rounded-full mr-2 ${
											entityType === 'employee'
												? 'bg-blue-500'
												: entityType === 'asset'
												? 'bg-green-500'
												: 'bg-gray-500'
										}`}
									></div>
									<div>
										<div className='text-sm font-medium'>{entityName}</div>
										<div className='text-xs text-gray-500'>{tagId}</div>
									</div>
								</div>
								<div className='flex space-x-1'>
									<button
										onClick={() => handleHighlightTag(tagId)}
										className='text-xs bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600'
										disabled={!isConnected}
									>
										Evidenzia
									</button>
									<button
										onClick={() => handleFocusTag(tagId)}
										className='text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600'
										disabled={!isConnected}
									>
										Focus
									</button>
								</div>
							</div>
						);
					})}
					{Object.keys(positions).length === 0 && (
						<p className='text-sm text-gray-500 text-center py-4'>
							Nessun tag attivo
						</p>
					)}
				</div>
			</div>
		</div>
	);
};

export default Verge3DControl;
