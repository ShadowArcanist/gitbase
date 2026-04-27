import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";

/**
 * Fine-grained Shiki bundle: only these grammars are ever loaded (see shiki.style/guide/bundles).
 * Unknown fence languages fall back to unstyled output via `text` in highlight callers.
 */
export const SHIKI_BUNDLED_LANGS = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"html",
	"css",
	"bash",
	"shellscript",
	"python",
	"go",
	"rust",
	"yaml",
	"markdown",
	"diff",
	"sql",
	"graphql",
	"ruby",
	"java",
	"c",
	"cpp",
	"swift",
	"kotlin",
	"dockerfile",
	"toml",
	"vue",
	"svelte",
	"php",
	"csharp",
	"mdx",
	"nginx",
] as const;

export type ShikiBundledLang = (typeof SHIKI_BUNDLED_LANGS)[number];

const LANG_IMPORTS = {
	javascript: () => import("@shikijs/langs/javascript"),
	typescript: () => import("@shikijs/langs/typescript"),
	jsx: () => import("@shikijs/langs/jsx"),
	tsx: () => import("@shikijs/langs/tsx"),
	json: () => import("@shikijs/langs/json"),
	html: () => import("@shikijs/langs/html"),
	css: () => import("@shikijs/langs/css"),
	bash: () => import("@shikijs/langs/bash"),
	shellscript: () => import("@shikijs/langs/shellscript"),
	python: () => import("@shikijs/langs/python"),
	go: () => import("@shikijs/langs/go"),
	rust: () => import("@shikijs/langs/rust"),
	yaml: () => import("@shikijs/langs/yaml"),
	markdown: () => import("@shikijs/langs/markdown"),
	diff: () => import("@shikijs/langs/diff"),
	sql: () => import("@shikijs/langs/sql"),
	graphql: () => import("@shikijs/langs/graphql"),
	ruby: () => import("@shikijs/langs/ruby"),
	java: () => import("@shikijs/langs/java"),
	c: () => import("@shikijs/langs/c"),
	cpp: () => import("@shikijs/langs/cpp"),
	swift: () => import("@shikijs/langs/swift"),
	kotlin: () => import("@shikijs/langs/kotlin"),
	dockerfile: () => import("@shikijs/langs/dockerfile"),
	toml: () => import("@shikijs/langs/toml"),
	vue: () => import("@shikijs/langs/vue"),
	svelte: () => import("@shikijs/langs/svelte"),
	php: () => import("@shikijs/langs/php"),
	csharp: () => import("@shikijs/langs/csharp"),
	mdx: () => import("@shikijs/langs/mdx"),
	nginx: () => import("@shikijs/langs/nginx"),
} as const satisfies Record<ShikiBundledLang, () => Promise<unknown>>;

export const shikiBundledLangSet = new Set<string>(SHIKI_BUNDLED_LANGS);

export type MarkdownHighlighter = Awaited<
	ReturnType<typeof createHighlighterCore>
>;

export function createMarkdownHighlighter(): Promise<MarkdownHighlighter> {
	return createHighlighterCore({
		themes: [githubLight, githubDark],
		langs: [],
		engine: createOnigurumaEngine(import("shiki/wasm")),
	});
}

let highlighterSingleton: Promise<MarkdownHighlighter> | null = null;

export function getHighlighter(): Promise<MarkdownHighlighter> {
	if (!highlighterSingleton) {
		highlighterSingleton =
			typeof window !== "undefined"
				? createMarkdownHighlighter()
				: new Promise<MarkdownHighlighter>(() => {});
	}
	return highlighterSingleton;
}

export function warmHighlighter(): void {
	void getHighlighter();
}

const COMMON_LANGS: ShikiBundledLang[] = [
	"typescript",
	"javascript",
	"tsx",
	"jsx",
	"json",
	"markdown",
	"yaml",
	"bash",
	"python",
	"go",
	"rust",
	"html",
	"css",
];

export function prewarmCommonLangs(): void {
	void getHighlighter().then((h) => {
		for (const l of COMMON_LANGS) void ensureLang(h, l);
	});
}

export function prewarmLangs(langs: string[]): void {
	const valid = langs.filter((l): l is ShikiBundledLang =>
		shikiBundledLangSet.has(l),
	);
	if (valid.length === 0) return;
	void getHighlighter().then((h) => {
		for (const l of valid) void ensureLang(h, l);
	});
}

const loadedLangs = new Set<string>();
const inflightLangs = new Map<string, Promise<void>>();

export function ensureLang(
	highlighter: MarkdownHighlighter,
	lang: ShikiBundledLang,
): Promise<void> {
	if (loadedLangs.has(lang)) return Promise.resolve();
	const existing = inflightLangs.get(lang);
	if (existing) return existing;
	const p = LANG_IMPORTS[lang]()
		.then((mod) => highlighter.loadLanguage(mod as never))
		.then(() => {
			loadedLangs.add(lang);
			inflightLangs.delete(lang);
		});
	inflightLangs.set(lang, p);
	return p;
}
