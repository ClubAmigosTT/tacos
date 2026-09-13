@echo off
setlocal

set "TACOS_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
set "TACOS_NODE=%TACOS_RUNTIME%\node\bin\node.exe"
set "TACOS_PNPM=%TACOS_RUNTIME%\bin\fallback\pnpm.cmd"

if not exist "%TACOS_NODE%" (
  echo No se encontro Node en "%TACOS_NODE%".
  exit /b 1
)

if not exist "%TACOS_PNPM%" (
  echo No se encontro pnpm en "%TACOS_PNPM%".
  exit /b 1
)

set "PATH=%TACOS_RUNTIME%\node\bin;%TACOS_RUNTIME%\bin\fallback;%TACOS_RUNTIME%\native\git\cmd;%PATH%"
set "EAS_NO_VCS=1"

if /i "%~1"=="--check" (
  "%TACOS_NODE%" --version
  call "%TACOS_PNPM%" --version
  exit /b %ERRORLEVEL%
)

call "%TACOS_PNPM%" release:ios
exit /b %ERRORLEVEL%
