# Phnx - AI-Powered News Credibility Verification

Phnx is an intelligent system designed to combat misinformation by verifying the credibility of news claims using advanced AI and a curated database of real news articles.

## Features

- **AI-Powered Verification**: Uses Mistral AI to analyze claims and determine credibility.
- **Vector Database**: Employs ChromaDB for efficient similarity search of news articles.
- **Hybrid Credibility Model**: Combines LLM knowledge with retrieved news evidence for accurate scoring.
- **Real-time Analysis**: Provides instant credibility scores and explanations for any given claim.

## Getting Started

### Prerequisites

- Python 3.8+
- pip
- A Mistral AI API key

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd phnx
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up environment variables:
   Create a `.env` file in the `transformer/` directory with the following:
   ```env
   MISTRAL_API_KEY=your_mistral_api_key_here
   MISTRAL_MODEL=mistral-small-latest
   ```

## Usage

### Running the Server

Start the Flask server:
```bash
python transformer/app.py
```

The server will start on `http://localhost:5000`.

### API Endpoints

#### Verify News Credibility

**Endpoint**: `POST /verify`

**Request Body**:
```json
{
  "claim": "Your news claim here",
  "article": "Optional: Full article text if available",
  "reference_links": ["Optional: URLs to reference articles"]
}
```

**Response**:
```json
{
  "article": "Sanitized article text",
  "snippets": "Retrieved news snippets",
  "score": 85,
  "reason": "Explanation of the score"
}
```

## Project Structure

```
phnx/
├── data/
│   ├── mongo_db/      # Raw news data
│   └── chroma_db/     # Vector database (generated)
├── transformer/
│   ├── app.py         # Main Flask application
│   ├── requirements.txt
│   └── .env           # Environment variables
└── README.md
```

## Development

### Adding News Data

1. Add news articles to `data/mongo_db/` as JSON files.
2. Run the data ingestion script to update the vector database:
   ```bash
   python transformer/app.py --ingest
   ```
=======
# phnx
Repo for Impact AI 2026

## How to run the app
```
pip install -r requirements.txt
python web_crawler/web_crawler.py
python embedding/embedding.py
python transformer/app.py
python app.py
```
