/**
 * 한국 전화번호에 하이픈을 붙여요.
 *
 * - 휴대전화 010: 010-1234-5678 (옛 10자리는 010-123-4567)
 * - 서울 02: 02-123-4567, 02-1234-5678
 * - 지역번호(031 등)·070·080·011 등: 031-940-1234, 031-1234-5678
 * - 안심번호 0502~0508: 0505-123-4567, 0505-1234-5678
 * - 대표번호 15XX·16XX·18XX: 1588-1234
 * - 지역번호 없는 번호: 940-1234, 9400-1234
 * - 네 자리까지는 내선번호라 그대로: 1111 (2026-10-25 사용자)
 *
 * `final`이 거짓이면 치는 중의 모양(가운데 자리가 아직 정해지지 않음)이고,
 * 참이면 칸을 떠날 때의 마지막 모양이에요. 자리 수가 규칙에 안 맞으면 숫자 그대로 둬요.
 * 칸을 떠날 때 자리 수가 모자란 번호(`12345`, `0101234`)도 숫자만 남겨요 – 덜 친 번호가
 * 완성된 번호처럼 보이지 않게(2026-10-28 사용자 1안).
 */
export function formatPhone(d: string, final = false): string {
  if (!d) return "";
  if (d[0] !== "0") {
    if (d.length <= 4) return d;
    if (final && d.length < (/^1[5-9]/.test(d) ? 8 : 7)) return d;
    if (/^1[5-9]/.test(d)) return d.length <= 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return d;
  }
  const areaLen = d.startsWith("02") ? 2 : /^050[2-8]/.test(d) ? 4 : 3;
  if (d.length <= areaLen) return d;
  const area = d.slice(0, areaLen);
  const rest = d.slice(areaLen);
  if (rest.length > 8) return d;
  if (final && rest.length < 7) return d;
  // 010은 거의 모두 4-4라서 치는 중에도 4자리로 끊어요.
  const mobile = area === "010";
  if (mobile && !final) return rest.length <= 4 ? `${area}-${rest}` : `${area}-${rest.slice(0, 4)}-${rest.slice(4)}`;
  if (rest.length <= 3) return `${area}-${rest}`;
  if (rest.length <= 7) return `${area}-${rest.slice(0, 3)}-${rest.slice(3)}`;
  return `${area}-${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export const digitsOf = (v: string) => v.replace(/[^0-9]/g, "");

/**
 * 규칙대로 하이픈을 다시 붙일 글자인지: 숫자와 하이픈만 있으면 참(하이픈 자리는 따지지 않아요 –
 * `010-72805715`도 `010-7280-5715`로). 괄호·띄어쓰기·글자가 섞이면 사용자가 적은 그대로 둬요
 * (2026-10-28 사용자 1안).
 */
export function isAutoShape(v: string): boolean {
  return !v || /^[0-9-]+$/.test(v);
}

/** 칸을 떠나거나 등록할 때: 숫자·하이픈만이면 마지막 모양으로, 다른 글자가 섞였으면 그대로. */
export function finalizePhone(v: string): string {
  const t = v.trim();
  return isAutoShape(t) ? formatPhone(digitsOf(t), true) : t;
}
