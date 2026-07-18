const noise = /(ニュース|速報|可決|通過|衆議院|参議院|国会|について|に関する|を|が|は)/g;
const genericLegislativeTerms = /^(?:議員立法|閣法|政府提出法案|法案提出|法律案|改正案|法案|基本法|特措法|新法|制度)$/;
const billEnding = /(?:法律の一部を改正する法律案|法律案|改正案|法案|基本法|特措法|新法)$/;

function cleanCandidate(value: string) {
  return value
    .replace(/^[【\s]*(?:法案提出|速報|解説|詳報)[】\s]*/g, "")
    .replace(/^(?:議員立法|閣法|政府提出法案)[「『\s]*/g, "")
    .replace(/[」』】\s]*$/g, "")
    .trim();
}

function quotedBillNames(value: string) {
  return Array.from(value.matchAll(/[「『]([^」』\n]{3,120}?(?:法律案|改正案|法案|基本法|特措法|新法))[」』]/g))
    .map((match) => cleanCandidate(match[1]))
    .filter((candidate) => !genericLegislativeTerms.test(candidate));
}

function billScore(value: string, title: string) {
  return (value.includes("法律の一部を改正する法律案") ? 300 : 0)
    + (value.endsWith("法律案") ? 100 : 0)
    + (title.includes(value) ? 40 : 0)
    + Math.min(value.length, 100);
}

export function deriveKeyword(title: string, context = title) {
  const quotedBills = Array.from(new Set(quotedBillNames(`${title}\n${context}`)))
    .sort((a, b) => billScore(b, title) - billScore(a, title));
  if (quotedBills[0]) return quotedBills[0];

  const bills = Array.from(title.matchAll(/([^｜|–—:：、。「」『』【】]{2,90}?(?:法律案|改正案|法案|基本法|特措法|新法|制度))/g))
    .map((match) => cleanCandidate(match[1]))
    .filter((candidate) => !genericLegislativeTerms.test(candidate))
    .sort((a, b) => billScore(b, title) - billScore(a, title));
  if (bills[0]) return bills[0];

  const quoted = title.match(/[「『](.{3,60}?)[」』]/)?.[1];
  if (quoted && /(法|制度|政策|予算|条約|規制|支援|給付)/.test(quoted)) return quoted.trim();
  const chunks = title.replace(/[｜|–—:：].*$/, "").replace(noise, " ").split(/[\s、。・「」『』【】]+/).filter((value) => value.length >= 3 && !genericLegislativeTerms.test(value));
  return chunks.sort((a, b) => b.length - a.length)[0]?.slice(0, 60) || title.slice(0, 40);
}

export function buildSearchCandidates(keyword: string, title: string, context = title) {
  const base = cleanCandidate(keyword).replace(/(?:では|には|への|での|から|まで|より|について|に関して|で)$/g, "").trim();
  const aliases = quotedBillNames(`${title}\n${context}`);
  const words = title
    .replace(/[｜|–—:：].*$/, "")
    .replace(noise, " ")
    .split(/[\s、。・「」『』【】（）()]+/)
    .map((word) => cleanCandidate(word).replace(/(?:では|には|への|での|から|まで|より|で)$/g, "").replace(/(?:めぐる|巡る|求める|対策|問題|課題|方針|検討)$/, ""))
    .filter((word) => word.length >= 3 && word.length <= 40 && !genericLegislativeTerms.test(word));
  const reduced = [
    base.replace(/に関する法律の一部を改正する法律案$/, ""),
    base.replace(/法律の一部を改正する法律案$/, ""),
    base.replace(/(?:法律案|改正案|法案|基本法|特措法|新法)$/, ""),
    base.replace(/(?:対策|規制|支援|制度|問題|課題|方針|検討)(?:法律案|改正案|法案)?$/, ""),
  ];
  return Array.from(new Set([base, ...reduced, ...aliases, ...words]
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && !genericLegislativeTerms.test(value) && (billEnding.test(value) || value.length >= 3))))
    .slice(0, 10);
}
