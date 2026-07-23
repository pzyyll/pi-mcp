import { logger } from "./logger.js";
//#region src/lifecycle.ts
var McpLifecycleManager = class {
	manager;
	keepAliveServers = /* @__PURE__ */ new Map();
	allServers = /* @__PURE__ */ new Map();
	serverSettings = /* @__PURE__ */ new Map();
	globalIdleTimeout = 600 * 1e3;
	healthCheckInterval;
	onReconnect;
	onIdleShutdown;
	constructor(manager) {
		this.manager = manager;
	}
	/**
	* Set callback to be invoked after a successful auto-reconnect.
	* Use this to update tool metadata when a server reconnects.
	*/
	setReconnectCallback(callback) {
		this.onReconnect = callback;
	}
	markKeepAlive(name, definition) {
		this.keepAliveServers.set(name, definition);
	}
	registerServer(name, definition, settings) {
		this.allServers.set(name, definition);
		if (settings?.idleTimeout !== void 0) this.serverSettings.set(name, settings);
	}
	setGlobalIdleTimeout(minutes) {
		this.globalIdleTimeout = minutes * 60 * 1e3;
	}
	setIdleShutdownCallback(callback) {
		this.onIdleShutdown = callback;
	}
	startHealthChecks(intervalMs = 3e4) {
		this.healthCheckInterval = setInterval(() => {
			this.checkConnections();
		}, intervalMs);
		this.healthCheckInterval.unref();
	}
	async checkConnections() {
		for (const [name, definition] of this.keepAliveServers) {
			const connection = this.manager.getConnection(name);
			if (!connection || connection.status !== "connected") try {
				await this.manager.connect(name, definition);
				logger.debug(`Reconnected to ${name}`);
				this.onReconnect?.(name);
			} catch (error) {
				console.error(`MCP: Failed to reconnect to ${name}:`, error);
			}
		}
		for (const [name] of this.allServers) {
			if (this.keepAliveServers.has(name)) continue;
			const timeout = this.getIdleTimeout(name);
			if (timeout > 0 && this.manager.isIdle(name, timeout)) {
				await this.manager.close(name);
				this.onIdleShutdown?.(name);
			}
		}
	}
	getIdleTimeout(name) {
		const perServer = this.serverSettings.get(name)?.idleTimeout;
		if (perServer !== void 0) return perServer * 60 * 1e3;
		return this.globalIdleTimeout;
	}
	async gracefulShutdown() {
		if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
		await this.manager.closeAll();
	}
};
//#endregion
export { McpLifecycleManager };
