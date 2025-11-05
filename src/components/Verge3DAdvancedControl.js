// src/components/Verge3DAdvancedControl.js
import React, { useState, useEffect } from 'react';
import { useVerge3DConnection } from '../hooks/useVerge3DConnection';
import { useData } from '../context/DataContext';

const Verge3DAdvancedControl = () => {
	const { isConnected, sendCommand, sendSceneEvent } = useVerge3DConnection();
	const { employees, assets, tagAssociations, positions, currentSite } =
		useData();

	const [selectedEmployee, setSelectedEmployee] = useState(null);
	const [selectedAsset, setSelectedAsset] = useState(null);
	const [sceneObjects, setSceneObjects] = useState([]);
	const [mappingMode, setMappingMode] = useState(false);
	const [selectedTag, setSelectedTag] = useState('');
	const [selectedObject, setSelectedObject] = useState('');

	// Richiedi lista oggetti dalla scena Verge3D
	useEffect(() => {
		if (isConnected) {
			sendCommand('get_scene_objects', {});
		}
	}, [isConnected]);

	// Mostra dipendente in Verge3D
	const showEmployeeInVerge3D = (employee) => {
		const association = tagAssociations.find(
			(a) => a.targetType === 'employee' && a.targetId === employee.id
		);

		const employeeData = {
			...employee,
			tagId: association?.tagId || null,
			lastPosition: association?.tagId ? positions[association.tagId] : null,
		};

		// Invia messaggio custom per mostrare info dipendente
		sendCommand('custom_message', {
			type: 'show_employee',
			data: employeeData,
		});

		setSelectedEmployee(employee);
	};

	// Mappa oggetto a tag
	const mapObjectToTag = () => {
		if (selectedObject && selectedTag) {
			sendCommand('custom_message', {
				type: 'map_object_to_tag',
				objectName: selectedObject,
				tagId: selectedTag,
			});

			// Reset selezioni
			setSelectedObject('');
			setSelectedTag('');
			setMappingMode(false);
		}
	};

	// Centra camera su area/zona
	const focusOnArea = (areaName) => {
		sendCommand('custom_message', {
			type: 'focus_area',
			areaName: areaName,
		});
	};

	// Toggle visualizzazione layer
	const toggleLayer = (layerName, visible) => {
		sendCommand('custom_message', {
			type: 'toggle_layer',
			layerName: layerName,
			visible: visible,
		});
	};

	// Ottieni tag disponibili (non ancora mappati)
	const getAvailableTags = () => {
		const allTags = Object.keys(positions);
		const mappedTags = Object.values(window.blueiotData?.tagToObject || {});
		return allTags.filter((tag) => !mappedTags.includes(tag));
	};

	return (
		<div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
			{/* Pannello Controllo Principale */}
			<div className='bg-white rounded-lg shadow p-4'>
				<h3 className='text-lg font-semibold mb-4'>Controllo Scena 3D</h3>

				{/* Stato connessione */}
				<div className='mb-4'>
					<div className='flex items-center'>
						<div
							className={`w-3 h-3 rounded-full mr-2 ${
								isConnected ? 'bg-green-500' : 'bg-red-500'
							}`}
						></div>
						<span className='text-sm'>
							{isConnected ? 'Connesso a Verge3D' : 'Disconnesso'}
						</span>
					</div>
				</div>

				{/* Controlli Vista */}
				<div className='mb-6'>
					<h4 className='font-medium mb-2'>Vista Rapida</h4>
					<div className='grid grid-cols-2 gap-2'>
						<button
							onClick={() => focusOnArea('Entrance')}
							className='bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600 text-sm'
						>
							Ingresso
						</button>
						<button
							onClick={() => focusOnArea('WorkArea_A')}
							className='bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600 text-sm'
						>
							Area Lavoro A
						</button>
						<button
							onClick={() => focusOnArea('WorkArea_B')}
							className='bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600 text-sm'
						>
							Area Lavoro B
						</button>
						<button
							onClick={() => focusOnArea('Storage')}
							className='bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600 text-sm'
						>
							Magazzino
						</button>
					</div>
				</div>

				{/* Controlli Layer */}
				<div className='mb-6'>
					<h4 className='font-medium mb-2'>Visualizzazione Layer</h4>
					<div className='space-y-2'>
						<label className='flex items-center'>
							<input
								type='checkbox'
								defaultChecked
								onChange={(e) =>
									toggleLayer('Employees_Layer', e.target.checked)
								}
								className='mr-2'
							/>
							<span className='text-sm'>Dipendenti</span>
						</label>
						<label className='flex items-center'>
							<input
								type='checkbox'
								defaultChecked
								onChange={(e) => toggleLayer('Assets_Layer', e.target.checked)}
								className='mr-2'
							/>
							<span className='text-sm'>Macchinari</span>
						</label>
						<label className='flex items-center'>
							<input
								type='checkbox'
								defaultChecked
								onChange={(e) => toggleLayer('Safety_Zones', e.target.checked)}
								className='mr-2'
							/>
							<span className='text-sm'>Zone Sicurezza</span>
						</label>
					</div>
				</div>

				{/* Modalità Mappatura */}
				<div className='mb-6'>
					<h4 className='font-medium mb-2'>Mappatura Oggetti</h4>
					<button
						onClick={() => setMappingMode(!mappingMode)}
						className={`w-full px-4 py-2 rounded ${
							mappingMode
								? 'bg-orange-500 text-white hover:bg-orange-600'
								: 'bg-gray-200 hover:bg-gray-300'
						}`}
					>
						{mappingMode ? 'Disattiva Mappatura' : 'Attiva Mappatura'}
					</button>

					{mappingMode && (
						<div className='mt-4 p-4 bg-gray-50 rounded'>
							<div className='mb-3'>
								<label className='block text-sm font-medium mb-1'>
									Seleziona Tag:
								</label>
								<select
									value={selectedTag}
									onChange={(e) => setSelectedTag(e.target.value)}
									className='w-full p-2 border rounded'
								>
									<option value=''>-- Seleziona --</option>
									{getAvailableTags().map((tag) => (
										<option key={tag} value={tag}>
											{tag}
										</option>
									))}
								</select>
							</div>

							<div className='mb-3'>
								<label className='block text-sm font-medium mb-1'>
									Nome Oggetto Scena:
								</label>
								<input
									type='text'
									value={selectedObject}
									onChange={(e) => setSelectedObject(e.target.value)}
									placeholder='es. Escavatore_01'
									className='w-full p-2 border rounded'
								/>
							</div>

							<button
								onClick={mapObjectToTag}
								disabled={!selectedTag || !selectedObject}
								className='w-full bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-300'
							>
								Associa
							</button>
						</div>
					)}
				</div>
			</div>

			{/* Pannello Dipendenti/Asset */}
			<div className='bg-white rounded-lg shadow p-4'>
				<h3 className='text-lg font-semibold mb-4'>Dipendenti e Asset</h3>

				{/* Tab per switchare tra dipendenti e asset */}
				<div className='flex mb-4'>
					<button
						className={`flex-1 py-2 px-4 ${
							selectedEmployee ? 'bg-blue-500 text-white' : 'bg-gray-200'
						}`}
						onClick={() => {
							setSelectedEmployee(true);
							setSelectedAsset(false);
						}}
					>
						Dipendenti
					</button>
					<button
						className={`flex-1 py-2 px-4 ${
							selectedAsset ? 'bg-blue-500 text-white' : 'bg-gray-200'
						}`}
						onClick={() => {
							setSelectedEmployee(false);
							setSelectedAsset(true);
						}}
					>
						Asset
					</button>
				</div>

				{/* Lista Dipendenti */}
				{selectedEmployee !== false && (
					<div className='max-h-96 overflow-y-auto'>
						{employees.map((employee) => {
							const association = tagAssociations.find(
								(a) => a.targetType === 'employee' && a.targetId === employee.id
							);
							const hasTag = !!association;

							return (
								<div
									key={employee.id}
									className='p-3 border-b hover:bg-gray-50 cursor-pointer'
									onClick={() => showEmployeeInVerge3D(employee)}
								>
									<div className='flex justify-between items-center'>
										<div>
											<div className='font-medium'>{employee.name}</div>
											<div className='text-sm text-gray-600'>
												{employee.role}
											</div>
										</div>
										<div className='text-right'>
											{hasTag ? (
												<span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
													{association.tagId}
												</span>
											) : (
												<span className='text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded'>
													No Tag
												</span>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}

				{/* Lista Asset */}
				{selectedAsset && (
					<div className='max-h-96 overflow-y-auto'>
						{assets.map((asset) => {
							const association = tagAssociations.find(
								(a) => a.targetType === 'asset' && a.targetId === asset.id
							);
							const hasTag = !!association;

							return (
								<div
									key={asset.id}
									className='p-3 border-b hover:bg-gray-50 cursor-pointer'
									onClick={() => {
										sendCommand('custom_message', {
											type: 'update_asset_status',
											assetId: asset.id,
											status: asset,
										});
									}}
								>
									<div className='flex justify-between items-center'>
										<div>
											<div className='font-medium'>{asset.name}</div>
											<div className='text-sm text-gray-600'>{asset.type}</div>
										</div>
										<div className='text-right'>
											{hasTag ? (
												<span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
													{association.tagId}
												</span>
											) : (
												<span className='text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded'>
													No Tag
												</span>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Pannello Statistiche Live */}
			<div className='bg-white rounded-lg shadow p-4 lg:col-span-2'>
				<h3 className='text-lg font-semibold mb-4'>Statistiche Live</h3>

				<div className='grid grid-cols-4 gap-4'>
					<div className='text-center'>
						<div className='text-2xl font-bold text-blue-600'>
							{employees.filter((e) => e.isActive).length}
						</div>
						<div className='text-sm text-gray-600'>Dipendenti Presenti</div>
					</div>
					<div className='text-center'>
						<div className='text-2xl font-bold text-green-600'>
							{assets.filter((a) => a.isOperational).length}
						</div>
						<div className='text-sm text-gray-600'>Asset Operativi</div>
					</div>
					<div className='text-center'>
						<div className='text-2xl font-bold text-orange-600'>
							{Object.keys(positions).length}
						</div>
						<div className='text-sm text-gray-600'>Tag Attivi</div>
					</div>
					<div className='text-center'>
						<div className='text-2xl font-bold text-purple-600'>
							{currentSite?.name || 'N/A'}
						</div>
						<div className='text-sm text-gray-600'>Sito Corrente</div>
					</div>
				</div>

				<button
					onClick={() => {
						sendCommand('custom_message', {
							type: 'update_stats',
							stats: {
								employeesPresent: employees.filter((e) => e.isActive).length,
								assetsActive: assets.filter((a) => a.isOperational).length,
								tagsActive: Object.keys(positions).length,
							},
						});
					}}
					className='mt-4 w-full bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600'
				>
					Aggiorna Statistiche in 3D
				</button>
			</div>
		</div>
	);
};

export default Verge3DAdvancedControl;
