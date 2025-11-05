import { env } from './env';

// Fetch all employees for a specific company
export const fetchUsersFromCRM = async () => {
	console.log('[CRM] Fetching employees from SGSL Web API');
	console.log('[CRM] Company ID:', env.companyId);
	console.log('[CRM] API URL:', env.crmUrl);

	try {
		const res = await fetch(
			`${env.crmUrl}/api/v1/company/employees/${env.companyId}`,
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
			}
		);

		if (!res.ok) {
			console.error('[CRM] Response status:', res.status);
			throw new Error(`Errore recupero dipendenti dal CRM: ${res.status}`);
		}

		const response = await res.json();
		console.log('[CRM] Raw employee data:', response);

		const employeeWrappers = response.data || [];

		return employeeWrappers.map((wrapper) => {
			const emp = wrapper.employee;
			return {
				id: parseInt(emp.id) || emp.numericId,
				name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
				role: emp.jobTitle || emp.qualification || 'Dipendente',
				email: emp.email || '',
				phone: emp.phone || emp.mobile || '',
				companyId: env.companyId,
				fiscalCode: emp.taxCode || '',
				birthDate: emp.birthDate || '',
				birthCity: emp.birthCity || '',
				birthProvince: emp.birthProvince || '',
				hireDate: emp.hireDate || '',
				department: emp.department || '',
				isActive: emp.active === 1,
				registrationNumber: emp.registrationNumber || '',
				gender: emp.gender || '',
				nationality: emp.nationality || '',
				address: emp.address || '',
				city: emp.city || '',
				postalCode: emp.postalCode || '',
				province: emp.province || '',
				contractType: emp.contractType || '',
				contractExpiry: emp.contractExpiry || '',
				educationLevel: emp.educationLevel || '',
				underMedicalSurveillance: emp.underMedicalSurveillance || false,
				fragileWorker: emp.fragileWorker || false,
				usesVdtMoreThan20h: emp.usesVdtMoreThan20h || false,
				hours: emp.hours || 40,
				doctorName: emp.doctorName || '',
				doctorPhone: emp.doctorPhone || '',
			};
		});
	} catch (error) {
		console.error('[CRM] Error fetching employees:', error);

		if (env.useMock || process.env.NODE_ENV === 'development') {
			console.warn('[CRM] Falling back to mock data');
			return [
				{
					id: 1,
					name: 'Roberto Fortunato',
					role: 'Operaio',
					email: '',
					companyId: env.companyId,
					isActive: true,
				},
				{
					id: 2,
					name: 'Marco Bianchi',
					role: 'Tecnico manutentore',
					email: 'm.bianchi@azienda.it',
					companyId: env.companyId,
					isActive: true,
				},
			];
		}

		throw error;
	}
};

export const fetchAssetsFromCRM = async () => {
	console.log('[CRM] Fetching assets/machines from SGSL Web API');

	try {
		const employees = await fetchUsersFromCRM();
		const assets = [];
		const assetMap = new Map();

		// Per ogni dipendente, recupera le macchine autorizzate
		for (const employee of employees) {
			try {
				const res = await fetch(
					`${env.crmUrl}/api/v1/employee/machine/${employee.id}`,
					{
						method: 'GET',
						headers: {
							Accept: 'application/json',
							'Content-Type': 'application/json',
						},
					}
				);

				if (res.ok) {
					const response = await res.json();
					console.log(
						`[CRM] Machine response for employee ${employee.id}:`,
						response
					);

					const machineData = response.data;

					if (machineData && machineData.machineAssignments) {
						const validMachines = machineData.machineAssignments.filter(
							(assignment) =>
								assignment.machineAssignmentId !== null &&
								assignment.machineName !== null
						);

						validMachines.forEach((assignment) => {
							const assetId = assignment.machineAssignmentId;
							if (!assetMap.has(assetId)) {
								assetMap.set(assetId, {
									id: assetId,
									name: assignment.machineName,
									type: 'Macchinario',
									model: '',
									serialNumber: '',
									manufacturer: '',
									companyId: env.companyId,
									departmentId: assignment.departmentId || null,
									departmentName: assignment.departmentName || '',
									lastMaintenance: '',
									nextMaintenance: '',
									isOperational: true,
								});
							}
						});
					}
				} else if (res.status === 500) {
					// Ignora gli errori 500 per singoli dipendenti
					console.warn(
						`[CRM] Server error for employee ${employee.id}, skipping...`
					);
					continue;
				}
			} catch (error) {
				console.warn(
					`[CRM] Error fetching machines for employee ${employee.id}:`,
					error
				);
				// Continua con il prossimo dipendente invece di bloccarsi
				continue;
			}
		}

		// Converti la map in array
		assets.push(...assetMap.values());

		console.log(`[CRM] Found ${assets.length} unique assets`);
		return assets;
	} catch (error) {
		console.error('[CRM] Error fetching assets:', error);

		if (env.useMock || process.env.NODE_ENV === 'development') {
			return [
				{
					id: 10,
					name: 'Escavatore CAT 320',
					type: 'Escavatore',
					model: 'CAT 320',
					companyId: env.companyId,
					isOperational: true,
				},
				{
					id: 11,
					name: 'Gru Torre Liebherr',
					type: 'Gru',
					model: 'Liebherr 81K',
					companyId: env.companyId,
					isOperational: true,
				},
			];
		}

		throw error;
	}
};

// Fetch employee training information
export const fetchEmployeeTraining = async (employeeId) => {
	try {
		const res = await fetch(
			`${env.crmUrl}/api/v1/employee/training/${employeeId}`,
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
			}
		);

		if (!res.ok) throw new Error(`Errore recupero formazione: ${res.status}`);

		const response = await res.json();
		const trainingData = response.data;

		let trainings = [];
		if (trainingData && trainingData.completedTrainings) {
			trainings = trainingData.completedTrainings.map((t) => ({
				courseName: t.training?.name || 'Corso',
				completionDate: t.date || '',
				outcome: t.outcome || 'Not Evaluated',
				hasCertificate: t.hasCertificate === 1,
				location: t.location || '',
				instructor: t.instructor || '',
				durationHours: t.training?.durationHours || 0,
			}));
		}

		return trainings;
	} catch (error) {
		console.error(
			`[CRM] Error fetching training for employee ${employeeId}:`,
			error
		);

		if (env.useMock || process.env.NODE_ENV === 'development') {
			return [
				{ courseName: 'Sicurezza Base', completionDate: '2024-01-15' },
				{ courseName: 'Primo Soccorso', completionDate: '2024-02-20' },
			];
		}

		return [];
	}
};

// Fetch employee DPI (Personal Protective Equipment) information
export const fetchEmployeeDPI = async (employeeId) => {
	try {
		const res = await fetch(`${env.crmUrl}/api/v1/employee/dpi/${employeeId}`, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		});

		if (!res.ok) throw new Error(`Errore recupero DPI: ${res.status}`);

		const response = await res.json();
		const dpiData = response.data;

		let dpiList = [];

		if (dpiData) {
			if (dpiData.trackedDeliveries) {
				dpiList = dpiList.concat(
					dpiData.trackedDeliveries.map((d) => ({
						name: d.dpi?.name || 'DPI',
						type: d.dpi?.typeName || 'Tipo non specificato',
						assignmentDate: d.deliveryDate || '',
						expiryDate: d.details?.expiryDate || '',
						brand: d.details?.brand || '',
						model: d.details?.model || '',
						dismissed: d.dismissed === 1,
					}))
				);
			}

			if (dpiData.manualDeliveries) {
				dpiList = dpiList.concat(
					dpiData.manualDeliveries.map((d) => ({
						name: d.dpi?.name || 'DPI',
						type: d.dpi?.typeName || 'Tipo non specificato',
						assignmentDate: d.deliveryDate || '',
						expiryDate: d.details?.expiryDate || '',
						brand: d.details?.brand || '',
						model: d.details?.model || '',
						dismissed: d.dismissed === 1,
					}))
				);
			}
		}

		return dpiList;
	} catch (error) {
		console.error(
			`[CRM] Error fetching DPI for employee ${employeeId}:`,
			error
		);

		if (env.useMock || process.env.NODE_ENV === 'development') {
			return [
				{
					name: 'Casco protettivo',
					assignmentDate: '2024-01-10',
					type: 'Protezione testa',
				},
				{
					name: 'Scarpe antinfortunistica',
					assignmentDate: '2024-01-10',
					type: 'Protezione piedi',
				},
			];
		}

		return [];
	}
};

// Fetch company information
export const fetchCompanyInfo = async () => {
	try {
		const res = await fetch(`${env.crmUrl}/api/v1/company/${env.companyId}`, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		});

		if (!res.ok) throw new Error(`Errore recupero info azienda: ${res.status}`);

		const response = await res.json();
		console.log('[CRM] Company info:', response);

		const company = response.data?.company || {};

		return {
			id: parseInt(company.id) || env.companyId,
			name: company.name || env.companyName,
			vatNumber: company.vatNumber || company.piva || 'Non disponibile',
			address: company.address || 'Non disponibile',
			phone: company.phone || 'Non disponibile',
			email: company.email || '',
			administrator: company.administrator || '',
			username: company.username || '',
			expirationDate: company.expirationDate || '',
			type: company.type || 1,
			maxBranches: company.maxBranches || 0,
			maxUsers: company.maxUsers || 0,
			dpiExpirationInterval: company.dpiExpirationInterval || 30,
		};
	} catch (error) {
		console.error('[CRM] Error fetching company info:', error);

		// Dati di fallback più completi
		return {
			id: env.companyId,
			name: env.companyName || 'INFOREF',
			vatNumber: 'Non disponibile',
			address: 'Non disponibile',
			phone: 'Non disponibile',
			email: 'info@inforef.it',
		};
	}
};

// Check if an employee is authorized for a specific site/construction site
export const checkEmployeeSiteAuthorization = async (employeeId, siteId) => {
	try {
		const employees = await fetchUsersFromCRM();
		const employee = employees.find((e) => e.id === employeeId);
		return employee && employee.isActive;
	} catch (error) {
		console.error('[CRM] Error checking employee authorization:', error);
		return true;
	}
};

// Check if an asset is available for a specific site
export const checkAssetSiteAvailability = async (assetId, siteId) => {
	try {
		const assets = await fetchAssetsFromCRM();
		const asset = assets.find((a) => a.id === assetId);
		return asset && asset.isOperational;
	} catch (error) {
		console.error('[CRM] Error checking asset availability:', error);
		return true;
	}
};

// Fetch employee details including job assignments
export const fetchEmployeeJobAssignments = async (employeeId) => {
	try {
		const res = await fetch(
			`${env.crmUrl}/api/v1/employee/machine/${employeeId}`,
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
			}
		);

		if (!res.ok) throw new Error(`Errore recupero mansioni: ${res.status}`);

		const response = await res.json();
		const data = response.data;

		let jobAssignments = [];
		if (data && data.jobAssignments) {
			jobAssignments = data.jobAssignments
				.filter((job) => job.jobRoleId !== null)
				.map((job) => ({
					jobRoleId: job.jobRoleId,
					jobRoleName: job.jobRoleName || 'Mansione',
					departmentId: job.departmentId,
					departmentName: job.departmentName || '',
				}));
		}

		return jobAssignments;
	} catch (error) {
		console.error(
			`[CRM] Error fetching job assignments for employee ${employeeId}:`,
			error
		);
		return [];
	}
};
