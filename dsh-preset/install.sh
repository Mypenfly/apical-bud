#!/usr/bin/env bash
# Install (or refresh) the apical-bud DSH agent preset from this folder.
#
# The preset roster discovers presets as plain directories under
# `$DSH_HOME/.agent-presets/<id>/`; it does NOT follow symlinks, so this installs
# a real copy. Re-run it after `git pull` to refresh that copy.
#
# Usage:
#   ./install.sh                 # install into $DSH_HOME (default ~/.dsh)
#   DSH_HOME=/path ./install.sh  # install into another harness home

set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
target="$dsh_home/.agent-presets/apical-bud"
skill_target="$dsh_home/skills/apical-bud"

if [[ ! -f "$skill_target/SKILL.md" ]]; then
  cat >&2 <<EOF
提示：在 $skill_target 没找到 skill（SKILL.md）。
本 preset 的 persona 第一句就是"读 skill 的 SKILL.md"，方法本体全在 skill 里；请先把仓库的 skill 部分装上：
  git clone <repo> "$skill_target"
写守卫与状态横幅不依赖 skill，缺了也照常工作。
EOF
fi

mkdir -p "$(dirname "$target")"
rm -rf "$target"
mkdir -p "$target"
cp "$source_dir/preset.yml" "$source_dir/agent.cordis.yml" \
   "$source_dir/apical-guard.mjs" "$source_dir/smoke.mjs" \
   "$target/"
if [[ -f "$source_dir/README.md" ]]; then
  cp "$source_dir/README.md" "$target/"
fi

cat <<EOF
已安装 preset → $target

下一步：
  1. 重启 DSH（或至少新开一个会话）让名单刷新；
  2. 新建会话时在 preset 选择器里选「顶芽模式」；
  3. 自检（可选）：node "$target/smoke.mjs"

这一版只有两个机制：写守卫（只放行 design/<slug>/，seed.md 的「用户原话」只追加）
与每轮一行的状态横幅（核心问题、现状、缺口数、边界是否填齐）。
同会话实现：在宿主环境设 DSH_APICAL_UNLOCK=1，或在 apical-guard 行的 allowPaths 里放行项目目录。
EOF
