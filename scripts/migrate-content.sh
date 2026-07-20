#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

# 只读取简单的 KEY=VALUE 配置，不使用 eval，避免 .env 内容被当作 shell 命令执行。
if [[ -f "${ENV_FILE}" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line:0:1}" == "#" ]] && continue
    if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      export "${key}=${value}"
    fi
  done < "${ENV_FILE}"
else
  echo "未找到 ${ENV_FILE}，将使用默认配置。" >&2
fi

PYTHON_BIN="${PYTHON_BIN:-${PROJECT_ROOT}/backend-python/.venv/bin/python}"
if [[ ! -x "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="$(command -v python3 || true)"
fi
if [[ -z "${PYTHON_BIN}" || ! -x "${PYTHON_BIN}" ]]; then
  echo "未找到 Python 3。请先运行 bash backend-python/install-linux.sh。" >&2
  exit 1
fi

"${PYTHON_BIN}" - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("需要 Python 3.11 或更高版本。")
PY

ARGS=()
for argument in "$@"; do
  case "${argument}" in
    --dry-run|-n)
      ARGS+=("--dry-run")
      ;;
    *)
      echo "未知参数：${argument}" >&2
      echo "用法：$0 [--dry-run|-n]" >&2
      exit 2
      ;;
  esac
done

cd "${PROJECT_ROOT}/backend-python"
export PYTHONPATH="${PROJECT_ROOT}/backend-python${PYTHONPATH:+:${PYTHONPATH}}"
exec "${PYTHON_BIN}" -m app.content_migration "${ARGS[@]}"

