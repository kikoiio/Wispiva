#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RT="${LUANTI_RT:-$HERE/.runtime}"
CLIENT="$RT/root/usr/libexec/luanti/luanti"
LUA_HOME="$RT/home"
PORT=30078
NAME="observer"
SECONDS_MAX=0
RANDOM_INPUT=0
LOGFILE=""
CONFIG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --seconds) SECONDS_MAX="$2"; shift 2 ;;
    --random-input) RANDOM_INPUT=1; shift ;;
    --logfile) LOGFILE="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '1,34p' "$0"; exit 0 ;;
    *) echo "view_product.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

[[ -x "$CLIENT" ]] || { echo "view_product.sh: client unavailable: $CLIENT" >&2; exit 2; }
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]] || {
  echo "view_product.sh: invalid port" >&2; exit 2;
}
[[ "$NAME" =~ ^[A-Za-z0-9_-]{1,20}$ ]] || { echo "view_product.sh: invalid name" >&2; exit 2; }
[[ "$SECONDS_MAX" =~ ^[0-9]+$ ]] || { echo "view_product.sh: invalid seconds" >&2; exit 2; }
if [[ -n "$LOGFILE" ]]; then
  mkdir -p "$(dirname "$LOGFILE")"
fi

# X11 often reports 96 DPI on a much denser panel, so text stays tiny.
# Scale from the connected panel's pixel size and physical size.
screen_scale="$(python3 - <<'PY'
import re, subprocess
try:
    text = subprocess.check_output(["xrandr", "--query"], text=True, stderr=subprocess.DEVNULL)
except (OSError, subprocess.CalledProcessError):
    print("")
    raise SystemExit
line = next((item for item in text.splitlines() if " connected" in item), "")
size = re.search(r"(\d+)x(\d+)\+", line)
span = re.search(r"(\d+)mm x (\d+)mm", line)
if not size or not span:
    print("")
    raise SystemExit
px, py = int(size.group(1)), int(size.group(2))
mx, my = int(span.group(1)), int(span.group(2))
if min(px, py) < 100 or min(mx, my) < 80:
    print("")
    raise SystemExit
ppi = (px * px + py * py) ** 0.5 / (mx * mx + my * my) ** 0.5 * 25.4
factor = min(5.0, max(1.0, ppi / 96.0))
print("" if factor < 1.05 else f"{factor:.2f}")
PY
)"
launch_config="$CONFIG"
if [[ -n "$screen_scale" ]]; then
  launch_config="$RT/view-scale.conf"
  if [[ -n "$CONFIG" ]]; then
    cat "$CONFIG" > "$launch_config"
  else
    : > "$launch_config"
  fi
  if ! grep -q '^display_density_factor[[:space:]]*=' "$launch_config"; then
    printf '\ndisplay_density_factor = %s\n' "$screen_scale" >> "$launch_config"
  fi
  chmod 600 "$launch_config"
fi

# The unpacked engine looks for translations under share/luanti/locale.
# The catalogs ship in share/locale, and the system directory does not have them.
locale_link="$RT/root/usr/share/luanti/locale"
if [[ ! -e "$locale_link" && -d "$RT/root/usr/share/locale" ]]; then
  ln -s ../locale "$locale_link"
fi

ui_choice="zh"
ui_lang_file="${XDG_CONFIG_HOME:-$HOME/.config}/wispiva/language"
if [[ -f "$ui_lang_file" ]]; then
  ui_choice="$(tr -cd 'a-z' < "$ui_lang_file" | head -c 8)"
fi
client_language="zh_CN"
[[ "$ui_choice" == "en" ]] && client_language="en"
if [[ -z "$launch_config" ]]; then
  launch_config="$RT/view-lang.conf"
  : > "$launch_config"
fi
language_tmp="${launch_config}.language"
grep -v '^language[[:space:]]*=' "$launch_config" > "$language_tmp" || true
printf 'language = %s\n' "$client_language" >> "$language_tmp"
mv "$language_tmp" "$launch_config"
chmod 600 "$launch_config"

args=(--address 127.0.0.1 --port "$PORT" --name "$NAME" --go)
if [[ "$RANDOM_INPUT" -eq 1 ]]; then args+=(--random-input); fi
if [[ -n "$LOGFILE" ]]; then args+=(--logfile "$LOGFILE"); fi
if [[ -n "$launch_config" ]]; then args+=(--config "$launch_config"); fi

if [[ "$SECONDS_MAX" -eq 0 ]]; then
  HOME="$LUA_HOME" LD_LIBRARY_PATH="$RT/root/usr/lib/x86_64-linux-gnu" \
    "$CLIENT" "${args[@]}"
else
  set +e
  HOME="$LUA_HOME" LD_LIBRARY_PATH="$RT/root/usr/lib/x86_64-linux-gnu" \
    timeout --signal=TERM "${SECONDS_MAX}s" "$CLIENT" "${args[@]}"
  status=$?
  set -e
  [[ "$status" -eq 124 || "$status" -eq 143 ]] && exit 0
  exit "$status"
fi
