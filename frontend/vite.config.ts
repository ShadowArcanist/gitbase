import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function trimMaterialIcons(): Plugin {
	const target = "material-icon-theme/dist/material-icons.json";
	return {
		name: "trim-material-icons",
		enforce: "pre",
		transform(code, id) {
			if (!id.replace(/\\/g, "/").endsWith(target)) return null;
			const full = JSON.parse(code);
			const slim = {
				iconDefinitions: full.iconDefinitions,
				fileExtensions: full.fileExtensions,
				fileNames: full.fileNames,
				folderNames: full.folderNames,
				languageIds: full.languageIds,
				file: full.file,
				folder: full.folder,
			};
			return { code: JSON.stringify(slim), map: null };
		},
	};
}

export default defineConfig({
	plugins: [
		trimMaterialIcons(),
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:3000",
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		assetsInlineLimit: 0,
	},
});
