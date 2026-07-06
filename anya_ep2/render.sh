#!/bin/bash
# Эпизод 2 Ани — рендер базового говорящего видео через HeyGen.
# Готово к запуску, как только появится рабочий HEYGEN_API_KEY.
#
# Использование:
#   export HEYGEN_API_KEY="реальный_ключ_из_дашборда_HeyGen"
#   ./render.sh
#
# Что уже сделано (не требует ключа, готово заранее):
#   - script.txt        — текст эпизода 2, голос Ани, "я посчитала" про СПП на WB
#   - voice_ep2.mp3      — озвучка ЭТОГО текста, голос-клон ManyaRef1, 30.24с
#     (сгенерено через Higgsfield generate_audio, публичный URL уже захостен CloudFront'ом)
#
# Дальше (после этого скрипта): скачанное raw-видео нужно прогнать через Higgsfield
# custom preset "Marker Doodle Clean" (id 97c2b9e9-f39e-4330-b875-d94ce548610c) —
# ровно как эпизод 1 — и наложить RU-подписи (mc_captions.py, шрифт Molli Writes),
# с новой таблицей BLOCKS под тайминги этого эпизода.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${HEYGEN_API_KEY:-}" ] && [ -f "$DIR/.heygen_key_candidate" ]; then
  HEYGEN_API_KEY=$(cat "$DIR/.heygen_key_candidate")
fi
if [ -z "${HEYGEN_API_KEY:-}" ]; then
  echo "HEYGEN_API_KEY не задан. export HEYGEN_API_KEY=... и запусти снова." >&2
  exit 1
fi
AUDIO_URL="https://d8j0ntlcm91z4.cloudfront.net/user_3F2xFeNBdXzuql9oNI2hAzjvPDI/hf_20260705_190048_1562a12a-daf1-42a7-9cd0-5d498ea479c4.mp3"

# avatarLookId/voiceId из lib/factory/ugcStoryboard.ts, запись manya_ugc_wb_v1
# (voice_id не используется — липсинк идёт по audio_url, а не по нативному голосу HeyGen)
AVATAR_ID="f3d97943d5854f28bda126ad03f02bab"

echo "→ создаю видео…"
CREATE_RESP=$(curl -s -X POST "https://api.heygen.com/v3/videos" \
  -H "x-api-key: ${HEYGEN_API_KEY}" \
  -H "content-type: application/json" \
  -d @- <<JSON
{
  "type": "avatar",
  "avatar_id": "${AVATAR_ID}",
  "title": "anya_ep2_spp",
  "aspect_ratio": "9:16",
  "resolution": "1080p",
  "output_format": "mp4",
  "audio_url": "${AUDIO_URL}",
  "engine": {"type": "avatar_iv"},
  "motion_prompt": "спокойная уверенная речь, лёгкая мимика, смотрит в камеру, экономист объясняет цифры",
  "expressiveness": "medium"
}
JSON
)
echo "$CREATE_RESP" | tee "$DIR/create_response.json"

VIDEO_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('video_id') or d.get('video_id') or '')")
if [ -z "$VIDEO_ID" ]; then
  echo "Не получил video_id — смотри create_response.json" >&2
  exit 1
fi
echo "video_id = $VIDEO_ID"

echo "→ жду рендер (до ~10 минут)…"
for i in $(seq 1 110); do
  sleep 6
  STATUS_RESP=$(curl -s "https://api.heygen.com/v3/videos/${VIDEO_ID}" -H "x-api-key: ${HEYGEN_API_KEY}")
  STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or d).get('status',''))")
  VIDEO_URL=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or d).get('video_url') or '')")
  echo "  [$i] status=$STATUS"
  if [ -n "$VIDEO_URL" ]; then
    echo "→ готово: $VIDEO_URL"
    curl -sL "$VIDEO_URL" -o "$DIR/raw_ep2.mp4"
    echo "→ сохранено: $DIR/raw_ep2.mp4"
    exit 0
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "Рендер упал:" >&2
    echo "$STATUS_RESP" >&2
    exit 1
  fi
done
echo "Не дождался за отведённое время — проверь video_id вручную: $VIDEO_ID" >&2
exit 1
