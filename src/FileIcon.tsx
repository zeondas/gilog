// 탐색기 아이콘: 앱에서는 윈도우가 쓰는 아이콘을 그대로 받아 보여요(2026-10-18 사용자 2안).
// 확장자마다 한 번만 받아 두고, 받기 전이나 브라우저 미리 보기에서는 자리 표시 아이콘을 그려요.
import { useEffect, useState } from "react";
import { extOf } from "./files";
import { fsApi } from "./filesApi";

/** .exe·.lnk·.ico는 파일마다 아이콘이 달라 경로로 받아요. */
const PER_FILE = new Set(["exe", "lnk", "ico", "url"]);

export const iconKey = (name: string, path: string, dir: boolean) => {
  // 드라이브(C:\)는 윈도우가 그 드라이브 아이콘을 줘요(내 PC 목록·트리)
  if (dir) return /^[A-Za-z]:\\$/.test(path) ? path : "<dir>";
  const e = extOf(name);
  return PER_FILE.has(e) ? path : "." + (e || "_");
};

const cache = new Map<string, string>();
const waiting = new Map<string, Set<() => void>>();
let queue: { key: string; size: number }[] = [];
let timer = 0;

function request(key: string, size: number, done: () => void) {
  const k = `${size}|${key}`;
  let w = waiting.get(k);
  if (!w) {
    w = new Set();
    waiting.set(k, w);
    queue.push({ key, size });
    if (!timer) {
      // 한 번 그릴 때 보이는 확장자를 모아 한꺼번에 받아요.
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
    const keys = q.filter((x) => x.size === size).map((x) => x.key);
    let got: Record<string, string> = {};
    try {
      got = await fsApi.icons(keys, size);
    } catch {
      got = {};
    }
    for (const key of keys) {
      const k = `${size}|${key}`;
      cache.set(k, got[key] ?? "");
      for (const f of waiting.get(k) ?? []) f();
      waiting.delete(k);
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

export function FileIcon({ name, path, dir, size }: { name: string; path: string; dir: boolean; size: number }) {
  const want = size <= 20 ? 16 : 32;
  const key = iconKey(name, path, dir);
  const k = `${want}|${key}`;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!cache.has(k)) request(key, want, () => tick((n) => n + 1));
  }, [k, key, want]);
  const url = cache.get(k);
  if (url) return <img className="fx-icon" src={url} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
  return dir ? <FolderShape size={size} /> : <FileShape size={size} name={name} />;
}
