#!/bin/sh
set -eu

# Disposable CI resources only. Verify a root-owned mount works without running
# the server as root, and that SQLite survives replacing the container.
container="feedme-check-$$"
volume="feedme-check-data-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run --rm --entrypoint sh -v "$volume:/data" feedme:test -c 'chown 0:0 /data && chmod 755 /data'

for pass in 1 2; do
  docker run -d --name "$container" -v "$volume:/data" \
    -e RENDER_EXTERNAL_URL=https://feedme.example.com feedme:test >/dev/null
  attempt=0
  until docker exec --user node "$container" node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then docker logs "$container"; exit 1; fi
    sleep 1
  done
  docker exec --user node "$container" node --import tsx --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { strict as assert } from "node:assert";
    import { DatabaseSync } from "node:sqlite";
    import { databaseVersion, readDatabaseVersion } from "./src/lib/database-migrations.ts";
    const status = readFileSync("/proc/1/status", "utf8");
    assert.match(status, /Uid:\s+1000\s+1000\s+1000\s+1000/);
    const health = await (await fetch("http://127.0.0.1:4321/api/health")).json();
    assert.equal(health.version, JSON.parse(readFileSync("package.json", "utf8")).version);
    assert.equal(health.databaseSchema, databaseVersion);
    const db = new DatabaseSync("/data/demo.sqlite", { readOnly: true });
    try { assert.equal(readDatabaseVersion(db), databaseVersion); }
    finally { db.close(); }
    const response = await fetch("http://127.0.0.1:4321/oauth-client-metadata.json");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).client_id, "https://feedme.example.com/oauth-client-metadata.json");
  '
  if [ "$pass" = 1 ]; then
    docker exec -i --user node "$container" node --input-type=module < scripts/check-support-card.mjs
    docker exec --user node "$container" node --input-type=module -e '
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync("/data/demo.sqlite");
      db.exec("CREATE TABLE deployment_probe (value TEXT); INSERT INTO deployment_probe VALUES (\u0027persisted\u0027)");
      db.close();
    '
  else
    docker exec --user node "$container" node --input-type=module -e '
      import { DatabaseSync } from "node:sqlite";
      import { strict as assert } from "node:assert";
      const db = new DatabaseSync("/data/demo.sqlite");
      assert.equal(db.prepare("SELECT value FROM deployment_probe").get().value, "persisted");
      db.close();
    '
  fi
  docker rm -f "$container" >/dev/null
done
echo 'Container health, non-root server, generated origin, and persistent SQLite verified.'
