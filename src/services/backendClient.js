import { env } from './env';

export const saveUsers = async (users) => {
	for (const user of users) {
		await fetch(`${env.backendUrl}/api/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: user.id,
				name: user.name,
				role: user.role,
				email: user.email || '',
				phone: user.phone || '',
				fiscalCode: user.fiscalCode || '',
				birthDate: user.birthDate || '',
				birthCity: user.birthCity || '',
				birthProvince: user.birthProvince || '',
				hireDate: user.hireDate || '',
				department: user.department || '',
				isActive: user.isActive !== undefined ? user.isActive : true,
				registrationNumber: user.registrationNumber || '',
				gender: user.gender || '',
				nationality: user.nationality || '',
				address: user.address || '',
				city: user.city || '',
				postalCode: user.postalCode || '',
				province: user.province || '',
				contractType: user.contractType || '',
				contractExpiry: user.contractExpiry || '',
				educationLevel: user.educationLevel || '',
				hours: user.hours || 40,
				doctorName: user.doctorName || '',
				doctorPhone: user.doctorPhone || '',
				underMedicalSurveillance: user.underMedicalSurveillance || false,
				fragileWorker: user.fragileWorker || false,
				usesVdtMoreThan20h: user.usesVdtMoreThan20h || false,
			}),
		});
	}
};

export const saveAssets = async (assets) => {
	for (const asset of assets) {
		await fetch(`${env.backendUrl}/api/assets`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: asset.id,
				name: asset.name,
				type: asset.type,
				model: asset.model || '',
				serialNumber: asset.serialNumber || '',
				manufacturer: asset.manufacturer || '',
				lastMaintenance: asset.lastMaintenance || '',
				nextMaintenance: asset.nextMaintenance || '',
				isOperational:
					asset.isOperational !== undefined ? asset.isOperational : true,
				departmentId: asset.departmentId || null,
				departmentName: asset.departmentName || '',
			}),
		});
	}
};

export const saveAssociation = async (tagId, targetType, targetId, siteId) => {
	return fetch(`${env.backendUrl}/api/associate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tagId, targetType, targetId, siteId }),
	});
};

export const fetchStoredUsers = async () => {
	const res = await fetch(`${env.backendUrl}/api/users`);
	if (!res.ok) {
		throw new Error("Errore caricamento dipendenti dal backend");
	}
	const data = await res.json();
	return Array.isArray(data) ? data : [];
};

export const fetchStoredAssets = async () => {
	const res = await fetch(`${env.backendUrl}/api/assets`);
	if (!res.ok) {
		throw new Error("Errore caricamento macchinari dal backend");
	}
	const data = await res.json();
	return Array.isArray(data) ? data : [];
};
