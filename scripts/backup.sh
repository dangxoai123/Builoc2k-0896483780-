#!/bin/bash
# =============================================
# MMoPanel - PostgreSQL Auto Backup Script
# Token/Chat ID đọc từ /root/.backup_config
# =============================================

DB_NAME="mmopanel"
DB_USER="postgres"
BACKUP_DIR="/root/backups/mmopanel"
KEEP_DAYS=7

# Đọc config (file này tạo thủ công trên VPS, không push GitHub)
CONFIG_FILE="/root/.backup_config"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# Kiểm tra biến bắt buộc
if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
    echo "❌ Thiếu TG_TOKEN hoặc TG_CHAT_ID trong $CONFIG_FILE"
    exit 1
fi

DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="mmopanel_backup_${DATE}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Bắt đầu backup..."
pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILEPATH"

if [ $? -eq 0 ]; then
    SIZE=$(du -sh "$FILEPATH" | cut -f1)
    curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendDocument" \
        -F "chat_id=${TG_CHAT_ID}" \
        -F "document=@${FILEPATH}" \
        -F "caption=✅ MMoPanel Backup%0A📅 ${DATE}%0A💾 ${SIZE}" > /dev/null
    echo "[$(date)] ✅ Backup OK: $FILENAME ($SIZE)"
else
    curl -s "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -d "chat_id=${TG_CHAT_ID}" \
        -d "text=❌ MMoPanel Backup THẤT BẠI lúc ${DATE}" > /dev/null
    echo "[$(date)] ❌ Backup thất bại!"
fi

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
echo "[$(date)] Dọn xong backup cũ >$KEEP_DAYS ngày."
