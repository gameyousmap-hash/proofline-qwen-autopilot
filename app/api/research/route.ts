import { NextRequest, NextResponse } from "next/server";
import { buildSearchCandidates, deriveKeyword } from "./topic";
import { createQwenGroundedAnalysis, type GroundedRecord } from "../../lib/qwen-analysis";

type SpeechRecord = {
  speechID: string;
  issueID: string;
  speechOrder: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  date: string;
  speaker: string;
  speakerGroup?: string | null;
  speech: string;
  speechURL: string;
};

function cleanText(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

function createBrief(speech: string, keyword: string) {
  const clean = (value: string) => value
    .replace(/^(?:えー|あの|その|そして|また|しかし|そこで|まず|今、|さて|次に|○[^　]+　)+/g, "")
    .replace(/(?:でございます|というふうに思います|と思っております|と考えております)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const score = (text: string) => (text.includes(keyword) ? 7 : 0)
    + (/(求め|必要|べき|提案|検討|実施|整備|強化)/.test(text) ? 4 : 0)
    + (/(懸念|問題|課題|リスク|不足|遅れ)/.test(text) ? 4 : 0)
    + (/(伺|質問|どう|でしょうか|見解)/.test(text) ? 3 : 0)
    + (/\d|[一二三四五六七八九十百千万億兆]+/.test(text) ? 2 : 0);
  const sentences = speech.split(/(?<=[。！？])/).map(clean).filter((value) => value.length >= 24 && value.length <= 300);
  const selected = sentences.map((text) => ({ text, score: score(text) })).sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0]?.text || clean(speech.slice(0, 200));
  const clauses = selected.split("、").map(clean).filter((value) => value.length >= 12);
  const focusIndex = clauses.map((text) => score(text)).reduce((best, current, index, all) => current > all[best] ? index : best, 0);
  const compact = clean((clauses.length > 1 ? clauses.slice(Math.max(0, focusIndex - 1), focusIndex + 2).join("、") : selected))
    .replace(/^(?:私からは|私どもとしては|政府としては)/, "")
    .slice(0, 138);
  const type = /(伺|質問|どう|でしょうか|見解)/.test(selected) ? "政府への確認" : /(懸念|問題|課題|リスク|不足)/.test(selected) ? "課題・懸念" : /(求め|必要|べき|提案|実施)/.test(selected) ? "提案・要求" : "事実・見解";
  const headlineCore = compact
    .replace(/[。！？]$/, "")
    .replace(/(?:いただきたい|お願いしたい|伺いたい|でしょうか)$/, "")
    .slice(0, 48);
  const headline = type === "政府への確認"
    ? `${keyword}${/(決意|認識)/.test(compact) ? "実現への政府の決意と認識" : "に関する政府見解"}を質問`
    : type === "課題・懸念"
      ? `${keyword}をめぐる${/(遅れ|不足)/.test(compact) ? "対応の遅れ・不足" : "課題と懸念"}を指摘`
      : type === "提案・要求"
        ? `${keyword}の${compact.includes("必要") ? "必要性を主張" : "実施・対応を要求"}`
        : compact.includes("提出")
          ? `${keyword}に関する法案提出を報告`
          : headlineCore.length >= 14 ? `${headlineCore}${compact.length > 48 ? "…" : ""}` : `${keyword}に関する${type}`;
  return { briefType: type, briefHeadline: headline, briefText: compact, briefQuote: selected.slice(0, 210) };
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("input")?.trim();
  if (!input) return NextResponse.json({ error: "URLまたは検索語を入力してください。" }, { status: 400 });

  let sourceTitle = input;
  let sourceContext = input;
  let sourceUrl: string | null = null;
  if (/^https?:\/\//i.test(input)) {
    sourceUrl = input;
    try {
      const response = await fetch(input, { headers: { "User-Agent": "Proofline/0.1 public-record-research" }, redirect: "follow" });
      const html = await response.text();
      const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      sourceTitle = cleanText(og || title || input);
      sourceContext = `${sourceTitle}\n${cleanText(html).slice(0, 12000)}`;
    } catch {
      sourceTitle = decodeURIComponent(new URL(input).pathname).replace(/[-_/]+/g, " ");
      sourceContext = sourceTitle;
    }
  }

  const keyword = deriveKeyword(sourceTitle, sourceContext);
  const isUrl = /^https?:\/\//i.test(input);
  const reliableTopic = /(法律案|改正案|法案|基本法|特措法|新法|制度|政策|予算|条約|規制|支援|給付)/.test(keyword);
  if (isUrl && (!reliableTopic || keyword.length < 3)) {
    return NextResponse.json({
      sourceTitle,
      sourceUrl,
      keyword,
      needsConfirmation: true,
      message: "記事から法案名・政策名を確実に特定できませんでした。誤った会議録を表示しないため、法案名または記事タイトルを入力してください。",
      total: 0,
      records: [],
      searched: [],
    });
  }
  try {
    const candidates = buildSearchCandidates(keyword, sourceTitle, sourceContext);
    let usedKeyword = keyword;
    let data: { numberOfRecords?: number; speechRecord?: SpeechRecord[] } = {};
    const attempted: string[] = [];
    for (const candidate of candidates) {
      attempted.push(candidate);
      const endpoint = new URL("https://kokkai.ndl.go.jp/api/speech");
      endpoint.searchParams.set("any", candidate);
      endpoint.searchParams.set("recordPacking", "json");
      endpoint.searchParams.set("maximumRecords", "8");
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      data = await response.json() as { numberOfRecords?: number; speechRecord?: SpeechRecord[] };
      usedKeyword = candidate;
      if ((data.numberOfRecords || 0) > 0) break;
    }
    const groundedRecords: GroundedRecord[] = (data.speechRecord || []).map((item) => ({
      id: item.speechID,
      issueId: item.issueID,
      speechOrder: item.speechOrder,
      speaker: item.speaker,
      group: item.speakerGroup,
      house: item.nameOfHouse,
      meeting: item.nameOfMeeting,
      date: item.date,
      url: item.speechURL,
      text: item.speech.replace(/^○[^　]+　/, "").replace(/\s+/g, " "),
    }));
    const records = groundedRecords.map((grounded) => {
      const normalized = grounded.text;
      const at = normalized.indexOf(usedKeyword);
      const start = Math.max(0, at >= 0 ? at - 70 : 0);
      const excerpt = normalized.slice(start, start + 240);
      const mentions = normalized.split(usedKeyword).length - 1;
      const brief = createBrief(normalized, usedKeyword);
      return {
      id: grounded.id,
      issueId: grounded.issueId,
      speechOrder: grounded.speechOrder,
      house: grounded.house,
      meeting: grounded.meeting,
      date: grounded.date,
      speaker: grounded.speaker,
      group: grounded.group,
      excerpt: `${start > 0 ? "…" : ""}${excerpt}`,
      speechChars: normalized.length,
      url: grounded.url,
      relevance: mentions >= 2 ? "高" : "中",
      matchReason: `発言本文に「${usedKeyword}」を${Math.max(1, mentions)}回確認`,
      ...brief,
    };}).sort((a, b) => (a.relevance === "高" ? -1 : 1) - (b.relevance === "高" ? -1 : 1));
    const aiAnalysis = await createQwenGroundedAnalysis(usedKeyword, sourceTitle, groundedRecords);
    const agentRun = {
      id: `run-${Date.now()}`,
      status: "awaiting-human-approval",
      provider: aiAnalysis?.provider || "deterministic-fallback",
      model: aiAnalysis?.model || null,
      stages: [
        { id: "interpret", label: "入力を解釈", status: "completed" },
        { id: "retrieve", label: "公式記録を取得", status: "completed", count: records.length },
        { id: "analyze", label: "根拠限定で分析", status: "completed", engine: aiAnalysis?.engine || "rules" },
        { id: "verify", label: "根拠IDを検証", status: "completed" },
        { id: "approve", label: "人が公開を承認", status: "pending" },
      ],
    };
    return NextResponse.json({ sourceTitle, sourceUrl, keyword: usedKeyword, originalKeyword: keyword, fallbackUsed: usedKeyword !== keyword, attempted, needsConfirmation: false, total: data.numberOfRecords || 0, records, aiAnalysis, agentRun, analysisEngine: aiAnalysis?.engine || "rules", searched: ["国立国会図書館 国会会議録検索システム"] });
  } catch {
    return NextResponse.json({ error: "公式会議録への接続に失敗しました。時間を置いて再試行してください。", keyword }, { status: 502 });
  }
}
