#!/usr/bin/env python3
"""Run lightweight, offline checks for this heterogeneous script vault."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".ipynb_checkpoints",
    ".venv",
    "venv",
    "__pycache__",
    "outputs",
}
TEXT_SUFFIXES = {
    ".ipynb",
    ".js",
    ".json",
    ".md",
    ".py",
    ".txt",
    ".yaml",
    ".yml",
}
SECRET_PATTERNS = {
    "Google API key": re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    "GitHub personal access token": re.compile(
        r"(?:gh[opsu]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{50,})"
    ),
    "private key block": re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    ),
}


def repository_files(pattern: str) -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob(pattern)
        if not any(part in EXCLUDED_PARTS for part in path.parts)
    )


def check_javascript(node: str | None) -> tuple[int, list[str]]:
    files = repository_files("*.js")
    if not files:
        return 0, []
    if node is None:
        return 0, [
            f"SKIP JavaScript syntax ({len(files)} files): Node.js was not found."
        ]

    failures: list[str] = []
    for path in files:
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            check=False,
            text=True,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            failures.append(f"{path.relative_to(ROOT)}: {detail}")
    return len(files), failures


def check_python() -> tuple[int, list[str]]:
    files = repository_files("*.py")
    failures: list[str] = []
    for path in files:
        try:
            source = path.read_text(encoding="utf-8")
            compile(source, str(path), "exec")
        except (OSError, SyntaxError, UnicodeError) as exc:
            failures.append(f"{path.relative_to(ROOT)}: {exc}")
    return len(files), failures


def check_notebooks() -> tuple[int, list[str]]:
    files = repository_files("*.ipynb")
    failures: list[str] = []
    for path in files:
        try:
            notebook = json.loads(path.read_text(encoding="utf-8"))
            if notebook.get("nbformat") != 4:
                raise ValueError("expected nbformat 4")
            if not isinstance(notebook.get("cells"), list):
                raise ValueError("missing cells list")
            for index, cell in enumerate(notebook["cells"]):
                if cell.get("cell_type") not in {"code", "markdown", "raw"}:
                    raise ValueError(
                        f"cell {index} has invalid type {cell.get('cell_type')!r}"
                    )
                if not isinstance(cell.get("source"), list):
                    raise ValueError(f"cell {index} source is not a list")
                tags = cell.get("metadata", {}).get("tags", [])
                if (
                    cell.get("cell_type") == "code"
                    and cell.get("outputs")
                    and "keep_output" not in tags
                ):
                    raise ValueError(
                        f"cell {index} contains saved outputs; clear them or "
                        "tag the cell keep_output when the output is intentional"
                    )
        except (json.JSONDecodeError, OSError, UnicodeError, ValueError) as exc:
            failures.append(f"{path.relative_to(ROOT)}: {exc}")
    return len(files), failures


def check_high_confidence_secrets() -> tuple[int, list[str]]:
    files = sorted(
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and not any(part in EXCLUDED_PARTS for part in path.parts)
    )
    failures: list[str] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                failures.append(
                    f"{path.relative_to(ROOT)}: possible {label}; "
                    "remove it and rotate the credential before publishing"
                )
    return len(files), failures


def check_catalog() -> tuple[int, list[str]]:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    cataloged_files = [
        path
        for folder in ("GEE", "Apps", "JNotebooks")
        for path in sorted((ROOT / folder).rglob("*"))
        if path.is_file()
        and not any(part in EXCLUDED_PARTS for part in path.parts)
    ]
    failures = [
        f"{path.relative_to(ROOT)} is not listed in README.md"
        for path in cataloged_files
        if str(path.relative_to(ROOT)).replace("\\", "/") not in readme
    ]
    return len(cataloged_files), failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--node",
        default=shutil.which("node"),
        help="Node.js executable used for JavaScript syntax checks.",
    )
    args = parser.parse_args()

    checks = [
        ("JavaScript", lambda: check_javascript(args.node)),
        ("Python", check_python),
        ("notebooks", check_notebooks),
        ("text files for high-confidence secrets", check_high_confidence_secrets),
        ("README catalog entries", check_catalog),
    ]

    all_failures: list[str] = []
    for label, check in checks:
        count, failures = check()
        if failures and all(item.startswith("SKIP ") for item in failures):
            print(*failures, sep="\n")
            continue
        print(f"Checked {count} {label}.")
        all_failures.extend(failures)

    if all_failures:
        print("\nValidation failed:", file=sys.stderr)
        for failure in all_failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
