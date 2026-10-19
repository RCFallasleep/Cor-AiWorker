/**
 * 检查组件代码中是否写死了颜色（docs/ARCHITECTURE.md 4.10）。
 *
 * 颜色只能定义在 src/theme/ 中，其余代码必须通过 var(--…) 引用变量，
 * 否则皮肤与明暗模式切换时会有部分界面不跟着变。在 CI 中运行，发现即失败。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
const ALLOWED_DIR = join(ROOT, "theme");
const EXTENSIONS = [".ts", ".tsx", ".css"];
const PATTERNS = [
  { name: "十六进制颜色", regex: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-\w])/g },
  { name: "颜色函数", regex: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path !== ALLOWED_DIR) yield* walk(path);
    } else if (EXTENSIONS.some((ext) => path.endsWith(ext)) && !path.includes(".test.")) {
      yield path;
    }
  }
}

const problems = [];
for (const file of walk(ROOT)) {
  readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, index) => {
      for (const { name, regex } of PATTERNS) {
        for (const match of line.matchAll(regex)) {
          problems.push(`${relative(ROOT, file)}:${index + 1}  ${name} ${match[0]}`);
        }
      }
    });
}

if (problems.length) {
  console.error("以下位置写死了颜色，请改用 src/theme/tokens.css 中的变量：");
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}
console.log("颜色检查通过：组件代码中没有写死的颜色");
