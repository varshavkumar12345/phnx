import json
import os
import re
from dataclasses import asdict, dataclass
from typing import Optional

import chromadb
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from sentence_transformers import SentenceTransformer

load_dotenv()

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
COLLECTION_NAME = "news"
COSINE_THRESHOLD = 0.25  # Lowered: old embeddings used different text format
DEFAULT_MODEL = "mistral-small-latest"
DEFAULT_API_URL = "https://api.mistral.ai/v1/chat/completions"
DEFAULT_TRUNCATION = 1000

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
MISTRAL_MODEL = os.getenv("MISTRAL_MODEL", DEFAULT_MODEL)
MISTRAL_API_URL = os.getenv("MISTRAL_API_URL", DEFAULT_API_URL)

# Load embedding model
embedding_model = SentenceTransformer(EMBEDDING_MODEL)

# Set up ChromaDB with correct path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMADB_PATH = os.path.join(BASE_DIR, "data", "chroma_db")
os.makedirs(CHROMADB_PATH, exist_ok=True)

client = chromadb.PersistentClient(path=CHROMADB_PATH)
collection = client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
app = Flask(__name__, static_folder=FRONTEND_DIR, template_folder=FRONTEND_DIR)
CORS(app)

PROMPT_TEMPLATE = """
You are a news credibility verifier.

A user posted the following claim on social media:
\"\"\"{{claim}}\"\"\"

Below are real news article headlines retrieved from a trusted news database.
Each headline includes a Similarity score (0.00-1.00) showing how closely it matches the claim — higher means more relevant.
\"\"\"{{snippets}}\"\"\"

────────────────────────────────────────────────
STEP 0 — First, classify the claim into one of these types:
  A) SCIENTIFIC_FACT   — established science, medicine or health consensus (e.g. "vaccines are effective")
  B) HISTORICAL_FACT   — a well-known past event (e.g. "Man landed on the moon in 1969")
  C) CURRENT_EVENT     — a recent news story that requires verification against headlines
  D) OPINION / OTHER   — subjective statement or general claim

STEP 1 — Choose your evaluation path based on the type above:

  ► If Type A or B (SCIENTIFIC or HISTORICAL):
    • Use your own trained knowledge as the PRIMARY signal. Headlines are secondary.
    • If retrieved headlines are UNRELATED, that is perfectly fine — do NOT lower the score for it.
    • Score based on whether the claim matches scientific/historical consensus:
        - Well-established fact / strong consensus  →  85–100
        - Mostly true but oversimplified or partial →  65–84
        - Disputed / contested among experts        →  40–64
        - False or misleading                       →   0–39

  ► If Type C (CURRENT_EVENT):
    • Retrieved headlines are the PRIMARY signal.
    • High-similarity headlines (≥ 0.60) that confirm the claim  →  75–100
    • Headlines partially match or cover a related topic         →  50–74
    • Headlines fully unrelated (database may be incomplete)     →  45  (neutral — not low)
    • Headlines directly contradict the claim                    →   0–30

  ► If Type D (OPINION / OTHER):
    • Score in 50–70 range unless the claim is clearly false or harmful misinformation.

STEP 2 — Output ONLY this, with no extra text:
Credibility Score: <0-100>
Reason: <one sentence explaining the score>
────────────────────────────────────────────────
""".strip()


_RE_SCORE  = re.compile(r"Credibility Score:\s*\**(\d+)\**", re.IGNORECASE)
_RE_REASON = re.compile(r"Reason:\s*(.*)", re.IGNORECASE | re.DOTALL)
URL_PATTERN = re.compile(r"https?://[^\s\"')>\]]+")



@dataclass
class CredibilityResult:
    article: str
    snippets: str
    score: Optional[int]
    reason: str

    def serialize(self, truncate_at: int = DEFAULT_TRUNCATION) -> dict:
        payload = asdict(self)
        if self.article:
            payload["article"] = self.article[: truncate_at or DEFAULT_TRUNCATION]
        if self.snippets:
            payload["snippets"] = self.snippets[: truncate_at or DEFAULT_TRUNCATION]
        payload["score"] = self.score
        return payload


def extract_article_from_text(text: str) -> str:
    """Validate and clean input text."""
    if not text or not text.strip():
        raise ValueError("Article text cannot be empty.")
    return text.strip()


def _get_embedding(text: str) -> list[float]:
    """Generate embedding using sentence-transformers."""
    embedding = embedding_model.encode(text)
    return embedding.tolist()


def retrieve(query: str, top_n: int = 10) -> tuple[list[str], list[str], list[float]]:
    """Embed the query and retrieve similar docs from ChromaDB.
    Returns: (clean_docs, reference_links, similarity_scores)
    """
    qe = _get_embedding(query)
    results = collection.query(
        query_embeddings=[qe], n_results=top_n, include=["documents", "distances"]
    )

    docs = results.get("documents", [[]])[0]
    distances = results.get("distances", [[]])[0]

    filtered_docs = []
    filtered_links = []
    filtered_scores = []

    for doc, distance in zip(docs, distances):
        if distance is not None and (1 - distance) >= COSINE_THRESHOLD:
            similarity = round(1 - distance, 4)
            clean_doc = _sanitize_doc(doc)
            filtered_docs.append(clean_doc)
            filtered_scores.append(similarity)
            link = extract_reference_link(doc)  # extract from raw before sanitizing
            if link:
                filtered_links.append(link)

    return filtered_docs, filtered_links, filtered_scores


def _sanitize_doc(doc: str) -> str:
    """Convert stored docs to clean LLM-readable text.

    Handles both old format (json.dumps of full item with encoded URLs)
    and new format (plain text Title/Source/Link string).
    """
    if not doc:
        return ""

    # Try to parse as JSON (old format: {title, link, source, pubDate})
    try:
        parsed = json.loads(doc)
        if isinstance(parsed, dict):
            parts = []
            if parsed.get("title"):
                parts.append(f"Title: {parsed['title']}")
            if parsed.get("source"):
                parts.append(f"Source: {parsed['source']}")
            if parsed.get("pubDate"):
                parts.append(f"Published: {parsed['pubDate']}")
            # Deliberately omit 'link' — it's a base64-encoded Google News
            # redirect URL that looks like garbage to the LLM
            return "\n".join(parts) if parts else doc
    except (json.JSONDecodeError, TypeError):
        pass

    # Already plain text (new format) — strip any raw URLs to keep it clean
    clean = URL_PATTERN.sub("[link]", doc)
    return clean.strip()


def extract_reference_link(doc):
    if not doc:
        return None

    if isinstance(doc, dict):
        for key in ("link", "url", "source"):
            value = doc.get(key)
            if isinstance(value, str) and value.startswith("http"):
                return value

    if isinstance(doc, str):
        try:
            parsed = json.loads(doc)
            if isinstance(parsed, dict):
                ref = parsed.get("link") or parsed.get("url")
                if isinstance(ref, str) and ref.startswith("http"):
                    return ref
        except json.JSONDecodeError:
            pass

        match = URL_PATTERN.search(doc)
        if match:
            return match.group(0).rstrip(".,);")

    return None


def _parse_model_response(content: str) -> tuple[Optional[int], str]:
    if not content:
        return None, "Empty response from model."

    score_match  = _RE_SCORE.search(content)
    reason_match = _RE_REASON.search(content)

    if not score_match:
        print(f"[PHNX] Could not parse score from model response:\n{content}\n---")
        return None, "Unable to parse credibility score from model response."

    score  = int(score_match.group(1))
    reason = reason_match.group(1).strip() if reason_match else "No reason provided."
    return score, reason


def check_credibility(claim: str, snippets: str) -> CredibilityResult:
    if not MISTRAL_API_KEY:
        raise RuntimeError(
            "MISTRAL_API_KEY is not set. Please define it in your environment or .env file."
        )

    prompt = PROMPT_TEMPLATE.replace("{{claim}}", claim).replace("{{snippets}}", snippets)

    payload = {
        "model": MISTRAL_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }

    response = requests.post(
        MISTRAL_API_URL,
        headers={
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Mistral API error {response.status_code}: {response.text[:200]}"
        )

    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

    print(f"[PHNX] claim   : {claim[:120]}")
    print(f"[PHNX] snippets: {snippets[:300]}")
    print(f"[PHNX] response: {content}")

    score, reason = _parse_model_response(content)
    return CredibilityResult(article="", snippets=snippets, score=score, reason=reason)


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.post("/api/check")
def api_check():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    top_n = data.get("top_n", 3)

    if not text:
        return jsonify({"error": "Article text is required."}), 400

    try:
        # Clean input text
        article = extract_article_from_text(text)

        try:
            top_n = max(1, int(top_n))
        except (TypeError, ValueError):
            top_n = 3

        # Use the article text as the query into your vector DB
        documents, reference_links, similarity_scores = retrieve(article, top_n=top_n)

        if not documents:
            payload = {
                "article": article[:DEFAULT_TRUNCATION],
                "snippets": "",
                "score": 50,
                "reason": "No matching articles were found in the knowledge base to verify this claim. "
                          "The score is neutral (50/100) — populate the database with news articles "
                          "to enable accurate credibility checking.",
                "documents": [],
            }
            return jsonify(payload)

        # Annotate each snippet with its cosine similarity for the LLM
        annotated = []
        for doc, score in zip(documents, similarity_scores):
            annotated.append(f"[Similarity: {score:.2f}]\n{doc}")
        snippets = "\n\n".join(annotated)

        result = check_credibility(article, snippets)

        payload = result.serialize()
        payload["article"] = article[:DEFAULT_TRUNCATION]
        payload["documents"] = reference_links
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


#import os

if __name__ == "__main__":
    port = int(os.environ.get("TRANSFORMER_PORT", 5001))
    app.run(host="0.0.0.0", port=port)
