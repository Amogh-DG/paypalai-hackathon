import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const agentDir = path.join(rootDir, "server", "src", "agent");
const paypalDir = path.join(rootDir, "server", "src", "paypal");
const policyDir = path.join(rootDir, "server", "src", "policy");

function getSourceFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

export function checkAgentSource(
  content,
  relativePath = "server/src/agent/index.ts",
) {
  const violations = [];
  const importRegex =
    /(?:import\s+(?:type\s+)?(?:(\{[^}]*\})|([a-zA-Z0-9_$]+)|\*\s+as\s+[a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"])|(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:import\s+['"]([^'"]+)['"])/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const namedImports = match[1];
    const defaultImport = match[2];
    const importPath = match[3] || match[4] || match[5] || match[6];
    if (!importPath) {
      continue;
    }

    if (/\b(paypal|policy|mandate|audit)\b/.test(importPath)) {
      violations.push(`Forbidden import in ${relativePath}: "${importPath}"`);
    }

    if (/\bproposals\b/.test(importPath)) {
      const isAllowedFile =
        /(^|\/)proposals\/service(\.js|\.ts)?$/.test(importPath);
      if (!isAllowedFile) {
        violations.push(
          `Forbidden import of proposals internals in ${relativePath}: "${importPath}"`,
        );
      } else {
        if (defaultImport) {
          violations.push(
            `Forbidden default import from proposals/service in ${relativePath}: only submitProposal and getMandateView allowed`,
          );
        }
        if (/\*\s+as\b/.test(match[0])) {
          violations.push(
            `Forbidden namespace import from proposals/service in ${relativePath}: only submitProposal and getMandateView allowed`,
          );
        }
        if (namedImports) {
          const names = namedImports
            .replace(/[{}]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim());
          const allowedNames = new Set(["submitProposal", "getMandateView"]);
          for (const name of names) {
            if (!allowedNames.has(name)) {
              violations.push(
                `Forbidden specifier "${name}" imported from proposals/service in ${relativePath}: only submitProposal and getMandateView allowed`,
              );
            }
          }
        }
      }
    }
  }
  return violations;
}

export function runBoundaryCheck() {
  const violations = [];

  const agentFiles = getSourceFiles(agentDir);
  for (const file of agentFiles) {
    const content = fs.readFileSync(file, "utf-8");
    violations.push(...checkAgentSource(content, path.relative(rootDir, file)));
  }

  const moneyFiles = [
    ...getSourceFiles(paypalDir),
    ...getSourceFiles(policyDir),
  ];
  for (const file of moneyFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const importRegex =
      /(?:from\s+['"]([^'"]+)['"])|(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:import\s+['"]([^'"]+)['"])/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2] || match[3] || match[4];
      if (importPath && /\bagent\b/.test(importPath)) {
        violations.push(
          `Forbidden import of agent in ${path.relative(rootDir, file)}: "${importPath}"`,
        );
      }
    }
  }

  return violations;
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("boundary-check.mjs") ||
    import.meta.url.endsWith(path.basename(process.argv[1])));

if (isDirectRun) {
  const violations = runBoundaryCheck();
  if (violations.length > 0) {
    process.stderr.write(
      "Boundary check failed:\n" + violations.join("\n") + "\n",
    );
    process.exit(1);
  }
  process.stdout.write("Boundary check passed.\n");
}
