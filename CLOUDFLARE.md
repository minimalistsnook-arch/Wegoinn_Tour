# Cloudflare Pages

이 프로젝트의 실제 사이트는 `wegoinn/`입니다. `npm run build`는 Guest/Admin HTML, CSS, JavaScript만 `dist/`로 복사합니다. SQL과 문서는 배포에 포함하지 않습니다.

기존 Cloudflare Pages 프로젝트의 Git 연결 설정:

- 저장소: `minimalistsnook-arch/Wegoinn_Tour`
- 프로덕션 브랜치: `main`
- 루트 디렉터리: 저장소 루트 (빈 값)
- 빌드 명령: `npm run build`
- 빌드 출력 디렉터리: `dist`

Git 연동이 활성화되어 있으면 main 푸시마다 자동 배포됩니다. 기존 빌드 명령이 `npx vite build`라면 `npm run build`로 변경하세요.

직접 배포할 때:

```bash
npx wrangler login
npm run deploy
```

기존 Pages 프로젝트 이름이 `wegoinn-tour`가 아니라면 해당 이름으로 다음 명령을 실행하세요.

```bash
npm run build
npx wrangler pages deploy dist --project-name YOUR_PROJECT_NAME --branch main
```

Supabase 로그인과 데이터 저장은 `wegoinn/js/config.js`의 공개 URL/anon key 설정 및 DB 스키마 적용이 필요합니다.
