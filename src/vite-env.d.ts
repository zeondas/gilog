/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 구글 연동 앱 정보(JSON). 설치 파일을 만들 때 GitHub 비밀 값에서 넣어요. */
  readonly VITE_GOOGLE_CLIENT?: string;
}
