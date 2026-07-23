import { getAgentPath } from "./agent-dir.js";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
//#region src/onboarding-state.ts
const DEFAULT_STATE = {
	version: 1,
	sharedConfigHintShown: false,
	setupCompleted: false
};
function getOnboardingStatePath() {
	return getAgentPath("mcp-onboarding.json");
}
function loadOnboardingState() {
	const path = getOnboardingStatePath();
	if (!existsSync(path)) return { ...DEFAULT_STATE };
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
		return {
			version: 1,
			sharedConfigHintShown: raw.sharedConfigHintShown === true,
			setupCompleted: raw.setupCompleted === true,
			lastDiscoveryFingerprint: typeof raw.lastDiscoveryFingerprint === "string" ? raw.lastDiscoveryFingerprint : void 0
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}
function saveOnboardingState(state) {
	const path = getOnboardingStatePath();
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
	renameSync(tmpPath, path);
}
function updateOnboardingState(updater) {
	const next = updater(loadOnboardingState());
	saveOnboardingState(next);
	return next;
}
function markSharedConfigHintShown(fingerprint) {
	return updateOnboardingState((state) => ({
		...state,
		sharedConfigHintShown: true,
		lastDiscoveryFingerprint: fingerprint ?? state.lastDiscoveryFingerprint
	}));
}
function markSetupCompleted(fingerprint) {
	return updateOnboardingState((state) => ({
		...state,
		setupCompleted: true,
		lastDiscoveryFingerprint: fingerprint ?? state.lastDiscoveryFingerprint
	}));
}
//#endregion
export { getOnboardingStatePath, loadOnboardingState, markSetupCompleted, markSharedConfigHintShown, saveOnboardingState, updateOnboardingState };
