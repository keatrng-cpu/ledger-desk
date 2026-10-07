"""Commit a slippage note. Never the floor file, never a push.

GitPython stages only brainlab/slippage/. src/lib/aplus/config.ts is refused even if someone passes it.
"""

from __future__ import annotations

from pathlib import Path

import git

ALLOWED = "brainlab/slippage/"
FLOOR = "src/lib/aplus/config.ts"


def assert_paths(paths: list[str]) -> None:
    if not paths:
        raise RuntimeError("no note to commit")
    for raw in paths:
        path = raw.replace("\\", "/").lstrip("./")
        if path == FLOOR or path.endswith("/" + FLOOR):
            raise RuntimeError("the floor file is not written by the lab")
        if not path.startswith(ALLOWED) or not path.endswith(".md"):
            raise RuntimeError(f"{path} is outside the slippage notes")


def commit_notes(repo: git.Repo, paths: list[str], message: str) -> str:
    assert_paths(paths)
    repo.index.add(paths)
    if not repo.index.diff("HEAD"):
        raise RuntimeError("nothing to commit")
    return repo.index.commit(message).hexsha


def write_note(repo_root: Path, day: str, lines: list[str]) -> Path:
    """A measured note. `lines` are already computed from the fill log. This does not invent a rule."""
    folder = repo_root / "brainlab" / "slippage"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{day}.md"
    body = "\n".join(
        [
            f"# Slippage {day}",
            "",
            "Measured from the lab fill log. This is not a change to the floor.",
            "",
            *lines,
            "",
        ]
    )
    path.write_text(body, encoding="utf-8")
    return path
