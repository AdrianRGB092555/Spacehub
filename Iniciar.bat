@echo off
TITLE Servidor Sala de Red Local
color 0A
echo ==========================================
echo    INICIANDO SALA DE RED LOCAL (100%% OFFLINE)
echo ==========================================
echo.

:: Inicia el servidor Node.js en segundo plano o en ventana paralela
start cmd /k "node server.js"

echo Esperando a que el servidor arranque...
timeout /t 2 /nobreak > nul

echo Abriendo la intranet en tu navegador predeterminado...
start http://localhost:3000

echo.
echo ¡Listo! Ya puedes usar la intranet. 
echo (No cierres la ventana de Node.js que se abrio al lado).
pause
