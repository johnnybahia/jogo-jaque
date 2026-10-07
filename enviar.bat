@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo       SINCRONIZANDO COM O GITHUB
echo ==============================================
echo.

:: 1. Inicializa o Git se ainda nao existir nesta pasta
if not exist ".git" (
    echo [INFO] Repositório local não encontrado. Inicializando...
    git init
    git branch -M main
    git remote add origin https://github.com/johnnybahia/jogo-jaque.git
    echo.
)

:: 2. Prepara os arquivos
git add .

:: 3. Verifica se ha alteracoes para enviar
set "TEM_ALTERACAO="
for /f "tokens=*" %%i in ('git status --porcelain') do set "TEM_ALTERACAO=1"

if not defined TEM_ALTERACAO (
    echo [OK] Nenhuma alteração detectada. Seu repositório já está atualizado!
    goto fim
)

:: 4. Solicita uma mensagem ou gera uma automatica
echo Modificações detectadas!
echo.
set "msg="
set /p msg="Digite o que mudou (ou aperte ENTER para salvar com data/hora): "
if "%msg%"=="" set msg=Atualização: %date% %time%

:: 5. Salva e envia para o GitHub
echo.
echo [1/2] Gravando alterações...
git commit -m "%msg%"

echo.
echo [2/2] Enviando para o GitHub...
git push -u origin main

:fim
echo.
echo ==============================================
echo                CONCLUÍDO!
echo ==============================================
pause