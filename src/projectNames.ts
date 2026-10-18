/**
 * 프로젝트 칸 글자를 프로젝트 이름들로 나눠요. 쉼표(, ，)로 나누되 괄호 안의 쉼표는 이름의 일부예요.
 * 예: "2026년 동부권 도로시설물 유지보수 연간단가 공사(1지구, 하반기), 포장" → 두 개.
 * raw = true면 다듬지 않고 빈 조각도 그대로 돌려줘요(적는 중인 마지막 조각을 알 때).
 */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{（［｛「『〈《".includes(ch)) depth++;
    else if (")]}）］｝」』〉》".includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，") && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 나눈 뒤 다듬고 빈 것·같은 것을 뺀 이름 목록 */
export function splitProjects(s: string): string[] {
  const out: string[] = [];
  for (const x of splitTop(s).map((v) => v.trim())) if (x && !out.includes(x)) out.push(x);
  return out;
}
