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
    from chromadb.config import Settings

    # Chroma sends anonymous usage telemetry unless told not to. The notes are the trader's own book: nothing leaves this machine.
    client = chromadb.PersistentClient(path=str(path or DEFAULT_PATH), settings=Settings(anonymized_telemetry=False))
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


def ledger_notes(rows: list[dict]) -> list[tuple[str, str]]:
    """The high-alert ledger (the Brain tab's Copy JSON) as (id, text) notes: the lesson, then why, then the card's own evidence.

    A record that is not graded yet has no lesson and is skipped: an open card is not memory.
    """
    notes: list[tuple[str, str]] = []
    for r in rows:
        lesson = str(r.get("lesson") or "").strip()
        if not lesson or r.get("call") == "open":
            continue
        why = " ".join(str(w) for w in (r.get("why") or [])[:3])
        evidence = " ".join(str(e) for e in (r.get("evidence") or [])[:2])
        text = " ".join(x for x in (lesson, why, evidence) if x)
        notes.append((f"hialert-{r.get('id')}", text[:8000]))
    return notes


def index_ledger(json_path: Path, path: Path | None = None) -> int:
    """Index a ledger export. Returns how many graded cards were stored."""
    import json

    rows = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise RuntimeError("a ledger export is a JSON list")
    notes = ledger_notes(rows)
    if not notes:
        return 0
    col = _chroma(path)
    col.upsert(ids=[i for i, _ in notes], documents=[t for _, t in notes], metadatas=[{"file": i, "kind": "hi-alert"} for i, _ in notes])
    return len(notes)


def recall_like(card: dict, n: int = 4, path: Path | None = None) -> list[dict]:
    """Notes that read like this card. SIMILARITY, not evidence: each hit says so, and nothing here changes a score or a gate.

    The query is built from the card's model, side, symbol and what it was missing. A confident-looking neighbour can be the wrong lesson,
    which is why the floor's own recall (hi-alert.ts recallHiAlerts, same model and side, counts) is the one that speaks.
    """
    parts = [card.get("strategy"), card.get("side"), card.get("sym") or card.get("symbol"), *(card.get("why") or [])[:2]]
    query = " ".join(str(p) for p in parts if p)
    hits = recall(query, n=n, path=path)
    for h in hits:
        h["similarity_only"] = True
    return hits


def marqo_recall(query: str, url: str, index: str = "desk-brain", n: int = 4) -> list[dict]:
    """Same shape as recall(), against a Marqo server you are already running. Not started here."""
    try:
        import marqo
    except ImportError as e:
        raise RuntimeError("marqo is not installed. The lab uses Chroma on disk unless you point it at a Marqo server.") from e
    client = marqo.Client(url=url)
    res = client.index(index).search(query, limit=n)
    return [{"id": h.get("_id"), "text": h.get("text") or h.get("content") or "", "distance": h.get("_score")} for h in res.get("hits", [])]
