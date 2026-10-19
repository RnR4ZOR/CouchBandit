#!/usr/bin/env bash
# Couch Bandit: give this Mac read + write access to GitHub (RnR4ZOR).
# Your only jobs: your Mac password if asked, and approving the login in the browser.
REPO="RnR4ZOR/CouchBandit"
DEST="$HOME/CouchBandit"

echo "== 1. Installing tools =="
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Installing Apple's developer tools (includes git). Click Install in the pop-up."
  xcode-select --install 2>/dev/null
  until xcode-select -p >/dev/null 2>&1; do sleep 10; done
fi
echo "git ready."

if ! command -v gh >/dev/null; then
  if command -v brew >/dev/null; then
    brew install gh
  else
    echo "Downloading GitHub CLI..."
    PKG_URL=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -o 'https://[^"]*macOS_universal\.pkg' | head -1)
    curl -fsSL "$PKG_URL" -o /tmp/gh.pkg
    echo "Enter your Mac password to install it:"
    sudo installer -pkg /tmp/gh.pkg -target /
    export PATH="/usr/local/bin:$PATH"
  fi
fi
command -v gh >/dev/null || { echo "Couldn't install GitHub CLI. Get it from https://cli.github.com and run this again."; exit 1; }
echo "gh ready."

echo "== 2. Signing in to GitHub =="
if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "A browser will open. Press Enter here, type the code shown, click Authorize."
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
fi
gh auth setup-git
ME=$(gh api user --jq .login)
echo "Signed in as $ME"

echo "== 3. Getting Couch Bandit =="
git config --global user.name  >/dev/null || git config --global user.name "$ME"
git config --global user.email >/dev/null || git config --global user.email "$(gh api user --jq .id)+$ME@users.noreply.github.com"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull; else gh repo clone "$REPO" "$DEST"; fi

echo
if [ "$(gh api "repos/$REPO" --jq .permissions.push)" = "true" ]; then
  echo "Done. Read + write access confirmed. Couch Bandit is in $DEST"
else
  echo "Signed in, but this account can't push to $REPO. Make sure you signed in as RnR4ZOR."
fi
