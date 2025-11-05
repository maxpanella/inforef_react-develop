import React, { useState } from 'react';
import { useData } from '../context/DataContext';

const AssetSummaryPage = () => {
	const { assets, tagAssociations } = useData();
	const [selectedAsset, setSelectedAsset] = useState(null);
	const [filter, setFilter] = useState('all'); // all, operational, non-operational, with-tag

	// Filtra gli asset
	const filteredAssets = assets.filter((asset) => {
		switch (filter) {
			case 'operational':
				return asset.isOperational;
			case 'non-operational':
				return !asset.isOperational;
			case 'with-tag':
				return tagAssociations.some(
					(assoc) => assoc.targetType === 'asset' && assoc.targetId === asset.id
				);
			default:
				return true;
		}
	});

	// Trova il tag associato all'asset
	const getAssetTag = (assetId) => {
		const association = tagAssociations.find(
			(assoc) => assoc.targetType === 'asset' && assoc.targetId === assetId
		);
		return association?.tagId || null;
	};

	// Calcola statistiche
	const stats = {
		total: assets.length,
		operational: assets.filter((a) => a.isOperational).length,
		withTags: assets.filter((a) => getAssetTag(a.id)).length,
		departments: [
			...new Set(assets.map((a) => a.departmentName).filter(Boolean)),
		].length,
	};

	// Raggruppa asset per dipartimento
	const assetsByDepartment = filteredAssets.reduce((acc, asset) => {
		const dept = asset.departmentName || 'Non Assegnato';
		if (!acc[dept]) acc[dept] = [];
		acc[dept].push(asset);
		return acc;
	}, {});

	return (
		<div className='p-6'>
			<h1 className='text-2xl font-bold mb-4'>Riepilogo Macchinari</h1>

			{/* Statistiche */}
			<div className='grid grid-cols-4 gap-4 mb-6'>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold'>{stats.total}</div>
					<div className='text-sm text-gray-600'>Totale Macchinari</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-green-600'>
						{stats.operational}
					</div>
					<div className='text-sm text-gray-600'>Operativi</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-blue-600'>
						{stats.withTags}
					</div>
					<div className='text-sm text-gray-600'>Con Tag Assegnato</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-purple-600'>
						{stats.departments}
					</div>
					<div className='text-sm text-gray-600'>Reparti</div>
				</div>
			</div>

			{/* Filtri */}
			<div className='mb-4 flex gap-2'>
				<button
					onClick={() => setFilter('all')}
					className={`px-4 py-2 rounded ${
						filter === 'all'
							? 'bg-blue-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Tutti ({stats.total})
				</button>
				<button
					onClick={() => setFilter('operational')}
					className={`px-4 py-2 rounded ${
						filter === 'operational'
							? 'bg-green-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Operativi ({stats.operational})
				</button>
				<button
					onClick={() => setFilter('non-operational')}
					className={`px-4 py-2 rounded ${
						filter === 'non-operational'
							? 'bg-red-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Non Operativi ({stats.total - stats.operational})
				</button>
				<button
					onClick={() => setFilter('with-tag')}
					className={`px-4 py-2 rounded ${
						filter === 'with-tag'
							? 'bg-blue-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Con Tag ({stats.withTags})
				</button>
			</div>

			<div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
				{/* Lista asset per dipartimento */}
				<div className='lg:col-span-2'>
					<div className='space-y-4'>
						{Object.entries(assetsByDepartment).map(
							([department, deptAssets]) => (
								<div key={department} className='bg-white rounded shadow'>
									<div className='p-4 border-b bg-gray-50'>
										<h3 className='font-semibold'>
											{department} ({deptAssets.length})
										</h3>
									</div>
									<div className='divide-y'>
										{deptAssets.map((asset) => {
											const tag = getAssetTag(asset.id);
											return (
												<div
													key={asset.id}
													onClick={() => setSelectedAsset(asset)}
													className={`p-4 cursor-pointer hover:bg-gray-50 ${
														selectedAsset?.id === asset.id ? 'bg-blue-50' : ''
													}`}
												>
													<div className='flex justify-between items-start'>
														<div>
															<div className='font-medium'>{asset.name}</div>
															<div className='text-sm text-gray-600'>
																{asset.type} {asset.model && `- ${asset.model}`}
															</div>
															<div className='text-xs text-gray-500'>
																ID: {asset.id}
															</div>
														</div>
														<div className='text-right'>
															{asset.isOperational ? (
																<span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
																	Operativo
																</span>
															) : (
																<span className='text-xs bg-red-100 text-red-800 px-2 py-1 rounded'>
																	Non Operativo
																</span>
															)}
															{tag && (
																<div className='mt-1 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded'>
																	{tag}
																</div>
															)}
														</div>
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)
						)}
					</div>
				</div>

				{/* Dettagli asset */}
				<div className='lg:col-span-1'>
					{selectedAsset ? (
						<div className='bg-white rounded shadow sticky top-4'>
							<div className='p-4 border-b'>
								<h2 className='text-lg font-semibold'>Dettagli Macchinario</h2>
							</div>
							<div className='p-4'>
								<div className='space-y-3'>
									<div>
										<label className='text-sm font-medium text-gray-600'>
											Nome
										</label>
										<p className='font-semibold'>{selectedAsset.name}</p>
									</div>

									<div>
										<label className='text-sm font-medium text-gray-600'>
											Tipo
										</label>
										<p>{selectedAsset.type}</p>
									</div>

									{selectedAsset.model && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Modello
											</label>
											<p>{selectedAsset.model}</p>
										</div>
									)}

									{selectedAsset.manufacturer && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Produttore
											</label>
											<p>{selectedAsset.manufacturer}</p>
										</div>
									)}

									{selectedAsset.serialNumber && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Numero Serie
											</label>
											<p>{selectedAsset.serialNumber}</p>
										</div>
									)}

									<div>
										<label className='text-sm font-medium text-gray-600'>
											Reparto
										</label>
										<p>{selectedAsset.departmentName || 'Non Assegnato'}</p>
									</div>

									<div>
										<label className='text-sm font-medium text-gray-600'>
											Stato
										</label>
										<p>
											{selectedAsset.isOperational ? (
												<span className='text-green-600 font-medium'>
													✓ Operativo
												</span>
											) : (
												<span className='text-red-600 font-medium'>
													✗ Non Operativo
												</span>
											)}
										</p>
									</div>

									{selectedAsset.lastMaintenance && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Ultima Manutenzione
											</label>
											<p>
												{new Date(
													selectedAsset.lastMaintenance
												).toLocaleDateString('it-IT')}
											</p>
										</div>
									)}

									{selectedAsset.nextMaintenance && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Prossima Manutenzione
											</label>
											<p>
												{new Date(
													selectedAsset.nextMaintenance
												).toLocaleDateString('it-IT')}
											</p>
										</div>
									)}

									{getAssetTag(selectedAsset.id) && (
										<div>
											<label className='text-sm font-medium text-gray-600'>
												Tag Associato
											</label>
											<p className='font-mono bg-blue-50 text-blue-800 px-2 py-1 rounded inline-block'>
												{getAssetTag(selectedAsset.id)}
											</p>
										</div>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className='bg-white rounded shadow p-8 text-center'>
							<div className='text-gray-500'>
								Seleziona un macchinario per visualizzare i dettagli
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default AssetSummaryPage;
