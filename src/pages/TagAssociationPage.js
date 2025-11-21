import React, { useEffect, useMemo, useState } from 'react';
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
	const {
		tags,
		employees,
		assets,
		tagAssociations,
		associateTag,
		dissociateTag,
		currentSite,
	} = useData();
	const [selectedTag, setSelectedTag] = useState('');
	const [selectedEntity, setSelectedEntity] = useState('');
	const [entityType, setEntityType] = useState('employee');
	const [message, setMessage] = useState('');
	const [messageType, setMessageType] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [dissociatingTag, setDissociatingTag] = useState(null);
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

	const assignedTagIds = useMemo(() => {
		return new Set(tagAssociations.map((assoc) => String(assoc.tagId)));
	}, [tagAssociations]);

	const availableTags = useMemo(() => {
		return tags.filter((tag) => !assignedTagIds.has(String(tag.id)));
	}, [tags, assignedTagIds]);

	useEffect(() => {
		if (selectedTag && assignedTagIds.has(String(selectedTag))) {
			setSelectedTag('');
		}
	}, [assignedTagIds, selectedTag]);

	const handleAssociate = async () => {
		if (!selectedTag || !selectedEntity) {
			setMessage('Seleziona un tag e un elemento da associare.');
			setMessageType('error');
			return;
		}

		if (!currentSite?.id) {
			setMessage('Seleziona prima un sito.');
			setMessageType('error');
			return;
		}

		setIsSubmitting(true);
		setMessage('');
		setMessageType('');

		try {
			await associateTag(selectedTag, entityType, parseInt(selectedEntity, 10));
			setMessage('Tag associato con successo.');
			setMessageType('success');
			setSelectedEntity('');
			setSelectedTag('');
		} catch (error) {
			console.error('Errore durante la creazione associazione:', error);
			setMessage(
				error?.message || "Si è verificato un errore durante l'associazione."
			);
			setMessageType('error');
		} finally {
			setIsSubmitting(false);
		}
	};

	const availableEntities =
		entityType === 'employee' ? localEmployees : localAssets;

	const handleDissociate = async (tagId) => {
		if (!tagId) return;

		if (!currentSite?.id) {
			setMessage('Seleziona prima un sito.');
			setMessageType('error');
			return;
		}

		setDissociatingTag(tagId);
		setMessage('');
		setMessageType('');

		try {
			await dissociateTag(tagId);
			setMessage(`Tag ${tagId} dissociato con successo.`);
			setMessageType('success');
		} catch (error) {
			console.error('Errore durante la dissociazione tag:', error);
			setMessage(
				error?.message || "Si è verificato un errore durante la dissociazione."
			);
			setMessageType('error');
		} finally {
			setDissociatingTag(null);
		}
	};

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
						disabled={availableTags.length === 0}
					>
						<option value=''>-- Seleziona Tag --</option>
						{availableTags.map((tag) => (
							<option key={tag.id} value={tag.id}>
								{tag.internalId ? `#${tag.internalId} ` : ''}{tag.id} {tag.name ? `— ${tag.name}` : ''}
							</option>
						))}
					</select>
					{availableTags.length === 0 && (
						<p className='text-xs text-gray-500 mt-1'>
							Tutti i tag sono già associati. Dissocia un tag per renderlo
							nuovamente disponibile.
						</p>
					)}
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
					className={`bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 ${
						isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
					}`}
					disabled={isSubmitting}
				>
					{isSubmitting ? 'Associazione...' : 'Associa'}
				</button>
				{message && (
					<div
						className={`mt-4 font-medium ${
							messageType === 'error' ? 'text-red-700' : 'text-green-700'
						}`}
					>
						{message}
					</div>
				)}
			</div>

			<div className='mt-8'>
				<h2 className='text-lg font-semibold mb-2'>Tag Associati</h2>
				<div className='bg-white p-4 rounded shadow'>
					{tagAssociations.length === 0 ? (
						<p className='text-gray-500 text-sm'>
							Nessuna associazione presente per questo sito.
						</p>
					) : (
						tagAssociations.map((a) => {
							const entityList =
								a.targetType === 'employee' ? localEmployees : localAssets;
							const entity = entityList.find((e) => e.id === a.targetId);
							const entityName = entity?.name || a.targetName || 'N/A';

							return (
								<div
									key={`${a.tagId}-${a.targetId}-${a.targetType}`}
									className='flex items-center justify-between border-b py-2'
								>
									<div>
										<strong>{a.tagId}</strong> - {entityName} ({a.targetType})
									</div>
									<button
										onClick={() => handleDissociate(a.tagId)}
										disabled={dissociatingTag === a.tagId}
										className={`text-sm text-red-600 hover:underline ${
											dissociatingTag === a.tagId
												? 'opacity-50 cursor-not-allowed'
												: ''
										}`}
									>
										{dissociatingTag === a.tagId
											? 'Dissociazione...'
											: 'Dissocia'}
									</button>
								</div>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
};

export default TagAssociationPage;
