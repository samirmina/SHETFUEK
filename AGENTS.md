# AGENTS.md — Zendesk FM Assistant

## Critical Rule: Node Process Management

**NEVER run `taskkill` or `Stop-Process` targeting `node.exe` outside the project directory.**

The Kilo CLI runs on Node.js. Terminating `node.exe` globally kills the Kilo process itself, causing immediate session termination.

### Allowed
- Stopping processes started **within** this project (e.g., the native host on port 27183) using targeted PIDs
- Using `background_process` tool with `stop` action for managed processes
- Running project-scoped npm/node commands

### Forbidden
- `taskkill /IM node.exe /F` (or any global node kill)
- `Get-Process -Name node | Stop-Process` (or variants)
- Any command that kills node processes not explicitly started by this project

### Process Management
- Native host runs on **port 27183** (HTTP mode)
- Use `background_process` tool to start/stop/monitor the native host
- Verify with `netstat -ano | findstr :27183` before assuming port conflicts