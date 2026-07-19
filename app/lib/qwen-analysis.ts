export type GroundedRecord = {
  id: string;
  issueId: string;
  speechOrder: number;
  speaker: string;
  group?: string | null;
  house: string;
  meeting: string;
  date: string;
  url: string;
  text: string;
};

export type GroundedAnalysis = {
  engine: "qwen";
  model: string;
  provider: "alibaba-function-compute" | "qwen-cloud-direct";
  executiveSummary: string;
  centralQuestion: string;
  evidenceStrength: "強い" | "限定的" | "不十分";
  keyPoints: Array<{
    type: string;
    headline: string;
    summary: string;
    significance: string;
    recordIds: string[];
  }>;
  unresolvedQuestions: string[];
  sourceCoverage: string;
};

type RawAnalysis = Omit<GroundedAnalysis, "engine" | "model" | "provider">;

const systemPrompt = [
  "あなたは日本の国会会議録を扱う、非党派の調査エージェントです。",
  "与えられた公式発言だけを根拠に分析し、外部知識や推測を追加しないでください。",
  "各論点は必ず根拠となるrecordIdを付け、原文で確認できない内容は未回答事項へ回してください。",
  "賛否を断定せず、発言者が何を質問・主張・懸念・回答したかを区別してください。",
  "日本語で、一般の読者が30秒で理解できる明瞭な文にしてください。",
  "JSONだけを返し、Markdownのコードブロックは使わないでください。",
].join("\n");

const outputContract = {
  executiveSummary: "string",
  centralQuestion: "string",
  evidenceStrength: "強い | 限定的 | 不十分",
  keyPoints: [{
    type: "政府への確認 | 政府答弁 | 提案・要求 | 課題・懸念 | 事実・見解",
    headline: "string",
    summary: "string",
    significance: "string",
    recordIds: ["retrieved record ID"],
  }],
  unresolvedQuestions: ["string"],
  sourceCoverage: "string",
};

function parseJsonContent(value: string): RawAnalysis {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized) as RawAnalysis;
}

function validateAnalysis(parsed: RawAnalysis, records: GroundedRecord[]) {
  const knownIds = new Set(records.map((record) => record.id));
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints
      .map((point) => ({ ...point, recordIds: Array.isArray(point.recordIds) ? point.recordIds.filter((id) => knownIds.has(id)) : [] }))
      .filter((point) => point.recordIds.length > 0)
      .slice(0, 4)
    : [];
  if (!keyPoints.length) throw new Error("Qwen analysis did not return a valid evidence ID.");
  return {
    ...parsed,
    evidenceStrength: (["強い", "限定的", "不十分"].includes(parsed.evidenceStrength) ? parsed.evidenceStrength : "限定的") as RawAnalysis["evidenceStrength"],
    unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions) ? parsed.unresolvedQuestions.slice(0, 4) : [],
    keyPoints,
  };
}

function sourcePacket(records: GroundedRecord[]) {
  return records.map((record) => ({
    recordId: record.id,
    speaker: record.speaker,
    group: record.group || "所属情報なし",
    house: record.house,
    meeting: record.meeting,
    date: record.date,
    officialUrl: record.url,
    speech: record.text.slice(0, 3600),
  }));
}

async function analyzeOnFunctionCompute(keyword: string, sourceTitle: string, records: GroundedRecord[]) {
  const endpoint = process.env.ALIBABA_AUTOPILOT_URL;
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.ALIBABA_AUTOPILOT_SECRET ? { "x-proofline-service-key": process.env.ALIBABA_AUTOPILOT_SECRET } : {}),
    },
    body: JSON.stringify({ keyword, sourceTitle, records: sourcePacket(records), outputContract }),
  });
  if (!response.ok) throw new Error(`Function Compute returned ${response.status}.`);
  const payload = await response.json() as { analysis?: RawAnalysis; model?: string } & RawAnalysis;
  const parsed = payload.analysis || payload;
  return {
    ...validateAnalysis(parsed, records),
    engine: "qwen" as const,
    model: payload.model || process.env.QWEN_MODEL || "qwen3.7-plus",
    provider: "alibaba-function-compute" as const,
  };
}

async function analyzeDirectly(keyword: string, sourceTitle: string, records: GroundedRecord[]) {
  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.QWEN_BASE_URL?.replace(/\/$/, "");
  if (!apiKey || !baseUrl) return null;
  const model = process.env.QWEN_MODEL || "qwen3.7-plus";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 1400,
      enable_thinking: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `調査テーマ: ${keyword}\n記事または入力タイトル: ${sourceTitle}\n\n出力JSON契約:\n${JSON.stringify(outputContract)}\n\n公式会議録データ:\n${JSON.stringify(sourcePacket(records))}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Qwen Cloud returned ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen Cloud returned no analysis.");
  return {
    ...validateAnalysis(parseJsonContent(content), records),
    engine: "qwen" as const,
    model,
    provider: "qwen-cloud-direct" as const,
  };
}

export async function createQwenGroundedAnalysis(keyword: string, sourceTitle: string, records: GroundedRecord[]): Promise<GroundedAnalysis | null> {
  if (!records.length) return null;
  try {
    return await analyzeOnFunctionCompute(keyword, sourceTitle, records) || await analyzeDirectly(keyword, sourceTitle, records);
  } catch (error) {
    console.error("Qwen grounded analysis failed", error);
    return null;
  }
}
