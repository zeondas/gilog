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
 */
export function formatPhone(d: string, final = false): string {
  if (!d) return "";
  if (d[0] !== "0") {
    if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : d.length <= 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
    if (d.length <= 4) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return d;
  }
  const areaLen = d.startsWith("02") ? 2 : /^050[2-8]/.test(d) ? 4 : 3;
  if (d.length <= areaLen) return d;
  const area = d.slice(0, areaLen);
  const rest = d.slice(areaLen);
  if (rest.length > 8) return d;
  // 010은 거의 모두 4-4라서 치는 중에도 4자리로 끊어요.
  const mobile = area === "010";
  if (mobile && !final) return rest.length <= 4 ? `${area}-${rest}` : `${area}-${rest.slice(0, 4)}-${rest.slice(4)}`;
  if (rest.length <= 3) return `${area}-${rest}`;
  if (rest.length <= 7) return `${area}-${rest.slice(0, 3)}-${rest.slice(3)}`;
  return `${area}-${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export const digitsOf = (v: string) => v.replace(/[^0-9]/g, "");

/** 자동으로 붙인 모양인지 (사용자가 직접 하이픈 등을 적은 것이 아닌지). */
export function isAutoShape(v: string): boolean {
  if (!v) return true;
  if (!/^[0-9-]+$/.test(v)) return false;
  const d = digitsOf(v);
  return v === d || v === formatPhone(d) || v === formatPhone(d, true);
}

/** 칸을 떠나거나 등록할 때: 자동 모양이면 마지막 모양으로, 직접 적은 것이면 그대로. */
export function finalizePhone(v: string): string {
  const t = v.trim();
  return isAutoShape(t) ? formatPhone(digitsOf(t), true) : t;
}
