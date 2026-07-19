const systemPrompt = [
  "You are Proofline Autopilot, a non-partisan research agent for Japanese parliamentary records.",
  "Use only the supplied official records. Never add outside facts or infer a verdict.",
  "Every key point must cite one or more supplied recordId values.",
  "Move anything unsupported into unresolvedQuestions.",
  "Return Japanese JSON only, with no Markdown fences.",
].join("\n");

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function readRequest(event) {
  const raw = Buffer.isBuffer(event) ? event.toString("utf8") : String(event || "{}");
  const envelope = JSON.parse(raw);
  const headers = envelope.headers || {};
  const body = typeof envelope.body === "string" ? JSON.parse(envelope.body) : envelope.body || envelope;
  return { headers, body };
}

function extractJson(value) {
  const normalized = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Qwen returned no JSON object");
    return JSON.parse(normalized.slice(start, end + 1));
  }
}

export const handler = async (event) => {
  try {
    const { headers, body } = readRequest(event);
    const expectedSecret = process.env.PROOFLINE_SERVICE_SECRET;
    const suppliedSecret = headers["x-proofline-service-key"] || headers["X-Proofline-Service-Key"];
    if (expectedSecret && suppliedSecret !== expectedSecret) return httpResponse(401, { error: "Unauthorized" });
    if (!body.keyword || !Array.isArray(body.records) || !body.records.length) {
      return httpResponse(400, { error: "keyword and records are required" });
    }

    const baseUrl = String(process.env.QWEN_BASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
    const model = process.env.QWEN_MODEL || "qwen3.7-plus";
    if (!baseUrl || !apiKey) return httpResponse(500, { error: "Qwen Cloud is not configured" });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1200,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Research topic: ${body.keyword}\nInput title: ${body.sourceTitle}\nOutput contract: ${JSON.stringify(body.outputContract)}\nOfficial records: ${JSON.stringify(body.records)}` },
        ],
      }),
    });
    if (!response.ok) return httpResponse(502, { error: "Qwen Cloud request failed", status: response.status });
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return httpResponse(502, { error: "Qwen Cloud returned no content" });
    const analysis = extractJson(content);
    return httpResponse(200, {
      analysis,
      model,
      runtime: "Alibaba Cloud Function Compute",
      region: process.env.ALIBABA_CLOUD_REGION || "ap-southeast-1",
    });
  } catch (error) {
    console.error(error);
    return httpResponse(500, {
      error: "Autopilot analysis failed",
      detail: error instanceof Error ? error.message.slice(0, 180) : "Unknown error",
    });
  }
};
