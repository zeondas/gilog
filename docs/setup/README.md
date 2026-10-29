# 기록 준비 안내서 (준비 안내서 세션)

설치 파일만으로는 쓸 수 없는 세 기능(민원처리·구글 캘린더 연동·집행현황 팀 공유)을 다른 담당자가 혼자 준비하도록 안내해요. 2026-10-29 사용자 결정은 두 가지예요. 이 안내서는 매뉴얼과 따로 둬요(①2안). 모양은 매뉴얼과 같은 한글 양식이에요(②1안). 매뉴얼과 합치는 일은 나중에 해요.

## 파일
| 파일 | 내용 |
| --- | --- |
| `준비안내서.txt` | 원고(글은 여기서 고쳐요) |
| `양식.hwpx` | 사용자가 정한 매뉴얼 한글 양식(탐색기 앞부분 – `wip/manual`의 `docs/manual/hangul/사용자-원고-탐색기-앞부분.hwpx` 복사) |
| `make_hwpx.py` | 원고를 양식의 문단·글자 모양으로 한글 파일로 만들어요 |
| `기록-준비-안내서.hwpx` | 결과(담당자에게 이 파일을 줘요 – 회사에서는 GitHub가 막혀 있어서) |

다시 만들기:

```
python3 docs/setup/make_hwpx.py
```

## 캡처 목록 (사용자가 찍어 그림 틀에 넣어요)
1. 설정 › 민원처리 카드 (Claude 실행 파일·Claude 모델·폴더 줄)
2. claude.exe 검은 창의 로그인 안내
3. 크롬 웹 스토어 Claude 확장 화면
4. 설정 › 캘린더 카드 › 구글 연동 줄 (연결 전)
5. 구글 콘솔 – OAuth 동의 화면(게시 상태 "테스트")
6. 구글 콘솔 – 클라이언트 만들기(데스크톱 앱)
7. 구글 콘솔 – 테스트 사용자 추가
8. 구글 로그인 – "확인하지 않은 앱" 경고
9. 구글 로그인 – 권한 허용
10. 설정 › 집행현황 카드 › 팀 공유 (호스트가 시트를 만든 뒤)
11. 팀 공유 – 함께 쓰는 사람 명단

## 확인 필요 (원고의 【확인 필요】)
- 회사 PC에서 claude.ai 로그인·크롬 웹 스토어 확장 설치·구글 로그인·구글 시트 새로고침이 되는지
- claude.exe를 다른 담당자에게 어떻게 건넬지
- 설치 파일에 구글 앱 정보가 들어 있는지, 콘솔 게시 상태와 클라이언트 종류

## 구글 제한 수치 (2026-10-29 확인)
- 테스트 상태 앱의 테스트 사용자는 100명까지예요.
- 테스트 사용자의 허락은 7일 뒤 끝나요. 메일·이름 같은 기본 권한만 쓰면 예외인데, 기록은 캘린더 권한을 써서 예외가 아니에요.
- 출처: [Google Cloud 고객센터 – 앱 게시 상태·사용자 유형](https://support.google.com/cloud/answer/15549945)

## 근거 (앱 기준 커밋 main `362f9e4`)
- 민원처리: `src/process.ts`(`processError`), `src-tauri/src/process.rs`(`claude_exe`·`explain`), `src/screens/process/Screen.tsx`, 설정 `src/screens/settings/Table.tsx`
- 구글: `src/google.ts`(권한·`friendly`·`BUILTIN_CLIENT`), 설정 구글 연동 줄
- 팀 공유: `src/budgetShare.ts`(`shareErrorText`), `src/BudgetShareCard.tsx`, [share-twin.md](https://github.com/zeondas/gilog/blob/main/docs/qa/share-twin.md)
- 설정 "민원처리" 준비 단계 카드(✓/✗ 세 줄)가 들어오면 제2장을 그 카드 기준으로 고쳐요.
