import chromadb
import json
import os
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
COLLECTION_NAME = "news"

# Resolve paths relative to this script's location (not CWD)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMADB_PATH = os.path.join(BASE_DIR, "data", "chroma_db")
JSON_PATH = os.path.join(BASE_DIR, "data", "mongo_db", "googlenews.json")

# Load model
model = SentenceTransformer(EMBEDDING_MODEL)

os.makedirs(CHROMADB_PATH, exist_ok=True)
client = chromadb.PersistentClient(path=CHROMADB_PATH)
collection = client.get_or_create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})

# Load dataset
try:
    with open(JSON_PATH, "r", encoding="utf-8") as file:
        dataset = json.load(file)
except FileNotFoundError:
    print(f"googlenews.json not found at {JSON_PATH}. Please run the web crawler first.")
    exit(1)

# Prepare data for ChromaDB
documents = []
embeddings = []
ids = []

for i, news_item in enumerate(dataset):
    doc_id = f"id_{i}"

    # Check if ID already exists in collection
    existing = collection.get(ids=[doc_id])
    if existing['ids']:  # ID already exists
        print(f"Skipping {doc_id} - already in collection")
        continue

    # Convert dictionary to a formatted string for embedding
    text_to_embed = f"Title: {news_item['title']}. Source: {news_item['source']}. Published: {news_item['pubDate']}"

    # Generate embedding
    embedding = model.encode(text_to_embed).tolist()

    # Store the original JSON string as the document
    documents.append(json.dumps(news_item))
    embeddings.append(embedding)
    ids.append(doc_id)

# Add to ChromaDB only if there are new documents
if documents:
    collection.add(
        documents=documents,
        embeddings=embeddings,
        ids=ids
    )
    print(f"Successfully added {len(documents)} news items to ChromaDB")
else:
    print("No new items to add - all IDs already in collection")

# Delete the JSON file after embedding to keep the data directory clean
if os.path.exists(JSON_PATH):
    os.remove(JSON_PATH)
    print(f"Deleted {JSON_PATH} after embedding.")
