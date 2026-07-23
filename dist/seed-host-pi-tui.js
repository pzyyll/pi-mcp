import { seedHostPiTui } from "./host-peers.js";
import { Text, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
//#region src/seed-host-pi-tui.ts
seedHostPiTui({
	matchesKey,
	truncateToWidth,
	visibleWidth,
	Text
});
//#endregion
export {};
