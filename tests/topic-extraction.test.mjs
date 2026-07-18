import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchCandidates, deriveKeyword } from "../app/api/research/topic.ts";

test("prefers a concrete bill name over generic legislative labels", () => {
  const title = "【法案提出】議員立法「同日選実施禁止法案」を提出";
  const officialName = "大都市地域における特別区の設置に関する法律の一部を改正する法律案";
  const context = `${title}\n国民民主党は、議員立法「${officialName}」（同日選実施禁止法案）を提出した。`;

  const keyword = deriveKeyword(title, context);
  const candidates = buildSearchCandidates(keyword, title, context);

  assert.equal(keyword, officialName);
  assert.equal(candidates[0], officialName);
  assert.ok(candidates.includes("同日選実施禁止法案"));
  assert.ok(!candidates.includes("議員立法"));
  assert.ok(!candidates.includes("法案提出"));
});
