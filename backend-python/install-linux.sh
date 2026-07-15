#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "未找到 ${PYTHON_BIN}，请先安装 Python 3.11 及 python3-venv。" >&2
  exit 1
fi

"${PYTHON_BIN}" - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("需要 Python 3.11 或更高版本。")
PY

if [[ ! -d "${VENV_DIR}" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install -r "${SCRIPT_DIR}/requirements.txt"

echo
echo "Python 后端依赖安装完成。"
echo "启动方式："
echo "  ${SCRIPT_DIR}/.venv/bin/uvicorn app.main:app --app-dir ${SCRIPT_DIR} --host 0.0.0.0 --port 8080 --workers 1"
echo "或从项目根目录运行："
echo "  python3 -m uvicorn app.main:app --app-dir ${SCRIPT_DIR} --host 0.0.0.0 --port 8080 --workers 1"
