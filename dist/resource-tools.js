//#region src/resource-tools.ts
function resourceNameToToolName(name) {
	let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "").toLowerCase();
	if (!result || /^\d/.test(result)) result = "resource" + (result ? "_" + result : "");
	return result;
}
//#endregion
export { resourceNameToToolName };
