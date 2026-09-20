@echo off
REM =============================================================================
REM GWS Admin — Windows Start Script
REM =============================================================================
echo =======================================
echo   GWS Admin
echo =======================================

REM Start the JWT signer sidecar
if exist "sidecar\signer.exe" (
  echo -^> Starting JWT signer on 127.0.0.1:9999...
  start /B sidecar\signer.exe
) else (
  echo WARNING: sidecar\signer.exe not found. Google API operations will fail.
  echo          Build it with:  cd sidecar ^&^& go build -o signer.exe .
)

REM Start PocketBase
REM Loopback by default: PocketBase serves plain HTTP, so 0.0.0.0 would put
REM the admin UI on your network. Front it with a reverse proxy.
echo -^> Starting PocketBase on http://127.0.0.1:8090 ...
echo.
pocketbase.exe serve --http=127.0.0.1:8090 --dir=data --hooksDir=hooks --migrationsDir=backend --publicDir=frontend

pause
