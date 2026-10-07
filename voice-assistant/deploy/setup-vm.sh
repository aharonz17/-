#!/usr/bin/env bash
# ============================================================================
#  התקנת העוזר הקולי על שרת Ubuntu, בפקודה אחת.
#
#  נבנה ל-e2-micro החינמי של Google Cloud, אבל עובד על כל Ubuntu 22.04/24.04
#  עם כתובת IP ציבורית ופורטים 80 ו-443 פתוחים.
#
#  מה הוא עושה:
#    1. מתקין Node.js 22, git ו-Caddy (שרת HTTPS עם תעודה אוטומטית)
#    2. מוריד את הקוד מ-GitHub ומתקין אותו
#    3. שואל אותך על המפתחות ויוצר קובץ .env (רק בהרצה הראשונה)
#    4. מגדיר את העוזר כשירות שעולה לבד אחרי הפעלה מחדש ונופל-וקם
#    5. נותן כתובת HTTPS ומדפיס את שתי השורות להדבקה בימות
#
#  הרצה חוזרת בטוחה: מעדכנת את הקוד ומשאירה את ההגדרות והנתונים.
#
#  למה שרת ולא Cloud Run: ב-Cloud Run הדיסק נמחק בכל הפעלה מחדש, ואיתו
#  מסד הנתונים של התזכורות. כאן הדיסק קבוע והשרת לא נרדם.
# ============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aharonz17/-.git}"
BRANCH="${BRANCH:-claude/eloquent-pascal-cc5uvt}"
INSTALL_DIR="/opt/assistant"
APP_DIR="$INSTALL_DIR/voice-assistant"
SERVICE_USER="assistant"
PORT=8080

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "צריך להריץ עם sudo"

# ---------------------------------------------------------------------------
say "1/6  התקנת תוכנות"
export DEBIAN_FRONTEND=noninteractive
# שרת חדש מריץ עדכונים אוטומטיים בדקות הראשונות ונועל את apt. מחכים במקום להיכשל.
apt_get() { apt-get -o DPkg::Lock::Timeout=600 "$@"; }
apt_get update -qq
apt_get install -y -qq git curl ca-certificates gnupg build-essential python3 \
    debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt_get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node --version)"

if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt_get update -qq
    apt_get install -y -qq caddy >/dev/null
fi
ok "Caddy $(caddy version | cut -d' ' -f1)"

# ---------------------------------------------------------------------------
say "2/6  הורדת הקוד"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

# בהרצה חוזרת התיקייה כבר שייכת למשתמש השירות, ו-git מסרב לעבוד בה כ-root
# ("dubious ownership"). מסמנים אותה כבטוחה בכל פקודה, ולא ב-config גלובלי,
# כי ב-startup-script אין HOME.
repo_git() { git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" "$@"; }

if [ -d "$INSTALL_DIR/.git" ]; then
    repo_git fetch -q origin "$BRANCH"
    repo_git checkout -q -f -B "$BRANCH" "origin/$BRANCH"
    ok "הקוד עודכן"
else
    git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "הקוד הורד"
fi

cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
ok "החבילות הותקנו"

# ---------------------------------------------------------------------------
say "3/6  הגדרות"
if [ -f "$APP_DIR/.env" ]; then
    ok "קובץ ההגדרות כבר קיים — לא נוגעים בו (למחיקה: sudo rm $APP_DIR/.env והרצה חוזרת)"
else
    # הערכים יכולים להגיע מראש, כדי שההתקנה תרוץ בלי מסך:
    #   1. ממשתני סביבה באותם שמות
    #   2. מה-metadata של שרת Google Cloud (setup-<שם>), כשהשרת נוצר עם
    #      startup-script ואין מי שיקליד. ראה deploy/create-gce.sh
    meta() {
        curl -fs -H 'Metadata-Flavor: Google' \
            "http://metadata.google.internal/computeMetadata/v1/instance/attributes/setup-$1" 2>/dev/null || true
    }
    : "${YEMOT_NUMBER:=$(meta yemot-number)}"
    : "${YEMOT_PASSWORD:=$(meta yemot-password)}"
    : "${AUTHORIZED_PHONE:=$(meta authorized-phone)}"
    : "${ELEVENLABS_API_KEY:=$(meta elevenlabs-key)}"
    : "${GROQ_API_KEY:=$(meta groq-key)}"

    if [ -z "$YEMOT_NUMBER" ] || [ -z "$YEMOT_PASSWORD" ] || [ -z "$AUTHORIZED_PHONE" ] \
        || [ -z "$ELEVENLABS_API_KEY" ] || [ -z "$GROQ_API_KEY" ]; then
        echo "  ההקלדה של המפתחות לא מוצגת על המסך. הדבק ולחץ Enter."
        [ -n "$YEMOT_NUMBER" ]       || read -r -p "  מספר מערכת ימות (למשל 0796077939): " YEMOT_NUMBER </dev/tty
        [ -n "$YEMOT_PASSWORD" ]     || { read -r -s -p "  סיסמת הניהול של ימות: " YEMOT_PASSWORD </dev/tty; echo; }
        [ -n "$AUTHORIZED_PHONE" ]   || read -r -p "  הטלפון שלך, היחיד שמורשה להתקשר (למשל 0583264054): " AUTHORIZED_PHONE </dev/tty
        [ -n "$ELEVENLABS_API_KEY" ] || { read -r -s -p "  מפתח ElevenLabs (מתחיל ב-sk_): " ELEVENLABS_API_KEY </dev/tty; echo; }
        [ -n "$GROQ_API_KEY" ]       || { read -r -s -p "  מפתח Groq (מתחיל ב-gsk_): " GROQ_API_KEY </dev/tty; echo; }
    fi

    # ערכים שהודבקו דרך Notepad מגיעים עם \r בסוף, ורווחים מסביב. בלינוקס \r
    # נשאר חלק מהערך ושובר את הסיסמה ואת המפתחות בלי שום סימן נראה.
    clean() { local v="${1//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }
    YEMOT_NUMBER="$(clean "$YEMOT_NUMBER")"
    YEMOT_PASSWORD="$(clean "$YEMOT_PASSWORD")"
    AUTHORIZED_PHONE="$(clean "$AUTHORIZED_PHONE")"
    ELEVENLABS_API_KEY="$(clean "$ELEVENLABS_API_KEY")"
    GROQ_API_KEY="$(clean "$GROQ_API_KEY")"

    [ -n "$YEMOT_NUMBER" ] && [ -n "$YEMOT_PASSWORD" ] && [ -n "$AUTHORIZED_PHONE" ] \
        && [ -n "$ELEVENLABS_API_KEY" ] && [ -n "$GROQ_API_KEY" ] \
        || fail "אחד הערכים ריק. הרץ שוב."

    WEBHOOK_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"

    umask 077
    cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
LOG_LEVEL=info
TIMEZONE=Asia/Jerusalem

WEBHOOK_SECRET=$WEBHOOK_SECRET
YEMOT_TOKEN=$YEMOT_NUMBER:$YEMOT_PASSWORD
AUTHORIZED_PHONE=$AUTHORIZED_PHONE
YEMOT_RECORDINGS_PATH=/1

ACTIVE_TRANSCRIBER=elevenlabs+qwen
ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY
GROQ_API_KEY=$GROQ_API_KEY

# Drive, Sheets ו-Docs אופציונליים. בלעדיהם הכל נשמר בשרת, ב-data/.
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_SHEET_ID=
GOOGLE_DOCS_FOLDER_ID=
EOF
    umask 022
    ok "קובץ ההגדרות נוצר"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$APP_DIR/.env"

# ---------------------------------------------------------------------------
say "4/6  בדיקת חיבורים"
sudo -u "$SERVICE_USER" node bin/check-config.js || \
    echo "  ⚠ חלק מהבדיקות נכשלו. ממשיכים, אבל כדאי לקרוא את השורות האדומות למעלה."

# ---------------------------------------------------------------------------
say "5/6  הפעלה כשירות קבוע"
cat > /etc/systemd/system/voice-assistant.service <<EOF
[Unit]
Description=Voice assistant (Yemot)
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node src/main.js
Restart=always
RestartSec=3
Environment=TZ=Asia/Jerusalem

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable voice-assistant >/dev/null 2>&1
systemctl restart voice-assistant

# על e2-micro ההפעלה הראשונה לוקחת כחצי דקה (טעינת המודולים מדיסק איטי).
# מחכים עד שתי דקות, לא 20 שניות.
for _ in $(seq 1 120); do
    curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break
    sleep 1
done
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null \
    || fail "השירות לא עלה. לוג: sudo journalctl -u voice-assistant -n 50"
ok "העוזר רץ"

# ---------------------------------------------------------------------------
say "6/6  כתובת HTTPS"
IP="$(curl -fs -H 'Metadata-Flavor: Google' \
        http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
      || curl -fs https://api.ipify.org)"
[ -n "$IP" ] || fail "לא הצלחתי לגלות את כתובת ה-IP הציבורית"
DOMAIN="${IP//./-}.sslip.io"

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl reload caddy || systemctl restart caddy

for _ in $(seq 1 60); do
    curl -fs "https://$DOMAIN/health" >/dev/null 2>&1 && break
    sleep 2
done
curl -fs "https://$DOMAIN/health" >/dev/null \
    || fail "HTTPS לא עלה. בדוק שפורטים 80 ו-443 פתוחים בחומת האש. לוג: sudo journalctl -u caddy -n 50"
ok "https://$DOMAIN"

SECRET="$(grep '^WEBHOOK_SECRET=' "$APP_DIR/.env" | cut -d= -f2)"

cat <<EOF

════════════════════════════════════════════════════════════════
  הכל מוכן. העתק את שתי השורות האלה לקובץ ext.ini של השלוחה בימות:

type=api
api_link=https://$DOMAIN/yemot/$SECRET

  לצפייה במה שקורה בזמן אמת:
    sudo journalctl -u voice-assistant -f
════════════════════════════════════════════════════════════════
EOF
