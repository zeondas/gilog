# 집행현황 팀 공유 시험

`src/budgetShare.ts`의 합치기(세 갈래 비교)를 노드로 시험하고, 3년치 6,000줄 부하를 재요.

```sh
npx esbuild tools/share/merge.test.ts --bundle --platform=node --format=esm --outfile=/tmp/merge.mjs --log-level=error --define:import.meta.env.VITE_GOOGLE_CLIENT='""'
node /tmp/merge.mjs
```

- 모두 `ok`면 통과예요. 마지막 줄은 6,000줄 합치기 시간(ms)·시트 칸 수·한 번 읽는 크기(KB)예요.
- 브라우저 미리 보기에서는 `window.__shareFake = { mail: "내 메일", books: {} }`를 넣으면 구글 대신 메모리 시트를 써요
  (`books[시트 id][탭 이름]` = 줄 배열, 1행은 제목). 다른 PC가 고친 것은 이 배열을 직접 고쳐 흉내 내요.
