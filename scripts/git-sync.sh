#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
expected_remote='https://github.com/minimalistsnook-arch/Wegoinn_Tour.git'
remote="$(git remote get-url origin)"
if [[ "$remote" != "$expected_remote" && "$remote" != 'git@github.com:minimalistsnook-arch/Wegoinn_Tour.git' ]]; then
  echo 'origin이 Wegoinn_Tour 저장소가 아닙니다. GIT_SYNC.md를 확인하세요.' >&2
  exit 1
fi
branch="$(git symbolic-ref --quiet --short HEAD)"
if [[ -n "$(git ls-files -u)" ]]; then
  echo '먼저 Git 충돌을 해결하세요.' >&2
  exit 1
fi

sync_once() {
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "chore: auto sync $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  fi
  git push --set-upstream origin "$branch"
}

case "${1:-}" in
  '') sync_once ;;
  --watch)
    interval="${GIT_SYNC_INTERVAL:-30}"
    if [[ ! "$interval" =~ ^[1-9][0-9]*$ ]]; then
      echo 'GIT_SYNC_INTERVAL은 양의 정수(초)여야 합니다.' >&2
      exit 1
    fi
    echo "${interval}초마다 ${branch} 브랜치를 자동 커밋·푸시합니다. 종료: Ctrl+C"
    while true; do
      sync_once
      sleep "$interval"
    done
    ;;
  *) echo '사용법: bash scripts/git-sync.sh [--watch]' >&2; exit 1 ;;
esac
