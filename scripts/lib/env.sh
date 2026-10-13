# Helpers for reading and writing KEY=value lines in .env (sourced, not run).
# Portable across GNU and BSD/macOS (no sed -i). Run from the repo root.

env_get() {  # $1 = key; prints the value with surrounding quotes stripped
  local val
  val=$(grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)
  val=${val%\"}; val=${val#\"}; val=${val%\'}; val=${val#\'}
  printf '%s' "$val"
}

env_set() {  # $1 = key, $2 = value; replaces the line or appends it
  local tmp
  tmp=$(mktemp)
  if grep -qE "^$1=" .env; then
    K="$1" V="$2" awk 'index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' .env > "$tmp"
  else
    cat .env > "$tmp"; printf '%s=%s\n' "$1" "$2" >> "$tmp"
  fi
  cat "$tmp" > .env; rm -f "$tmp"
}
