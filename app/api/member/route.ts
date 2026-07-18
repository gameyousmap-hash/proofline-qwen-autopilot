import { NextRequest, NextResponse } from "next/server";
type Speech = { speechID: string; nameOfHouse: string; nameOfMeeting: string; date: string; speaker: string; speakerGroup?: string | null; speech: string; speechURL: string };
const stop = new Set(["について", "という", "こと", "ため", "これ", "それ", "政府", "委員", "大臣", "お願い", "問題", "必要", "考え", "ところ", "ように", "もの"]);
const officialProfiles: Record<string, { constituency: string; officialUrl: string }> = {
  "山谷えり子": { constituency: "参議院・比例代表", officialUrl: "https://www.sangiin.go.jp/japanese/joho1/kousei/giin/profile/7004013.htm" },
  "伊藤孝恵": { constituency: "参議院・愛知県選挙区", officialUrl: "https://www.sangiin.go.jp/japanese/joho1/kousei/giin/profile/7016006.htm" },
  "岡本あき子": { constituency: "衆議院・宮城1区", officialUrl: "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm" },
};
const categories: Array<[string, RegExp]> = [["子ども・教育", /(子ども|子供|教育|学校|保育|児童)/], ["法務・人権", /(法務|司法|人権|犯罪|刑事|入管)/], ["デジタル・情報", /(デジタル|インターネット|サイバー|広告|情報通信|ＡＩ|AI)/], ["地方・防災", /(地方|自治体|防災|災害|復興|地域)/], ["外交・安全保障", /(外交|安全保障|防衛|拉致|北朝鮮|外国人)/], ["経済・雇用", /(経済|雇用|賃金|企業|予算|物価)/]];
export async function GET(request: NextRequest) {
  const speaker = request.nextUrl.searchParams.get("speaker")?.trim();
  const start = Math.max(1, Number(request.nextUrl.searchParams.get("start") || "1"));
  if (!speaker) return NextResponse.json({ error: "発言者名が必要です。" }, { status: 400 });
  try {
    const endpoint = new URL("https://kokkai.ndl.go.jp/api/speech");
    endpoint.searchParams.set("speaker", speaker); endpoint.searchParams.set("recordPacking", "json"); endpoint.searchParams.set("maximumRecords", "20");
    endpoint.searchParams.set("startRecord", String(start));
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error();
    const data = await response.json() as { numberOfRecords?: number; speechRecord?: Speech[] };
    const records = (data.speechRecord || []).filter((item) => item.speaker.includes(speaker));
    const meetings = Array.from(new Set(records.map((item) => item.nameOfMeeting))).slice(0, 5);
    const dates = records.map((item) => item.date).sort(); const frequency = new Map<string, number>();
    records.forEach((item) => (item.speech.match(/[一-龠々ァ-ヶー]{3,10}/g) || []).forEach((word) => { if (!stop.has(word)) frequency.set(word, (frequency.get(word) || 0) + 1); }));
    const topics = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
    const recent = records.slice(0, 5).map((item) => ({ id: item.speechID, date: item.date, house: item.nameOfHouse, meeting: item.nameOfMeeting, text: item.speech.replace(/^○[^　]+　/, "").replace(/\s+/g, " ").slice(0, 180), url: item.speechURL }));
    const categoryScores = categories.map(([name, pattern]) => ({ name, count: records.filter((item) => pattern.test(item.speech)).length })).filter((item) => item.count).sort((a, b) => b.count - a.count);
    const main = categoryScores.slice(0, 3).map((item) => item.name);
    const activitySummary = main.length ? `直近に取得した${records.length}発言では、${main.join("、")}に関する質疑が中心です。${meetings.slice(0, 2).join("、")}などで発言を確認できます。` : `直近に取得した${records.length}発言を、会議名と原文付きで確認できます。`;
    const profile = officialProfiles[speaker.replace(/[ 　]/g, "")];
    return NextResponse.json({ speaker, group: records[0]?.speakerGroup || null, total: data.numberOfRecords || 0, start, hasMore: start + records.length <= (data.numberOfRecords || 0), samplePeriod: dates.length ? `${dates[0]}〜${dates.at(-1)}` : "確認できず", meetings, topics, categories: categoryScores.slice(0, 5), activitySummary, constituency: profile?.constituency || "公式プロフィールで未確認", officialUrl: profile?.officialUrl || null, recent });
  } catch { return NextResponse.json({ error: "議員の活動記録を取得できませんでした。" }, { status: 502 }); }
}
