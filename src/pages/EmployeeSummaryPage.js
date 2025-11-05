import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import {
	fetchEmployeeTraining,
	fetchEmployeeDPI,
	fetchEmployeeJobAssignments,
} from '../services/crmClient';

const EmployeeSummaryPage = () => {
	const { employees, tagAssociations } = useData();
	const [selectedEmployee, setSelectedEmployee] = useState(null);
	const [employeeDetails, setEmployeeDetails] = useState(null);
	const [loading, setLoading] = useState(false);
	const [filter, setFilter] = useState('all'); // all, active, inactive, with-tag

	// Filtra i dipendenti
	const filteredEmployees = employees.filter((emp) => {
		switch (filter) {
			case 'active':
				return emp.isActive;
			case 'inactive':
				return !emp.isActive;
			case 'with-tag':
				return tagAssociations.some(
					(assoc) =>
						assoc.targetType === 'employee' && assoc.targetId === emp.id
				);
			default:
				return true;
		}
	});

	// Carica i dettagli del dipendente selezionato
	const loadEmployeeDetails = async (employee) => {
		setLoading(true);
		setSelectedEmployee(employee);

		try {
			const [training, dpi, jobAssignments] = await Promise.all([
				fetchEmployeeTraining(employee.id),
				fetchEmployeeDPI(employee.id),
				fetchEmployeeJobAssignments(employee.id),
			]);

			setEmployeeDetails({
				training,
				dpi,
				jobAssignments,
			});
		} catch (error) {
			console.error('Error loading employee details:', error);
			setEmployeeDetails(null);
		}

		setLoading(false);
	};

	// Trova il tag associato al dipendente
	const getEmployeeTag = (employeeId) => {
		const association = tagAssociations.find(
			(assoc) =>
				assoc.targetType === 'employee' && assoc.targetId === employeeId
		);
		return association?.tagId || null;
	};

	// Calcola statistiche
	const stats = {
		total: employees.length,
		active: employees.filter((e) => e.isActive).length,
		withTags: employees.filter((e) => getEmployeeTag(e.id)).length,
		fragileWorkers: employees.filter((e) => e.fragileWorker).length,
	};

	return (
		<div className='p-6'>
			<h1 className='text-2xl font-bold mb-4'>Riepilogo Dipendenti</h1>

			{/* Statistiche */}
			<div className='grid grid-cols-4 gap-4 mb-6'>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold'>{stats.total}</div>
					<div className='text-sm text-gray-600'>Totale Dipendenti</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-green-600'>
						{stats.active}
					</div>
					<div className='text-sm text-gray-600'>Dipendenti Attivi</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-blue-600'>
						{stats.withTags}
					</div>
					<div className='text-sm text-gray-600'>Con Tag Assegnato</div>
				</div>
				<div className='bg-white p-4 rounded shadow'>
					<div className='text-2xl font-semibold text-orange-600'>
						{stats.fragileWorkers}
					</div>
					<div className='text-sm text-gray-600'>Lavoratori Fragili</div>
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
					onClick={() => setFilter('active')}
					className={`px-4 py-2 rounded ${
						filter === 'active'
							? 'bg-green-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Attivi ({stats.active})
				</button>
				<button
					onClick={() => setFilter('inactive')}
					className={`px-4 py-2 rounded ${
						filter === 'inactive'
							? 'bg-red-600 text-white'
							: 'bg-gray-200 text-gray-700'
					}`}
				>
					Inattivi ({stats.total - stats.active})
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
				{/* Lista dipendenti */}
				<div className='lg:col-span-1'>
					<div className='bg-white rounded shadow'>
						<div className='p-4 border-b'>
							<h2 className='text-lg font-semibold'>Lista Dipendenti</h2>
						</div>
						<div className='max-h-[600px] overflow-y-auto'>
							{filteredEmployees.map((emp) => {
								const tag = getEmployeeTag(emp.id);
								return (
									<div
										key={emp.id}
										onClick={() => loadEmployeeDetails(emp)}
										className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
											selectedEmployee?.id === emp.id ? 'bg-blue-50' : ''
										}`}
									>
										<div className='flex justify-between items-start'>
											<div>
												<div className='font-medium'>{emp.name}</div>
												<div className='text-sm text-gray-600'>{emp.role}</div>
												<div className='text-xs text-gray-500'>
													Matricola: {emp.registrationNumber || 'N/A'}
												</div>
											</div>
											<div className='text-right'>
												{emp.isActive ? (
													<span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
														Attivo
													</span>
												) : (
													<span className='text-xs bg-red-100 text-red-800 px-2 py-1 rounded'>
														Inattivo
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
				</div>

				{/* Dettagli dipendente */}
				<div className='lg:col-span-2'>
					{loading ? (
						<div className='bg-white rounded shadow p-8 text-center'>
							<div className='text-gray-500'>Caricamento dettagli...</div>
						</div>
					) : selectedEmployee ? (
						<div className='bg-white rounded shadow'>
							<div className='p-4 border-b'>
								<h2 className='text-lg font-semibold'>
									Dettagli: {selectedEmployee.name}
								</h2>
							</div>
							<div className='p-4'>
								{/* Informazioni personali */}
								<div className='mb-6'>
									<h3 className='font-medium text-gray-700 mb-3'>
										Informazioni Personali
									</h3>
									<div className='grid grid-cols-2 gap-4 text-sm'>
										<div>
											<span className='font-medium'>Codice Fiscale:</span>{' '}
											{selectedEmployee.fiscalCode || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Data Nascita:</span>{' '}
											{selectedEmployee.birthDate
												? new Date(
														selectedEmployee.birthDate
												  ).toLocaleDateString('it-IT')
												: 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Luogo Nascita:</span>{' '}
											{selectedEmployee.birthCity || 'N/A'}
											{selectedEmployee.birthProvince &&
												` (${selectedEmployee.birthProvince})`}
										</div>
										<div>
											<span className='font-medium'>Nazionalità:</span>{' '}
											{selectedEmployee.nationality || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Genere:</span>{' '}
											{selectedEmployee.gender || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Telefono:</span>{' '}
											{selectedEmployee.phone || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Email:</span>{' '}
											{selectedEmployee.email || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Indirizzo:</span>{' '}
											{selectedEmployee.address || 'N/A'}
											{selectedEmployee.city && `, ${selectedEmployee.city}`}
											{selectedEmployee.province &&
												` (${selectedEmployee.province})`}
										</div>
									</div>
								</div>

								{/* Informazioni contrattuali */}
								<div className='mb-6'>
									<h3 className='font-medium text-gray-700 mb-3'>
										Informazioni Contrattuali
									</h3>
									<div className='grid grid-cols-2 gap-4 text-sm'>
										<div>
											<span className='font-medium'>Data Assunzione:</span>{' '}
											{selectedEmployee.hireDate
												? new Date(
														selectedEmployee.hireDate
												  ).toLocaleDateString('it-IT')
												: 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Tipo Contratto:</span>{' '}
											{selectedEmployee.contractType === '0'
												? 'Indeterminato'
												: selectedEmployee.contractType === '1'
												? 'Determinato'
												: selectedEmployee.contractType === '2'
												? 'Apprendistato'
												: 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Scadenza Contratto:</span>{' '}
											{selectedEmployee.contractExpiry
												? new Date(
														selectedEmployee.contractExpiry
												  ).toLocaleDateString('it-IT')
												: 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Ore Settimanali:</span>{' '}
											{selectedEmployee.hours || '40'}
										</div>
										<div>
											<span className='font-medium'>Reparto:</span>{' '}
											{selectedEmployee.department || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Livello Istruzione:</span>{' '}
											{selectedEmployee.educationLevel || 'N/A'}
										</div>
									</div>
								</div>

								{/* Informazioni sanitarie */}
								<div className='mb-6'>
									<h3 className='font-medium text-gray-700 mb-3'>
										Informazioni Sanitarie
									</h3>
									<div className='grid grid-cols-2 gap-4 text-sm'>
										<div>
											<span className='font-medium'>Medico Competente:</span>{' '}
											{selectedEmployee.doctorName || 'N/A'}
										</div>
										<div>
											<span className='font-medium'>Tel. Medico:</span>{' '}
											{selectedEmployee.doctorPhone || 'N/A'}
										</div>
										<div className='flex items-center gap-4'>
											<label className='flex items-center gap-2'>
												<input
													type='checkbox'
													checked={selectedEmployee.underMedicalSurveillance}
													disabled
													className='rounded'
												/>
												<span>Sorveglianza Sanitaria</span>
											</label>
										</div>
										<div className='flex items-center gap-4'>
											<label className='flex items-center gap-2'>
												<input
													type='checkbox'
													checked={selectedEmployee.usesVdtMoreThan20h}
													disabled
													className='rounded'
												/>
												<span>Uso VDT > 20h</span>
											</label>
										</div>
										<div className='flex items-center gap-4'>
											<label className='flex items-center gap-2'>
												<input
													type='checkbox'
													checked={selectedEmployee.fragileWorker}
													disabled
													className='rounded'
												/>
												<span>Lavoratore Fragile</span>
											</label>
										</div>
									</div>
								</div>

								{/* Formazione, DPI e Mansioni */}
								{employeeDetails && (
									<>
										<div className='grid grid-cols-2 gap-6 mb-6'>
											<div>
												<h3 className='font-medium text-gray-700 mb-3'>
													Formazione
												</h3>
												<div className='max-h-48 overflow-y-auto'>
													{employeeDetails.training.length === 0 ? (
														<p className='text-sm text-gray-500'>
															Nessuna formazione registrata
														</p>
													) : (
														<ul className='space-y-2'>
															{employeeDetails.training.map((training, idx) => (
																<li key={idx} className='text-sm border-b pb-2'>
																	<div className='font-medium'>
																		{training.courseName}
																	</div>
																	<div className='text-xs text-gray-600'>
																		Completato:{' '}
																		{new Date(
																			training.completionDate
																		).toLocaleDateString('it-IT')}
																		{training.outcome &&
																			` - ${training.outcome}`}
																		{training.hasCertificate && ' ✓'}
																	</div>
																</li>
															))}
														</ul>
													)}
												</div>
											</div>

											<div>
												<h3 className='font-medium text-gray-700 mb-3'>
													DPI Assegnati
												</h3>
												<div className='max-h-48 overflow-y-auto'>
													{employeeDetails.dpi.length === 0 ? (
														<p className='text-sm text-gray-500'>
															Nessun DPI assegnato
														</p>
													) : (
														<ul className='space-y-2'>
															{employeeDetails.dpi.map((dpi, idx) => (
																<li key={idx} className='text-sm border-b pb-2'>
																	<div className='font-medium'>{dpi.name}</div>
																	<div className='text-xs text-gray-600'>
																		{dpi.type} - Consegnato:{' '}
																		{new Date(
																			dpi.assignmentDate
																		).toLocaleDateString('it-IT')}
																		{dpi.expiryDate && (
																			<span className='ml-2'>
																				Scade:{' '}
																				{new Date(
																					dpi.expiryDate
																				).toLocaleDateString('it-IT')}
																			</span>
																		)}
																	</div>
																</li>
															))}
														</ul>
													)}
												</div>
											</div>
										</div>

										{employeeDetails.jobAssignments.length > 0 && (
											<div>
												<h3 className='font-medium text-gray-700 mb-3'>
													Mansioni Autorizzate
												</h3>
												<div className='flex flex-wrap gap-2'>
													{employeeDetails.jobAssignments.map((job, idx) => (
														<span
															key={idx}
															className='text-xs bg-blue-100 text-blue-800 px-3 py-1 rounded'
														>
															{job.jobRoleName}
															{job.departmentName && ` - ${job.departmentName}`}
														</span>
													))}
												</div>
											</div>
										)}
									</>
								)}
							</div>
						</div>
					) : (
						<div className='bg-white rounded shadow p-8 text-center'>
							<div className='text-gray-500'>
								Seleziona un dipendente per visualizzare i dettagli
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default EmployeeSummaryPage;
