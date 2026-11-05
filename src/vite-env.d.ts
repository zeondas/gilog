/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 구글 연동 앱 정보(JSON). 설치 파일을 만들 때 GitHub 비밀 값에서 넣어요. */
  readonly VITE_GOOGLE_CLIENT?: string;
  /** 카카오 JavaScript 키(민원 지도 ✔4). 설치 파일을 만들 때 GitHub 비밀 KAKAO_JS_KEY에서 넣어요. 저장소엔 없어요. */
  readonly VITE_KAKAO_JS_KEY?: string;
}
