"use client";

import { useMemo, useRef, useState } from "react";

type Evidence = {
  id: string;
  kind: "音声" | "PDF" | "表計算" | "画像";
  name: string;
  detail: string;
  status: "解析済み" | "待機中";
  color: string;
};

type ResearchResult = {
  sourceTitle: string;
  sourceUrl?: string | null;
  keyword: string;
  total: number;
  searched: string[];
  needsConfirmation?: boolean;
  message?: string;
  originalKeyword?: string;
  fallbackUsed?: boolean;
  attempted?: string[];
  analysisEngine?: "qwen" | "rules";
  agentRun?: {
    id: string;
    status: "awaiting-human-approval";
    provider: "alibaba-function-compute" | "qwen-cloud-direct" | "deterministic-fallback";
    model: string | null;
    stages: Array<{ id: string; label: string; status: "completed" | "pending"; count?: number; engine?: string }>;
  };
  aiAnalysis?: {
    engine: "qwen";
    model: string;
    provider: "alibaba-function-compute" | "qwen-cloud-direct";
    executiveSummary: string;
    centralQuestion: string;
    evidenceStrength: "強い" | "限定的" | "不十分";
    keyPoints: Array<{ type: string; headline: string; summary: string; significance: string; recordIds: string[] }>;
    unresolvedQuestions: string[];
    sourceCoverage: string;
  } | null;
  records: Array<{ id: string; issueId?:string; speechOrder?:number; house: string; meeting: string; date: string; speaker: string; group?: string | null; excerpt: string; speechChars?: number; briefType?: string; briefHeadline?: string; briefText?: string; briefQuote?: string; url: string; relevance: "高" | "中"; matchReason: string }>;
};
type ExchangeResult = { found:boolean; message?:string; meeting?:string; date?:string; assessment?:string; note?:string; question?:{ speaker:string; position?:string|null; text:string; url:string }; answer?:{ speaker:string; position?:string|null; text:string; url:string } };
type MemberResult = { speaker: string; group?: string | null; total: number; samplePeriod: string; meetings: string[]; topics: string[]; categories: Array<{ name: string; count: number }>; activitySummary: string; constituency: string; officialUrl?: string | null; hasMore: boolean; recent: Array<{ id: string; date: string; house: string; meeting: string; text: string; url: string }> };
type BillLookup = {
  matched: boolean;
  matches: Array<{ session: string; number: string; title: string; status: string; progressUrl?: string; textUrl?: string; progress?: { proposer?: string; proposerGroups?: string; supportGroups?: string[]; opposeGroups?: string[]; lawNumber?: string; timeline: Array<{ date: string; title: string; detail: string; chamber: string }> } | null }>;
  source: { name: string; url: string; note: string };
  additionalSources: Array<{ name: string; url: string; note: string }>;
  checkedAt: string;
};

const initialEvidence: Evidence[] = [
  { id: "audio-01", kind: "音声", name: "市長定例会見_2026-04-03.wav", detail: "12分18秒 · 発言者2名 · 42件の主張", status: "解析済み", color: "#7357ff" },
  { id: "pdf-01", kind: "PDF", name: "子育て支援事業_報道発表.pdf", detail: "8ページ · 令和8年4月1日", status: "解析済み", color: "#e9684a" },
  { id: "sheet-01", kind: "表計算", name: "令和8年度_事業予算.xlsx", detail: "3シート · 284セル", status: "解析済み", color: "#1d9272" },
  { id: "image-01", kind: "画像", name: "住民向け事業案内.png", detail: "2400 × 1600 · OCR済み", status: "解析済み", color: "#d49721" },
];

const findings = [
  {
    severity: "重要",
    title: "事業開始日に3つの異なる記録",
    summary: "同じ子育て支援事業について、開始時期が「7月」「9月」「令和9年度」と記録されています。",
    sources: [
      { label: "市長会見", quote: "今年7月から、対象世帯への支援を開始します。", anchor: "08:42–08:49", color: "#7357ff" },
      { label: "報道発表", quote: "事業開始予定：令和8年9月1日", anchor: "p.2", color: "#e9684a" },
      { label: "予算表", quote: "実施期間：令和9年度 第1四半期", anchor: "事業一覧!F18", color: "#1d9272" },
    ],
  },
  {
    severity: "確認",
    title: "対象世帯数の差異",
    summary: "会見では約12,000世帯、予算資料では8,500世帯とされています。定義の違いを確認してください。",
    sources: [
      { label: "市長会見", quote: "およそ一万二千世帯を対象としています。", anchor: "09:13–09:19", color: "#7357ff" },
      { label: "予算表", quote: "給付見込世帯数：8,500", anchor: "積算根拠!C7", color: "#1d9272" },
    ],
  },
];

export default function Home() {
  const [evidence, setEvidence] = useState(initialEvidence);
  const [activeFinding, setActiveFinding] = useState(0);
  const [selectedSource, setSelectedSource] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [publicInput, setPublicInput] = useState("");
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [researchError, setResearchError] = useState("");
  const [showSample, setShowSample] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "timeline" | "statements" | "sources">("overview");
  const [statementQuery, setStatementQuery] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [member, setMember] = useState<MemberResult | null>(null);
  const [memberLoading, setMemberLoading] = useState("");
  const [memberSpeechQuery, setMemberSpeechQuery] = useState("");
  const [exchange, setExchange] = useState<ExchangeResult | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState("");
  const [billLookup, setBillLookup] = useState<BillLookup | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reviewApproved, setReviewApproved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = findings[activeFinding];
  const progress = useMemo(() => Math.round((evidence.filter((x) => x.status === "解析済み").length / evidence.length) * 100), [evidence]);
  const researchSummary = useMemo(() => {
    if (!research || research.needsConfirmation || !research.records.length) return null;
    const houses = Array.from(new Set(research.records.map((x) => x.house)));
    const meetings = Array.from(new Set(research.records.map((x) => x.meeting)));
    const speakers = Array.from(new Set(research.records.map((x) => `${x.speaker}${x.group ? `（${x.group}）` : ""}`)));
    const dates = research.records.map((x) => x.date).sort();
    const speakerStats = Array.from(new Set(research.records.map((x) => x.speaker))).map((speaker) => { const chars = research.records.filter((x) => x.speaker === speaker).reduce((sum, x) => sum + (x.speechChars || x.excerpt.length), 0); return { speaker, chars, minutes: Math.max(1, Math.round(chars / 300)) }; }).sort((a, b) => b.chars - a.chars);
    const totalChars = speakerStats.reduce((sum, item) => sum + item.chars, 0);
    const pieColors = ["#0d6b5a", "#51a38b", "#e4a23b", "#d66b55", "#7967b1", "#4e86a6", "#9aaf55", "#a66d91"];
    let pieCursor = 0;
    const pieGradient = `conic-gradient(${speakerStats.map((item, index) => { const start = pieCursor; pieCursor += item.chars / totalChars * 100; return `${pieColors[index % pieColors.length]} ${start}% ${pieCursor}%`; }).join(",")})`;
    const cleanSentence = (value: string) => value
      .replace(/^…/, "")
      .replace(/^(?:えー|あの|その|そして|また|しかし|そこで|ということで|まず|今、|…)+/g, "")
      .replace(/^[、。・\s]+/, "")
      .trim();
    const rulesPoints = research.records.map((record) => ({ speaker: record.speaker, type: record.briefType || "論点", headline: record.briefHeadline || `${research.keyword}に関する発言`, text: record.briefText || cleanSentence(record.excerpt), significance: "", quote: record.briefQuote || record.excerpt, url: record.url, meeting: record.meeting, date: record.date }))
      .filter((point, index, all) => all.findIndex((other) => other.type === point.type) === index).slice(0, 3);
    const aiPoints = research.aiAnalysis?.keyPoints.map((point) => {
      const source = research.records.find((record) => point.recordIds.includes(record.id)) || research.records[0];
      return { speaker: source.speaker, type: point.type, headline: point.headline, text: point.summary, significance: point.significance, quote: source.briefQuote || source.excerpt, url: source.url, meeting: source.meeting, date: source.date };
    }).slice(0, 4);
    const points = aiPoints?.length ? aiPoints : rulesPoints;
    return {
      overview: research.aiAnalysis?.executiveSummary || `${research.total.toLocaleString()}件が検索に一致し、原文を確認できる${research.records.length}件を取得。${houses.join("・")}の${meetings.length}会議、${speakers.length}名の発言を整理しました。`,
      centralQuestion: research.aiAnalysis?.centralQuestion || `${research.keyword}について、国会で何が問われ、どこまで回答されたか。`,
      evidenceStrength: research.aiAnalysis?.evidenceStrength || "限定的",
      unresolvedQuestions: research.aiAnalysis?.unresolvedQuestions?.length
        ? research.aiAnalysis.unresolvedQuestions
        : [
            `${research.keyword}について、政府が最終的に採用した方針と実施時期は何か。`,
            "確認した発言の後に、法案・予算・行政措置へ反映されたか。",
            "対象範囲、費用、責任主体などの実施条件は確定しているか。",
            "反対意見や代替案に対する政府の最終回答は示されたか。",
          ],
      sourceCoverage: research.aiAnalysis?.sourceCoverage || "取得した国会会議録の範囲を整理しています。",
      analysisEngine: research.aiAnalysis?.engine || "rules",
      period: dates.length ? `${dates[0]}〜${dates[dates.length - 1]}` : "不明",
      meetings: meetings.slice(0, 3),
      speakers: speakers.slice(0, 4),
      keyPoints: points,
      speakerStats: speakerStats.map((item, index) => ({ ...item, color: pieColors[index % pieColors.length] })), totalChars, estimatedMinutes: Math.max(1, Math.round(totalChars / 300)), pieGradient,
    };
  }, [research]);
  const liveCase = research && !research.needsConfirmation;
  const liveSource = liveCase ? research.records[0] : null;
  const filteredMemberRecords = useMemo(() => member?.recent.filter((item) => !memberSpeechQuery.trim() || `${item.meeting} ${item.text} ${item.date}`.includes(memberSpeechQuery.trim())) || [], [member, memberSpeechQuery]);

  function acceptFiles(files: FileList | null) {
    if (!files?.length) return;
    const additions: Evidence[] = Array.from(files).map((file, index) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const kind: Evidence["kind"] = ["wav", "mp3", "m4a", "mp4"].includes(ext || "") ? "音声" : ["xls", "xlsx", "csv"].includes(ext || "") ? "表計算" : ext === "pdf" ? "PDF" : "画像";
      return { id: `upload-${Date.now()}-${index}`, kind, name: file.name, detail: `${(file.size / 1024 / 1024).toFixed(1)} MB · 解析待ち`, status: "待機中", color: "#70808c" };
    });
    setEvidence((current) => [...additions, ...current]);
    setNotice(`${additions.length}件を受け付けました。解析キューに追加しています。`);
  }

  async function researchPublicRecord(overrideInput?: string) {
    const query = (overrideInput ?? publicInput).trim();
    if (!query) return;
    if (overrideInput) setPublicInput(overrideInput);
    setActiveTab("overview"); setStatementQuery(""); setMember(null); setBillLookup(null); setReportOpen(false); setReviewApproved(false);
    if (!/^https?:\/\//i.test(query) && /^[一-龠々ぁ-んァ-ヶー\s　]{3,12}$/.test(query) && !/(法|制度|政策|予算|規制|対策|支援|構想|法案)$/.test(query)) {
      setResearch(null); setShowSample(false); await researchMember(query.replace(/[ 　]/g, "")); return;
    }
    setShowSample(false);
    setResearching(true); setResearchError(""); setResearch(null);
    try {
      const response = await fetch(`/api/research?input=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "調査を開始できませんでした。");
      setResearch(data);
      if (!data.needsConfirmation) {
        setBillLoading(true);
        fetch(`/api/bills?keyword=${encodeURIComponent(data.keyword)}&title=${encodeURIComponent(data.sourceTitle || data.keyword)}`)
          .then((billResponse) => billResponse.json())
          .then((billData) => setBillLookup(billData))
          .catch(() => setBillLookup(null))
          .finally(() => setBillLoading(false));
      }
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "調査を開始できませんでした。");
    } finally { setResearching(false); }
  }
  async function researchMember(speaker: string, append = false) {
    if (!append) setActiveTab("overview");
    setMemberLoading(speaker); if (!append) { setMember(null); setMemberSpeechQuery(""); }
    try { const start = append && member ? member.recent.length + 1 : 1; const response = await fetch(`/api/member?speaker=${encodeURIComponent(speaker)}&start=${start}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMember((current) => append && current ? { ...data, recent: [...current.recent, ...data.recent], categories: current.categories, activitySummary: current.activitySummary, samplePeriod: `${data.samplePeriod.split("〜")[0]}〜${current.samplePeriod.split("〜").at(-1)}` } : data); }
    catch (error) { setResearchError(error instanceof Error ? error.message : "議員の活動を取得できませんでした。"); }
    finally { setMemberLoading(""); }
  }
  async function loadExchange(record: ResearchResult["records"][number]) {
    if (!record.issueId || record.speechOrder === undefined) return;
    setExchangeLoading(record.id); setExchange(null);
    try { const response = await fetch(`/api/exchange?issueID=${encodeURIComponent(record.issueId)}&speechOrder=${record.speechOrder}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setExchange(data); setTimeout(() => document.querySelector(".exchange-panel")?.scrollIntoView({ behavior:"smooth", block:"start" }), 80); }
    catch (error) { setResearchError(error instanceof Error ? error.message : "答弁を取得できませんでした。"); }
    finally { setExchangeLoading(""); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>Proofline</span><em>Qwen Autopilot</em></div>
        <div className="top-actions"><button className="ghost" onClick={async () => { await navigator.clipboard.writeText(window.location.href); setActionNotice("URLをコピーしました"); setTimeout(() => setActionNotice(""), 1800); }}>共有</button><button className="primary" onClick={() => { if (liveCase && researchSummary && reviewApproved) setReportOpen(true); else { setActionNotice(liveCase ? "根拠レビューを承認してからレポートを作成してください" : "先に公式記録を調査してください"); setTimeout(() => setActionNotice(""), 2200); } }}>承認済みレポート</button></div>
      </header>
      {actionNotice && <div className="action-toast" role="status">{actionNotice}</div>}
      {liveCase && researchSummary && reportOpen && <section className="report-overlay" role="dialog" aria-modal="true" aria-label={`${research.keyword}の調査レポート`}>
        <div className="report-sheet">
          <header className="report-toolbar"><div><span>PROOFLINE VERIFIED REPORT</span><strong>根拠付き調査レポート</strong></div><div><button onClick={() => window.print()}>印刷・PDF保存</button><button className="report-close" onClick={() => setReportOpen(false)}>閉じる ×</button></div></header>
          <div className="report-cover"><div><p>PUBLIC RECORD RESEARCH</p><h1>{research.keyword}</h1><span>{research.sourceTitle}</span></div><aside><small>作成日</small><strong>{new Date().toLocaleDateString("ja-JP")}</strong><small>確認した公式発言</small><strong>{research.records.length}件</strong></aside></div>
          <section className="report-summary"><span>EXECUTIVE SUMMARY</span><h2>{billLookup?.matches[0] ? `${billLookup.matches[0].status}の法案と、関連する国会発言を確認` : "関連する国会発言を公式会議録で確認"}</h2><p>{researchSummary.overview}</p></section>
          <div className="report-metrics"><article><span>検索一致</span><strong>{research.total.toLocaleString()}件</strong></article><article><span>取得原文</span><strong>{research.records.length}件</strong></article><article><span>収録期間</span><strong>{researchSummary.period}</strong></article><article><span>推定審議時間</span><strong>約{researchSummary.estimatedMinutes}分</strong></article></div>
          <section className="report-section"><header><span>01</span><h2>確認できた主要論点</h2></header><div className="report-points">{researchSummary.keyPoints.map((point, index) => <article key={`report-${point.speaker}-${index}`}><b>{point.type}</b><div><h3>{point.headline}</h3><p>{point.text}</p><a href={point.url}>{point.speaker} · {point.meeting} · 原文</a></div></article>)}</div></section>
          {billLookup?.matches[0] && <section className="report-section"><header><span>02</span><h2>法案の現在地</h2></header><div className="report-bill"><div><span>第{billLookup.matches[0].session}回国会 · 議案{billLookup.matches[0].number}</span><h3>{billLookup.matches[0].title}</h3><b>{billLookup.matches[0].status}</b></div><ol>{billLookup.matches[0].progress?.timeline.map((event, index) => <li key={`report-event-${index}`}><time>{event.date}</time><strong>{event.title}</strong><span>{event.chamber}{event.detail ? ` · ${event.detail}` : ""}</span></li>)}</ol></div></section>}
          <section className="report-section"><header><span>{billLookup?.matches[0] ? "03" : "02"}</span><h2>検証可能な出典</h2></header><div className="report-sources">{research.sourceUrl && <a href={research.sourceUrl}><b>ニュース記事</b><span>{research.sourceTitle}</span></a>}<a href="https://kokkai.ndl.go.jp/"><b>国会会議録検索システム</b><span>{research.records.length}件の発言原文を取得</span></a>{billLookup?.matches[0]?.progressUrl && <a href={billLookup.matches[0].progressUrl}><b>衆議院 議案審議経過情報</b><span>法案の提出・審議・採決状況</span></a>}</div></section>
          <footer className="report-foot"><b>Proofline Qwen Autopilot</b><span>人による承認済み · 要約は判断の代替ではありません。結論は必ずリンク先の公式原文で確認してください。</span></footer>
        </div>
      </section>}

      <section className="case-head">
        <div>
          <p className="eyebrow">{liveCase ? "AUTOPILOT PUBLIC RECORD CASE" : showSample ? "SAMPLE PUBLIC RECORD CASE · PL-2026-004" : "QWEN-POWERED PUBLIC RECORD AUTOPILOT"}</p>
          <h1>{liveCase ? research.keyword : showSample ? "青波市 子育て支援事業" : "公開記録を調査"}</h1>
          <p className="subcopy">{liveCase ? "ニュースを入口に、関連する国会会議録と発言の原典を追跡しています。" : showSample ? "公開記録に含まれる主張を比較し、すべての発見を原典まで追跡できます。" : "ニュースURLまたは法案名から、背後にある公式記録と国会発言を探します。"}</p>
        </div>
        {(liveCase || showSample) && <div className="trust-score"><span>{liveCase ? "公式記録の取得" : "出典カバレッジ"}</span><strong>{liveCase ? `${research.records.length}件` : `${progress}%`}</strong><div><i style={{ width: liveCase ? "100%" : `${progress}%` }} /></div></div>}
      </section>

      <nav className="tabs"><button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>概要</button><button className={activeTab === "timeline" ? "active" : ""} onClick={() => setActiveTab("timeline")}>タイムライン</button><button className={activeTab === "statements" ? "active" : ""} onClick={() => setActiveTab("statements")}>{liveCase ? "公式発言" : showSample ? "すべての主張" : "公式発言"} {(liveCase || showSample) && <b>{liveCase ? research.records.length : 57}</b>}</button><button className={activeTab === "sources" ? "active" : ""} onClick={() => setActiveTab("sources")}>資料 {(liveCase || showSample) && <b>{liveCase ? (research.sourceUrl ? 2 : 1) + (billLookup ? 2 : 0) : evidence.length}</b>}</button></nav>

      <section className="public-research">
        <div className="research-copy"><p className="eyebrow">PUBLIC SOURCE DISCOVERY</p><h2>ニュース・法案・議員から公式記録を探す</h2><p>URL、法案名、議員名から国会会議録と活動記録を検索します。</p></div>
        <div className="research-form"><input value={publicInput} onChange={(e) => setPublicInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") researchPublicRecord(); }} placeholder="ニュースURL・法案名・議員名" aria-label="ニュースURL、法案名または議員名" /><button onClick={() => researchPublicRecord()} disabled={researching || !!memberLoading || !publicInput.trim()}>{researching || memberLoading ? "公式記録を検索中…" : "公式記録を調査"}</button></div>
        {!liveCase && <div className="demo-cases"><span>ライブデモ（約90秒）</span>{["副首都構想", "防災庁設置法案", "高額療養費制度"].map((demo, index) => <button className={index === 0 ? "featured" : ""} key={demo} onClick={() => researchPublicRecord(demo)} disabled={researching}>{demo}<b>→</b></button>)}</div>}
        {(researching || billLoading) && <div className="research-progress" role="status" aria-live="polite"><header><span className="progress-spinner" /><div><b>{researching ? "公式記録を横断検索しています" : "法案本文と審議経過を照合しています"}</b><small>推測ではなく、取得できた原文だけを表示します</small></div></header><div><article className={researching ? "current" : "done"}><i>{researching ? "1" : "✓"}</i><span>テーマを特定</span></article><article className={researching ? "queued" : "done"}><i>{researching ? "2" : "✓"}</i><span>国会発言を取得</span></article><article className={billLoading ? "current" : "queued"}><i>3</i><span>法案経過を照合</span></article></div></div>}
        {researchError && <p className="research-error">{researchError}</p>}
        {member && <div className="speech-finder"><div><input value={memberSpeechQuery} onChange={(e) => setMemberSpeechQuery(e.target.value)} placeholder="発言内容・委員会名・日付で絞り込み" /><span>{filteredMemberRecords.length} / {member.recent.length}件</span></div>{memberSpeechQuery && <div className="speech-filter-results">{filteredMemberRecords.map((item) => <a key={`filter-${item.id}`} href={item.url} target="_blank" rel="noreferrer"><b>{item.date} · {item.meeting}</b><p>{item.text}…</p></a>)}</div>}<button disabled={!!memberLoading || !member.hasMore} onClick={() => researchMember(member.speaker, true)}>{memberLoading ? "追加取得中…" : member.hasMore ? "さらに20件を取得" : "取得できる発言をすべて表示しました"}</button></div>}
        {member && !research && <section className="member-profile direct-member"><div className="member-profile-head"><div><span>MEMBER ACTIVITY</span><h2>{member.speaker}{member.group ? ` · ${member.group}` : ""}</h2><p>{member.constituency} · 国会会議録に基づく活動サマリー</p></div><button onClick={() => setMember(null)}>閉じる ×</button></div><p className="activity-summary">{member.activitySummary}</p><div className="member-stats"><article><span>会議録の発言総数</span><strong>{member.total.toLocaleString()}件</strong></article><article><span>今回の取得期間</span><strong>{member.samplePeriod}</strong></article><article><span>選挙区</span><strong>{member.constituency}</strong>{member.officialUrl && <a href={member.officialUrl} target="_blank" rel="noreferrer">公式プロフィール ↗</a>}</article></div><div className="member-topics"><span>政策分野（直近取得分）</span>{member.categories.map((item) => <b key={item.name}>{item.name} {item.count}</b>)}</div><h3>最近取得した発言</h3><div className="member-recent">{member.recent.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.date} · {item.house} · {item.meeting}</span><p>{item.text}…</p><b>原文を確認 ↗</b></a>)}</div></section>}
        {research?.needsConfirmation && <div className="confirmation-box"><strong>検索テーマを確認してください</strong><p>{research.message}</p><div><span>ページから取得した情報</span><b>{research.sourceTitle}</b></div><button onClick={() => { setPublicInput(research.sourceTitle); setResearch(null); }}>記事タイトルを入力欄へ移す</button></div>}
        {research && !research.needsConfirmation && <div className={`research-result tab-${activeTab}`}>
          <div className="result-head"><div><span>検索テーマ</span><strong>{research.keyword}</strong></div><div><span>公式会議録</span><strong>{research.total.toLocaleString()}件</strong></div><div><span>今回取得</span><strong>{research.records.length}件</strong></div><small>検索元：{research.searched.join("、")}</small></div>
          {research.fallbackUsed && <p className="fallback-note">記事の表現「{research.originalKeyword}」では見つからなかったため、中心語「{research.keyword}」まで段階的に広げて確認しました。</p>}
          {research.records.length === 0 && <div className="zero-result"><strong>国会会議録では該当発言を確認できませんでした</strong><p>これは「情報が存在しない」という意味ではありません。表記の違い、会議録への未収録、国会以外の資料に掲載されている可能性があります。</p><div><button onClick={() => { setPublicInput(research.keyword.replace(/(?:法律案|改正案|法案|対策|制度)$/g, "")); setResearch(null); }}>検索語を短くして再試行</button><a href="https://kokkai.ndl.go.jp/" target="_blank" rel="noreferrer">公式サイトで詳細検索 ↗</a></div></div>}
          {research.agentRun && <section className="agent-run"><header><div><span>AUTOPILOT RUN</span><strong>公式記録の取得から根拠検証までを実行</strong></div><b>{research.agentRun.model || "rules fallback"}</b></header><div>{research.agentRun.stages.map((stage, index) => <article className={stage.status} key={stage.id}><i>{stage.status === "completed" ? "✓" : index + 1}</i><span>{stage.label}</span></article>)}</div><footer><p>Qwenの出力は根拠IDと照合済みです。公開前に人が原文と未回答事項を確認します。</p><button className={reviewApproved ? "approved" : ""} onClick={() => setReviewApproved((value) => !value)}>{reviewApproved ? "✓ 人によるレビュー承認済み" : "原文を確認し、レポートを承認"}</button></footer></section>}
          {researchSummary && <div className="briefing-overview">
            <article className="briefing-main"><div className="briefing-kicker"><span>ISSUE BRIEF</span><b className={researchSummary.analysisEngine === "qwen" ? "ai-live" : "ai-fallback"}>{researchSummary.analysisEngine === "qwen" ? `QWEN · 原文限定` : "原文ルール分析"}</b></div><h3>{researchSummary.centralQuestion}</h3><ul>{researchSummary.keyPoints.map((point) => <li key={`${point.speaker}-${point.text}`}><b>{point.type}</b><div><strong>{point.headline}</strong><p>{point.text}</p>{point.significance && <em>なぜ重要か：{point.significance}</em>}<small>{point.speaker} · {point.meeting}</small></div></li>)}</ul><div className="briefing-disclaimer">根拠強度：{researchSummary.evidenceStrength} · 発言原文へのリンクを保持</div></article>
            <aside className="briefing-side">
              <div className="briefing-stats"><article><span>収録期間</span><strong>{researchSummary.period}</strong><small>取得した発言の範囲</small></article><article><span>関連する会議</span><strong>{researchSummary.meetings.length}件</strong><small>{researchSummary.meetings.join(" / ")}</small></article><article><span>主な発言者</span><strong>{researchSummary.speakers.length}名</strong><small>{researchSummary.speakers.join(" / ")}</small></article></div>
              {researchSummary.unresolvedQuestions.length > 0 && <section className="open-questions"><div><span>OPEN QUESTIONS</span><h3>公式記録だけでは、まだ断定できないこと</h3></div><ol>{researchSummary.unresolvedQuestions.map((question, index) => <li key={`${question}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><p>{question}</p></li>)}</ol><small>{researchSummary.sourceCoverage}</small></section>}
            </aside>
          </div>}
          {researchSummary && <div className="research-visuals"><article><div><span>推定審議時間（取得発言分）</span><strong>約{researchSummary.estimatedMinutes}分</strong><small>取得した発言全文 {researchSummary.totalChars.toLocaleString()}文字 ÷ 300字/分</small></div><div className="donut"><b>{research.records.length}</b><small>発言</small></div></article><article className="speaker-pie-card"><div className="speaker-pie" style={{ background: researchSummary.pieGradient }} /><div><span>発言者別の発言量</span><div className="pie-legend">{researchSummary.speakerStats.map((item) => <p key={item.speaker}><i style={{ background:item.color }} /><b>{item.speaker}</b><small>{Math.round(item.chars / researchSummary.totalChars * 100)}% · 約{item.minutes}分</small></p>)}</div></div></article></div>}
          {researchSummary && <section className="legislative-path">
            <div className="legislative-head"><div><span>OFFICIAL LEGISLATIVE TRACE</span><h3>発言の先にある法案情報まで確認</h3><p>国会会議録と法案本文・審議経過・現行法令を分けて追跡します。</p></div><b className={billLookup?.matched ? "verified" : ""}>{billLoading ? "公式情報を照合中" : billLookup?.matched ? "法案候補を照合済み" : "法案候補は未特定"}</b></div>
            <div className="legislative-flow">
              <article className="complete"><i>1</i><div><span>国会発言</span><strong>{research.records.length}件の原文を取得</strong><small>国会会議録検索システム</small></div></article>
              <em>→</em>
              <article className={billLookup?.matched ? "complete" : "pending"}><i>2</i><div><span>法案本文・審議経過</span><strong>{billLoading ? "公式情報を確認しています" : billLookup?.matched ? `${billLookup.matches.length}件の候補` : "一致する議案を未確認"}</strong><small>衆議院 議案情報</small></div></article>
              <em>→</em>
              <article className="pending"><i>3</i><div><span>成立・施行後</span><strong>現行法令を確認</strong><small>日本法令索引・e-Gov法令検索</small></div></article>
            </div>
            {billLookup?.matched && <div className="bill-matches">{billLookup.matches.map((bill) => <article key={`${bill.session}-${bill.number}-${bill.title}`}><div><span>第{bill.session}回国会 · 議案{bill.number}</span><b>{bill.status}</b></div><h4>{bill.title}</h4><footer>{bill.progressUrl && <a href={bill.progressUrl} target="_blank" rel="noreferrer">審議経過を開く ↗</a>}{bill.textUrl && <a href={bill.textUrl} target="_blank" rel="noreferrer">法案本文を開く ↗</a>}</footer></article>)}</div>}
            {billLookup?.matches[0]?.progress?.timeline?.length ? <section className="official-bill-progress">
              <header><div><span>VERIFIED BILL PROGRESS</span><h4>{billLookup.matches[0].title}</h4><p>{billLookup.matches[0].progress?.proposerGroups || billLookup.matches[0].progress?.proposer || "提出者情報は公式ページで確認"}</p></div><b>{billLookup.matches[0].status}</b></header>
              <div className="bill-progress-grid">{billLookup.matches[0].progress!.timeline.map((event, index, events) => <article key={`${event.date}-${event.title}-${index}`} className={index === events.length - 1 ? "latest" : "done"}><i>{index + 1}</i><div><time>{event.date}</time><strong>{event.title}</strong><span>{event.chamber}{event.detail ? ` · ${event.detail}` : ""}</span></div></article>)}</div>
              {(billLookup.matches[0].progress?.supportGroups?.length || billLookup.matches[0].progress?.opposeGroups?.length) ? <div className="vote-balance"><div className="support"><span>衆議院で賛成</span><strong>{billLookup.matches[0].progress?.supportGroups?.length || 0}会派</strong><p>{billLookup.matches[0].progress?.supportGroups?.join("、")}</p></div><div className="oppose"><span>衆議院で反対</span><strong>{billLookup.matches[0].progress?.opposeGroups?.length || 0}会派</strong><p>{billLookup.matches[0].progress?.opposeGroups?.join("、")}</p></div></div> : null}
              <footer><span>衆議院「議案審議経過情報」から取得</span>{billLookup.matches[0].progressUrl && <a href={billLookup.matches[0].progressUrl} target="_blank" rel="noreferrer">公式の審議経過を確認 ↗</a>}</footer>
            </section> : null}
            {!billLoading && !billLookup?.matched && <div className="bill-unmatched"><div><strong>現在のテーマから議案を一意に特定できませんでした</strong><p>似た名称を推測表示せず、公式データベースで確認できる入口を示します。</p></div><div>{(billLookup?.additionalSources || [{ name:"日本法令索引", url:"https://hourei.ndl.go.jp/", note:"法令・法案の沿革を確認" }, { name:"衆議院 議案情報", url:"https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm", note:"法案本文と審議経過を確認" }]).slice(0,2).map((source) => <a key={source.name} href={source.url} target="_blank" rel="noreferrer"><b>{source.name}</b><small>{source.note}</small><span>公式サイト ↗</span></a>)}</div></div>}
          </section>}
          {research.records.some((record) => record.issueId) && <section className="qa-feature"><div className="qa-feature-copy"><span>NEW · QUESTION → ANSWER</span><h3>質問だけでなく、政府の答弁まで追う</h3><p>同じ会議録の発言順から、質問と直後の答弁を対応付けます。留保された回答も判別します。</p></div><div className="qa-feature-actions">{research.records.filter((record) => record.issueId).slice(0,3).map((record) => <button key={`qa-${record.id}`} disabled={exchangeLoading === record.id} onClick={() => loadExchange(record)}><i>Q</i><span><b>{record.speaker}</b><small>{record.meeting}</small></span><em>{exchangeLoading === record.id ? "取得中…" : "答弁を確認 →"}</em></button>)}</div></section>}
          <div className="record-grid">{research.records.slice(0, 4).map((record) => <article key={record.id} className="record-card"><div><span>{record.house}</span><time>{record.date}</time></div><button className="member-search" onClick={() => researchMember(record.speaker)}>{memberLoading === record.speaker ? "活動を検索中…" : `${record.speaker}${record.group ? ` · ${record.group}` : ""} の活動を見る`}</button><small>{record.meeting}</small><p>{record.excerpt}…</p><em>関連度 {record.relevance} · {record.matchReason}</em><a href={record.url} target="_blank" rel="noreferrer">公式会議録で原文を開く ↗</a></article>)}</div>
          {member && <section className="member-profile"><div className="member-profile-head"><div><span>MEMBER ACTIVITY</span><h2>{member.speaker}{member.group ? ` · ${member.group}` : ""}</h2><p>{member.constituency} · 国会会議録に基づく活動サマリー</p></div><button onClick={() => setMember(null)}>閉じる ×</button></div><p className="activity-summary">{member.activitySummary}</p><div className="member-stats"><article><span>会議録の発言総数</span><strong>{member.total.toLocaleString()}件</strong></article><article><span>今回の取得期間</span><strong>{member.samplePeriod}</strong></article><article><span>選挙区</span><strong>{member.constituency}</strong>{member.officialUrl && <a href={member.officialUrl} target="_blank" rel="noreferrer">公式プロフィール ↗</a>}</article></div><div className="member-topics"><span>政策分野（直近取得分）</span>{member.categories.map((item) => <b key={item.name}>{item.name} {item.count}</b>)}</div><h3>最近取得した発言</h3><div className="member-recent">{member.recent.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.date} · {item.house} · {item.meeting}</span><p>{item.text}…</p><b>原文を確認 ↗</b></a>)}</div></section>}
        </div>}
      </section>

      {liveCase && activeTab === "timeline" && <section className="tab-panel timeline-panel"><div className="tab-panel-head"><div><p className="eyebrow">CHRONOLOGY</p><h2>発言タイムライン</h2></div><span>{research.records.length}件の公式発言</span></div><div className="timeline-list">{[...research.records].sort((a,b) => a.date.localeCompare(b.date)).map((record) => <article key={`time-${record.id}`}><time>{record.date}</time><i /><div><span>{record.house} · {record.meeting}</span><h3>{record.speaker}{record.group ? ` · ${record.group}` : ""}</h3><p>{record.excerpt}…</p><a href={record.url} target="_blank" rel="noreferrer">原文を確認 ↗</a></div></article>)}</div></section>}
      {liveCase && activeTab === "statements" && <section className="tab-panel statements-panel"><div className="tab-panel-head"><div><p className="eyebrow">OFFICIAL STATEMENTS</p><h2>取得した公式発言</h2></div><span>{research.records.length}件</span></div><div className="tab-search"><input value={statementQuery} onChange={(e) => setStatementQuery(e.target.value)} placeholder="発言者・委員会・本文を検索" /><small>原文リンク付き</small></div><div className="statement-list">{research.records.filter((record) => !statementQuery || `${record.speaker} ${record.meeting} ${record.excerpt}`.includes(statementQuery)).map((record) => <article key={`statement-${record.id}`}><div><b>{record.speaker}</b><span>{record.group || "所属情報なし"}</span><time>{record.date}</time></div><small>{record.house} · {record.meeting}</small><p>{record.excerpt}…</p><footer><div><button className="exchange-button" disabled={exchangeLoading === record.id} onClick={() => loadExchange(record)}>{exchangeLoading === record.id ? "答弁取得中…" : "対応する答弁を見る"}</button><button onClick={() => researchMember(record.speaker)}>議員活動</button></div><a href={record.url} target="_blank" rel="noreferrer">原文を開く ↗</a></footer></article>)}</div></section>}
      {exchange && <section className="exchange-panel"><div className="exchange-head"><div><p className="eyebrow">QUESTION → ANSWER</p><h2>質疑と答弁の対応</h2><span>{exchange.meeting} · {exchange.date}</span></div><button onClick={() => setExchange(null)}>閉じる ×</button></div>{exchange.found && exchange.question && exchange.answer ? <><div className="exchange-flow"><article><span>質問・要求</span><h3>{exchange.question.speaker}</h3><small>{exchange.question.position}</small><p>{exchange.question.text}…</p><a href={exchange.question.url} target="_blank" rel="noreferrer">質問原文 ↗</a></article><i>→</i><article className="answer-card"><span>政府・答弁側</span><h3>{exchange.answer.speaker}</h3><small>{exchange.answer.position}</small><p>{exchange.answer.text}…</p><a href={exchange.answer.url} target="_blank" rel="noreferrer">答弁原文 ↗</a></article></div><div className={`exchange-assessment ${exchange.assessment === "継続確認が必要" ? "pending" : "confirmed"}`}><b>{exchange.assessment}</b><p>{exchange.note}</p></div></> : <div className="exchange-empty">{exchange.message}</div>}</section>}
      {liveCase && activeTab === "sources" && <section className="tab-panel sources-tab"><div className="tab-panel-head"><div><p className="eyebrow">SOURCE INVENTORY</p><h2>この調査で使用した資料</h2></div><span>{(research.sourceUrl ? 2 : 1) + (billLookup ? 2 : 0)}系統</span></div><div className="source-inventory">{research.sourceUrl && <a href={research.sourceUrl} target="_blank" rel="noreferrer"><i className="news-source">報</i><div><span>ニュース記事</span><h3>{research.sourceTitle}</h3><p>検索テーマを特定する入口として使用</p></div><b>記事を開く ↗</b></a>}<a href="https://kokkai.ndl.go.jp/" target="_blank" rel="noreferrer"><i className="diet-source">国</i><div><span>公式データベース</span><h3>国立国会図書館 国会会議録検索システム</h3><p>{research.total.toLocaleString()}件ヒット · {research.records.length}件取得</p></div><b>公式サイト ↗</b></a>{billLookup && <><a href={billLookup.source.url} target="_blank" rel="noreferrer"><i className="bill-source">法</i><div><span>法案・審議経過</span><h3>{billLookup.source.name}</h3><p>{billLookup.matched ? `${billLookup.matches.length}件の候補を照合` : billLookup.source.note}</p></div><b>公式サイト ↗</b></a><a href="https://hourei.ndl.go.jp/" target="_blank" rel="noreferrer"><i className="index-source">索</i><div><span>法令・法案の沿革</span><h3>国立国会図書館 日本法令索引</h3><p>成立前後の法令沿革を確認</p></div><b>公式サイト ↗</b></a></>}</div></section>}

      {liveCase && activeTab === "overview" ? <div className="workspace live-workspace">
        <aside className="left-panel">
          <div className="panel-heading"><div><span>公式資料</span><small>{research.sourceUrl ? 2 : 1}系統</small></div><button onClick={() => { setResearch(null); setPublicInput(""); setShowSample(false); }}>新しい調査</button></div>
          <div className="live-source-list">
            {research.sourceUrl && <a href={research.sourceUrl} target="_blank" rel="noreferrer"><i className="news-source">報</i><div><strong>入力されたニュース記事</strong><span>{research.sourceTitle}</span></div><b>入口</b></a>}
            <a href="https://kokkai.ndl.go.jp/" target="_blank" rel="noreferrer"><i className="diet-source">国</i><div><strong>国会会議録検索システム</strong><span>{research.total.toLocaleString()}件ヒット · {research.records.length}件取得</span></div><b>公式</b></a>
            {billLookup && <a href={billLookup.source.url} target="_blank" rel="noreferrer"><i className="bill-source">法</i><div><strong>衆議院 議案情報</strong><span>{billLookup.matched ? `${billLookup.matches.length}件の法案候補を照合` : "本文・審議経過の公式入口"}</span></div><b>公式</b></a>}
          </div>
          <div className="coverage-box"><span>今回確認した範囲</span><strong>国会会議録 + 法案情報</strong><p>発言原文、衆議院の議案本文・審議経過、日本法令索引への経路を保持します。</p></div>
        </aside>
        <section className="findings-panel">
          <div className="section-title"><div><p className="eyebrow">LIVE ANALYSIS</p><h2>公式記録の整理</h2></div><span className="finding-count">{research.records.length}件取得</span></div>
          <p className="section-intro">検索総数と実際に取得した記録を区別し、確認済みの範囲だけを表示します。</p>
          <div className="live-analysis-list">
            {researchSummary ? <><article className="key-points-panel"><span>原文から確認できる3つの論点</span>{researchSummary.keyPoints.map((point, index) => <a key={`${point.speaker}-${index}`} href={point.url} target="_blank" rel="noreferrer"><b>{index + 1}</b><div><strong>{point.text}</strong><small>{point.speaker} · {point.meeting} · {point.date}</small></div></a>)}</article><article><span>今回確認できた範囲</span><h3>{researchSummary.overview}</h3><small>検索ヒット数と取得済み原文を区別して表示</small></article><article><span>審議された会議</span><h3>{researchSummary.meetings.join("、")}</h3><small>取得した発言が掲載された会議</small></article><article><span>確認できた発言者</span><h3>{researchSummary.speakers.join("、")}</h3><small>原文で確認できた人物のみ掲載</small></article></> : <article className="no-analysis"><span>確認結果</span><h3>現在の検索条件では、分析できる国会発言を取得できませんでした。</h3><small>該当なしをサンプルデータで埋めず、未確認として保持しています。</small></article>}
          </div>
        </section>
        <aside className="source-panel">
          <div className="source-title"><p className="eyebrow">SOURCE TRACE</p><h2>根拠を確認</h2></div>
          {liveSource && <><div className="selected-summary"><span className="review">公式発言</span><h3>{liveSource.speaker}{liveSource.group ? ` · ${liveSource.group}` : ""}</h3><p>{liveSource.meeting} · {liveSource.date}</p></div><article className="source-card live-source-card"><div className="source-meta"><i style={{ background: "#7357ff" }} /><strong>{liveSource.house}</strong><span>関連度 {liveSource.relevance}</span></div><blockquote>「{liveSource.excerpt}…」</blockquote><a className="open-source live-open" href={liveSource.url} target="_blank" rel="noreferrer">国会会議録で原文を開く <span>↗</span></a></article></>}
          <div className="audit-note"><strong>検証可能な出力</strong><p>要約ではなく、公式会議録の発言者・日付・委員会・原文URLを保持しています。</p></div>
        </aside>
      </div> : liveCase ? null : showSample ? <div className="workspace">
        <aside className="left-panel">
          <div className="panel-heading"><div><span>資料</span><small>{evidence.length}件</small></div><button onClick={() => inputRef.current?.click()}>＋ 追加</button></div>
          <input ref={inputRef} className="hidden-input" type="file" multiple accept="audio/*,video/*,image/*,.pdf,.csv,.xls,.xlsx" onChange={(e) => acceptFiles(e.target.files)} />
          <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFiles(e.dataTransfer.files); }}>
            <span>↑</span><strong>資料をドロップ</strong><small>音声・動画・PDF・画像・Excel</small>
          </button>
          {notice && <p className="notice">{notice}</p>}
          <div className="evidence-list">
            {evidence.map((item) => <article key={item.id} className="evidence-item"><i style={{ background: item.color }}>{item.kind.slice(0, 1)}</i><div><strong>{item.name}</strong><span>{item.detail}</span></div><small className={item.status === "待機中" ? "pending" : ""}>{item.status}</small></article>)}
          </div>
        </aside>

        <section className="findings-panel">
          <div className="section-title"><div><p className="eyebrow">ANALYSIS</p><h2>検出された相違</h2></div><span className="finding-count">2件</span></div>
          <p className="section-intro">Prooflineが同一の対象を指す記録を比較しました。結論ではなく、確認が必要な差異を提示します。</p>
          <div className="finding-list">
            {findings.map((finding, index) => <button key={finding.title} className={`finding-card ${activeFinding === index ? "selected" : ""}`} onClick={() => { setActiveFinding(index); setSelectedSource(0); }}><span className={finding.severity === "重要" ? "critical" : "review"}>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.summary}</p><small>{finding.sources.length}つの原典を比較</small></div><b>›</b></button>)}
          </div>
        </section>

        <aside className="source-panel">
          <div className="source-title"><p className="eyebrow">SOURCE TRACE</p><h2>根拠を確認</h2></div>
          <div className="selected-summary"><span className={active.severity === "重要" ? "critical" : "review"}>{active.severity}</span><h3>{active.title}</h3><p>{active.summary}</p></div>
          <div className="source-tabs">{active.sources.map((source, index) => <button key={source.label} className={selectedSource === index ? "active" : ""} onClick={() => setSelectedSource(index)}>{index + 1}</button>)}</div>
          <article className="source-card">
            <div className="source-meta"><i style={{ background: active.sources[selectedSource].color }} /><strong>{active.sources[selectedSource].label}</strong><span>{active.sources[selectedSource].anchor}</span></div>
            <blockquote>「{active.sources[selectedSource].quote}」</blockquote>
            <button className="open-source">原典の該当箇所を開く <span>↗</span></button>
          </article>
          <div className="audit-note"><strong>検証可能な出力</strong><p>この発見には、取得日時・元URL・ファイルハッシュを含む監査記録が保存されています。</p></div>
        </aside>
      </div> : <section className="empty-start">
        <div className="empty-mark">P</div>
        <p className="eyebrow">START A VERIFIABLE RESEARCH CASE</p>
        <h2>ニュースの奥にある原典へ</h2>
        <p>上の入力欄へニュースURLまたは法案名を入れてください。国会会議録から関連発言を探し、発言者・日付・委員会・原文URLを保持します。</p>
        <div className="start-steps"><span><b>1</b>ニュースを入力</span><i>→</i><span><b>2</b>公式記録を検索</span><i>→</i><span><b>3</b>原文を確認</span></div>
        <div className="empty-actions"><button className="live-demo" onClick={() => researchPublicRecord("副首都構想")}>副首都構想でライブデモを開始 <span>→</span></button><button onClick={() => setShowSample(true)}>ファイル比較サンプルを見る</button></div>
        <small className="demo-note">公式会議録を検索し、要点・審議統計・法案経過・発言原文まで確認します。</small>
      </section>}
    </main>
  );
}
