# 빌드 세션 프롬프트 틀

우두머리 세션은 아래 **[채울 곳]**만 채워서 새 빌드 세션에 줘요(가지 이름·커밋·요약·check 통과 여부). 나머지는 그대로예요. 빌드는 하루 2번 묶음(점심·퇴근 전)이에요 — [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 현황판 규칙 6.

---

**답은 전부 한국어·해요체예요(영어 금지).** main **[채울 곳: 해시 7자리]** + 현황판 읽기. 너는 "빌드" 세션이에요. 아래 가지를 main에 합치고 버전을 올려 빌드하고, 설치 파일을 대화로 보내요. 기능 코드는 충돌을 푸는 것 말고는 고치지 않아요.

**넣을 가지** (check = 그 커밋에서 `check.yml` 통과 여부. 2026-10-27 09:26부터 기능 세션은 검사를 기다리지 않고 "끝(검사 도는 중)"으로 멈추니, 빌드 세션이 여기서 확인해요. ✗면 넣지 않고 사용자에게 알려요. 문서·매뉴얼만 바꾼 가지는 검사가 돌지 않아 "–"로 두고 넣어요)

| 가지 | 커밋 | 요약 | check |
| --- | --- | --- | --- |
| [채울 곳] | [7자리] | [한 줄] | ✓ / ✗ |

**순서**
1. `git fetch origin` → 현황판에서 각 가지 줄이 "끝(합치기 기다림)" 또는 "끝(검사 도는 중)"인지, 커밋이 표와 같은지 확인. 다르면 멈추고 물어요.
   - check 확인: `gh run list -R zeondas/gilog --workflow check.yml --branch <가지> -L 1 --json headSha,conclusion`(headSha가 표의 커밋과 같고 success).
2. 가지마다 `git merge --no-ff origin/<가지> -m "합치기: <가지>"`(표 순서대로). 충돌 풀이 규칙:
   - `src/app.css` 끝에 서로 덧붙인 묶음은 **둘 다 남겨요**(앞 가지 묶음 → 뒤 가지 묶음 순서).
   - 같은 화면 파일(tsx·ts·rs)에서 같은 줄이 부딪치면 **뒤 가지 쪽**을 따르고, 앞 가지가 더한 다른 줄은 살려요. 뜻이 갈리면 멈추고 사용자에게 1안/2안으로 물어요.
   - CLAUDE.md는 main 쪽을 두고 빌드 줄만 고쳐요.
   - 다 합친 뒤 두 검사가 모두 0줄이어야 해요: `grep -rn "—" src src-tauri/src`(긴 줄표, 공통 결정 로그 2026-10-20 13:02) · `grep -rn "기Log" src src-tauri/src`(보이는 이름은 "기록", 2026-10-18 23:27).
3. 검사: `npm ci` → `npm run build` · `npm test`(규칙 + 화면 부품) · `cargo test --manifest-path src-tauri/core/Cargo.toml`(자료 올리기 시험 포함) · 가능하면 `cargo check --manifest-path src-tauri/Cargo.toml`. 모양 지킴이는 check.yml이 가지마다 4갈래로 돌려요(2026-10-29 `wip/ci2` 뒤 – check ✓면 지킴이도 통과) – 합친 뒤 전체 한 번은 그대로 해요. build.yml도 설치 파일 전에 `npm test`를 돌리고, 릴리스 제목이 "기록 0.N.0 (build-N)"이에요(태그는 `build-N` 그대로).
4. 버전 올리기 **4곳**(같은 값 0.N.0): `package.json`(→ `npm install --package-lock-only`로 `package-lock.json`도) · `src-tauri/tauri.conf.json` · `src-tauri/Cargo.toml`(`Cargo.lock`은 cargo가 따라 바꿔요) · `src/version.ts`. 커밋 이름 "0.N.0: <넣은 것 짧게>"(`[skip ci]` 글자는 쓰지 않아요).
5. 사양서(https://claude.ai/code/artifact/8a776f73-e26c-4e2c-9735-3dc7cd0885f4)에서 넣은 기능의 "(다음 빌드)" 표시를 지워요.
6. **허가를 따로 묻지 않고** 스스로 판단해 main에 올려요(2026-10-27 11:32 사용자 – 빌드 프롬프트를 준 것이 허가). 멈추고 묻는 것은 이때만: check 실패 가지 · 충돌의 뜻이 갈림 · 두 grep 수가 늘어남 · npm build·npm test·core 실패 · 지킴이에 바뀌기로 하지 않은 장면 차이. 올리면 build.yml이 돌아요. 실패하면 `gh api repos/zeondas/gilog/commits/<sha>/comments`로 오류를 읽어요.
7. 설치 파일 보내기(회사에서는 GitHub이 막혀 있어 파일이 먼저예요):
   - `gh api repos/zeondas/gilog/releases/tags/build-<번호>`로 asset id를 찾아
   - `gh api -H "Accept: application/octet-stream" repos/zeondas/gilog/releases/assets/<id> > giLog_<버전>_x64-setup.exe`(크기 확인 — `gh release download`는 막혀 있어요)
   - SendUserFile로 보내고, Releases 주소 https://github.com/zeondas/gilog/releases/tag/build-<번호> 도 함께 적어요.

**끝낼 때**
- 현황판: 빌드 줄 = 0.N.0(build-번호)·넣은 가지·설치 파일 크기·걸린 시간·"사용자 윈도우 시험 기다림". 합친 가지 줄은 지우고, [docs/history.md](https://github.com/zeondas/gilog/blob/main/docs/history.md) "버전별"에 `### 0.N.0(build-번호)` 칸을 만들어 가지마다 "들어간 것 · 시험" 두 줄로 옮겨요. 다 쓴 가지는 현황판 규칙 8에 "지워도 됨". `[skip ci]`로 main에.
- 사용자에게(해요체, 기술 용어 없이, 링크 함께) 번호 목록 세 가지:
  1. 들어간 것
  2. 제가 확인한 것(검사 결과, 두 grep 0줄, 버전 4곳)
  3. 윈도우에서 사용자가 시험할 것
