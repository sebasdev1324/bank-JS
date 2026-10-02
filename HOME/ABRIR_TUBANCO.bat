@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 24 o posterior y vuelve a intentarlo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Instalando dependencias necesarias...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/me' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  start "TuBanco - servidor" /D "%~dp0" cmd /k npm start
  for /L %%N in (1,1,15) do (
    powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/me' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 goto open_app
    timeout /t 1 /nobreak >nul
  )
  echo El servidor no respondio en http://localhost:3000.
  pause
  exit /b 1
)

:open_app
set "APP_URL=http://localhost:3000/"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)
where chrome >nul 2>&1
if not errorlevel 1 (
  start "" chrome "%APP_URL%"
  exit /b 0
)
start "" "%APP_URL%"