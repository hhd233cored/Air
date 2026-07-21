import type { ReactNode } from "react";
import { resolveApiUrl } from "../lib/api/client";

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  php: "PHP",
  plaintext: "Text",
  py: "Python",
  python: "Python",
  rust: "Rust",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

const KEYWORDS = new Set([
  "and", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default",
  "del", "elif", "else", "except", "export", "extends", "finally", "for", "from", "function", "if", "import",
  "in", "is", "let", "match", "new", "not", "of", "or", "pass", "raise", "return", "switch", "try", "throw",
  "type", "var", "while", "with", "yield",
]);

const BUILTINS = new Set([
  "Array", "Boolean", "Date", "Error", "Float", "Image", "Int", "JSON", "Map", "Math", "None", "Object", "Path",
  "Print", "Range", "Set", "String", "True", "False", "ValueError", "console", "dict", "enumerate", "float", "int",
  "len", "list", "max", "min", "open", "print", "range", "set", "str", "sum", "tuple",
]);

const TOKEN_PATTERN = /(#(?![0-9a-fA-F]{3,8}\b)[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm;

export function languageKey(value: string) {
  return value.trim().split(/\s+/u)[0].replace(/^language-/u, "").toLowerCase();
}

export function languageLabel(value: string) {
  const key = languageKey(value);
  return LANGUAGE_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
}

function tokenClass(value: string, code: string, start: number) {
  if (/^(#(?![0-9a-fA-F]{3,8}\b)|\/\/|\/\*)/u.test(value)) return "markdown-token--comment";
  if (/^["'`]/u.test(value)) return "markdown-token--string";
  if (/^\d/u.test(value)) return "markdown-token--number";
  if (KEYWORDS.has(value)) return "markdown-token--keyword";
  if (BUILTINS.has(value)) return "markdown-token--builtin";

  const before = code.slice(0, start);
  const after = code.slice(start + value.length);
  if (/\.\s*$/u.test(before)) return "markdown-token--property";
  if (/^\s*(?::|=)/u.test(after)) return "markdown-token--key";
  if (/^\s*\(/u.test(after)) return "markdown-token--function";
  return "markdown-token--variable";
}

function highlightCodeLine(code: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(code)) !== null) {
    if (match.index > lastIndex) nodes.push(code.slice(lastIndex, match.index));
    nodes.push(<span className={tokenClass(match[0], code, match.index)} key={`${keyPrefix}-token-${match.index}`}>{match[0]}</span>);
    lastIndex = TOKEN_PATTERN.lastIndex;
  }
  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));
  return nodes;
}

export function highlightCode(code: string): ReactNode[] {
  return code.split("\n").map((line, lineIndex) => (
    <span className="markdown-code__line" key={`line-${lineIndex}`}>
      <span className="markdown-code__line-number" aria-hidden="true">{lineIndex + 1}</span>
      <span className="markdown-code__line-content">{highlightCodeLine(line, `line-${lineIndex}`)}</span>
    </span>
  ));
}

function renderInlineLine(text: string, keyPrefix: string): ReactNode[] {
  const definition = text.match(/^(\s*)`([^`]+)`\s*([:：])\s*(.*)$/u);
  if (definition) {
    return [
      <span className="markdown-definition" key={`${keyPrefix}-definition`}>
        <span className="markdown-definition__bullet" aria-hidden="true">•</span>
        <code>{definition[2]}</code>
        <span className="markdown-definition__separator">{definition[3]}</span>
        <span className="markdown-definition__value">{renderInlineLine(definition[4], `${keyPrefix}-value`)}</span>
      </span>,
    ];
  }

  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] && match[3]) {
      nodes.push(<a href={match[3]} key={`${keyPrefix}-link-${match.index}`} target="_blank" rel="noreferrer">{match[2]}</a>);
    } else if (match[4]) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={`${keyPrefix}-em-${match.index}`}>{match[6]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split("\n").flatMap((line, lineIndex, lines) => [
    ...renderInlineLine(line, `inline-${lineIndex}`),
    ...(lineIndex < lines.length - 1 ? ["\n"] : []),
  ]);
}

export function MarkdownRenderer({ source }: { source: string }) {
  const lines = source.replace(/^---[\s\S]*?---\s*/u, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineMarkdown(paragraph.join("\n"))}</p>);
      paragraph = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${index}`}>{renderInlineMarkdown(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderInlineMarkdown(quoteLines.join(" "))}</blockquote>);
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      const code = codeLines.join("\n");
      const label = languageLabel(language);
      blocks.push(
        <div className="markdown-code" key={`code-block-${index}`} data-language={languageKey(language) || undefined}>
          {label ? <div className="markdown-code__header"><span>{label}</span></div> : null}
          <pre><code>{highlightCode(code)}</code></pre>
        </div>,
      );
      continue;
    }

    if (/^([-*])\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^([-*])\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`}>{items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushParagraph();
      const imagePath = image[2].trim();
      blocks.push(
        <figure key={`image-${index}`}>
          <img
            src={resolveApiUrl(imagePath)}
            alt={image[1]}
            onError={(event) => {
              if (event.currentTarget.dataset.fallbackAttempted === "true") return;
              event.currentTarget.dataset.fallbackAttempted = "true";
              event.currentTarget.src = imagePath;
            }}
          />
        </figure>,
      );
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();

  return <div className="markdown-content">{blocks}</div>;
}
