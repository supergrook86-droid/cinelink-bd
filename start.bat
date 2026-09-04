@echo off
title CineLink BD Server
cd /d %~dp0

echo.
echo ==================================================
echo   CINELINK BD - SERVER CHALU KARAR PROGRAM
echo ==================================================
echo.

rem ---------- 1. Node.js check ----------
where node >nul 2>nul
if errorlevel 1 goto NONODE

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo [OK] Node.js paoa geche  (version: %NODEVER%)
echo.

rem ---------- 2. dependencies ----------
if exist node_modules goto RUNSERVER

echo [..] Prothom bar - dependencies install hocche  (npm install)...
echo      DOE: 2-5 minute lage. EKHONI WINDOW BONDHO KORBEN NA!
echo.
call npm install
if errorlevel 1 goto NPMFAIL

:RUNSERVER
echo.
echo [OK] Server suru hocche...
echo      Browser e SITE ekhuni nijei khule jabe...
echo      (Server bondho korte: ei window e click kore Ctrl+C chapan)
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
node server.js
if errorlevel 1 goto SERVERFAIL
goto END

:NONODE
echo.
echo [X] NODE.JS PAI NAI!  Ei jonno'i "Press any key to continue" ashe.
echo.
echo     Ekhon ekhane shudhu ektu kaj korte hobe:
echo      1) Ami ekhoni nodejs.org kholchi - oi site e jabe
echo      2) Green "LTS" button e CLICK  (naki "Get Node.js" button)
echo      3) .msi file download hobe
echo      4) Oi file e DOUBLE-CLICK - Next, Next, Next, Install, Finish
echo      5) Windows kono prompt ask korle "Yes" chapan
echo      6) Sesh hobar POR computer RESTART korun  <<<< JORURRI
echo      7) Tarpor ei start.bat abar DOUBLE-CLICK korun
echo.
start https://nodejs.org
echo.
pause
exit /b

:NPMFAIL
echo.
echo [X] npm install FAIL koreche.
echo     Internet connection check korun, tarpor start.bat abar run korun.
echo     Holo na? Screen e jototuku likha ache chhobi tule amake pathan.
echo.
pause
exit /b

:SERVERFAIL
echo.
echo [X] Server cholte parenai.
echo     Uporer sheshato message e jototuku likha ache, chhobi tule amake pathan.
echo.
pause
exit /b

:END
pause
