import type { KnowledgeV2SecurityClassification } from "@leadvirt/types";
import type { ExtractedWebsiteContent } from "./website-content-extractor.js";

export type WebsiteContentSecurityDecision = "READY" | "NEEDS_REVIEW" | "QUARANTINED";
export type WebsiteContentSecurityFindingKind =
  | "SECRET"
  | "SENSITIVE_DATA"
  | "PROMPT_INJECTION"
  | "HIDDEN_CONTENT";

export interface WebsiteContentSecurityFinding {
  kind: WebsiteContentSecurityFindingKind;
  code: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  location: "VISIBLE" | "HIDDEN" | "METADATA";
  count: number;
}

export interface WebsiteContentSecurityResult {
  decision: WebsiteContentSecurityDecision;
  classification: KnowledgeV2SecurityClassification;
  findings: WebsiteContentSecurityFinding[];
  publishable: boolean;
}

interface PatternRule {
  code: string;
  pattern: RegExp;
}

const secretRules: PatternRule[] = [
  { code: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/giu },
  { code: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { code: "GITHUB_TOKEN", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/gu },
  { code: "SLACK_TOKEN", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/gu },
  {
    code: "JWT_BEARER",
    pattern: /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/giu,
  },
  {
    code: "ASSIGNED_SECRET",
    pattern:
      /\b(?:password|passwd|api[_ -]?key|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*["']?(?!example|placeholder|redacted|hidden)[A-Za-z0-9_./+\-=]{8,}/giu,
  },
  {
    code: "CREDENTIAL_URI",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/giu,
  },
];

const promptInjectionRules: PatternRule[] = [
  {
    code: "IGNORE_INSTRUCTIONS",
    pattern:
      /\b(?:ignore|disregard|forget|override)\b.{0,80}\b(?:previous|prior|system|developer|instructions?|rules?|prompt)\b/giu,
  },
  {
    code: "REVEAL_PROMPT",
    pattern:
      /\b(?:reveal|show|print|repeat|expose|leak)\b.{0,80}\b(?:system|developer|hidden|internal)\b.{0,40}\b(?:prompt|instructions?|message|rules?)\b/giu,
  },
  {
    code: "TOOL_OVERRIDE",
    pattern:
      /\b(?:call|invoke|execute|run|use)\b.{0,60}\b(?:tool|function|shell|command)\b.{0,80}\b(?:without|bypass|ignore|approval|authorization)\b/giu,
  },
  {
    code: "MULTILINGUAL_OVERRIDE",
    pattern:
      /(?:игнорируй|игнорировать|забудь|раскрой|системн(?:ый|ые)|ignora|olvida|revela|sistema|ignorez|oubliez|révélez|système|ignoriere|vergiss|enthülle|system|ignore|esqueça|revele|sistema).{0,100}(?:инструкц|prompt|промпт|instrucciones|instructions|anweisungen|instruções)/giu,
  },
];

const sensitiveRules: PatternRule[] = [
  { code: "US_SSN", pattern: /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/gu },
  { code: "IBAN", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gu },
];

function matches(pattern: RegExp, value: string) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(value)) {
    count += 1;
    if (count >= 100) break;
  }
  pattern.lastIndex = 0;
  return count;
}

function luhn(value: string) {
  let sum = 0;
  let alternate = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function paymentCardCount(value: string) {
  const candidates = value.match(/(?:\d[ -]?){13,19}/gu) ?? [];
  return candidates
    .map((candidate) => candidate.replace(/\D/gu, ""))
    .filter((candidate) => candidate.length >= 13 && candidate.length <= 19 && luhn(candidate))
    .slice(0, 100).length;
}

function scanRules(
  value: string,
  rules: readonly PatternRule[],
  kind: WebsiteContentSecurityFindingKind,
  severity: WebsiteContentSecurityFinding["severity"],
  location: WebsiteContentSecurityFinding["location"],
) {
  return rules.flatMap((rule) => {
    const count = matches(rule.pattern, value);
    return count ? [{ kind, code: rule.code, severity, location, count }] : [];
  });
}

function securityMetadata(content: ExtractedWebsiteContent) {
  const maximumCharacters = 500_000;
  const values: string[] = [];
  let characters = 0;
  const append = (value: string | null) => {
    if (!value || characters >= maximumCharacters) return;
    const bounded = value.slice(0, maximumCharacters - characters);
    if (!bounded) return;
    values.push(bounded);
    characters += bounded.length + 1;
  };
  append(content.title);
  append(content.declaredLocale);
  for (const link of content.links) {
    append(link);
    try {
      const decoded = decodeURIComponent(link);
      if (decoded !== link) append(decoded);
    } catch {
      // Malformed escapes remain available in their raw form.
    }
  }
  for (const element of content.elements) {
    append(element.urlAnchor);
    for (const heading of element.headingPath) append(heading);
  }
  return values.join("\n");
}

export function scanWebsiteContentSecurity(
  content: ExtractedWebsiteContent,
  defaultClassification: Extract<KnowledgeV2SecurityClassification, "PUBLIC" | "INTERNAL">,
): WebsiteContentSecurityResult {
  const visible = content.text.slice(0, 3_000_000);
  const hidden = content.hiddenText.slice(0, 20_000);
  const metadata = securityMetadata(content);
  const findings: WebsiteContentSecurityFinding[] = [
    ...scanRules(visible, secretRules, "SECRET", "CRITICAL", "VISIBLE"),
    ...scanRules(hidden, secretRules, "SECRET", "CRITICAL", "HIDDEN"),
    ...scanRules(metadata, secretRules, "SECRET", "CRITICAL", "METADATA"),
    ...scanRules(visible, sensitiveRules, "SENSITIVE_DATA", "HIGH", "VISIBLE"),
    ...scanRules(hidden, sensitiveRules, "SENSITIVE_DATA", "HIGH", "HIDDEN"),
    ...scanRules(metadata, sensitiveRules, "SENSITIVE_DATA", "HIGH", "METADATA"),
    ...scanRules(visible, promptInjectionRules, "PROMPT_INJECTION", "HIGH", "VISIBLE"),
    ...scanRules(hidden, promptInjectionRules, "PROMPT_INJECTION", "CRITICAL", "HIDDEN"),
    ...scanRules(metadata, promptInjectionRules, "PROMPT_INJECTION", "HIGH", "METADATA"),
  ];
  const visibleCards = paymentCardCount(visible);
  if (visibleCards) {
    findings.push({
      kind: "SENSITIVE_DATA",
      code: "PAYMENT_CARD",
      severity: "CRITICAL",
      location: "VISIBLE",
      count: visibleCards,
    });
  }
  const hiddenCards = paymentCardCount(hidden);
  if (hiddenCards) {
    findings.push({
      kind: "SENSITIVE_DATA",
      code: "PAYMENT_CARD",
      severity: "CRITICAL",
      location: "HIDDEN",
      count: hiddenCards,
    });
  }
  const metadataCards = paymentCardCount(metadata);
  if (metadataCards) {
    findings.push({
      kind: "SENSITIVE_DATA",
      code: "PAYMENT_CARD",
      severity: "CRITICAL",
      location: "METADATA",
      count: metadataCards,
    });
  }
  if (hidden.trim()) {
    findings.push({
      kind: "HIDDEN_CONTENT",
      code: "HIDDEN_TEXT",
      severity: "MEDIUM",
      location: "HIDDEN",
      count: 1,
    });
  }

  const hasSecret = findings.some((finding) => finding.kind === "SECRET");
  const hasSensitive = findings.some((finding) => finding.kind === "SENSITIVE_DATA");
  const hasCritical = findings.some((finding) => finding.severity === "CRITICAL");
  const hasPromptInjection = findings.some((finding) => finding.kind === "PROMPT_INJECTION");
  const classification: KnowledgeV2SecurityClassification = hasSecret
    ? "SECRET"
    : hasSensitive
      ? "SENSITIVE"
      : defaultClassification;
  const decision: WebsiteContentSecurityDecision =
    hasSecret || hasCritical || hasPromptInjection
      ? "QUARANTINED"
      : findings.length
        ? "NEEDS_REVIEW"
        : "READY";
  return { decision, classification, findings, publishable: decision === "READY" };
}
