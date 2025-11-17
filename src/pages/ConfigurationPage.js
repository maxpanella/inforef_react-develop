import React, { useEffect, useState } from 'react';
import {
	fetchUsersFromCRM,
	fetchAssetsFromCRM,
	fetchCompanyInfo,
	fetchEmployeeTraining,
	fetchEmployeeDPI,
	fetchEmployeeJobAssignments,
} from '../services/crmClient';
import {
	saveUsers,
	saveAssets,
	saveAssociation,
	fetchStoredUsers,
	fetchStoredAssets,
} from '../services/backendClient';
import { useData } from '../context/DataContext';

const COMPANY_INFO_STORAGE_KEY = 'crm_company_info';
const CRM_USERS_STORAGE_KEY = 'crm_cached_users';
const CRM_ASSETS_STORAGE_KEY = 'crm_cached_assets';

const readCachedJson = (key, fallback = null) => {
	if (typeof window === 'undefined' || !window.localStorage) return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch (error) {
		console.warn(`Impossibile leggere ${key} dalla cache locale`, error);
		return fallback;
	}
};

const readCachedArray = (key) => {
	const value = readCachedJson(key, []);
	return Array.isArray(value) ? value : [];
};

const ConfigurationPage = () => {
	const [crmUsers, setCrmUsers] = useState(() =>
		readCachedArray(CRM_USERS_STORAGE_KEY)
	);
	const [crmAssets, setCrmAssets] = useState(() =>
		readCachedArray(CRM_ASSETS_STORAGE_KEY)
	);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState('');
	const [messageType, setMessageType] = useState(''); // 'success' or 'error'
	const [companyInfo, setCompanyInfo] = useState(() =>
		readCachedJson(COMPANY_INFO_STORAGE_KEY, null)
	);
	const [selectedEmployee, setSelectedEmployee] = useState(null);
	const [employeeDetails, setEmployeeDetails] = useState(null);
	const [jobAssignments, setJobAssignments] = useState([]);

	const { tags, employees, assets, associateTag, currentSite, refreshData } =
		useData();

	const cacheImportedData = (usersList = [], assetsList = []) => {
		if (typeof window === 'undefined' || !window.localStorage) return;
		try {
			localStorage.setItem(
				CRM_USERS_STORAGE_KEY,
				JSON.stringify(usersList || [])
			);
			localStorage.setItem(
				CRM_ASSETS_STORAGE_KEY,
				JSON.stringify(assetsList || [])
			);
		} catch (error) {
			console.warn('Impossibile salvare i dati importati in cache locale', error);
		}
	};

	const importData = async () => {
		setLoading(true);
		setMessage('');
		setMessageType('');

		try {
			// First, fetch company info
			setMessage('Recupero informazioni azienda...');
			const company = await fetchCompanyInfo();
			setCompanyInfo(company);
			if (typeof window !== 'undefined' && window.localStorage) {
				try {
					localStorage.setItem(
						COMPANY_INFO_STORAGE_KEY,
						JSON.stringify(company)
					);
				} catch (storageError) {
					console.warn(
						'Impossibile salvare le informazioni aziendali in cache locale',
						storageError
					);
				}
			}
			console.log('Company info fetched:', company);

			// Then fetch users
			setMessage('Recupero dipendenti dal CRM...');
			const users = await fetchUsersFromCRM();
			console.log('Users fetched from CRM:', users);

			// Then fetch assets
			setMessage('Recupero macchinari dal CRM...');
			const assets = await fetchAssetsFromCRM();
			console.log('Assets fetched from CRM:', assets);

			// Save to backend
			setMessage('Salvataggio dati nel sistema locale...');
			await saveUsers(users);
			console.log('Users saved to backend');

			await saveAssets(assets);
			console.log('Assets saved to backend');

			setCrmUsers(users);
			setCrmAssets(assets);
			cacheImportedData(users, assets);

			// Refresh data in context
			if (refreshData) {
				await refreshData();
			}

			setMessage(
				`Importazione completata! ${users.length} dipendenti e ${assets.length} asset importati.`
			);
			setMessageType('success');
		} catch (err) {
			console.error('Import error:', err);
			setMessage(`Errore durante l'importazione: ${err.message}`);
			setMessageType('error');
		}
		setLoading(false);
	};

	// Fetch additional employee details
	const fetchEmployeeDetails = async (employeeId) => {
		try {
			const [training, dpi, jobAssignments] = await Promise.all([
				fetchEmployeeTraining(employeeId),
				fetchEmployeeDPI(employeeId),
				fetchEmployeeJobAssignments(employeeId),
			]);

			setEmployeeDetails({
				training,
				dpi,
			});
			setJobAssignments(jobAssignments);
		} catch (error) {
			console.error('Error fetching employee details:', error);
			setEmployeeDetails(null);
			setJobAssignments([]);
		}
	};

	const handleAssociation = async (tagId, targetType, targetId) => {
		try {
			// Check if it's a valid association for the current site
			if (currentSite) {
				await saveAssociation(tagId, targetType, targetId, currentSite.id);
				associateTag(tagId, targetType, targetId);
				setMessage(`Tag ${tagId} associato con successo!`);
				setMessageType('success');
			}
		} catch (err) {
			console.error("Errore nell'associazione:", err);
			setMessage(`Errore nell'associazione: ${err.message}`);
			setMessageType('error');
		}
	};

	const loadExistingData = async () => {
		try {
			const [storedUsers, storedAssets] = await Promise.all([
				fetchStoredUsers(),
				fetchStoredAssets(),
			]);

			const usersList = Array.isArray(storedUsers) ? storedUsers : [];
			const assetsList = Array.isArray(storedAssets) ? storedAssets : [];

			setCrmUsers(usersList);
			setCrmAssets(assetsList);
			cacheImportedData(usersList, assetsList);

			return usersList.length > 0 || assetsList.length > 0;
		} catch (error) {
			console.error(
				'Errore durante il recupero dei dati dal backend locale:',
				error
			);
			return false;
		}
	};

	// Auto-import on component mount only if backend has no data yet
	useEffect(() => {
		const initializeData = async () => {
			if (!currentSite) return;

			const hasCachedData =
				(Array.isArray(crmUsers) && crmUsers.length > 0) ||
				(Array.isArray(crmAssets) && crmAssets.length > 0);

			if (hasCachedData) {
				return;
			}

			const hasExistingData = await loadExistingData();
			if (!hasExistingData) {
				await importData();
			}
		};

		initializeData();
	}, [currentSite, crmUsers, crmAssets]);

	return (
		<div className='p-6'>
			<h1 className='text-2xl font-bold mb-4'>Configurazione Sistema</h1>

			{/* Company Info Card */}
			{companyInfo && (
				<div className='bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6'>
					<h2 className='text-lg font-semibold text-blue-900 mb-2'>
						Informazioni Azienda
					</h2>
					<div className='grid grid-cols-2 gap-4 text-sm'>
						<div>
							<span className='font-medium'>Ragione Sociale:</span>{' '}
							{companyInfo.name}
						</div>
						<div>
							<span className='font-medium'>P.IVA:</span>{' '}
							{companyInfo.vatNumber}
						</div>
						<div>
							<span className='font-medium'>Indirizzo:</span>{' '}
							{companyInfo.address}
						</div>
						<div>
							<span className='font-medium'>Telefono:</span> {companyInfo.phone}
						</div>
					</div>
				</div>
			)}

			<button
				onClick={importData}
				disabled={loading}
				className={`bg-blue-600 text-white px-4 py-2 rounded mb-4 hover:bg-blue-700 transition-colors ${
					loading ? 'opacity-50 cursor-not-allowed' : ''
				}`}
			>
				{loading ? 'Importazione in corso...' : 'Importa da CRM SGSL'}
			</button>

			{message && (
				<div
					className={`mb-4 p-3 rounded ${
						messageType === 'success'
							? 'bg-green-100 text-green-700'
							: 'bg-red-100 text-red-700'
					}`}
				>
					{message}
				</div>
			)}

			<div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
				<div>
					<h2 className='text-xl font-semibold mb-2'>
						Dipendenti ({crmUsers.length})
					</h2>
					<div className='border rounded p-2 h-64 overflow-auto bg-white'>
						{crmUsers.length === 0 ? (
							<p className='text-gray-500 text-center py-8'>
								Nessun dipendente importato
							</p>
						) : (
							<ul className='space-y-2'>
								{crmUsers.map((u) => (
									<li
										key={u.id}
										className='border-b pb-2 hover:bg-gray-50 p-2 rounded cursor-pointer'
										onClick={() => {
											setSelectedEmployee(u);
											fetchEmployeeDetails(u.id);
										}}
									>
										<div className='flex items-center justify-between'>
											<div>
												<div className='font-medium'>{u.name}</div>
												<div className='text-sm text-gray-600'>{u.role}</div>
												{u.email && (
													<div className='text-xs text-gray-500'>{u.email}</div>
												)}
											</div>
											<div className='text-right'>
												{u.isActive ? (
													<span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
														Attivo
													</span>
												) : (
													<span className='text-xs bg-red-100 text-red-800 px-2 py-1 rounded'>
														Inattivo
													</span>
												)}
											</div>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				<div>
					<h2 className='text-xl font-semibold mb-2'>
						Macchinari ({crmAssets.length})
					</h2>
					<div className='border rounded p-2 h-64 overflow-auto bg-white'>
						{crmAssets.length === 0 ? (
							<p className='text-gray-500 text-center py-8'>
								Nessun macchinario importato
							</p>
						) : (
							<ul className='space-y-2'>
								{crmAssets.map((a) => (
									<li key={a.id} className='border-b pb-2'>
										<div className='font-medium'>{a.name}</div>
										<div className='text-sm text-gray-600'>{a.type}</div>
										{a.departmentName && (
											<div className='text-xs text-gray-500'>
												Reparto: {a.departmentName}
											</div>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			</div>

			{/* Employee Details Panel */}
			{selectedEmployee && employeeDetails && (
				<div className='mt-6 bg-gray-50 rounded-lg p-4'>
					<h3 className='text-lg font-semibold mb-3'>
						Dettagli Dipendente: {selectedEmployee.name}
					</h3>

					{/* Informazioni base */}
					<div className='grid grid-cols-2 gap-4 mb-4 text-sm'>
						<div>
							<span className='font-medium'>Matricola:</span>{' '}
							{selectedEmployee.registrationNumber || 'N/A'}
						</div>
						<div>
							<span className='font-medium'>Codice Fiscale:</span>{' '}
							{selectedEmployee.fiscalCode || 'N/A'}
						</div>
						<div>
							<span className='font-medium'>Data Assunzione:</span>{' '}
							{selectedEmployee.hireDate
								? new Date(selectedEmployee.hireDate).toLocaleDateString(
										'it-IT'
								  )
								: 'N/A'}
						</div>
						<div>
							<span className='font-medium'>Reparto:</span>{' '}
							{selectedEmployee.department || 'N/A'}
						</div>
						{selectedEmployee.contractExpiry && (
							<div>
								<span className='font-medium'>Scadenza Contratto:</span>{' '}
								{new Date(selectedEmployee.contractExpiry).toLocaleDateString(
									'it-IT'
								)}
							</div>
						)}
						<div>
							<span className='font-medium'>Ore Settimanali:</span>{' '}
							{selectedEmployee.hours || '40'}
						</div>
					</div>

					<div className='grid grid-cols-2 gap-4'>
						<div>
							<h4 className='font-medium text-gray-700 mb-2'>Formazione</h4>
							<ul className='text-sm space-y-1'>
								{employeeDetails.training.length === 0 ? (
									<li className='text-gray-500'>
										Nessuna formazione registrata
									</li>
								) : (
									employeeDetails.training.map((t, idx) => (
										<li key={idx} className='border-b pb-1'>
											<div className='flex justify-between'>
												<span className='font-medium'>{t.courseName}</span>
												<span className='text-gray-500'>
													{t.completionDate
														? new Date(t.completionDate).toLocaleDateString(
																'it-IT'
														  )
														: ''}
												</span>
											</div>
											{t.outcome && (
												<div className='text-xs text-gray-600'>
													Esito: {t.outcome}{' '}
													{t.hasCertificate && '✓ Certificato'}
												</div>
											)}
										</li>
									))
								)}
							</ul>
						</div>
						<div>
							<h4 className='font-medium text-gray-700 mb-2'>DPI Assegnati</h4>
							<ul className='text-sm space-y-1'>
								{employeeDetails.dpi.length === 0 ? (
									<li className='text-gray-500'>Nessun DPI assegnato</li>
								) : (
									employeeDetails.dpi.map((d, idx) => (
										<li key={idx} className='border-b pb-1'>
											<div>
												<span className='font-medium'>{d.name}</span>
												{d.type && (
													<span className='text-xs text-gray-600 ml-1'>
														({d.type})
													</span>
												)}
											</div>
											<div className='text-xs text-gray-600'>
												Consegnato:{' '}
												{d.assignmentDate
													? new Date(d.assignmentDate).toLocaleDateString(
															'it-IT'
													  )
													: 'N/A'}
												{d.expiryDate && (
													<span className='ml-2'>
														Scadenza:{' '}
														{new Date(d.expiryDate).toLocaleDateString('it-IT')}
													</span>
												)}
											</div>
										</li>
									))
								)}
							</ul>
						</div>
					</div>

					{/* Mansioni autorizzate */}
					{jobAssignments.length > 0 && (
						<div className='mt-4'>
							<h4 className='font-medium text-gray-700 mb-2'>
								Mansioni Autorizzate
							</h4>
							<div className='flex flex-wrap gap-2'>
								{jobAssignments.map((job, idx) => (
									<span
										key={idx}
										className='text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded'
									>
										{job.jobRoleName}
										{job.departmentName && ` - ${job.departmentName}`}
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			<div className='mt-8'>
				<h2 className='text-xl font-semibold mb-2'>Associazioni Tag RFID</h2>
				{tags.length === 0 ? (
					<div className='bg-yellow-50 border border-yellow-200 rounded p-4'>
						<p className='text-yellow-800'>
							Nessun tag rilevato. Assicurati che il sistema BlueIOT sia
							connesso.
						</p>
					</div>
				) : (
					<div className='bg-white border rounded p-4 space-y-3'>
						{tags.map((tag) => (
							<div key={tag.id} className='border rounded p-3 bg-gray-50'>
								<div className='font-medium mb-2'>Tag: {tag.id}</div>
								<div className='grid grid-cols-2 gap-2'>
									<select
										onChange={(e) => {
											if (e.target.value) {
												handleAssociation(
													tag.id,
													'employee',
													parseInt(e.target.value)
												);
											}
										}}
										className='border rounded p-2 text-sm'
										defaultValue=''
									>
										<option value=''>Associa a dipendente...</option>
										{employees.map((u) => (
											<option key={u.id} value={u.id}>
												{u.name}
											</option>
										))}
									</select>
									<select
										onChange={(e) => {
											if (e.target.value) {
												handleAssociation(
													tag.id,
													'asset',
													parseInt(e.target.value)
												);
											}
										}}
										className='border rounded p-2 text-sm'
										defaultValue=''
									>
										<option value=''>Associa a macchinario...</option>
										{assets.map((a) => (
											<option key={a.id} value={a.id}>
												{a.name}
											</option>
										))}
									</select>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export default ConfigurationPage;
