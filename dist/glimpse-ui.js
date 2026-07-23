import { createRequire } from "node:module";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
//#region src/glimpse-ui.ts
let glimpseAvailable = null;
let resolvedBinaryPath = null;
function isGlimpseAvailable() {
	if (glimpseAvailable !== null) return glimpseAvailable;
	if (platform() !== "darwin") {
		glimpseAvailable = false;
		return false;
	}
	resolvedBinaryPath = getGlimpseBinaryPath();
	glimpseAvailable = resolvedBinaryPath !== null;
	return glimpseAvailable;
}
function getGlimpseBinaryPath() {
	if (process.env.GLIMPSE_BINARY && existsSync(process.env.GLIMPSE_BINARY)) return process.env.GLIMPSE_BINARY;
	try {
		const binaryPath = join(dirname(createRequire(import.meta.url).resolve("glimpseui")), "glimpse");
		if (existsSync(binaryPath)) return binaryPath;
	} catch {}
	try {
		const binaryPath = join(execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim(), "glimpseui", "src", "glimpse");
		if (existsSync(binaryPath)) return binaryPath;
	} catch {}
	return null;
}
async function openGlimpseWindow(html, options) {
	const glimpse = await (resolvedBinaryPath ? import(join(dirname(resolvedBinaryPath), "glimpse.mjs")) : import("glimpseui"));
	let active = true;
	const win = glimpse.open(html, {
		width: options.width ?? 900,
		height: options.height ?? 700,
		title: options.title
	});
	win.on("closed", () => {
		if (!active) return;
		active = false;
		options.onClosed();
	});
	return { close: () => {
		if (!active) return;
		active = false;
		win.close();
	} };
}
//#endregion
export { isGlimpseAvailable, openGlimpseWindow };
