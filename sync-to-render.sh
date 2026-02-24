#!/bin/bash
RENDER_URL="https://pert-suite-server.onrender.com/api"
DATA_DIR="/Users/alexlevit/.gemini/antigravity/scratch/data"

echo "=== Syncing Projects ==="
for f in "$DATA_DIR/projects/"*.json; do
  id=$(basename "$f" .json)
  echo -n "  Project $id... "
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$RENDER_URL/projects/$id" \
    -H "Content-Type: application/json" \
    -d @"$f")
  echo "$status"
done

echo ""
echo "=== Syncing Todos ==="
count=0
total=$(ls "$DATA_DIR/todos/"*.json 2>/dev/null | wc -l | tr -d ' ')
for f in "$DATA_DIR/todos/"*.json; do
  id=$(basename "$f" .json)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$RENDER_URL/todos/$id" \
    -H "Content-Type: application/json" \
    -d @"$f")
  count=$((count + 1))
  if [ $((count % 10)) -eq 0 ] || [ "$count" -eq "$total" ]; then
    echo "  $count/$total (last: $status)"
  fi
done
echo ""
echo "=== Done! Synced $count todos ==="
