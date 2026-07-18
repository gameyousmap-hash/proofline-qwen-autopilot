import { NextRequest, NextResponse } from "next/server";

const HOUSE_BILLS_URL = "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm";
const CACHE_TTL = 10 * 60 * 1000;
let billListCache: { html: string; expiresAt: number } | null = null;
const progressCache = new Map<string, { value: BillProgress | null; expiresAt: number }>();

type BillRecord = {
  session: string;
  number: string;
  title: string;
  status: string;
  progressUrl?: string;
  textUrl?: string;
  score: number;
};

type BillProgress = {
  proposer?: string;
  proposerGroups?: string;
  supportGroups?: string[];
  opposeGroups?: string[];
  lawNumber?: string;
  timeline: Array<{ date: string; title: string; detail: string; chamber: string }>;
};

function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value, HOUSE_BILLS_URL).toString();
  } catch {
    return undefined;
  }
}

function searchTerms(keyword: string, sourceTitle: string) {
  const clean = (value: string) => value
    .replace(/[「」『』【】（）()・,:：!?！？\s]/g, "")
    .replace(/(?:ニュース|速報|解説|衆議院|参議院|国会|可決|通過|成立|審議入り|提出)$/g, "")
    .trim();
  const terms = [
    clean(keyword),
    clean(keyword).replace(/(?:基本法|特別措置法|改正法|法律案|法案|法律|対策|構想|制度)$/g, ""),
    ...sourceTitle
      .split(/[｜|・:：\s「」『』【】（）()]/)
      .map(clean)
      .filter((value) => value.length >= 3 && value.length <= 28),
  ];
  return Array.from(new Set(terms.filter((value) => value.length >= 2))).slice(0, 12);
}

function scoreTitle(title: string, terms: string[]) {
  const normalized = title.replace(/\s+/g, "");
  return terms.reduce((score, term) => {
    if (normalized === term) return score + 30;
    if (normalized.includes(term)) return score + Math.min(18, term.length * 2);
    if (term.length >= 4 && normalized.includes(term.slice(0, Math.ceil(term.length * 0.7)))) return score + 4;
    return score;
  }, 0);
}

function splitValue(value?: string) {
  if (!value) return { date: "", detail: "" };
  const [date = "", ...detail] = value.split("／").map((part) => part.trim());
  return { date, detail: detail.join("／").trim() };
}

function validValue(value?: string) {
  return Boolean(value && value.replace(/[／\s]/g, ""));
}

async function fetchOfficialHtml(url: string, userAgent: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    next: { revalidate: 600 },
  });
  if (!response.ok) throw new Error("Official source unavailable");
  const charset = response.headers.get("content-type")?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  return new TextDecoder(charset?.includes("shift") ? "shift_jis" : "utf-8").decode(await response.arrayBuffer());
}

async function fetchProgress(url?: string): Promise<BillProgress | null> {
  if (!url) return null;
  const cached = progressCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const html = await fetchOfficialHtml(url, "Proofline/0.1 official-bill-progress");
    const fields = new Map<string, string>();
    for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => decodeHtml(match[1]));
      if (cells.length >= 2 && cells[0]) fields.set(cells[0], cells.slice(1).join(" ").trim());
    }

    const timeline: BillProgress["timeline"] = [];
    const add = (field: string, title: string, chamber: string, fallbackDetail = "") => {
      const value = fields.get(field);
      if (!validValue(value)) return;
      const { date, detail } = splitValue(value);
      timeline.push({ date, title, detail: detail || fallbackDetail, chamber });
    };

    add("衆議院議案受理年月日", "衆議院に提出", "衆議院");
    add("衆議院付託年月日／衆議院付託委員会", "委員会へ付託", "衆議院");
    add("衆議院審査終了年月日／衆議院審査結果", "委員会審査を終了", "衆議院");
    add("衆議院審議終了年月日／衆議院審議結果", "衆議院で議了", "衆議院");
    add("参議院議案受理年月日", "参議院へ送付", "参議院");
    add("参議院付託年月日／参議院付託委員会", "委員会へ付託", "参議院");
    add("参議院審査終了年月日／参議院審査結果", "委員会審査を終了", "参議院");
    add("参議院審議終了年月日／参議院審議結果", "参議院で議了", "参議院");
    add("公布年月日／法律番号", "公布", "法律", "法律として公布");

    const promulgation = splitValue(fields.get("公布年月日／法律番号"));
    const value = {
      proposer: fields.get("議案提出者"),
      proposerGroups: fields.get("議案提出会派"),
      supportGroups: fields.get("衆議院審議時賛成会派")?.split(";").map((value) => value.trim()).filter(Boolean) || [],
      opposeGroups: fields.get("衆議院審議時反対会派")?.split(";").map((value) => value.trim()).filter(Boolean) || [],
      lawNumber: promulgation.detail || undefined,
      timeline,
    };
    progressCache.set(url, { value, expiresAt: Date.now() + CACHE_TTL });
    return value;
  } catch {
    progressCache.set(url, { value: null, expiresAt: Date.now() + 60_000 });
    return null;
  }
}

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword")?.trim() || "";
  const sourceTitle = request.nextUrl.searchParams.get("title")?.trim() || keyword;
  if (!keyword) return NextResponse.json({ error: "検索テーマが必要です。" }, { status: 400 });

  try {
    const html = billListCache && billListCache.expiresAt > Date.now()
      ? billListCache.html
      : await fetchOfficialHtml(HOUSE_BILLS_URL, "Proofline/0.1 official-bill-research");
    billListCache = { html, expiresAt: Date.now() + CACHE_TTL };
    const terms = searchTerms(keyword, sourceTitle);
    const records: BillRecord[] = [];

    for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => decodeHtml(match[1]));
      const titleIndex = cells.findIndex((cell) => /(法律案|法案|予算|条約|承認を求めるの件|決議案)$/.test(cell));
      if (titleIndex < 2) continue;
      const title = cells[titleIndex];
      const score = scoreTitle(title, terms);
      if (score < 4) continue;
      const links = [...row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
        url: absoluteUrl(match[1]),
        label: decodeHtml(match[2]),
      }));
      records.push({
        session: cells[titleIndex - 2] || "",
        number: cells[titleIndex - 1] || "",
        title,
        status: cells[titleIndex + 1] || "公式ページで確認",
        progressUrl: links.find((link) => link.label.includes("経過"))?.url,
        textUrl: links.find((link) => link.label.includes("本文"))?.url,
        score,
      });
    }

    const candidates = records
      .sort((a, b) => b.score - a.score)
      .filter((record, index, all) => all.findIndex((item) => item.title === record.title) === index)
      .slice(0, 3);
    const matches = await Promise.all(candidates.map(async ({ score: _score, ...record }) => ({
      ...record,
      progress: await fetchProgress(record.progressUrl),
    })));

    return NextResponse.json({
      keyword,
      matched: matches.length > 0,
      matches,
      source: {
        name: "衆議院 議案情報",
        url: HOUSE_BILLS_URL,
        note: "審議状況・経過・本文を公式情報から照合",
      },
      additionalSources: [
        { name: "日本法令索引", url: "https://hourei.ndl.go.jp/", note: "法令・法案の沿革を確認" },
        { name: "参議院 議案情報", url: "https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm", note: "参議院での審議状況を確認" },
        { name: "e-Gov法令検索", url: "https://elaws.e-gov.go.jp/", note: "成立・施行後の現行法令を確認" },
      ],
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      keyword,
      matched: false,
      matches: [],
      source: {
        name: "衆議院 議案情報",
        url: HOUSE_BILLS_URL,
        note: "現在、自動照合できません。公式ページで確認してください。",
      },
      additionalSources: [
        { name: "日本法令索引", url: "https://hourei.ndl.go.jp/", note: "法令・法案の沿革を確認" },
        { name: "参議院 議案情報", url: "https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm", note: "参議院での審議状況を確認" },
        { name: "e-Gov法令検索", url: "https://elaws.e-gov.go.jp/", note: "成立・施行後の現行法令を確認" },
      ],
      checkedAt: new Date().toISOString(),
    });
  }
}
