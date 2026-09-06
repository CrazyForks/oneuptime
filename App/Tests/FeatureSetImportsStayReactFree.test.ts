import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * App has no react, by design.
 *
 * FeatureSet/Dashboard (and Accounts, AdminDashboard, StatusPage,
 * PublicDashboard, BrowserRecorder) each own their own react and their own
 * compile job; App/tsconfig.json excludes them, App's package.json does not
 * depend on react, and CI installs node_modules for Common and App only.
 *
 * A test that imports a component therefore fails twice over: jest cannot
 * resolve react, and tsc pulls the whole component graph into App's program
 * through the test file - `exclude` stops the initial glob, not a file an
 * included file imports. That is exactly how "Cannot find module 'react'"
 * took out both App Test and Compile on master, from three test files that
 * wanted pure exports which happened to live beside a view.
 *
 * The fix each time is the same: move the pure half into a React-free
 * sibling and have the component re-export it. This guard is what makes that
 * the obvious move rather than a lesson re-learned - it fails HERE, in
 * seconds, naming the test and the import, instead of in CI twenty minutes
 * later with a resolver stack trace.
 */

const TESTS_DIR: string = __dirname;
const APP_DIR: string = path.join(__dirname, "..");

/* import ... from "<x>" / export ... from "<x>" / import("<x>") */
const IMPORT_PATTERN: RegExp = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/* An opening tag: the cheapest reliable sign a file really is JSX. */
const JSX_PATTERN: RegExp = /<[A-Za-z/>]/;

/* A module that imports React is a module App cannot load. */
const REACT_IMPORT_PATTERN: RegExp =
  /(?:from|import)\s*\(?\s*["'](react|react-dom|react-router-dom|react-i18next|reactflow|recharts|react-beautiful-dnd)(?:\/[^"']*)?["']/;

function listFiles(directory: string, suffix: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__mocks__") {
        continue;
      }
      found.push(...listFiles(full, suffix));
      continue;
    }

    if (entry.name.endsWith(suffix)) {
      found.push(full);
    }
  }

  return found;
}

/*
 * Comments are stripped first. Several of these modules explain in prose
 * which component they were split out of - `... from "./FilterChipDropdown"
 * keep working` - and a scanner that read those would report the split it is
 * meant to encourage as the violation it is meant to catch.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readImports(filePath: string): Array<string> {
  const source: string = stripComments(fs.readFileSync(filePath, "utf8"));
  const specifiers: Array<string> = [];

  IMPORT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null = IMPORT_PATTERN.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = IMPORT_PATTERN.exec(source);
  }

  return specifiers;
}

/* Resolve a relative specifier the way ts-jest does: .ts, .tsx, or /index. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function isFeatureSetFile(filePath: string): boolean {
  return filePath.startsWith(path.join(APP_DIR, "FeatureSet"));
}

function relativeToApp(filePath: string): string {
  return path.relative(APP_DIR, filePath);
}

/*
 * Every FeatureSet module an App test can reach, with the chain that got
 * there. Only relative imports are followed: "Common/*" is mapped to Common,
 * which DOES have react installed and which App's compile resolves fine.
 */
function reachableFeatureSetModules(): Map<string, Array<string>> {
  const reached: Map<string, Array<string>> = new Map<string, Array<string>>();
  const queue: Array<{ file: string; chain: Array<string> }> = [];

  for (const testFile of listFiles(TESTS_DIR, ".test.ts").concat(
    listFiles(TESTS_DIR, ".test.tsx"),
  )) {
    for (const specifier of readImports(testFile)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const resolved: string | null = resolveRelative(testFile, specifier);

      if (resolved && isFeatureSetFile(resolved)) {
        queue.push({
          file: resolved,
          chain: [relativeToApp(testFile), relativeToApp(resolved)],
        });
      }
    }
  }

  while (queue.length > 0) {
    const next: { file: string; chain: Array<string> } = queue.pop()!;

    if (reached.has(next.file)) {
      continue;
    }

    reached.set(next.file, next.chain);

    for (const specifier of readImports(next.file)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const resolved: string | null = resolveRelative(next.file, specifier);

      if (resolved && isFeatureSetFile(resolved) && !reached.has(resolved)) {
        queue.push({
          file: resolved,
          chain: [...next.chain, relativeToApp(resolved)],
        });
      }
    }
  }

  return reached;
}

describe("App tests never reach a React module", () => {
  const reachable: Map<string, Array<string>> = reachableFeatureSetModules();

  test("the scan actually found something to check", () => {
    /*
     * Guards the guard: a resolver change that quietly matched nothing would
     * leave this file passing while checking an empty set.
     */
    expect(reachable.size).toBeGreaterThan(50);
  });

  test("no FeatureSet module an App test can reach imports React", () => {
    const offenders: Array<string> = [];

    for (const [file, chain] of reachable) {
      if (
        REACT_IMPORT_PATTERN.test(stripComments(fs.readFileSync(file, "utf8")))
      ) {
        offenders.push(chain.join("\n    -> "));
      }
    }

    /*
     * The chains ARE the message: jest prints the received array, so a
     * failure names every test and the exact hop that reaches React. The fix
     * is always the same - move the pure half into a React-free sibling,
     * re-export it from the component, and import the sibling here.
     */
    expect(offenders).toEqual([]);
  });

  test("a .tsx module an App test can reach must actually contain JSX", () => {
    /*
     * A .tsx extension on a file with no JSX is how a module App CAN load
     * ends up looking like one it cannot: the next person moving a pure
     * export out of a component sees a .tsx in the chain and assumes the
     * boundary is already broken. Nothing about it is wrong at runtime, so
     * this is a naming rule rather than a resolution one.
     */
    const offenders: Array<string> = [];

    for (const [file] of reachable) {
      if (!file.endsWith(".tsx")) {
        continue;
      }

      if (!JSX_PATTERN.test(fs.readFileSync(file, "utf8"))) {
        offenders.push(relativeToApp(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
