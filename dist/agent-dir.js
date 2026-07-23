import { join, resolve } from "node:path";
import { homedir } from "node:os";
//#region src/agent-dir.ts
function getAgentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
	return resolve(configured);
}
function getAgentPath(...segments) {
	return join(getAgentDir(), ...segments);
}
//#endregion
export { getAgentPath as t };
