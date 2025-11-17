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

export const getTags = async () => {
	const resp = await fetch(`${env.backendUrl}/api/tags`);
	if (!resp.ok) throw new Error('Failed to fetch tags');
	return resp.json();
};

export const createTag = async (id, battery = null) => {
	let body = { id };
	if (battery !== null && battery !== undefined && battery !== '') body.battery = battery;
	const resp = await fetch(`${env.backendUrl}/api/tags`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		let text = '';
		try { text = await resp.text(); } catch(_) {}
		throw new Error(`Failed to create tag (status ${resp.status}): ${text}`);
	}
	return resp.json();
};

// Tag assignments (time-bounded)
export const listTagAssignments = async ({ tagId, siteId, current } = {}) => {
	const qs = new URLSearchParams();
	if (tagId) qs.set('tagId', tagId);
	if (siteId) qs.set('siteId', siteId);
	if (current) qs.set('current', '1');
	const resp = await fetch(`${env.backendUrl}/api/tag-assignments${qs.toString() ? `?${qs.toString()}` : ''}`);
	if (!resp.ok) throw new Error('Failed to fetch tag assignments');
	return resp.json();
};

export const createTagAssignment = async ({ tagId, targetType, targetId, siteId, validFrom, validTo }) => {
	const resp = await fetch(`${env.backendUrl}/api/tag-assignments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tagId, targetType, targetId, siteId, validFrom, validTo }),
	});
	if (!resp.ok) throw new Error('Failed to create tag assignment');
	return resp.json();
};

export const closeTagAssignment = async ({ id, tagId, siteId, validTo }) => {
	const resp = await fetch(`${env.backendUrl}/api/tag-assignments/close`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ id, tagId, siteId, validTo }),
	});
	if (!resp.ok) throw new Error('Failed to close tag assignment');
	return resp.json();
};

export const deleteTag = async (id) => {
	let resp = await fetch(`${env.backendUrl}/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
	if (!resp.ok) {
		// Fallback: some environments/proxies block DELETE; try POST fallback endpoint
		try {
			const postResp = await fetch(`${env.backendUrl}/api/tags/${encodeURIComponent(id)}/delete`, { method: 'POST' });
			if (!postResp.ok) {
				let text2 = '';
				try { text2 = await postResp.text(); } catch(_) {}
				throw new Error(`Failed to delete tag via fallback (status ${postResp.status}): ${text2}`);
			}
			return postResp.json();
		} catch (e) {
			let text = '';
			try { text = await resp.text(); } catch(_) {}
			throw new Error(`Failed to delete tag (status ${resp.status}): ${text} ${e?.message? ' | Fallback: '+e.message : ''}`);
		}
	}
	return resp.json();
};

export const restoreTag = async (id) => {
	const resp = await fetch(`${env.backendUrl}/api/tags/${encodeURIComponent(id)}/restore`, {
		method: 'POST',
	});
	if (!resp.ok) {
		let text = '';
		try { text = await resp.text(); } catch(_) {}
		throw new Error(`Failed to restore tag (status ${resp.status}): ${text}`);
	}
	return resp.json();
};
