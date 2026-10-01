#!/usr/bin/env bash
# GitHub Pages の公開が「順番待ち」で止まったときに、詰まりの元を解除する。
#
# 症状: Pages のデプロイが waiting / queued のまま何時間も動かず、
#       以後のデプロイが全部 pending → cancelled になって公開が止まる
#       （= 羽田ライブのデータが古いまま固まる。2026-10-02に発生）。
# 対処: 一定時間(既定20分)より古い waiting/queued/pending のデプロイを打ち切る。
#       データ配信は6分おき＝正常なら20分も待たない。打ち切っても次の配信が公開される。
#
# 使い方: unstick-pages.sh <owner/repo> [何分より古いものを打ち切るか]
set -euo pipefail

repo="${1:?usage: unstick-pages.sh <owner/repo> [minutes]}"
limit_min="${2:-20}"
now="$(date -u +%s)"
found=0

for st in waiting queued pending; do
  while read -r id created; do
    [ -n "${id:-}" ] || continue
    created_epoch="$(date -u -d "$created" +%s 2>/dev/null || date -u -jf '%Y-%m-%dT%H:%M:%SZ' "$created" +%s)"
    age_min=$(( (now - created_epoch) / 60 ))
    if [ "$age_min" -ge "$limit_min" ]; then
      echo "stuck: $repo run $id status=$st age=${age_min}min -> cancel"
      gh run cancel "$id" -R "$repo" || echo "  (cancel できず: すでに終了済みの幽霊run)"
      found=1
    else
      echo "ok: $repo run $id status=$st age=${age_min}min (待たせない)"
    fi
  done < <(gh api "/repos/$repo/actions/runs?status=$st&per_page=50" \
             --jq '.workflow_runs[] | select(.name | test("pages"; "i")) | "\(.id) \(.created_at)"')
done

[ "$found" -eq 1 ] && echo "詰まりを解除した" || echo "詰まりなし"
exit 0
