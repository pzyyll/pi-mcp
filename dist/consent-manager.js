import { ConsentError } from "./errors.js";
import { logger } from "./logger.js";
//#region src/consent-manager.ts
var ConsentManager = class {
	mode;
	approvedServers = /* @__PURE__ */ new Set();
	deniedServers = /* @__PURE__ */ new Set();
	log = logger.child({ component: "ConsentManager" });
	constructor(mode = "once-per-server") {
		this.mode = mode;
		this.log.debug("Initialized", { mode });
	}
	requiresPrompt(serverName) {
		if (this.mode === "never") return false;
		if (this.deniedServers.has(serverName)) return true;
		if (this.mode === "always") return true;
		return !this.approvedServers.has(serverName);
	}
	shouldCacheConsent() {
		return this.mode !== "always";
	}
	registerDecision(serverName, approved) {
		this.deniedServers.delete(serverName);
		this.approvedServers.delete(serverName);
		if (approved) {
			this.approvedServers.add(serverName);
			this.log.debug("Consent granted", { server: serverName });
			return;
		}
		this.deniedServers.add(serverName);
		this.log.debug("Consent denied", { server: serverName });
	}
	ensureApproved(serverName) {
		if (this.mode === "never") return;
		if (this.deniedServers.has(serverName)) throw new ConsentError(serverName, { denied: true });
		if (!this.approvedServers.has(serverName)) throw new ConsentError(serverName, { requiresApproval: true });
		if (this.mode === "always") this.approvedServers.delete(serverName);
	}
	clear(serverName) {
		if (serverName) {
			this.approvedServers.delete(serverName);
			this.deniedServers.delete(serverName);
			this.log.debug("Cleared consent for server", { server: serverName });
			return;
		}
		this.approvedServers.clear();
		this.deniedServers.clear();
		this.log.debug("Cleared all consent records");
	}
};
//#endregion
export { ConsentManager };
