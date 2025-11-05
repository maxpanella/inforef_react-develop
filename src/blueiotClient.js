class MockBlueIOTClient {
	constructor({
		serverIp = '192.168.1.11',
		serverPort = 48300,
		username = 'admin',
		password = '#BlueIOT',
		salt = 'abcdefghijklmnopqrstuvwxyz20191107salt',
	}) {
		this.server = `${serverIp}:${serverPort}`;
		this.username = username;
		this.password = password;
		this.salt = salt;
		this.connected = false;
		this.listeners = {
			tagPosition: [],
			batteryInfo: [],
			alarm: [],
		};
	}

	connect() {
		console.log(`[MOCK] Connessione a BlueIOT WebSocket @ ${this.server}`);
		this.connected = true;
		setTimeout(() => this.mockPositionUpdates(), 1000);
	}

	on(event, callback) {
		if (this.listeners[event]) {
			this.listeners[event].push(callback);
		}
	}

	mockPositionUpdates() {
		if (!this.connected) return;
		const mockData = [
			{ tagId: 'TAG001', x: Math.random() * 50, y: Math.random() * 50, z: 0 },
			{ tagId: 'TAG002', x: Math.random() * 50, y: Math.random() * 50, z: 0 },
		];
		mockData.forEach((tag) => {
			this.listeners.tagPosition.forEach((cb) => cb(tag));
		});
		setTimeout(() => this.mockPositionUpdates(), 3000);
	}

	disconnect() {
		console.log('[MOCK] Disconnessione da BlueIOT WebSocket');
		this.connected = false;
	}
}

export default MockBlueIOTClient;
