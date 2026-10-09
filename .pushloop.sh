#!/bin/sh
cd "C:/Users/Luxef/New folder (6)" || exit 1
MINE=$(git rev-parse HEAD)
for i in 1 2 3 4 5 6; do
  git fetch origin main -q
  if git merge-base --is-ancestor "$MINE" origin/main; then echo "LANDED"; exit 0; fi
  if ! git merge origin/main --no-edit -q; then echo "CONFLICT"; git merge --abort 2>/dev/null; exit 2; fi
  MINE=$(git rev-parse HEAD)
  git push origin main 2>&1 | tail -2
done
git fetch origin main -q
git merge-base --is-ancestor "$MINE" origin/main && echo "LANDED late" || echo "NOT LANDED"
