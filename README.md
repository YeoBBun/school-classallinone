# 학급관리

담임교사용 학급 관리 웹앱. 학생 출결 상황·증빙서류 수합, 관찰·상담 기록, 학생별 한눈에 보기. 설계는 [docs/DESIGN.md](docs/DESIGN.md) 참고.

- 데이터는 브라우저 안(IndexedDB)에만 저장되고 외부로 전송되지 않습니다.
- 다른 컴퓨터로 옮기거나 브라우저 데이터를 지우기 전에 **설정 → 백업**에서 백업 파일을 저장하세요.
- 안드로이드 홈 화면 위젯(받을 서류): [android-widget/README.md](android-widget/README.md)
- 나이스 자동 입력: [YeoBBun/neis-automation-kit](https://github.com/YeoBBun/neis-automation-kit) (출결 앱 연동판 키트)

## 개발

```bash
npm install
npm run dev      # 개발 서버
npm test         # 규칙 로직 테스트
npm run build    # dist/ 에 정적 파일 생성
```

## 배포 (GitHub Pages)

저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꾸면,
푸시할 때마다 `.github/workflows/deploy.yml` 이 빌드해서 배포합니다.
(Source 를 "Deploy from a branch" 로 두면 빌드 전 소스가 그대로 올라가 화면이 뜨지 않고 404 오류가 납니다.)
