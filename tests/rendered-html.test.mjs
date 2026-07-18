import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished Proofline research interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Proofline Autopilot — Qwen-grounded public records<\/title>/i);
  assert.match(html, /公開記録を調査/);
  assert.match(html, /ニュース・法案・議員から公式記録を探す/);
  assert.match(html, /ニュースの奥にある原典へ/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Codex is working/i);
});

test("keeps official-source, grounded Qwen analysis, human approval, and question-answer tracing in the product", async () => {
  const [page, css, bills, exchange, research, qwen, functionCompute, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bills/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exchange/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/qwen-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../alibaba-cloud/function-compute/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OFFICIAL LEGISLATIVE TRACE/);
  assert.match(page, /QUESTION → ANSWER/);
  assert.match(page, /PROOFLINE VERIFIED REPORT/);
  assert.match(page, /印刷・PDF保存/);
  assert.match(page, /公式記録を横断検索しています/);
  assert.match(page, /日本法令索引/);
  assert.match(page, /QWEN · 原文限定/);
  assert.match(page, /AUTOPILOT RUN/);
  assert.match(page, /人によるレビュー承認済み/);
  assert.match(page, /公式記録だけでは、まだ断定できないこと/);
  assert.match(page, /briefing-overview/);
  assert.match(page, /briefing-side/);
  assert.match(page, /政府が最終的に採用した方針と実施時期/);
  assert.match(css, /briefing-main \{ min-width:0; padding:16px 18px/);
  assert.match(page, /副首都構想でライブデモを開始/);
  assert.match(page, /要点・審議統計・法案経過・発言原文/);
  assert.match(bills, /shugiin\.go\.jp/);
  assert.match(bills, /審議状況・経過・本文を公式情報から照合/);
  assert.match(exchange, /kokkai\.ndl\.go\.jp\/api\/meeting/);
  assert.match(research, /createQwenGroundedAnalysis/);
  assert.match(research, /awaiting-human-approval/);
  assert.match(qwen, /chat\/completions/);
  assert.match(qwen, /recordIds\.filter/);
  assert.match(qwen, /ALIBABA_AUTOPILOT_URL/);
  assert.match(functionCompute, /Alibaba Cloud Function Compute/);
  assert.match(functionCompute, /QWEN_API_KEY/);
  assert.match(readme, /Significant update from the earlier Proofline Japan project/);
  assert.match(readme, /human approval checkpoint/i);
  assert.doesNotMatch(readme, /vinext-starter/);
});
