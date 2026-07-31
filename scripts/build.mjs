#!/usr/bin/env node
/**
 * 一步构建：先从 open-doc 生成数据，再产出静态站。
 *
 *   npm run build                  # 从 ../open-doc 读
 *   npm run build -- ../open-doc   # 显式指定仓库路径
 *   npm run build -- --out=public-dist
 *
 * 单独一个入口的原因：`npm run a && b -- 参数` 里的参数只会传给链条最后一个命令，
 * 很容易把「仓库路径」误传成「输出目录」。这里统一收口。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const HERE = path.resolve(import.meta.dirname);
const args = process.argv.slice(2);

const outFlag = args.find((a) => a.startsWith("--out="));
const repo = args.find((a) => !a.startsWith("-"));

function run(script, scriptArgs) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(HERE, script), ...scriptArgs],
    { stdio: "inherit" }
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("build-data.mjs", repo ? [repo] : []);
run("build-static.mjs", outFlag ? [outFlag] : []);
