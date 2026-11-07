#!/usr/bin/env bash
# Creates the public repo patbing/decision-pit from the decision-pit-app branch of the
# patbing/pollinations fork and turns on GitHub Pages. Run in an empty folder on your
# computer; needs git and gh logged in as patbing.
set -euo pipefail
git clone -q --single-branch -b decision-pit-app https://github.com/patbing/pollinations.git decision-pit
cd decision-pit
gh auth setup-git
gh repo create patbing/decision-pit --public --source=. --remote=public \
  --description "AI decision models trade a fake market (Pollinations quest #19176)"
git push -q public HEAD:main
gh api -X POST repos/patbing/decision-pit/pages -f 'source[branch]=main' -f 'source[path]=/'
echo "Pages: https://patbing.github.io/decision-pit/"
