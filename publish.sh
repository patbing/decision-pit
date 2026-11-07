#!/usr/bin/env bash
# Run on your computer (needs git + gh logged in as patbing). Creates the public repo, pushes, enables Pages.
set -e
unzip -q decision-pit.zip && cd decision-pit
git init -q -b main && git add -A && git commit -qm "Decision Pit: AI decision models trade a fake market (quest #19176)"
gh repo create patbing/decision-pit --public --source=. --push \
  --description "AI decision models trade a fake market (Pollinations quest #19176)"
gh api -X POST repos/patbing/decision-pit/pages -f 'source[branch]=main' -f 'source[path]=/'
echo "Pages: https://patbing.github.io/decision-pit/"
