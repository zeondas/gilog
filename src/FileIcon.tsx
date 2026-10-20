// 탐색기 아이콘: 앱에서는 윈도우가 쓰는 아이콘을 그대로 받아 보여요(2026-10-18 사용자 2안).
// 확장자마다 한 번만 받아 두고, 받기 전이나 브라우저 미리 보기에서는 자리 표시 아이콘을 그려요.
import { useEffect, useState } from "react";
import { extOf } from "./files";
import { fsApi } from "./filesApi";

export const iconKey = (name: string, path: string, dir: boolean) => {
  // 파일·폴더 모두 실제 경로로 받아요 – 윈도우 탐색기처럼 그 파일에 붙은 아이콘(한컴·보안 자물쇠·특수 폴더·
  // 바로가기 화살표)이 나와요. 같은 모양은 Rust가 한 번만 그려 나눠 써요(2026-10-19).
  // 경로가 없을 때(브라우저 미리 보기)만 확장자·<dir>로 떨어져 자리 표시 아이콘을 받게 해요.
  if (path) return path;
  if (dir) return "<dir>";
  const e = extOf(name);
  return "." + (e || "_");
};

// 캐시 열쇠(ck)는 "크기|경로|수정표" – 파일이 바뀌면 열쇠가 달라져 다시 받아요.
// 윈도우에 물을 때 쓰는 열쇠(key)는 경로만이에요.
const cache = new Map<string, string>();
const waiting = new Map<string, Set<() => void>>();
let queue: { ck: string; key: string; size: number }[] = [];
let timer = 0;

function request(ck: string, key: string, size: number, done: () => void) {
  let w = waiting.get(ck);
  if (!w) {
    w = new Set();
    waiting.set(ck, w);
    queue.push({ ck, key, size });
    if (!timer) {
      // 한 번 그릴 때 보이는 것을 모아 한꺼번에 받아요.
      timer = window.setTimeout(flush, 16);
    }
  }
  w.add(done);
}

async function flush() {
  timer = 0;
  const q = queue;
  queue = [];
  for (const size of new Set(q.map((x) => x.size))) {
    const items = q.filter((x) => x.size === size);
    let got: Record<string, string> = {};
    try {
      got = await fsApi.icons(items.map((x) => x.key), size);
    } catch {
      got = {};
    }
    for (const { ck, key } of items) {
      cache.set(ck, got[key] ?? "");
      for (const f of waiting.get(ck) ?? []) f();
      waiting.delete(ck);
    }
  }
}

/** 자리 표시 폴더(노란 폴더) */
function FolderShape({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5.2l2 2h9.8A1.5 1.5 0 0 1 22 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="#E3A33A" />
      <path d="M2 9.5A1.5 1.5 0 0 1 3.5 8h17A1.5 1.5 0 0 1 22 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="#F7C95C" />
    </svg>
  );
}

const BAND: Record<string, [string, string]> = {
  ppt: ["#D24726", "P"], pptx: ["#D24726", "P"],
  xls: ["#1F7A45", "X"], xlsx: ["#1F7A45", "X"], csv: ["#1F7A45", "X"],
  doc: ["#2B5797", "W"], docx: ["#2B5797", "W"],
  hwp: ["#2B6CC4", "한"], hwpx: ["#2B6CC4", "한"],
  pdf: ["#C2262E", "P"],
  jpg: ["#2E8B57", ""], jpeg: ["#2E8B57", ""], png: ["#2E8B57", ""], gif: ["#2E8B57", ""], bmp: ["#2E8B57", ""],
  zip: ["#8A6D3B", "Z"],
};

function FileShape({ size, name }: { size: number; name: string }) {
  const [c, mark] = BAND[extOf(name)] ?? ["#8A88A0", ""];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
      <path d="M6 2.5h8.5L19 7v14.5H6z" fill="#FFFFFF" stroke="#A9A7B8" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M14.5 2.5V7H19" fill="none" stroke="#A9A7B8" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="2.5" y="11" width="12" height="8" rx="1.5" fill={c} />
      {mark && size >= 24 && (
        <text x="8.5" y="17.1" textAnchor="middle" fontSize="6.2" fontWeight="800" fill="#FFFFFF" fontFamily="Pretendard, sans-serif">
          {mark}
        </text>
      )}
    </svg>
  );
}

// rev: 파일이 바뀌면(보안 해제 등으로 수정 시각·크기가 달라지면) 아이콘을 다시 받게 하는 표
// – 윈도우 탐색기처럼 자물쇠가 사라지거나 종류 아이콘이 바뀌어도 따라가요(2026-10-19).
export function FileIcon({ name, path, dir, size, rev }: { name: string; path: string; dir: boolean; size: number; rev?: string | number }) {
  // 보이는 크기보다 한 단계 큰 그림을 받아 줄여 그려요(윈도우 탐색기처럼 또렷하게).
  // 16px 목록도 32를 받아 2배로 선명, 44 그리드는 48, 64 썸네일 자리는 256(점보)로.
  const want = size <= 24 ? 32 : size <= 48 ? 48 : 256;
  const key = iconKey(name, path, dir);
  const ck = rev ? `${want}|${key}|${rev}` : `${want}|${key}`;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!cache.has(ck)) request(ck, key, want, () => tick((n) => n + 1));
  }, [ck, key, want]);
  const url = cache.get(ck);
  if (url) return <img className="fx-icon" src={url} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
  return dir ? <FolderShape size={size} /> : <FileShape size={size} name={name} />;
}
