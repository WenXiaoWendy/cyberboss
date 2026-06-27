#!/bin/bash
# 扫描 uu 的三个项目，检查是否有已 commit 未 push 的提交
# 用法: bash scripts/git-push-check.sh [--push]

PROJECTS=(
  "D:/uuHalo:master"
  "D:/uuHalo-gateway:master"
  "D:/cyberboss-app:main"
)

AUTO_PUSH=false
if [ "$1" = "--push" ]; then
  AUTO_PUSH=true
fi

echo "=== $(date '+%Y-%m-%d %H:%M') git push 检查 ==="

for entry in "${PROJECTS[@]}"; do
  dir="${entry%%:*}"
  branch="${entry##*:}"
  name=$(basename "$dir")

  if [ ! -d "$dir/.git" ]; then
    alt_dir=$(echo "$dir" | sed 's|^[Dd]:|/d|')
    if [ -d "$alt_dir/.git" ]; then
      dir="$alt_dir"
    else
      echo "[$name] 不是 git 仓库，跳过"
      continue
    fi
  fi

  cd "$dir" || continue

  # 先 fetch 一下远程
  git fetch origin "$branch" 2>/dev/null

  count=$(git log "origin/$branch..HEAD" --oneline 2>/dev/null | wc -l)

  if [ "$count" -gt 0 ]; then
    echo "[$name] ⚠ $count 个提交未推送:"
    git log "origin/$branch..HEAD" --oneline
    if $AUTO_PUSH; then
      echo "[$name] 自动推送中..."
      git push origin "$branch"
    fi
  else
    echo "[$name] ✅ 已同步"
  fi
  echo ""
done

echo "=== 检查完毕 ==="
