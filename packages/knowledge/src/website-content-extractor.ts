import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AcquiredWebsiteSourceBody } from "./pinned-https-website-connector.js";

export const websiteContentExtractionMessages = Object.freeze({
  CHARSET_NOT_ALLOWED: "The website character encoding is not supported.",
  CONTENT_INVALID: "The website content could not be read safely.",
  PARSER_FAILED: "The website content could not be parsed safely.",
  PARSER_TIMEOUT: "The website content took too long to parse.",
  PARSER_OUTPUT_INVALID: "The website parser returned an invalid result.",
} as const);

export type WebsiteContentExtractionErrorCode = keyof typeof websiteContentExtractionMessages;

export class WebsiteContentExtractionError extends Error {
  constructor(readonly code: WebsiteContentExtractionErrorCode) {
    super(websiteContentExtractionMessages[code]);
    this.name = "WebsiteContentExtractionError";
  }
}

export type ExtractedWebsiteElementKind =
  | "TITLE"
  | "PARAGRAPH"
  | "LIST"
  | "TABLE_ROW_GROUP"
  | "CODE";

export interface ExtractedWebsiteElement {
  kind: ExtractedWebsiteElementKind;
  ordinal: number;
  headingPath: string[];
  urlAnchor: string | null;
  text: string;
  parserConfidence: number;
}

export interface ExtractedWebsiteContent {
  title: string | null;
  declaredLocale: string | null;
  text: string;
  hiddenText: string;
  elements: ExtractedWebsiteElement[];
  links: string[];
  characterCount: number;
}

export interface WebsiteContentExtractorOptions {
  timeoutMs?: number;
  maxInputCharacters?: number;
  maxOutputCharacters?: number;
  maxElements?: number;
  maxLinks?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_INPUT_CHARACTERS = 2_000_000;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 1_500_000;
const DEFAULT_MAX_ELEMENTS = 2_000;
const DEFAULT_MAX_LINKS = 5_000;
const parse5ModuleUrl = pathToFileURL(createRequire(import.meta.url).resolve("parse5")).href;
const supportedCharsets = new Map<string, string>([
  ["utf-8", "utf-8"],
  ["utf8", "utf-8"],
  ["us-ascii", "utf-8"],
  ["ascii", "utf-8"],
  ["windows-1252", "windows-1252"],
  ["cp1252", "windows-1252"],
  ["iso-8859-1", "windows-1252"],
  ["latin1", "windows-1252"],
]);

const parserWorkerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "math", "canvas", "iframe", "object", "embed"]);
const BLOCK = new Map([
  ["title", "TITLE"], ["h1", "TITLE"], ["h2", "TITLE"], ["h3", "TITLE"], ["h4", "TITLE"], ["h5", "TITLE"], ["h6", "TITLE"],
  ["p", "PARAGRAPH"], ["address", "PARAGRAPH"], ["blockquote", "PARAGRAPH"], ["dt", "PARAGRAPH"], ["dd", "PARAGRAPH"],
  ["li", "LIST"], ["tr", "TABLE_ROW_GROUP"], ["pre", "CODE"], ["code", "CODE"]
]);

function attrs(node) {
  return Object.fromEntries(Array.isArray(node.attrs) ? node.attrs.map((entry) => [String(entry.name).toLowerCase(), String(entry.value)]) : []);
}
function normalize(value) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}
function hidden(attributes) {
  const style = String(attributes.style || "").toLowerCase().replace(/\s+/gu, "");
  return Object.prototype.hasOwnProperty.call(attributes, "hidden") || String(attributes["aria-hidden"] || "").toLowerCase() === "true" || style.includes("display:none") || style.includes("visibility:hidden") || String(attributes.type || "").toLowerCase() === "hidden";
}
function textOf(node, includeHidden = false) {
  if (!node || typeof node !== "object") return "";
  if (node.nodeName === "#text") return typeof node.value === "string" ? node.value : "";
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (SKIP.has(tag)) return "";
  const attributes = attrs(node);
  if (!includeHidden && hidden(attributes)) return "";
  return Array.isArray(node.childNodes) ? node.childNodes.map((child) => textOf(child, includeHidden)).join(" ") : "";
}
function collect(document) {
  const elements = [];
  const links = [];
  const hiddenParts = [];
  const headingPath = [];
  let title = null;
  let declaredLocale = null;
  let outputCharacters = 0;
  let hiddenCharacters = 0;
  function appendElement(kind, text, attributes) {
    const normalized = normalize(text).slice(0, 10000);
    if (!normalized || elements.length >= workerData.maxElements || outputCharacters >= workerData.maxOutputCharacters) return;
    const bounded = normalized.slice(0, workerData.maxOutputCharacters - outputCharacters);
    if (!bounded) return;
    outputCharacters += bounded.length;
    elements.push({ kind, ordinal: elements.length, headingPath: headingPath.slice(0, 12), urlAnchor: attributes.id ? String(attributes.id).slice(0, 240) : null, text: bounded, parserConfidence: 1 });
  }
  function visit(node) {
    if (!node || typeof node !== "object") return;
    const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
    if (SKIP.has(tag)) return;
    const attributes = attrs(node);
    if (tag === "html" && attributes.lang) declaredLocale = String(attributes.lang).slice(0, 35);
    if (hidden(attributes)) {
      const value = normalize(textOf(node, true));
      if (value && hiddenCharacters < 20000) {
        const bounded = value.slice(0, 20000 - hiddenCharacters);
        hiddenParts.push(bounded);
        hiddenCharacters += bounded.length;
      }
      return;
    }
    if (tag === "a" && attributes.href && links.length < workerData.maxLinks) {
      const href = String(attributes.href).trim();
      if (href && href.length <= 2048) links.push(href);
    }
    const kind = BLOCK.get(tag);
    if (kind) {
      const value = normalize(textOf(node));
      if (tag === "title" && value && !title) title = value.slice(0, 500);
      if (/^h[1-6]$/u.test(tag) && value) {
        const level = Number(tag[1]);
        headingPath.length = Math.max(0, level - 1);
        headingPath[level - 1] = value.slice(0, 500);
        if (!title && tag === "h1") title = value.slice(0, 500);
      }
      appendElement(kind, value, attributes);
    }
    if (Array.isArray(node.childNodes)) for (const child of node.childNodes) visit(child);
  }
  visit(document);
  const uniqueElements = [];
  const seen = new Set();
  for (const element of elements) {
    const key = element.kind + "\u0000" + element.text;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueElements.push({ ...element, ordinal: uniqueElements.length });
  }
  const text = uniqueElements.map((element) => element.text).join("\n\n").slice(0, workerData.maxOutputCharacters);
  return { title, declaredLocale, text, hiddenText: hiddenParts.join("\n").slice(0, 20000), elements: uniqueElements, links: [...new Set(links)], characterCount: text.length };
}
(async () => {
  try {
    const parse5 = await import(workerData.parse5Url);
    parentPort.postMessage({ ok: true, value: collect(parse5.parse(workerData.html, { sourceCodeLocationInfo: false })) });
  } catch {
    parentPort.postMessage({ ok: false });
  }
})();
`;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function decodeBody(body: AcquiredWebsiteSourceBody) {
  const charset = supportedCharsets.get((body.charset ?? "utf-8").trim().toLowerCase());
  if (!charset) throw new WebsiteContentExtractionError("CHARSET_NOT_ALLOWED");
  try {
    return new TextDecoder(charset, { fatal: true }).decode(body.bytes);
  } catch {
    throw new WebsiteContentExtractionError("CONTENT_INVALID");
  }
}

function replaceControlCharacters(value: string) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127)
        ? " "
        : character;
    })
    .join("");
}

function plainTextContent(value: string, maxOutputCharacters: number, maxElements: number): ExtractedWebsiteContent {
  const text = replaceControlCharacters(value)
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, maxOutputCharacters);
  const elements = text
    .split(/\n{2,}/gu)
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .slice(0, maxElements)
    .map((part, ordinal) => ({ kind: "PARAGRAPH" as const, ordinal, headingPath: [], urlAnchor: null, text: part.slice(0, 10_000), parserConfidence: 1 }));
  const normalized = elements.map((element) => element.text).join("\n\n");
  return { title: null, declaredLocale: null, text: normalized, hiddenText: "", elements, links: [], characterCount: normalized.length };
}

function validResult(value: unknown, limits: { maxOutputCharacters: number; maxElements: number; maxLinks: number }): value is ExtractedWebsiteContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if ((result.title !== null && typeof result.title !== "string") || (result.declaredLocale !== null && typeof result.declaredLocale !== "string") || typeof result.text !== "string" || typeof result.hiddenText !== "string" || !Array.isArray(result.elements) || !Array.isArray(result.links) || typeof result.characterCount !== "number" || result.text.length > limits.maxOutputCharacters || result.elements.length > limits.maxElements || result.links.length > limits.maxLinks || !result.links.every((link) => typeof link === "string")) return false;
  return result.elements.every((element, index) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return false;
    const item = element as Record<string, unknown>;
    return ["TITLE", "PARAGRAPH", "LIST", "TABLE_ROW_GROUP", "CODE"].includes(String(item.kind)) && item.ordinal === index && Array.isArray(item.headingPath) && item.headingPath.every((part) => typeof part === "string") && (item.urlAnchor === null || typeof item.urlAnchor === "string") && typeof item.text === "string" && item.text.length > 0 && item.text.length <= 10_000 && item.parserConfidence === 1;
  });
}

async function extractHtml(html: string, limits: { timeoutMs: number; maxOutputCharacters: number; maxElements: number; maxLinks: number }) {
  const worker = new Worker(parserWorkerSource, {
    eval: true,
    workerData: { html, parse5Url: parse5ModuleUrl, maxOutputCharacters: limits.maxOutputCharacters, maxElements: limits.maxElements, maxLinks: limits.maxLinks },
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16, stackSizeMb: 2 },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      new Promise<unknown>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => { if (code !== 0) reject(new Error("parser worker exited")); });
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new WebsiteContentExtractionError("PARSER_TIMEOUT")), limits.timeoutMs);
      }),
    ]);
    if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("value" in result)) throw new WebsiteContentExtractionError("PARSER_FAILED");
    if (!validResult(result.value, limits)) throw new WebsiteContentExtractionError("PARSER_OUTPUT_INVALID");
    return result.value;
  } catch (error) {
    if (error instanceof WebsiteContentExtractionError) throw error;
    throw new WebsiteContentExtractionError("PARSER_FAILED");
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate().catch(() => undefined);
  }
}

export async function extractWebsiteContent(body: AcquiredWebsiteSourceBody, options: WebsiteContentExtractorOptions = {}): Promise<ExtractedWebsiteContent> {
  const limits = {
    timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000),
    maxInputCharacters: boundedInteger(options.maxInputCharacters, DEFAULT_MAX_INPUT_CHARACTERS, 1, 4_000_000),
    maxOutputCharacters: boundedInteger(options.maxOutputCharacters, DEFAULT_MAX_OUTPUT_CHARACTERS, 1, 3_000_000),
    maxElements: boundedInteger(options.maxElements, DEFAULT_MAX_ELEMENTS, 1, 10_000),
    maxLinks: boundedInteger(options.maxLinks, DEFAULT_MAX_LINKS, 0, 20_000),
  };
  const decoded = decodeBody(body);
  if (decoded.length > limits.maxInputCharacters) throw new WebsiteContentExtractionError("CONTENT_INVALID");
  return body.contentType === "text/plain"
    ? plainTextContent(decoded, limits.maxOutputCharacters, limits.maxElements)
    : extractHtml(decoded, limits);
}
