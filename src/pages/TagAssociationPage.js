import React, { useEffect, useState } from 'react';
import { useData } from '../context/DataContext';

const CRM_USERS_STORAGE_KEY = 'crm_cached_users';
const CRM_ASSETS_STORAGE_KEY = 'crm_cached_assets';

const readCachedArray = (key) => {
	if (typeof window === 'undefined' || !window.localStorage) return [];
	try {
		const raw = window.localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		console.warn(`Impossibile leggere ${key} dalla cache locale`, error);
		return [];
	}
};

const persistCachedArray = (key, value = []) => {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		window.localStorage.setItem(
			key,
			JSON.stringify(Array.isArray(value) ? value : [])
		);
	} catch (error) {
		console.warn(`Impossibile salvare ${key} in cache locale`, error);
	}
};

const TagAssociationPage = () => {
	const { tags, employees, assets, tagAssociations, associateTag } = useData();
	const [selectedTag, setSelectedTag] = useState('');
	const [selectedEntity, setSelectedEntity] = useState('');
	const [entityType, setEntityType] = useState('employee');
	const [message, setMessage] = useState('');
	const [localEmployees, setLocalEmployees] = useState(() =>
		Array.isArray(employees) && employees.length > 0
			? employees
			: readCachedArray(CRM_USERS_STORAGE_KEY)
	);
	const [localAssets, setLocalAssets] = useState(() =>
		Array.isArray(assets) && assets.length > 0
			? assets
			: readCachedArray(CRM_ASSETS_STORAGE_KEY)
	);

	useEffect(() => {
		if (Array.isArray(employees) && employees.length > 0) {
			setLocalEmployees(employees);
			persistCachedArray(CRM_USERS_STORAGE_KEY, employees);
		} else {
			const cachedEmployees = readCachedArray(CRM_USERS_STORAGE_KEY);
			if (cachedEmployees.length > 0) {
				setLocalEmployees(cachedEmployees);
			}
		}
	}, [employees]);

	useEffect(() => {
		if (Array.isArray(assets) && assets.length > 0) {
			setLocalAssets(assets);
			persistCachedArray(CRM_ASSETS_STORAGE_KEY, assets);
		} else {
			const cachedAssets = readCachedArray(CRM_ASSETS_STORAGE_KEY);
			if (cachedAssets.length > 0) {
				setLocalAssets(cachedAssets);
			}
		}
	}, [assets]);

	const handleAssociate = () => {
		if (selectedTag && selectedEntity) {
			associateTag(selectedTag, entityType, parseInt(selectedEntity));
			setMessage('Tag associato con successo.');
		}
	};

	const availableEntities =
		entityType === 'employee' ? localEmployees : localAssets;

	return (
		<div className='p-6'>
			<h1 className='text-2xl font-semibold mb-4'>Associazione Tag</h1>
			<div className='bg-white p-4 rounded shadow space-y-4'>
				<div>
					<label className='block font-medium'>Tag:</label>
					<select
						className='w-full border rounded p-2'
						value={selectedTag}
						onChange={(e) => setSelectedTag(e.target.value)}
					>
						<option value=''>-- Seleziona Tag --</option>
						{tags.map((tag) => (
							<option key={tag.id} value={tag.id}>
								{tag.internalId ? `#${tag.internalId} ` : ''}{tag.id} {tag.name ? `— ${tag.name}` : ''}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className='block font-medium'>Tipo:</label>
					<select
						className='w-full border rounded p-2'
						value={entityType}
						onChange={(e) => setEntityType(e.target.value)}
					>
						<option value='employee'>Dipendente</option>
						<option value='asset'>Asset</option>
					</select>
				</div>
				<div>
					<label className='block font-medium'>Seleziona:</label>
					<select
						className='w-full border rounded p-2'
						value={selectedEntity}
						onChange={(e) => setSelectedEntity(e.target.value)}
					>
						<option value=''>-- Seleziona --</option>
						{availableEntities.map((entity) => (
							<option key={entity.id} value={entity.id}>
								{entity.name}
							</option>
						))}
					</select>
				</div>
				<button
					onClick={handleAssociate}
					className='bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700'
				>
					Associa
				</button>
				{message && (
					<div className='mt-4 text-green-700 font-medium'>{message}</div>
				)}
			</div>

			<div className='mt-8'>
				<h2 className='text-lg font-semibold mb-2'>Tag Associati</h2>
				<div className='bg-white p-4 rounded shadow'>
					{tagAssociations.map((a) => {
						const entityList =
							a.targetType === 'employee' ? localEmployees : localAssets;
						const entity = entityList.find((e) => e.id === a.targetId);
						return (
							<div key={a.tagId} className='border-b py-2'>
								<strong>{a.tagId}</strong> — {entity?.name || 'N/A'} (
								{a.targetType})
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};

export default TagAssociationPage;
