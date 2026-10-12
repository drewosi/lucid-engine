#!/bin/sh
# Exercises the CSP logic of the container without Docker: runs the envsh against a
# scratch copy of app.html and checks the result. Usage: sh deploy/test-csp.sh
set -e
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

run() { cp "$here/../app.html" "$tmp/app.html"; ( export HTML_DIR="$tmp"; "$@" ); }
meta() { grep -o 'connect-src [^;"]*;' "$tmp/app.html" | head -1; }

# default: unchanged cloud hosts + localhost
run sh -c ". '$here/10-meridian-csp.envsh' >/dev/null"
[ "$(meta)" = "connect-src https://api.anthropic.com https://api.openai.com http://localhost:* http://127.0.0.1:*;" ] || fail "default connect-src changed: $(meta)"

# air-gapped with a gateway and an audit collector
run sh -c "MERIDIAN_AIRGAP=1 LLM_ORIGIN=https://llm.corp.example AUDIT_ORIGIN=https://audit.corp.example:8443 . '$here/10-meridian-csp.envsh' >/dev/null"
[ "$(meta)" = "connect-src http://localhost:* http://127.0.0.1:* https://llm.corp.example https://audit.corp.example:8443;" ] || fail "airgap connect-src wrong: $(meta)"
grep "Content-Security-Policy" "$tmp/app.html" | grep -q "api.anthropic.com" && fail "air-gapped CSP still allows a public AI host"

# bad origins are refused, not interpolated
for bad in "http://insecure.example" "https://evil.example/path" "https://*.example" "https://a.example;script-src *" "https://u:p@host.example"; do
  if ( HTML_DIR="$tmp" AUDIT_ORIGIN="$bad" sh -c ". '$here/10-meridian-csp.envsh'" ) >/dev/null 2>&1; then fail "accepted bad origin: $bad"; fi
done
# the rest of the meta CSP is untouched
cp "$here/../app.html" "$tmp/app.html"
( HTML_DIR="$tmp" MERIDIAN_AIRGAP=1 sh -c ". '$here/10-meridian-csp.envsh'" ) >/dev/null
grep -q "script-src 'self'; style-src" "$tmp/app.html" || fail "script-src was disturbed"
echo "csp: ok"
