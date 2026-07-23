import { ResourceFetchError, ResourceParseError } from "./errors.js";
import { logger } from "./logger.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
//#region src/ui-resource-handler.ts
var UiResourceHandler = class {
	manager;
	log = logger.child({ component: "UiResourceHandler" });
	constructor(manager) {
		this.manager = manager;
	}
	async readUiResource(serverName, uri) {
		const log = this.log.child({
			server: serverName,
			uri
		});
		if (!uri.startsWith("ui://")) throw new ResourceParseError(uri, "URI must start with ui://", { server: serverName });
		log.debug("Fetching UI resource");
		let result;
		try {
			result = await this.manager.readResource(serverName, uri);
		} catch (error) {
			if (error instanceof UrlElicitationRequiredError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			log.error("Failed to read resource", error instanceof Error ? error : void 0);
			throw new ResourceFetchError(uri, message, {
				server: serverName,
				cause: error instanceof Error ? error : void 0
			});
		}
		const content = selectContent(result, uri);
		const mimeType = content.mimeType;
		if (mimeType && !isHtmlMimeType(mimeType)) {
			log.warn("Unsupported MIME type", { mimeType });
			throw new ResourceParseError(uri, `unsupported MIME type "${mimeType}" (expected text/html or ${RESOURCE_MIME_TYPE})`, {
				server: serverName,
				mimeType
			});
		}
		const html = toHtml(content);
		if (!html.trim()) {
			log.warn("Resource content is empty");
			throw new ResourceParseError(uri, "content is empty", { server: serverName });
		}
		const contentMeta = extractUiMeta(content._meta);
		const listMeta = extractUiMeta(this.getListResourceMeta(serverName, uri));
		log.debug("Resource loaded successfully", {
			contentLength: html.length,
			hasCsp: !!contentMeta.csp || !!listMeta.csp
		});
		return {
			uri: content.uri ?? uri,
			html,
			mimeType: mimeType ?? RESOURCE_MIME_TYPE,
			meta: {
				csp: contentMeta.csp ?? listMeta.csp,
				permissions: contentMeta.permissions ?? listMeta.permissions,
				domain: contentMeta.domain ?? listMeta.domain,
				prefersBorder: contentMeta.prefersBorder ?? listMeta.prefersBorder
			}
		};
	}
	getListResourceMeta(serverName, uri) {
		const connection = this.manager.getConnection(serverName);
		if (!connection?.resources?.length) return void 0;
		const resource = connection.resources.find((entry) => entry.uri === uri);
		if (!resource || !resource._meta || typeof resource._meta !== "object") return void 0;
		return resource._meta;
	}
};
function selectContent(result, preferredUri) {
	const contents = result.contents ?? [];
	if (contents.length === 0) throw new Error(`No contents returned for UI resource: ${preferredUri}`);
	const byUri = contents.find((content) => content.uri === preferredUri);
	if (byUri) return byUri;
	const byHtmlMime = contents.find((content) => content.mimeType && isHtmlMimeType(content.mimeType));
	if (byHtmlMime) return byHtmlMime;
	return contents[0];
}
function isHtmlMimeType(mimeType) {
	const normalized = mimeType.toLowerCase();
	return normalized.startsWith("text/html") || normalized === RESOURCE_MIME_TYPE.toLowerCase();
}
function toHtml(content) {
	if (typeof content.text === "string") return content.text;
	if (typeof content.blob === "string") return Buffer.from(content.blob, "base64").toString("utf-8");
	throw new Error(`UI resource ${content.uri ?? "(unknown)"} did not include text or blob content`);
}
function extractUiMeta(meta) {
	if (!meta || typeof meta !== "object") return {};
	const ui = meta.ui;
	if (!ui || typeof ui !== "object") return {};
	const out = {};
	if (ui.csp && typeof ui.csp === "object") out.csp = ui.csp;
	if (ui.permissions && typeof ui.permissions === "object") out.permissions = ui.permissions;
	if (typeof ui.domain === "string") out.domain = ui.domain;
	if (typeof ui.prefersBorder === "boolean") out.prefersBorder = ui.prefersBorder;
	return out;
}
//#endregion
export { UiResourceHandler };
