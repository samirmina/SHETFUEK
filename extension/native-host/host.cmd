@echo off
REM ============================================================
REM NATIVE HOST LAUNCHER
REM Annotated startup diagnostics and errorlevel capture.
REM Every step is logged to host.log for debugging Chrome
REM native messaging EOF issues.
REM ============================================================
setlocal enabledelayedexpansion

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "HOST_SCRIPT=%~dp0host.js"
set "LOG_FILE=%~dp0logs\host.log"

echo [HOST_CMD] ======================================== >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Launching native host >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Timestamp: %DATE% %TIME% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Node exe: %NODE_EXE% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Host script: %HOST_SCRIPT% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Log file: %LOG_FILE% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Working dir: %CD% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] ======================================== >> "%LOG_FILE%" 2>&1

REM Verify node exists
if not exist "%NODE_EXE%" (
    echo [HOST_CMD] ERROR: Node.js not found at %NODE_EXE% >> "%LOG_FILE%" 2>&1
    echo [HOST_CMD] ERRORLEVEL=%ERRORLEVEL% >> "%LOG_FILE%" 2>&1
    exit /b 1
)

echo [HOST_CMD] Node found, starting host... >> "%LOG_FILE%" 2>&1

REM Set HTTP_PORT so host.js starts the HTTP server
REM This bypasses Chrome's broken native messaging pipe on Windows
set "HTTP_PORT=27183"
echo [HOST_CMD] HTTP_PORT=%HTTP_PORT% >> "%LOG_FILE%" 2>&1

REM Launch the host
"%NODE_EXE%" "%HOST_SCRIPT%"
set "HOST_EXIT=%ERRORLEVEL%"

echo [HOST_CMD] Host exited with errorlevel %HOST_EXIT% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] Exit timestamp: %DATE% %TIME% >> "%LOG_FILE%" 2>&1
echo [HOST_CMD] ======================================== >> "%LOG_FILE%" 2>&1

exit /b %HOST_EXIT%
