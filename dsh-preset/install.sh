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

if [[ ! -f "$skill_target/scripts/check.mjs" ]]; then
  cat >&2 <<EOF
提示：在 $skill_target 没找到 skill（scripts/check.mjs）。
本 preset 的体检工具（apical_check）要调用 skill 的体检脚本才能校验讨论根；请先把本仓库的 skill 装好：
  git clone <repo> "$skill_target"
（或在该 preset 的 apical-check 行里配置 checkScript: <仓库>/scripts/check.mjs；
 或设环境变量 APICAL_CHECK_SCRIPT 指向该文件。写守卫与横幅不依赖 skill，缺了也照常工作。）
EOF
fi

mkdir -p "$(dirname "$target")"
rm -rf "$target"
mkdir -p "$target/lib"
cp "$source_dir/preset.yml" "$source_dir/agent.cordis.yml" \
   "$source_dir/apical-check.mjs" "$source_dir/apical-guard.mjs" "$source_dir/selftest.mjs" \
   "$target/"
cp "$source_dir/lib/apical-tree.mjs" "$target/lib/"
if [[ -f "$source_dir/README.md" ]]; then
  cp "$source_dir/README.md" "$target/"
fi

cat <<EOF
已安装 preset → $target

下一步：
  1. 重启 DSH（或至少新开一个会话）让名单刷新；
  2. 新建会话时在 preset 选择器里选「顶芽模式」；
  3. 自检（可选）：node "$target/selftest.mjs"

工具：apical_check —— action=check 跑体检（缺件是硬拦，其余是警告）；
      action=map 生成并回显 map.md；action=trees 列出项目里的全部讨论根。
旋钮：$target/agent.cordis.yml 里 apical-check 行的 checkScript: <仓库>/scripts/check.mjs，
      或环境变量 APICAL_CHECK_SCRIPT（旧名 APICAL_GATE_SCRIPT 仍作回退）。
逃生阀：环境变量 DSH_APICAL_UNLOCK=1 可临时解除写守卫；
        或在 apical-guard 行里用 allowPaths 放行额外可写路径前缀。
EOF
