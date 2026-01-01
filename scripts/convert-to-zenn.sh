#!/bin/bash
# Convert article markdown to Zenn format
# Usage: convert-to-zenn.sh <input.md> [options]
#
# Options:
#   --repo <owner/repo> GitHub repo (default: from git remote)
#   --output <file>     Output file (default: stdout)
#   --lang-slug <slug>  Slug for language link (ja→en or en→ja)

set -euo pipefail

# Parse arguments
INPUT=""
REPO=""
OUTPUT=""
LANG_SLUG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --lang-slug) LANG_SLUG="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# //'
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) INPUT="$1"; shift ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 <input.md> [options]" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "File not found: $INPUT" >&2
  exit 1
fi

# Get repo from git remote if not specified
if [[ -z "$REPO" ]]; then
  REPO=$(git remote get-url origin 2>/dev/null | perl -pe 's#.*github\.com[:/](.+?/[^.]+?)(\.git)?$#$1#' || echo "")
  if [[ -z "$REPO" ]]; then
    echo "Could not determine repo. Use --repo option." >&2
    exit 1
  fi
fi

# Convert using perl
convert() {
  perl -0777 -pe '
    # 1. Remove h1 after frontmatter (first # line after second ---)
    s/(^---\n.*?^---\n)\s*^# [^\n]+\n\n?/$1/ms;

    # 2. Convert language links if LANG_SLUG is set
    my $lang_slug = $ENV{LANG_SLUG};
    if ($lang_slug) {
      s/\(article-[^)]+\.md\)/($lang_slug)/g;
    }

    # 3. Convert relative paths to GitHub links
    my $repo = $ENV{REPO};
    s/\]\(([^)#:]+\.(?:js|ts|txt|json|cpuprofile|sh))\)/](https:\/\/github.com\/$repo\/blob\/main\/$1)/g;

    # 4. Convert image relative paths to raw.githubusercontent.com
    s/!\[([^\]]*)\]\(([^)#:]+\.(?:png|jpg|jpeg|gif|svg|webp))\)/![$1](https:\/\/raw.githubusercontent.com\/$repo\/main\/$2)/g;

    # 5. Convert Twitter/X links to Zenn embed format
    # Bare URL → @[tweet](URL)
    s/(?<!\])\((https:\/\/(?:x\.com|twitter\.com)\/[^\/]+\/status\/\d+)\)/\@[tweet]($1)/g;
    s/(?<![(\[])(https:\/\/(?:x\.com|twitter\.com)\/[^\/]+\/status\/\d+)(?!\))/\@[tweet]($1)/g;
    # [text](URL)... → keep link + trailing text, add @[tweet](URL) after
    s/(\[[^\]]+\]\((https:\/\/(?:x\.com|twitter\.com)\/[^\/]+\/status\/\d+)\))([^\n]*)/$1$3\n\n\@[tweet]($2)/g;

    # 6. Convert <details><summary> to Zenn format
    s/<details>\s*<summary>([^<]+)<\/summary>/:::details $1/g;
    s/<\/details>/:::/g;
  ' "$INPUT"
}

# Output
if [[ -n "$OUTPUT" ]]; then
  REPO="$REPO" LANG_SLUG="$LANG_SLUG" convert > "$OUTPUT"
  echo "Converted: $INPUT → $OUTPUT" >&2
else
  REPO="$REPO" LANG_SLUG="$LANG_SLUG" convert
fi
