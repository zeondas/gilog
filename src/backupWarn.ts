// 자동 백업 실패 띠(버그 사냥 20, 설정 세션 `wip/settings6`): 잠금을 풀 때 자동 백업이 실패했고
// 마지막 자동 백업이 2일 넘게 전이면(또는 하나도 없으면) 앱 위에 띠 한 줄을 띄워요. 닫으면 다음 잠금 풀기까지 안 떠요.
import type { BackupInfo } from "./api";

/** 띠를 띄우는 기준 – 마지막 자동 백업이 이 날수보다 더 전이면 */
export const BACKUP_WARN_DAYS = 2;

/** "YYYY-MM-DD" 두 날짜 사이 날수(b − a), 읽을 수 없으면 null */
export function daysBetween(a: string, b: string): number | null {
  const ms = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  const n = Math.round((ms(b) - ms(a)) / 86400000);
  return Number.isFinite(n) ? n : null;
}

/** 띠 글(띄우지 않으면 "") */
export function backupWarnText(info: BackupInfo | null): string {
  if (!info?.fail) return "";
  const tail = "설정 › 자동 백업에서 백업 폴더를 확인해 주세요.";
  if (!info.latest) return `자동 백업이 안 되고 있어요. ${tail}`;
  const n = info.today ? daysBetween(info.latest, info.today) : null;
  if (n === null || n <= BACKUP_WARN_DAYS) return "";
  return `자동 백업이 ${n}일째 안 되고 있어요. ${tail}`;
}
