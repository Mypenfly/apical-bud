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

if [[ ! -f "$skill_target/scripts/gate.mjs" ]]; then
  cat >&2 <<EOF
提示：在 $skill_target 没找到 skill（scripts/gate.mjs）。
本 preset 的门禁工具需要 skill 才能校验讨论树；请先把本仓库的 skill 装好：
  git clone <repo> "$skill_target"
（或在该 preset 的 apical-gate 行里配置 gateScript: <仓库>/scripts/gate.mjs）
EOF
fi

mkdir -p "$(dirname "$target")"
rm -rf "$target"
mkdir -p "$target/lib"
cp "$source_dir/preset.yml" "$source_dir/agent.cordis.yml" \
   "$source_dir/apical-gate.mjs" "$source_dir/apical-guard.mjs" "$source_dir/selftest.mjs" \
   "$target/"
cp "$source_dir/lib/apical-state.mjs" "$target/lib/"
[[ -f "$source_dir/README.md" ]] && cp "$source_dir/README.md" "$target/"

cat <<EOF
已安装 preset → $target

下一步：
  1. 重启 DSH（或至少新开一个会话）让名单刷新；
  2. 新建会话时在 preset 选择器里选「顶芽模式」；
  3. 自检（可选）：node "$target/selftest.mjs"

逃生阀：环境变量 DSH_APICAL_UNLOCK=1 可临时解除写守卫；
或在 $target/agent.cordis.yml 的 apical-guard 行里用 allowPaths 放行额外路径。
EOF
