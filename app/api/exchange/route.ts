import { NextRequest, NextResponse } from "next/server";
type Speech = { speechID:string; speechOrder:number; speaker:string; speakerGroup?:string|null; speakerPosition?:string|null; speech:string; speechURL:string };
export async function GET(request: NextRequest) {
  const issueID = request.nextUrl.searchParams.get("issueID")?.trim();
  const speechOrder = Number(request.nextUrl.searchParams.get("speechOrder"));
  if (!issueID || !Number.isFinite(speechOrder)) return NextResponse.json({ error:"会議録IDと発言順が必要です。" }, { status:400 });
  try {
    const endpoint = new URL("https://kokkai.ndl.go.jp/api/meeting");
    endpoint.searchParams.set("issueID", issueID); endpoint.searchParams.set("recordPacking", "json"); endpoint.searchParams.set("maximumRecords", "1");
    const response = await fetch(endpoint, { headers:{ Accept:"application/json" } });
    if (!response.ok) throw new Error();
    const data = await response.json() as { meetingRecord?:Array<{ nameOfHouse:string; nameOfMeeting:string; date:string; speechRecord?:Speech[] }> };
    const meeting = data.meetingRecord?.[0]; const speeches = [...(meeting?.speechRecord || [])].sort((a,b) => a.speechOrder - b.speechOrder);
    const index = speeches.findIndex((item) => Number(item.speechOrder) === speechOrder);
    const question = speeches[index];
    const following = speeches.slice(index + 1, index + 7).filter((item) => item.speaker !== question?.speaker && item.speech.replace(/\s+/g," ").length > 30);
    const official = following.find((item) => /(大臣|副大臣|政務官|長官|政府参考人|局長|審議官|政府委員)/.test(item.speakerPosition || "")) || following[0];
    if (!question || !official) return NextResponse.json({ found:false, message:"同一会議内で対応する直後の答弁を特定できませんでした。" });
    const clean = (value:string) => value.replace(/^○[^　]+　/,"").replace(/\s+/g," ").trim();
    const answer = clean(official.speech); const unresolved = /(検討|今後|差し控え|困難|答えられ|承知していない|現時点)/.test(answer);
    return NextResponse.json({ found:true, meeting:meeting?.nameOfMeeting, date:meeting?.date, question:{ speaker:question.speaker, position:question.speakerPosition, text:clean(question.speech).slice(0,420), url:question.speechURL }, answer:{ speaker:official.speaker, position:official.speakerPosition, text:answer.slice(0,520), url:official.speechURL }, assessment:unresolved ? "継続確認が必要" : "回答を確認", note:unresolved ? "答弁に『検討』『今後』などの留保表現が含まれます。" : "直後の答弁から対応内容を確認できます。" });
  } catch { return NextResponse.json({ error:"同一会議の答弁を取得できませんでした。" }, { status:502 }); }
}
