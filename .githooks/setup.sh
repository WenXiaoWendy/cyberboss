#!/bin/bash
# Git Hook 自动安装脚本
# 在 npm install 时自动运行，无需手动配置

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_ROOT="$(cd "$HOOK_DIR/.." && git rev-parse --git-dir 2>/dev/null || echo '.git')"
GIT_HOOKS_DIR="$GIT_ROOT/hooks"

# 确保 .git/hooks 目录存在
mkdir -p "$GIT_HOOKS_DIR"

# 创建 pre-commit hook（检测文件变化时自动更新 profile）
cat > "$GIT_HOOKS_DIR/pre-commit" << 'HOOK_CONTENT'
#!/bin/bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.githooks/update-profile.js"
HOOK_CONTENT

chmod +x "$GIT_HOOKS_DIR/pre-commit"

echo "✅ Git hooks 已安装"
echo "   - .git/hooks/pre-commit: 每次提交时自动检测核心文件变化并更新 PROJECT_SPECIFICATION_PROFILE.json"
echo ""
echo "📝 如需手动卸载，运行: rm .git/hooks/pre-commit"
