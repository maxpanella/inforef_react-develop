import React, { useState } from 'react';
import { useData } from '../context/DataContext';

const TagAssociationPage = () => {
	const { tags, employees, assets, tagAssociations, associateTag } = useData();
	const [selectedTag, setSelectedTag] = useState('');
	const [selectedEntity, setSelectedEntity] = useState('');
	const [entityType, setEntityType] = useState('employee');
	const [message, setMessage] = useState('');

	const handleAssociate = () => {
		if (selectedTag && selectedEntity) {
			associateTag(selectedTag, entityType, parseInt(selectedEntity));
			setMessage('Tag associato con successo.');
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
					>
						<option value=''>-- Seleziona Tag --</option>
						{tags.map((tag) => (
							<option key={tag.id} value={tag.id}>
								{tag.id}
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
						{(entityType === 'employee' ? employees : assets).map((entity) => (
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
						const entityList = a.targetType === 'employee' ? employees : assets;
						const entity = entityList.find((e) => e.id === a.targetId);
						return (
							<div key={a.tagId} className='border-b py-2'>
								<strong>{a.tagId}</strong> → {entity?.name || 'N/A'} (
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
