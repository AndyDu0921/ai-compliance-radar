from __future__ import annotations

from pathlib import Path

from docx import Document
from pypdf import PdfReader


class ParseError(RuntimeError):
    pass


TEXT_SUFFIXES = {".txt", ".md", ".csv", ".log"}


def _decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse_text_from_path(path: str | Path) -> str:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return _decode_bytes(file_path.read_bytes())
    if suffix == ".docx":
        document = Document(file_path)
        paragraphs = [p.text.strip() for p in document.paragraphs if p.text and p.text.strip()]
        return "\n".join(paragraphs)
    if suffix == ".pdf":
        reader = PdfReader(str(file_path))
        pieces: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                pieces.append(text.strip())
        return "\n\n".join(pieces)
    raise ParseError(f"Unsupported file type: {suffix}")
