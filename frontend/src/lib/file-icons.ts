import {
	fileExtensions as FILE_EXT,
	fileNames as FILE_NAMES,
	file as FILE_DEFAULT,
	folder as FOLDER_DEFAULT,
	folderNames as FOLDER_NAMES,
	iconDefinitions as ICON_DEFS,
	languageIds as LANG_IDS,
} from "material-icon-theme/dist/material-icons.json";

type IconDefs = Record<string, { iconPath: string }>;
const J = {
	iconDefinitions: ICON_DEFS as unknown as IconDefs,
	fileExtensions: FILE_EXT as unknown as Record<string, string>,
	fileNames: FILE_NAMES as unknown as Record<string, string>,
	folderNames: FOLDER_NAMES as unknown as Record<string, string>,
	languageIds: LANG_IDS as unknown as Record<string, string>,
	file: FILE_DEFAULT as unknown as string,
	folder: FOLDER_DEFAULT as unknown as string,
};

const iconUrls = import.meta.glob<string>(
	"../../node_modules/material-icon-theme/icons/*.svg",
	{ query: "?url", import: "default", eager: true },
);

const urlByName: Record<string, string> = {};
for (const [path, url] of Object.entries(iconUrls)) {
	const m = path.match(/\/([^/]+)\.svg$/);
	if (m) urlByName[m[1]] = url;
}

function defKey(key: string | undefined): string | undefined {
	if (!key) return undefined;
	const def = J.iconDefinitions[key];
	if (!def) return undefined;
	const m = def.iconPath.match(/\/([^/]+)\.svg$/);
	return m?.[1];
}

function urlFor(key: string | undefined): string | undefined {
	const k = defKey(key);
	return k ? urlByName[k] : undefined;
}

const extOverrides: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	html: "html",
	htm: "html",
	xhtml: "html",
	yml: "yaml",
	yaml: "yaml",
	sh: "console",
	bash: "console",
	zsh: "console",
	fish: "console",
	ps1: "powershell",
	bat: "console",
	cmd: "console",
	vue: "vue",
	svelte: "svelte",
	astro: "astro",
	txt: "text",
	log: "log",
	xml: "xml",
	svg: "svg",
	csv: "table",
	tsv: "table",
	pdf: "pdf",
	zip: "zip",
	tar: "zip",
	gz: "zip",
	"7z": "zip",
	rar: "zip",
	mp3: "audio",
	wav: "audio",
	flac: "audio",
	ogg: "audio",
	mp4: "video",
	mov: "video",
	mkv: "video",
	webm: "video",
	avi: "video",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
	ico: "image",
	tiff: "image",
	avif: "image",
	psd: "image",
	otf: "font",
	ttf: "font",
	woff: "font",
	woff2: "font",
	eot: "font",
	lock: "lock",
	pem: "key",
	key: "key",
	crt: "certificate",
	cert: "certificate",
	cer: "certificate",
};

function lookupExtension(name: string): string | undefined {
	const lower = name.toLowerCase();
	const parts = lower.split(".");
	if (parts.length < 2) return undefined;
	for (let i = 1; i < parts.length; i++) {
		const ext = parts.slice(i).join(".");
		if (J.fileExtensions[ext]) return J.fileExtensions[ext];
	}
	const single = parts[parts.length - 1];
	if (extOverrides[single]) return extOverrides[single];
	if (J.languageIds[single]) return J.languageIds[single];
	return undefined;
}

export function fileIconUrl(name: string, isDir: boolean): string {
	const lower = name.toLowerCase();
	if (isDir) {
		return urlFor(J.folderNames[lower]) ?? urlFor(J.folder) ?? "";
	}
	const byName = J.fileNames[lower];
	if (byName) {
		const u = urlFor(byName);
		if (u) return u;
	}
	const byExt = lookupExtension(name);
	if (byExt) {
		const u = urlFor(byExt);
		if (u) return u;
	}
	return urlFor(J.file) ?? "";
}
