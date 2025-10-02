# Semantic Search Setup Guide

## Environment Variables Required

Create a `.env` file in your project root with the following variables:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Google Gemini Configuration
GOOGLE_API_KEY=your_google_api_key_here

# Server Configuration
PORT=3000
BASE_URL=https://your-localtunnel-url.loca.lt
```

## Getting API Keys

### 1. Telegram Bot Token
1. Message @BotFather on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token to your `.env` file

### 2. Google API Key (Free!)
1. Go to https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key to your `.env` file

## Running the Bot

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Start LocalTunnel:
```bash
npx lt --port 3000
```

4. Update your `.env` file with the LocalTunnel URL

5. Set up the webhook:
```bash
curl -X POST http://localhost:3000/setup-webhook
```

## New Commands

- `/search query` - Find files using semantic search
- `/help` - Show all available commands
- `/list` - Show all files
- `/get filename` - Download a specific file
- `/count` - Show file statistics

## Supported File Types

- PDF files (text extraction)
- DOCX files (text extraction)
- TXT files (direct text)
- Images (filename-based indexing)
- Other files (filename-based indexing)

## How Semantic Search Works

1. When you upload a file, the bot automatically:
   - Extracts text content from the file
   - Generates embeddings using Google Gemini's embedding-001 model
   - Stores the embeddings in a FAISS vector index

2. When you search:
   - Your query is converted to an embedding
   - The bot finds the most similar files using vector similarity
   - Returns the top 3 most relevant files with similarity scores

## Benefits of Google Gemini

- **Free to use** - No subscription required
- **High quality embeddings** - 768-dimensional vectors
- **Fast processing** - Quick response times
- **Reliable service** - Google's infrastructure
