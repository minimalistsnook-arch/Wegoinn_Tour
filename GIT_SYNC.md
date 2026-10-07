# GitHub 자동 커밋·푸시

저장소: https://github.com/minimalistsnook-arch/Wegoinn_Tour

## 최초 연동

GitHub CLI(`gh`)가 설치된 터미널에서 실행하세요.

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

명령이 표시하는 일회용 코드를 https://github.com/login/device 에 입력해 인증합니다. 코드는 로그인 명령 실행 시 발급됩니다.

현재 작업 폴더에서 원격 저장소를 등록하세요.

```bash
git remote add origin https://github.com/minimalistsnook-arch/Wegoinn_Tour.git
```

이미 origin이 등록되어 있다면 대신 다음 명령을 사용하세요.

```bash
git remote set-url origin https://github.com/minimalistsnook-arch/Wegoinn_Tour.git
```

Git 작성자 정보가 없다면 본인 정보로 설정하세요.

```bash
git config user.name "YOUR_NAME"
git config user.email "YOUR_GITHUB_EMAIL"
```

## 실행

```bash
# 한 번 커밋·푸시
npm run git:sync

# 터미널이 실행 중인 동안 30초마다 자동 커밋·푸시
npm run git:watch
```

현재 브랜치를 같은 이름의 원격 브랜치로 푸시합니다. 모든 변경 사항(삭제 포함)을 커밋하며, `.gitignore`로 제외된 미추적 파일은 추가하지 않습니다. 이미 추적 중인 파일에는 `.gitignore`가 적용되지 않습니다. 종료는 Ctrl+C입니다.

인증 실패, 충돌 또는 원격 이력 불일치로 푸시가 거절되면 중단합니다. 원격 저장소에 별도 이력이 있다면 먼저 확인하고 병합한 뒤 다시 실행하세요. 강제 푸시는 수행하지 않습니다.
