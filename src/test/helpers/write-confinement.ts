import ts from "typescript";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Write-confinement analysis.
 *
 * Authority: taskplans/123_enterprise_readiness_evidence_program.md (audit of
 * the command-path conformance rule, 2026-10-01).
 *
 * THE INVARIANT
 * A state-changing database operation in capability code must be reachable only
 * through an authorized execution path. Verity has two such paths inside a
 * capability: a `CommandDefinition` (run by `executeCommand`, which enforces
 * policy and records audit and events) and a scheduled unit (`schedules[].run`,
 * run by the authenticated scheduler under `withTenant`). A write is therefore
 * acceptable when it sits lexically in one of those, or in a helper function
 * whose every non-test reference is, transitively, in one of those.
 *
 * WHY NOT THE OLD RULE
 * The previous rule asked whether a file containing a write also contained the
 * text `CommandDefinition`. That is a property of a file, not of a call path:
 * it flagged a legitimate shared helper (`manufacturing/shared.ts`) and passed
 * any file that merely mentioned the word, including one whose helper a page
 * could call directly.
 *
 * WHAT IS AND IS NOT PROVEN
 * Proven, by symbol resolution over the project's own files: which functions
 * reference a write helper, and whether any reference sits in `src/app`,
 * `src/components` or `src/server/actions`. Not proven: dynamic dispatch
 * (a helper stored in a map and called by key), calls through values the
 * checker cannot resolve, and platform code, which has its own authorized
 * entry points (operator actions, the pack control plane) and is deliberately
 * out of this rule's scope. External packages are not resolved, so a write
 * hidden in a third-party callback is invisible.
 */

export type WriteFinding = {
  file: string;
  line: number;
  op: string;
  helper?: string;
  reason: string;
};

export type AnalysisOptions = {
  /** Posix path prefix of capability code, e.g. "src/server/capabilities/". */
  capabilityPrefix: string;
  /** Posix path prefixes of the entry layer, where no capability write helper may be referenced. */
  entryPrefixes: string[];
  /** Posix path prefixes where a direct write is forbidden outright (components). */
  noDirectWritePrefixes: string[];
  /** Posix file paths in the entry layer that may write directly, each with its reason. */
  directWriteAllowList: Record<string, string>;
};

export type Analysis = {
  totalWriteSites: number;
  capabilityViolations: WriteFinding[];
  entryLayerViolations: WriteFinding[];
  confinedHelpers: string[];
  /** Write sites per context kind in capability code, for reporting. */
  counts: { command: number; scheduleUnit: number; confinedHelper: number; unconfined: number };
};

/** Normalise a path to posix separators so comparisons never depend on the platform. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const RAW_WRITE_METHODS = new Set(["$executeRaw", "$executeRawUnsafe"]);
const DB_ROOTS = new Set(["tx", "prisma", "db", "admin", "client", "app"]);
/** A raw statement is a write only if it contains one of these; advisory locks and set_config are not. */
const RAW_WRITE_SQL = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i;

function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) || rel.startsWith("src/test/");
}

/** Builds a program over the given files without resolving external packages (fast, and enough for symbol resolution among project files). */
export function createProjectProgram(root: string, files: Map<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: false,
    allowJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const abs = (rel: string) => toPosix(`${root}/${rel}`);
  const byAbs = new Map<string, string>([...files].map(([rel, text]) => [abs(rel), text]));
  const host = ts.createCompilerHost(options, true);
  host.fileExists = (f) => byAbs.has(toPosix(f));
  host.readFile = (f) => byAbs.get(toPosix(f));
  host.getSourceFile = (f, lang) => {
    const text = byAbs.get(toPosix(f));
    return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
  };
  host.resolveModuleNames = (names, containing) =>
    names.map((name) => {
      let base: string | null = null;
      if (name.startsWith("@/")) base = abs(`src/${name.slice(2)}`);
      else if (name.startsWith(".")) base = toPosix(join(containing, "..", name));
      if (!base) return undefined; // external package: deliberately unresolved
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        if (byAbs.has(base + ext)) {
          return {
            resolvedFileName: base + ext,
            extension: ext.endsWith("x") ? ts.Extension.Tsx : ts.Extension.Ts,
          };
        }
      }
      return undefined;
    });
  return ts.createProgram([...byAbs.keys()], options, host);
}

/** Reads every non-test source file under `src/` for the real tree. */
export function loadRepoFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
        const rel = toPosix(full.slice(root.length + 1));
        if (!isTestFile(rel)) out.set(rel, readFileSync(full, "utf8"));
      }
    }
  };
  if (existsSync(join(root, "src"))) walk(join(root, "src"));
  return out;
}

function rootName(expr: ts.Node): string | null {
  let e: ts.Node | undefined = expr;
  while (e) {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) {
      if (ts.isIdentifier(e.expression) && e.expression.text === "ctx" && e.name.text === "tx") return "tx";
      e = e.expression;
    } else if (ts.isElementAccessExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) {
      e = e.expression;
    } else return null;
  }
  return null;
}

function writeOp(node: ts.Node): string | null {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const name = node.expression.name.text;
    if (WRITE_METHODS.has(name)) {
      const recv = node.expression.expression;
      if (ts.isPropertyAccessExpression(recv)) {
        const r = rootName(recv);
        if (r && DB_ROOTS.has(r)) return name;
      }
    }
    if (RAW_WRITE_METHODS.has(name)) {
      const r = rootName(node.expression.expression);
      const arg = node.arguments[0];
      const text = arg ? (ts.isStringLiteralLike(arg) ? arg.text : arg.getText()) : "";
      if (r && DB_ROOTS.has(r) && (!text || RAW_WRITE_SQL.test(text))) return name;
    }
  }
  if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && RAW_WRITE_METHODS.has(node.tag.name.text)) {
    const r = rootName(node.tag.expression);
    const tpl = node.template;
    const text = ts.isNoSubstitutionTemplateLiteral(tpl) ? tpl.text : tpl.getText();
    if (r && DB_ROOTS.has(r) && RAW_WRITE_SQL.test(text)) return node.tag.name.text;
  }
  return null;
}

function isExported(decl: ts.Node): boolean {
  // `export function f` and `export const f = ...`
  const target = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
  return ts.canHaveModifiers(target) && (ts.getModifiers(target) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

type Context =
  | { kind: "command" }
  | { kind: "schedule" }
  | { kind: "helper"; name: string; decl: ts.Node }
  | { kind: "toplevel" };

function typeText(n: ts.Node | undefined): string {
  return n ? n.getText() : "";
}

function classify(node: ts.Node): Context {
  let helper: Context | null = null;
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isObjectLiteralExpression(p)) {
      const d = p.parent;
      if (d && ts.isVariableDeclaration(d) && /CommandDefinition/.test(typeText(d.type))) return { kind: "command" };
      if (d && (ts.isAsExpression(d) || ts.isSatisfiesExpression(d)) && /CommandDefinition/.test(typeText(d.type))) {
        return { kind: "command" };
      }
    }
    if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name.getText() === "run") {
      for (let q: ts.Node | undefined = p.parent; q; q = q.parent) {
        if (ts.isPropertyAssignment(q) && q.name.getText() === "schedules") return { kind: "schedule" };
      }
    }
    if (!helper) {
      if (ts.isFunctionDeclaration(p) && p.name) helper = { kind: "helper", name: p.name.text, decl: p };
      else if (
        (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
        p.parent &&
        ts.isVariableDeclaration(p.parent) &&
        ts.isIdentifier(p.parent.name)
      ) {
        helper = { kind: "helper", name: p.parent.name.text, decl: p.parent };
      } else if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) helper = { kind: "helper", name: p.name.text, decl: p };
    }
  }
  return helper ?? { kind: "toplevel" };
}

export function analyzeWrites(root: string, files: Map<string, string>, options: AnalysisOptions): Analysis {
  const program = createProjectProgram(root, files);
  const checker = program.getTypeChecker();
  const rel = (f: string) => toPosix(f).replace(`${toPosix(root)}/`, "");
  const sourceFiles = program.getSourceFiles().filter((sf) => files.has(rel(sf.fileName)));

  type Site = { file: string; line: number; op: string; ctx: Context };
  const sites: Site[] = [];
  for (const sf of sourceFiles) {
    const file = rel(sf.fileName);
    const visit = (n: ts.Node) => {
      const op = writeOp(n);
      if (op) sites.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, op, ctx: classify(n) });
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const symbolOf = (decl: ts.Node): ts.Symbol | undefined => {
    const nameNode = (decl as ts.NamedDeclaration).name ?? decl;
    return checker.getSymbolAtLocation(nameNode);
  };

  /** Every reference to the symbol, following `const alias = helper` re-bindings. */
  const referencesTo = (decl: ts.Node, seen = new Set<ts.Symbol>()): Array<{ file: string; line: number; node: ts.Node }> => {
    const sym = symbolOf(decl);
    if (!sym || seen.has(sym)) return [];
    seen.add(sym);
    const refs: Array<{ file: string; line: number; node: ts.Node }> = [];
    for (const sf of sourceFiles) {
      const file = rel(sf.fileName);
      const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n.text === sym.getName() && n !== (decl as ts.NamedDeclaration).name) {
          let s = checker.getSymbolAtLocation(n);
          if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
          if (s === sym && !ts.isImportSpecifier(n.parent) && !ts.isExportSpecifier(n.parent) && !ts.isImportClause(n.parent)) {
            const parent = n.parent;
            // `const alias = helper`: the alias's references are the helper's references.
            if (ts.isVariableDeclaration(parent) && parent.initializer === n) {
              refs.push(...referencesTo(parent, seen));
            } else {
              refs.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, node: n });
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return refs;
  };

  const inEntryLayer = (f: string) => options.entryPrefixes.some((p) => f.startsWith(p));
  const verdicts = new Map<ts.Node, string[]>();

  /** Reasons a helper is NOT confined; empty means confined. */
  const unconfinedReasons = (decl: ts.Node, trail = new Set<ts.Node>()): string[] => {
    if (verdicts.has(decl)) return verdicts.get(decl)!;
    if (trail.has(decl)) return [];
    trail.add(decl);
    const reasons: string[] = [];
    const refsToDecl = referencesTo(decl);
    // An exported helper nobody in the project calls is not proven confined: a
    // script or a later caller outside this analysis could reach it directly.
    if (refsToDecl.length === 0 && isExported(decl)) reasons.push("exported with no reference from any command");
    for (const r of refsToDecl) {
      if (inEntryLayer(r.file)) {
        reasons.push(`referenced from entry layer ${r.file}:${r.line}`);
        continue;
      }
      const c = classify(r.node);
      if (c.kind === "command" || c.kind === "schedule") continue;
      if (c.kind === "helper") {
        const sub = unconfinedReasons(c.decl, trail);
        if (sub.length) reasons.push(`via ${c.name} (${r.file}:${r.line}): ${sub[0]}`);
        continue;
      }
      reasons.push(`referenced outside any command or helper at ${r.file}:${r.line}`);
    }
    trail.delete(decl);
    verdicts.set(decl, reasons);
    return reasons;
  };

  const capabilityViolations: WriteFinding[] = [];
  const entryLayerViolations: WriteFinding[] = [];
  const confined = new Set<string>();
  const counts = { command: 0, scheduleUnit: 0, confinedHelper: 0, unconfined: 0 };

  for (const s of sites) {
    if (s.file.startsWith(options.capabilityPrefix)) {
      if (s.ctx.kind === "command") counts.command++;
      else if (s.ctx.kind === "schedule") counts.scheduleUnit++;
      else if (s.ctx.kind === "helper") {
        const reasons = unconfinedReasons(s.ctx.decl);
        if (reasons.length === 0) {
          counts.confinedHelper++;
          confined.add(`${s.file} ${s.ctx.name}`);
        } else {
          counts.unconfined++;
          capabilityViolations.push({ file: s.file, line: s.line, op: s.op, helper: s.ctx.name, reason: reasons[0]! });
        }
      } else {
        counts.unconfined++;
        capabilityViolations.push({ file: s.file, line: s.line, op: s.op, reason: "write outside any function, command or schedule unit" });
      }
    } else if (inEntryLayer(s.file)) {
      const forbidden = options.noDirectWritePrefixes.some((p) => s.file.startsWith(p));
      if (forbidden || !(s.file in options.directWriteAllowList)) {
        entryLayerViolations.push({ file: s.file, line: s.line, op: s.op, reason: "direct database write in the entry layer, not on the allow-list" });
      }
    }
  }

  return {
    totalWriteSites: sites.length,
    capabilityViolations,
    entryLayerViolations,
    confinedHelpers: [...confined].sort(),
    counts,
  };
}
