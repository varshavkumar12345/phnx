import chromadb
import json
import os
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
COLLECTION_NAME = "news"
BATCH_SIZE = 256  # SentenceTransformer handles this efficiently

# Resolve paths relative to this script's location (not CWD)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMADB_PATH = os.path.join(BASE_DIR, "data", "chroma_db")
JSON_PATH = os.path.join(BASE_DIR, "data", "mongo_db", "googlenews.json")

# Load model
model = SentenceTransformer(EMBEDDING_MODEL)

os.makedirs(CHROMADB_PATH, exist_ok=True)
client = chromadb.PersistentClient(path=CHROMADB_PATH)
collection = client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)

# Load dataset
try:
    with open(JSON_PATH, "r", encoding="utf-8") as file:
        dataset = json.load(file)
except FileNotFoundError:
    print(f"[ERROR] googlenews.json not found at {JSON_PATH}. Please run the web crawler first.")
    exit(1)

if not dataset:
    print("[INFO] Dataset is empty. Nothing to index.")
    exit(0)

print(f"[INFO] Loaded {len(dataset)} articles from JSON.")

# ── FIX: Batch existence check instead of one DB call per item ────────────────
all_ids = [f"id_{i}" for i in range(len(dataset))]
existing_result = collection.get(ids=all_ids, include=[])  # include=[] → only IDs
existing_ids = set(existing_result["ids"])

new_items = [
    (f"id_{i}", item)
    for i, item in enumerate(dataset)
    if f"id_{i}" not in existing_ids
]

if not new_items:
    print(f"[INFO] No new items to add — all {len(dataset)} articles already indexed.")
    exit(0)

print(f"[INFO] {len(new_items)} new articles to index ({len(existing_ids)} already in DB).")

# ── Build texts to embed ──────────────────────────────────────────────────────
# FIX: Embed Title + Source only (pubDate adds noise, not semantic value).
# The stored document is the same text — consistent with what the retriever
# sends to the LLM, avoiding the "encoded URL as content" problem.
ids_to_add = []
texts_to_embed = []
docs_to_store = []

for doc_id, item in new_items:
    title  = item.get("title",  "").strip()
    source = item.get("source", "").strip()
    link   = item.get("link",   "").strip()

    # Human-readable text that the LLM can actually use as evidence
    doc_text = f"Title: {title}"
    if source:
        doc_text += f"\nSource: {source}"
    if link:
        doc_text += f"\nLink: {link}"

    ids_to_add.append(doc_id)
    texts_to_embed.append(doc_text)   # same text embedded AND stored
    docs_to_store.append(doc_text)

# ── FIX: Batch encode for 10-50x speedup ──────────────────────────────────────
print(f"[INFO] Encoding {len(texts_to_embed)} articles in batches of {BATCH_SIZE}...")
all_embeddings = model.encode(
    texts_to_embed,
    batch_size=BATCH_SIZE,
    show_progress_bar=True,
    convert_to_numpy=True,
).tolist()

# ── Add to ChromaDB in batches (avoids single massive payload) ────────────────
total_added = 0
for start in range(0, len(ids_to_add), BATCH_SIZE):
    end = start + BATCH_SIZE
    collection.add(
        ids=ids_to_add[start:end],
        documents=docs_to_store[start:end],
        embeddings=all_embeddings[start:end],
    )
    total_added += len(ids_to_add[start:end])
    print(f"[INFO] Indexed {total_added}/{len(ids_to_add)} articles...")

print(f"[SUCCESS] Added {total_added} new articles to ChromaDB. Total in DB: {collection.count()}")

# ── Safe cleanup: only delete JSON if ALL items were indexed ──────────────────
# FIX: Don't delete when skipping (would destroy data on re-run).
# Only delete after a successful full indexing run with new data.
if os.path.exists(JSON_PATH):
    os.remove(JSON_PATH)
    print(f"[INFO] Deleted {JSON_PATH} after successful indexing.")
