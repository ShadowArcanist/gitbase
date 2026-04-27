import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CodeIcon, ViewIcon } from "lucide-react";
import { Suspense, use, useState } from "react";

import { highlightCode } from "@/components/ui/markdown";
import { api } from "@/lib/api";
import { fileIconUrl } from "@/lib/file-icons";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"avif",
	"gif",
	"webp",
	"svg",
	"ico",
	"bmp",
]);

function isImageFile(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.has(ext);
}

const EXT_TO_LANG: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	json: "json",
	jsonc: "json",
	json5: "json",
	md: "markdown",
	mdx: "mdx",
	html: "html",
	htm: "html",
	xhtml: "html",
	svg: "html",
	xml: "xml",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	py: "python",
	pyi: "python",
	pyw: "python",
	rs: "rust",
	go: "go",
	rb: "ruby",
	erb: "ruby",
	java: "java",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	h: "c",
	hpp: "cpp",
	hxx: "cpp",
	cs: "csharp",
	swift: "swift",
	kt: "kotlin",
	kts: "kotlin",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	env: "bash",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	dockerfile: "dockerfile",
	diff: "diff",
	patch: "diff",
	php: "php",
};

const NAME_TO_LANG: Record<string, string> = {
	dockerfile: "dockerfile",
	makefile: "bash",
	gemfile: "ruby",
	".gitignore": "bash",
	".gitattributes": "bash",
	".dockerignore": "bash",
	".editorconfig": "ini",
	".env": "bash",
	".env.local": "bash",
	".env.example": "bash",
	"nginx.conf": "nginx",
};

export function detectLang(path: string): string {
	const name = path.split("/").pop() ?? "";
	const lower = name.toLowerCase();
	const nameMatch = NAME_TO_LANG[lower];
	if (nameMatch) return nameMatch;
	const ext = lower.split(".").pop() ?? "";
	return EXT_TO_LANG[ext] ?? "text";
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function CodeFileView({
	slug,
	currentRef,
	path,
}: {
	slug: string;
	currentRef: string;
	path: string;
}) {
	const blobQuery = useQuery({
		queryKey: ["blob", slug, currentRef, path],
		queryFn: () => api.blob(slug, currentRef, path),
		staleTime: 5 * 60_000,
		gcTime: 5 * 60_000,
	});

	const fileName = path.split("/").pop() ?? path;
	const isImage = isImageFile(path);
	const isSvg = path.toLowerCase().endsWith(".svg");
	const rawUrl = api.rawUrl(slug, currentRef, path);

	if (isImage && !isSvg) {
		return (
			<div className="flex flex-col gap-4">
				<div className="overflow-clip rounded-lg border">
					<FileViewHeader
					fileName={fileName}
					size={blobQuery.data?.size ?? null}
					slug={slug}
					currentRef={currentRef}
					path={path}
				/>
					<div className="flex items-center justify-center bg-surface-0 p-8">
						<img
							src={rawUrl}
							alt={fileName}
							className="max-h-[70vh] max-w-full object-contain"
						/>
					</div>
				</div>
			</div>
		);
	}

	if (blobQuery.isLoading) {
		return (
			<div className="overflow-clip rounded-lg border">
				<FileViewHeader
					fileName={fileName}
					slug={slug}
					currentRef={currentRef}
					path={path}
				/>
			</div>
		);
	}

	if (blobQuery.error || !blobQuery.data) {
		return (
			<div className="rounded-lg border">
				<FileViewHeader fileName={fileName} />
				<div className="p-6 text-sm text-muted-foreground">
					Unable to load file content.
				</div>
			</div>
		);
	}

	if (blobQuery.data.binary) {
		return (
			<div className="overflow-clip rounded-lg border">
				<FileViewHeader
					fileName={fileName}
					size={blobQuery.data.size}
					slug={slug}
					currentRef={currentRef}
					path={path}
				/>
				<div className="p-10 text-center text-sm text-muted-foreground">
					Binary file.{" "}
					<a href={rawUrl} target="_blank" rel="noreferrer" className="text-foreground underline">
						Download
					</a>
				</div>
			</div>
		);
	}

	const code = (blobQuery.data.content ?? "").replace(/\n$/, "");
	const lang = detectLang(path);
	const lineCount = code.split("\n").length;

	if (isSvg) {
		return (
			<SvgFileView
				code={code}
				lang={lang}
				lineCount={lineCount}
				fileName={fileName}
				size={blobQuery.data.size}
				rawUrl={rawUrl}
				slug={slug}
				currentRef={currentRef}
				path={path}
			/>
		);
	}

	return (
		<div className="sticky top-4 overflow-hidden rounded-lg border bg-surface-0" style={{ maxHeight: "calc(100vh - 6rem)" }}>
				<FileViewHeader
					fileName={fileName}
					lineCount={lineCount}
					size={blobQuery.data.size}
					slug={slug}
					currentRef={currentRef}
					path={path}
				/>
				<div className="overflow-auto" style={{ maxHeight: "calc(100vh - 6rem - 41px)" }}>
					<Suspense fallback={<CodeSkeleton code={code} />}>
						<HighlightedCode code={code} lang={lang} />
					</Suspense>
				</div>
				{blobQuery.data.truncated && (
					<div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
						Truncated for display.{" "}
						<a href={rawUrl} target="_blank" rel="noreferrer" className="underline">
							View full raw
						</a>
					</div>
				)}
		</div>
	);
}

function SvgFileView({
	code,
	lang,
	lineCount,
	fileName,
	size,
	rawUrl,
	slug,
	currentRef,
	path,
}: {
	code: string;
	lang: string;
	lineCount: number;
	fileName: string;
	size: number;
	rawUrl: string;
	slug: string;
	currentRef: string;
	path: string;
}) {
	const [mode, setMode] = useState<"preview" | "code">("preview");
	return (
		<div className="flex flex-col gap-4">
			<div className="overflow-clip rounded-lg border">
				<FileViewHeader
					fileName={fileName}
					lineCount={mode === "code" ? lineCount : undefined}
					size={size}
					slug={slug}
					currentRef={currentRef}
					path={path}
				>
					<div className="flex items-center rounded-md border border-border/60">
						<button
							type="button"
							onClick={() => setMode("preview")}
							className={cn(
								"flex items-center gap-1.5 rounded-l-md px-2 py-1 text-xs transition-colors",
								mode === "preview"
									? "bg-surface-1 text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<ViewIcon size={13} />
							Preview
						</button>
						<button
							type="button"
							onClick={() => setMode("code")}
							className={cn(
								"flex items-center gap-1.5 rounded-r-md border-l border-border/60 px-2 py-1 text-xs transition-colors",
								mode === "code"
									? "bg-surface-1 text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<CodeIcon size={13} />
							Code
						</button>
					</div>
				</FileViewHeader>
				{mode === "preview" ? (
					<div className="flex items-center justify-center bg-surface-0 p-8">
						<img
							src={rawUrl}
							alt={fileName}
							className="max-h-[70vh] max-w-full object-contain"
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<Suspense fallback={<CodeSkeleton code={code} />}>
							<HighlightedCode code={code} lang={lang} />
						</Suspense>
					</div>
				)}
			</div>
		</div>
	);
}

function FileViewHeader({
	fileName,
	lineCount,
	size,
	slug,
	currentRef,
	path,
	children,
}: {
	fileName: string;
	lineCount?: number;
	size?: number | null;
	slug?: string;
	currentRef?: string;
	path?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2 border-b bg-surface-0 px-4 py-2.5 text-sm">
			<img
				src={fileIconUrl(fileName, false)}
				alt=""
				aria-hidden
				className="size-4 shrink-0 select-none"
				draggable={false}
			/>
			<span className="optical-center font-medium text-foreground">{fileName}</span>
			{lineCount != null && (
				<span className="optical-center text-xs text-muted-foreground">
					{lineCount} {lineCount === 1 ? "line" : "lines"}
				</span>
			)}
			{lineCount != null && size != null && (
				<span aria-hidden className="optical-center text-xs text-muted-foreground">
					·
				</span>
			)}
			{size != null && (
				<span className="optical-center text-xs text-muted-foreground">
					{formatFileSize(size)}
				</span>
			)}
			<div className="ml-auto flex items-center gap-2">
				{children}
				{slug && currentRef && path && (
					<LastCommitInfo slug={slug} rev={currentRef} path={path} />
				)}
			</div>
		</div>
	);
}

function LastCommitInfo({
	slug,
	rev,
	path,
}: {
	slug: string;
	rev: string;
	path: string;
}) {
	const q = useQuery({
		queryKey: ["last-commit", slug, rev, path],
		queryFn: () => api.commits(slug, rev, 1, path),
		staleTime: 5 * 60_000,
	});
	const c = q.data?.[0];
	if (!c) return null;
	return (
		<Link
			to="/repos/$"
			params={{ _splat: slug }}
			search={{ tab: "commits", sha: c.sha, file: path }}
			className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
			title={c.subject}
		>
			<span className="optical-center max-w-[14rem] truncate-soft min-w-0 font-medium text-foreground">
				{c.subject}
			</span>
			<span className="optical-center" title={new Date(c.date).toLocaleString()}>
				{formatRelativeTime(c.date)}
			</span>
		</Link>
	);
}

function LineNumbers({ count }: { count: number }) {
	return (
		<div
			className="sticky left-0 z-10 flex w-10 shrink-0 flex-col items-end border-r bg-surface-0 px-2 py-3 text-muted-foreground tabular-nums select-none"
		>
			{Array.from({ length: count }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: stable
				<span key={i} className="leading-5">
					{i + 1}
				</span>
			))}
		</div>
	);
}

function CodeSkeleton({ code }: { code: string }) {
	const lines = code.split("\n");
	return (
		<div className="overflow-x-auto text-xs">
			<div className="flex min-w-fit">
				<LineNumbers count={lines.length} />
				<div className="flex-1 p-3">
					{lines.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable
						<div key={i} className="leading-5" style={{ height: "1.25rem" }}>
							{line.trim() && (
								<span
									className="inline-block animate-pulse rounded bg-muted"
									style={{
										width: `${Math.min(Math.max(line.length, 3), 80)}ch`,
										height: "0.75rem",
										marginTop: "0.175rem",
									}}
								/>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
	const html = use(highlightCode(code, lang));
	const lineCount = code.split("\n").length;
	return (
		<div className="overflow-x-auto text-xs">
			<div className="flex min-w-fit">
				<LineNumbers count={lineCount} />
				<div
					className="flex-1 [&_pre]:p-3 [&_pre]:leading-5 [&_code]:text-xs"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</div>
		</div>
	);
}

