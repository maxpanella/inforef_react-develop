// BlueIoT real client for browser (replace MockBlueIOTClient)
// - supports REST (fetch) and WebSocket streaming
// - parses incoming payloads with parseTagStats
// - reconnection/backoff, simple auth hashing support
//
// NOTE:
// - Assumes parseTagStats_Version3 is present in src and exported as named `parseTagStats`.
// - If you use md5 hashing for auth, install blueimp-md5 and keep import.
//   npm install blueimp-md5
//
// Usage (example):
// import BlueIOTClient from './blueiotClient';
// const client = new BlueIOTClient({ serverIp: '192.168.1.11', serverPort: 48300 });
// client.on('tagPosition', d => console.log('pos', d));
// client.connect();
import md5 from 'blueimp-md5';
import { parseTagStats } from './parseTagStats_Version3.mjs';

const DEFAULT_SERVER_IP = '192.168.1.11';
const DEFAULT_SERVER_PORT = 48300;
const DEFAULT_WS_PATH = '/ws'; // adattalo se il server usa un altro path

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

export default class BlueIOTClient {
  constructor({
    serverIp = DEFAULT_SERVER_IP,
    serverPort = DEFAULT_SERVER_PORT,
    username = 'admin',
    password = '#BlueIOT',
    salt = 'abcdefghijklmnopqrstuvwxyz20191107salt',
    wsPath = DEFAULT_WS_PATH,
    reconnect = true,
    logger = console,
    heartbeatInterval = 30000, // ms
  } = {}) {
    this.serverIp = serverIp;
    this.serverPort = serverPort;
    this.username = username;
    this.password = password;
    this.salt = salt;
    this.wsPath = wsPath;
    this.reconnect = reconnect;
    this.logger = logger;
    this.heartbeatInterval = heartbeatInterval;

    this.baseUrl = `http://${this.serverIp}:${this.serverPort}`;
    this.wsUrl = this._buildWsUrl();

    this.ws = null;
    this.wsConnected = false;
    this._shouldReconnect = false;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;

    // simple event listeners map: event -> [cb,...]
    this.listeners = new Map();
    // events commonly used: tagPosition, batteryInfo, alarm, tagStats, ws:open, ws:close, ws:error
    this._heartbeatTimer = null;
  }

  _buildWsUrl() {
    const proto = (this.baseUrl.startsWith('https')) ? 'wss' : 'ws';
    // Include simple auth token in query string (md5 salted) — adjust to server expectations
    const token = md5(this.username + ':' + this.password + ':' + this.salt);
    return `${proto}://${this.serverIp}:${this.serverPort}${this.wsPath}?user=${encodeURIComponent(this.username)}&t=${token}`;
  }

  // Event handling helpers
  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  off(event, cb) {
    if (!this.listeners.has(event)) return;
    const arr = this.listeners.get(event).filter(f => f !== cb);
    this.listeners.set(event, arr);
  }

  _emit(event, ...args) {
    const arr = this.listeners.get(event) || [];
    arr.forEach(cb => {
      try { cb(...args); } catch (e) { this.logger.error(`Listener for ${event} threw`, e); }
    });
  }

  // REST helpers (uses browser fetch)
  async request(path, { method = 'GET', body = null, headers = {}, timeout = 8000 } = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const opts = {
      method,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(url, opts);
      clearTimeout(id);
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = text;
        throw err;
      }
      // Try parse JSON
      try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  get(path, opts = {}) { return this.request(path, { ...opts, method: 'GET' }); }
  post(path, body, opts = {}) { return this.request(path, { ...opts, method: 'POST', body }); }

  // WebSocket connection lifecycle
  connect({ forceReconnect = false } = {}) {
    if (this.ws && this.wsConnected && !forceReconnect) return;
    this._shouldReconnect = this.reconnect;
    this._connectSocket();
  }

  _connectSocket() {
    try {
      this.wsUrl = this._buildWsUrl(); // refresh token each connect
      this.logger.log('BlueIOTClient connecting to', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.logger.log('BlueIOTClient ws open');
        this.wsConnected = true;
        this._reconnectDelay = 1000;
        this._startHeartbeat();
        this._emit('ws:open');
      };

      this.ws.onmessage = async (evt) => {
        try {
          const data = evt.data;
          // If ArrayBuffer or Blob, ensure we pass ArrayBuffer/Uint8Array to parser
          let payload = data;
          if (data instanceof Blob) {
            payload = await data.arrayBuffer();
          }
          // use parseTagStats which handles JSON/string/ArrayBuffer/Uint8Array
          const parsed = parseTagStats(payload);
          // heuristics: emit specific events if structure matches
          if (parsed && typeof parsed === 'object') {
            // if message has tagId or coords -> tagPosition
            if (Array.isArray(parsed)) {
              // array of objects -> treat as tagStats or positions
              this._emit('tagStats', parsed, payload);
              this._emit('ws:message', parsed, payload);
            } else if (parsed.tagId || (parsed.x !== undefined && parsed.y !== undefined)) {
              this._emit('tagPosition', parsed, payload);
              this._emit('ws:message', parsed, payload);
            } else if (parsed.type === 'battery' || parsed.battery !== undefined) {
              this._emit('batteryInfo', parsed, payload);
              this._emit('ws:message', parsed, payload);
            } else {
              // Generic parsed message
              this._emit('message', parsed, payload);
              this._emit('ws:message', parsed, payload);
            }
          } else {
            // Unrecognized: forward raw
            this._emit('message', parsed, payload);
            this._emit('ws:message', parsed, payload);
          }
        } catch (e) {
          this.logger.error('Error handling ws message', e);
          this._emit('ws:error', e);
        }
      };

      this.ws.onclose = (ev) => {
        this.logger.warn('BlueIOTClient ws close', ev && ev.code, ev && ev.reason);
        this.wsConnected = false;
        this._stopHeartbeat();
        this._emit('ws:close', ev);
        if (this._shouldReconnect) this._scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        this.logger.error('BlueIOTClient ws error', err);
        this._emit('ws:error', err);
      };
    } catch (err) {
      this.logger.error('BlueIOTClient connect error', err);
      this._emit('ws:error', err);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    const delay = Math.min(this._reconnectDelay, this._maxReconnectDelay);
    this.logger.log(`BlueIOTClient reconnect in ${delay} ms`);
    setTimeout(() => {
      this._reconnectDelay = Math.min(Math.floor(this._reconnectDelay * 1.5), this._maxReconnectDelay);
      this._connectSocket();
    }, delay);
  }

  disconnect() {
    this._shouldReconnect = false;
    if (this.ws) {
      try { this.ws.close(1000, 'client disconnect'); } catch (e) { /* ignore */ }
      this.ws = null;
      this.wsConnected = false;
      this._stopHeartbeat();
    }
  }

  // send JSON message over WS
  sendJson(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {
      this.logger.error('sendJson error', e);
    }
  }

  // heartbeat keepalive
  _startHeartbeat() {
    this._stopHeartbeat();
    if (!this.heartbeatInterval) return;
    this._heartbeatTimer = setInterval(() => {
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          // send ping as minimal message; server should reply or keep connection open
          this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      } catch (e) {
        this.logger.warn('Heartbeat send failed', e);
      }
    }, this.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // Convenience: single-shot fetch of tag statistics (server path can return JSON/NDJSON/text)
  async fetchTagStats(path = '/api/tagstats') {
    try {
      const res = await this.get(path);
      // if string, parse; if already object, return
      if (typeof res === 'string') return parseTagStats(res);
      return res;
    } catch (err) {
      this.logger.error('fetchTagStats error', err);
      throw err;
    }
  }
}