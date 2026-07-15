#!/bin/bash
# ============================================================================
# build-macos.sh — сборка .dmg для macOS и пуш в репозиторий.
#
# Запускать НА macOS:
#   ./scripts/build-macos.sh
#
# Скрипт сам:
#   1. Проверяет что запущен на macOS
#   2. Устанавливает зависимости (npm ci)
#   3. Собирает .dmg (x64 + arm64)
#   4. Копирует артефакты в releases/
#   5. Коммитит, тегает и пушит
# ============================================================================
set -e

# Цветной вывод
red()    { printf "\033[31m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
cyan()   { printf "\033[36m%s\033[0m\n" "$1"; }

# --- Проверки ---

if [ "$(uname -s)" != "Darwin" ]; then
  red "✗ Этот скрипт можно запускать только на macOS."
  red "  На Windows используйте: npm run dist"
  exit 1
fi

if ! command -v node &>/dev/null; then
  red "✗ Node.js не установлен."
  cyan "  Установите с https://nodejs.org или: brew install node"
  exit 1
fi

if ! command -v git &>/dev/null; then
  red "✗ Git не установлен."
  cyan "  Установите: brew install git"
  exit 1
fi

# Переход в корень проекта (родитель папки scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Чтение версии из package.json
VERSION=$(node -pe "require('./package.json').version")

green "═══════════════════════════════════════════════════"
green "  Polza Pulse v${VERSION} — сборка macOS"
green "═══════════════════════════════════════════════════"
echo ""
cyan "Платформа:    $(uname -s) $(uname -m)"
cyan "Node.js:      $(node --version)"
cyan "Версия:       ${VERSION}"
echo ""

# --- Установка зависимостей ---

yellow "▶ Установка зависимостей..."
npm ci
green "✓ Зависимости установлены"
echo ""

# --- Сборка ---

yellow "▶ Сборка TypeScript + esbuild..."
npm run build
green "✓ dist собран"
echo ""

yellow "▶ Сборка .dmg (это может занять несколько минут)..."
npm run dist:mac
green "✓ .dmg собран"
echo ""

# --- Копирование артефактов ---

yellow "▶ Копирование артефактов в releases/..."

# Показать что собралось
cyan "Собранные файлы:"
ls -lh release/*.dmg release/latest-mac*.yml 2>/dev/null || true
echo ""

# Копируем .dmg файлы и latest-mac.yml в releases/
mkdir -p releases

# Удаляем старые .dmg и mac yml
rm -f releases/*.dmg releases/latest-mac*.yml 2>/dev/null || true

# Копируем новые
cp release/*.dmg releases/ 2>/dev/null || true
cp release/latest-mac*.yml releases/ 2>/dev/null || true

green "✓ Артефакты скопированы в releases/"
ls -lh releases/*.dmg releases/latest-mac*.yml 2>/dev/null || true
echo ""

# --- Git ---

yellow "▶ Коммит и пуш..."

git add releases/
git commit -m "v${VERSION}: macOS сборка (.dmg x64 + arm64)" || {
  yellow "ℹ Нет изменений для коммита (возможно, уже закоммичено)"
}

# Тег (если ещё не существует)
if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
  yellow "ℹ Тег v${VERSION} уже существует"
else
  git tag "v${VERSION}"
  green "✓ Создан тег v${VERSION}"
fi

git push
git push origin "v${VERSION}" 2>/dev/null || true

echo ""
green "═══════════════════════════════════════════════════"
green "  ✅ Готово! macOS сборка v${VERSION} опубликована"
green "═══════════════════════════════════════════════════"
