/**
 * 휴대폰 '학급관리' 앱(android-widget/) 안에서 열렸을 때 앱이 넣어 주는 연결.
 * 앱 화면(WebView) 안에서는 파일 내려받기·공유가 그냥은 안 돼서 앱에 맡긴다. 구글 로그인은 google.ts 가 따로 쓴다.
 * (예전 '출결' 위젯 앱은 같은 것을 AttendanceApp 이름으로 넣는다)
 */
interface AndroidBridge {
  /** 저장 위치를 고르는 창을 띄워 저장한다 */
  saveFile(name: string, mime: string, base64: string): void;
  /** 공유 창(구글 드라이브 등)으로 보낸다 */
  shareFile(name: string, mime: string, base64: string): void;
  /** 위젯이 같은 동기화 설정(구글 계정·잠금 비밀번호)으로 처리 예정을 받아 오게 넘긴다 (끄면 빈 문자열). 이전 버전 앱에는 없다 */
  setSyncConfig?(json: string): void;
}

export function androidApp(): AndroidBridge | undefined {
  const w = window as unknown as { ClassApp?: AndroidBridge; AttendanceApp?: AndroidBridge };
  return w.ClassApp ?? w.AttendanceApp;
}

export function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
