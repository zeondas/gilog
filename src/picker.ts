// 구글 "파일 고르기" 창(Google Picker) — 집행현황 팀 공유에서 팀원이 시트를 처음 한 번 골라 묶을 때 써요.
// drive.file 권한은 앱이 만들었거나 이 창에서 고른 파일만 보이게 해 줘요(2026-10-20 사용자 1안).
// 지금은 "기록 앱 안에서 이 창이 뜨는지" 시험용으로 설정 카드에서 불러요(시험 뒤 팀 공유 화면이 써요).

type PickerResult = { id: string; name: string } | null;

declare global {
  interface Window {
    gapi?: { load: (name: string, cb: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
  }
}

let loading: Promise<void> | null = null;

/** apis.google.com의 api.js를 한 번 읽고 picker 모듈을 불러요. */
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((ok, bad) => {
    const fail = (why: string) => {
      loading = null;
      bad(new Error(why));
    };
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onerror = () => fail("구글 파일 고르기 창 코드를 받지 못했어요(인터넷·회사 망 확인).");
    s.onload = () => {
      if (!window.gapi) return fail("구글 코드가 이상해요(gapi 없음).");
      window.gapi.load("picker", {
        callback: () => ok(),
        onerror: () => fail("파일 고르기 창 모듈을 받지 못했어요."),
        timeout: 15000,
        ontimeout: () => fail("파일 고르기 창 모듈을 받는 데 15초를 넘었어요."),
      });
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * 시트만 보이는 파일 고르기 창을 띄워요. 고르면 {id, name}, 닫으면 null.
 * apiKey는 구글 콘솔의 "API 키"(Picker API 켬), appId는 프로젝트 번호예요.
 */
export async function pickSheet(o: { token: string; apiKey: string; appId: string }): Promise<PickerResult> {
  await loadPicker();
  const g = window.google;
  return new Promise<PickerResult>((ok) => {
    const view = new g.picker.DocsView(g.picker.ViewId.SPREADSHEETS).setMode(g.picker.DocsViewMode.LIST).setIncludeFolders(false);
    const picker = new g.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(o.token)
      .setDeveloperKey(o.apiKey)
      .setAppId(o.appId)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setLocale("ko")
      .setTitle("함께 쓸 집행현황 시트 고르기")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .setCallback((d: any) => {
        const act = d[g.picker.Response.ACTION];
        if (act === g.picker.Action.PICKED) {
          const doc = d[g.picker.Response.DOCUMENTS]?.[0];
          ok(doc ? { id: String(doc[g.picker.Document.ID]), name: String(doc[g.picker.Document.NAME] ?? "") } : null);
        } else if (act === g.picker.Action.CANCEL) {
          ok(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
