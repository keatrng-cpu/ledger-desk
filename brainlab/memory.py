"""Local semantic memory of notes the book already has. Chroma runs on disk. Marqo is used only when a URL is set.

This is not the floor's recall(). The floor stays on its own book. Nothing here is a gate.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "brainlab" / ".chroma"
BRAIN_NOTES = ROOT / "graphify-out" / "obsidian" / "brain"


def _chroma(path: Path | None = None):
    import chromadb

    client = chromadb.PersistentClient(path=str(path or DEFAULT_PATH))
    return client.get_or_create_collection("desk-brain")


def index_notes(directory: Path | None = None, path: Path | None = None) -> int:
    """Index markdown the vault already wrote. Returns how many notes were stored."""
    folder = directory or BRAIN_NOTES
    files = sorted(folder.glob("*.md"))
    if not files:
        return 0
    ids, docs, metas = [], [], []
    for f in files:
        text = f.read_text(encoding="utf-8").strip()
        if not text:
            continue
        ids.append(f.stem)
        docs.append(text[:8000])
        metas.append({"file": f.name})
    if not ids:
        return 0
    col = _chroma(path)
    col.upsert(ids=ids, documents=docs, metadatas=metas)
    return len(ids)


def remember(note_id: str, text: str, path: Path | None = None) -> None:
    text = text.strip()
    if not text:
        raise RuntimeError("empty note")
    _chroma(path).upsert(ids=[note_id], documents=[text], metadatas=[{"file": note_id}])


def recall(query: str, n: int = 4, path: Path | None = None) -> list[dict]:
    """Nearest notes. The text comes back as stored. The distance is Chroma's, not a win rate."""
    q = query.strip()
    if not q:
        return []
    col = _chroma(path)
    if col.count() == 0:
        return []
    got = col.query(query_texts=[q], n_results=min(n, col.count()))
    out = []
    for i, doc in enumerate(got["documents"][0]):
        out.append(
            {
                "id": got["ids"][0][i],
                "text": doc,
                "distance": got["distances"][0][i] if got.get("distances") else None,
            }
        )
    return out


def marqo_recall(query: str, url: str, index: str = "desk-brain", n: int = 4) -> list[dict]:
    """Same shape as recall(), against a Marqo server you are already running. Not started here."""
    try:
        import marqo
    except ImportError as e:
        raise RuntimeError("marqo is not installed. The lab uses Chroma on disk unless you point it at a Marqo server.") from e
    client = marqo.Client(url=url)
    res = client.index(index).search(query, limit=n)
    return [{"id": h.get("_id"), "text": h.get("text") or h.get("content") or "", "distance": h.get("_score")} for h in res.get("hits", [])]
