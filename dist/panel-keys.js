import { getHostPiTui } from "./host-peers.js";
//#region src/panel-keys.ts
function createPanelKeys(keybindings) {
	if (keybindings) return {
		selectUp: (data) => keybindings.matches(data, "tui.select.up"),
		selectDown: (data) => keybindings.matches(data, "tui.select.down"),
		selectConfirm: (data) => keybindings.matches(data, "tui.select.confirm")
	};
	const { matchesKey } = getHostPiTui();
	return {
		selectUp: (data) => matchesKey(data, "up"),
		selectDown: (data) => matchesKey(data, "down"),
		selectConfirm: (data) => matchesKey(data, "return")
	};
}
//#endregion
export { createPanelKeys };
