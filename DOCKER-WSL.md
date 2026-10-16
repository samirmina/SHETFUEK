# Docker Setup — WSL2/Linux Environment

This document is the setup and configuration procedure for running the Zendesk FM Assistant
native host in the current environment (WSL2 + Docker). It complements the standard Windows
configuration; the two are maintained separately.

## Environment Configuration Matrix

| Aspect | Windows (standard) | WSL2/Docker (this environment) |
|---|---|---|
| Launch | `host.cmd` → `node host.js` | `docker compose` via `start-host.sh` |
| Registration | `register-host.ps1` (registry + NativeMessagingHosts manifest) | Not required — extension uses HTTP mode |
| Config file | `host.cmd` (env vars inline) | `docker-compose.yml` (env vars in service block) |
| Ollama | Host-installed, `http://127.0.0.1:11434` | Separate Docker container, port `11434` published |
| Data/state | `D:\SHETFUEK\extension\...` | Bind-mounted `./extension` → `/app/extension` |

## Verified Environment Facts (2026-10-12)

- WSL2, Ubuntu 26.04.1 LTS, kernel `6.18.33.2-microsoft-standard-WSL2`
- Docker Engine `29.1.3` running (dockerd active), Compose plugin `2.40.3`
- Ollama **running in a Docker container** (`ollama-gpu`), port `11434` published on `0.0.0.0`
  - RTX 3070 (8 GB) passed through via `--gpus all`; inference measured at ~67 tokens/sec (GPU speed)
  - `OLLAMA_MAX_LOADED_MODELS=3` — up to 3 models resident simultaneously
  - `OLLAMA_KEEP_ALIVE=-1` — models stay loaded indefinitely (`ollama ps` shows UNTIL: Forever)
  - Resident models (3): `llama3.2:3b` (extension's chat/classification model, 4.1 GB),
    `mxbai-embed-large:latest` (RAG embeddings, 618 MB), and `gemma3:1b` (877 MB —
    lightweight alternative for text generation/extraction, since llama3.2:3b is not
    guaranteed optimal for that workload; swap by changing `OLLAMA_MODEL` in `docker-compose.yml`)
  - VRAM: ~6.6 GB of 8 GB used with all three resident (~1.5 GB headroom; a 3B-class
    fourth model would NOT fit — only ~1B-class models fit alongside these)
  - 29 other models available on disk (granite, qwen3, deepseek-r1, mistral, ...)
  - Model weights stored at `/mnt/d/.ollama` (Windows D: drive) via bind mount `/root/.ollama`
- Vector index pre-built: `extension/native-host/cache/index_meta.json` — 479 chunks, `mxbai-embed-large`
- Native host not running; port `27183` free
- User `Meena` is a member of the `docker` group (`getent group docker`) — but a shell
  session opened before that change must be refreshed (see Troubleshooting)
- Node.js `v22.22.1` available on the WSL host (fallback direct run)

## Architecture (this environment)

```
Windows Chrome (extension)
   │  POST http://localhost:27183/api/<action>   (WSL2 localhost forwarding)
   ▼
WSL2 host ── docker-proxy :27183 ──▶ native-host container (node:22-alpine)
                                          │  POST http://host.docker.internal:11434
                                          ▼
                                    ollama container (already running)
                                          │
                                    llama3.2:3b / mxbai-embed-large
```

- `host.docker.internal` resolves via `extra_hosts: host-gateway` (Docker ≥ 20.10; Engine 29.1.3 present).
- `docker-proxy` binds the published ports on `0.0.0.0` of the WSL2 host, so the gateway IP reaches Ollama.
- WSL2 forwards Windows `localhost` to the WSL2 host, so Chrome reaches the native host at `http://localhost:27183`.
- Bind mount `./extension:/app/extension` keeps a single source of truth: SOP data, macros, vector store
  (`native-host/cache/`), and logs (`native-host/logs/`) are shared with the Windows filesystem.
- All code paths resolve relative to `__dirname` (e.g. `rag/ingest.js` → `extension/sop-data.json`,
  `rag/store.js` → `native-host/cache/`, `logs/logger.js` → `native-host/logs/`), which align with the
  container workdir `/app/extension/native-host`. No code changes required.

## Configuration Files

| File | Purpose |
|---|---|
| `docker-compose.yml` (project root) | Service definition: build, ports, env, volumes, healthcheck |
| `extension/native-host/Dockerfile` | Image: `node:22-alpine`, workdir `/app/extension/native-host`, `CMD ["node","host.js"]` |
| `.dockerignore` (project root) | Excludes `Pages/`, backups, diag files from build context |
| `extension/native-host/start-host.sh` | Launcher (parity with `host.cmd`): `up`, `down`, `logs`, `status`, `restart` |

### Environment Variables (docker-compose.yml)

| Variable | Default | Consumed by | Purpose |
|---|---|---|---|
| `HTTP_PORT` | `27183` | `host.js` | HTTP listen port |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | `ollama_client.js` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.2:3b` | `ollama_client.js` | Chat/completion model |
| `OLLAMA_TIMEOUT_MS` | `120000` | `ollama_client.js` | Per-request timeout |

Note: the embedding model is **hardcoded** to `mxbai-embed-large` (`rag/ingest.js`, `ollama_client.js`).
It must exist in the Ollama container (verified present). Changing it requires rebuilding the vector index.

## Setup Procedure

### 1. Confirm Docker access

```bash
docker info
```

If you see `permission denied ... /var/run/docker.sock`: your session predates the docker group
membership. Fix by re-logging in (close the terminal, open a new one) or from PowerShell:
`wsl --shutdown`, then reopen the distro. Do not use sudo — group access is the intended path.

### 2. Confirm Ollama is up and models exist

```bash
curl -s http://127.0.0.1:11434/api/tags | grep -o '"name":"[^"]*"' | sort -u
docker exec ollama-gpu ollama ps
```

Required: `llama3.2:3b` and `mxbai-embed-large` (both verified present). `ollama ps` should show
the three resident models with `PROCESSOR: 100% GPU` and `UNTIL: Forever` after the first
classification runs.

**Ollama container configuration (managed separately from compose):**

```bash
docker run -d \
  --name ollama-gpu \
  --gpus all \
  --restart unless-stopped \
  --network wsl_default \
  -p 11434:11434 \
  -e OLLAMA_HOST=0.0.0.0:11434 \
  -e OLLAMA_MAX_LOADED_MODELS=3 \
  -e OLLAMA_KEEP_ALIVE=-1 \
  -v /mnt/d/.ollama:/root/.ollama:rw \
  ollama/ollama:latest
```

- `OLLAMA_MAX_LOADED_MODELS=3` allows the two extension models plus one alternative
  (`gemma3:1b`) to stay resident; loading a fourth model evicts the oldest resident one.
- `OLLAMA_KEEP_ALIVE=-1` keeps models loaded indefinitely, so every classification after the
  first runs at warm speed (~10–15 s) instead of paying model reload (~30–100 s cold).
- If missing, recreate with the command above; if models were pulled into a different storage
  path, point the bind mount at it.

If required models are missing:

```bash
docker exec ollama-gpu ollama pull llama3.2:3b
docker exec ollama-gpu ollama pull mxbai-embed-large
```

### 3. Build and start the native host

```bash
cd /mnt/d/SHETFUEK
./extension/native-host/start-host.sh up
```

Equivalent manual commands:

```bash
docker compose up -d --build
docker compose ps                            # expect status "healthy"
```

### 4. Verify the native host

```bash
curl -s -X POST http://127.0.0.1:27183/api/ping \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'
```

Expected: `{"success":true,"data":{"pong":true,"model":"llama3.2:3b"}}`

From Windows (PowerShell/CMD), the same URL works as `http://localhost:27183/api/ping`
via WSL2 localhost forwarding — this is the URL the extension uses.

### 5. (Only if SOP/macro data changed) Rebuild the vector index

The index rebuilds automatically on the first `classify` call when file mtimes differ
(`ensureIndex()` in `rag/ingest.js`). To force it explicitly:

```bash
curl -s -X POST http://127.0.0.1:27183/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"action":"ingest","force":true}'
```

The pre-built index (479 chunks) is already present in `extension/native-host/cache/embeddings.jsonl`
and is picked up through the bind mount — normally you can skip this step.

### 6. Load the extension in Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked** → `D:\SHETFUEK\extension`
2. Open a Zendesk ticket → the popup's ping/classify actions now hit the containerized host.

### 7. End-to-end test

```bash
curl -s -X POST http://127.0.0.1:27183/api/classify \
  -H "Content-Type: application/json" \
  -d @diag_payload.json
```

(`diag_payload.json` at the project root contains a sample `classify` payload.)

## Day-to-Day Operations

| Task | Command |
|---|---|
| Follow logs | `docker compose logs -f native-host` (also persisted to `extension/native-host/logs/native-host.log`) |
| Stop | `./extension/native-host/start-host.sh down` or `docker compose down` |
| Status | `./extension/native-host/start-host.sh status` |
| Restart | `./extension/native-host/start-host.sh restart` |
| Change model | Edit `OLLAMA_MODEL` in `docker-compose.yml`, then `docker compose up -d` (e.g. `gemma3:1b` for text generation/extraction instead of `llama3.2:3b`; with the cap of 3 the displaced model stays resident as long as slots remain) |
| Pull a new model | `docker exec ollama-gpu ollama pull <model>` |
| Show resident models | `docker exec ollama-gpu ollama ps` (expect 3 rows, `100% GPU`, `UNTIL: Forever`) |
| **After editing extension files** | `./extension/native-host/start-host.sh restart` (to pick up code changes) |

State persistence: the vector store (`cache/`) and ticket cache live on the bind-mounted
`./extension` directory, so they survive container recreation. Ollama models live at
`/mnt/d/.ollama` (Windows D: drive), independent of this compose file.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `permission denied` on `docker info` | Session predates docker group membership. Re-login or `wsl --shutdown` + reopen. |
| Port 27183 already in use | `ss -tlnp \| grep 27183` — stop the conflicting process (e.g. a directly-run `node host.js`). |
| `OLLAMA connection error` from native host | From the container: `docker exec zendesk-fm-native-host wget -qO- --post-data='{}' http://host.docker.internal:11434/api/tags`. If it fails, check the Ollama container is running and port 11434 is published. |
| Slow classification | First request after Ollama (re)starts pays a cold model load from `/mnt/d/.ollama` (~30–100 s); later requests are ~10–15 s and now stay warm indefinitely (`OLLAMA_KEEP_ALIVE=-1`). If still slow, check `docker exec ollama-gpu ollama ps` shows `100% GPU`, and switch `OLLAMA_MODEL` to a smaller model (e.g. `gemma3:1b`, `granite3-moe:latest`). |
| Stale RAG results | Force re-ingest (step 5). Check `cache/index_meta.json` `sourceMtimes` vs. the data files. |
| Files in `cache/`/`logs/` owned by root after container writes | Container runs as root; files on `/mnt/d` remain world-readable. To edit them from WSL, adjust permissions or re-run ingest from a direct `node` run. |
| Chrome cannot reach `localhost:27183` | Confirm the container publishes the port (`docker compose ps` → `0.0.0.0:27183->27183/tcp`) and that Windows firewall allows the WSL/Docker proxy on the private network profile. |

## Out of Scope

- Running Ollama inside this compose file (it runs as the separate `ollama-gpu` container;
  adding it here would conflict on port 11434 and on the model cap).
- Chrome extension packaging/signing; CI/CD; Kubernetes.
