#!/bin/bash
# =============================================
# MMoPanel - PostgreSQL Auto Backup Script
# =============================================

DB_NAME="mmopanel"
DB_HOST="127.0.0.1"   # dùng TCP thay vì socket để tránh peer auth
DB_PORT="5432"
DB_USER="postgres"
BACKUP_DIR="/root/backups/mmopanel"
KEEP_DAYS=7

# Đọc config (tạo thủ công trên VPS, không push GitHub)
CONFIG_FILE="/root/.backup_config"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
    echo "❌ Thiếu TG_TOKEN hoặc TG_CHAT_ID trong $CONFIG_FILE"
    exit 1
fi

DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="mmopanel_backup_${DATE}.sql"
FILEPATH_SQL="${BACKUP_DIR}/${FILENAME}"
FILEPATH_GZ="${FILEPATH_SQL}.gz"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Bắt đầu backup..."

# Dump ra file trước (tránh lỗi pipe che khuất exit code)
PGPASSWORD="$DB_PASS" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    "$DB_NAME" > "$FILEPATH_SQL" 2>/tmp/pgdump_error.log

if [ $? -ne 0 ]; then
    ERR=$(cat /tmp/pgdump_error.log)
    echo "[$(date)] ❌ pg_dump thất bại: $ERR"
    curl -s "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -d "chat_id=${TG_CHAT_ID}" \
        -d "text=❌ MMoPanel Backup THẤT BẠI lúc ${DATE}%0Aℹ️ ${ERR}" > /dev/null
    rm -f "$FILEPATH_SQL"
    exit 1
fi

# Nén file
gzip "$FILEPATH_SQL"
SIZE=$(du -sh "$FILEPATH_GZ" | cut -f1)
echo "[$(date)] ✅ Backup xong: ${FILENAME}.gz ($SIZE)"

# Gửi Telegram
curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendDocument" \
    -F "chat_id=${TG_CHAT_ID}" \
    -F "document=@${FILEPATH_GZ}" \
    -F "caption=✅ MMoPanel Backup%0A📅 ${DATE}%0A💾 ${SIZE}" > /dev/null

echo "[$(date)] ✅ Đã gửi Telegram."

# Dọn backup cũ
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
echo "[$(date)] Dọn xong backup cũ >$KEEP_DAYS ngày."
