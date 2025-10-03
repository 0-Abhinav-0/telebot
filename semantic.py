import os
import redis
import numpy as np
import PyPDF2
import re
from sentence_transformers import SentenceTransformer
import sys
import json  # for easy array output

UPLOAD_FOLDER = "uploads"
REDIS_HOST = 'localhost'
REDIS_PORT = 6379

# Load model
model = SentenceTransformer('all-mpnet-base-v2')

# Connect to Redis
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0)

# Clear Redis (optional)
# r.flushdb()

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'\bPage\s+\d+\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]', '', text)
    text = text.replace('ﬁ', 'fi').replace('ﬂ', 'fl')
    return text.strip()

def chunk_text(text, chunk_size=400, overlap=100):
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = []
    current_word_count = 0
    
    for sentence in sentences:
        sentence_words = sentence.split()
        sentence_word_count = len(sentence_words)
        
        if current_word_count + sentence_word_count > chunk_size and current_chunk:
            chunks.append(' '.join(current_chunk))
            overlap_words = []
            overlap_count = 0
            for prev_sentence in reversed(current_chunk):
                prev_words = prev_sentence.split()
                if overlap_count + len(prev_words) <= overlap:
                    overlap_words.insert(0, prev_sentence)
                    overlap_count += len(prev_words)
                else:
                    break
            current_chunk = overlap_words
            current_word_count = overlap_count
        
        current_chunk.append(sentence)
        current_word_count += sentence_word_count
    
    if current_chunk:
        chunks.append(' '.join(current_chunk))
    
    return chunks

# Process PDFs and store in Redis (if not already done)
for filename in os.listdir(UPLOAD_FOLDER):
    if filename.endswith(".pdf"):
        path = os.path.join(UPLOAD_FOLDER, filename)
        with open(path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text = "".join([page.extract_text() or "" for page in reader.pages])
        text = clean_text(text)
        chunks = chunk_text(text)
        for i, chunk in enumerate(chunks):
            vector = model.encode(chunk, convert_to_numpy=True, normalize_embeddings=True)
            r.set(f"chunk:{filename}::{i+1}", vector.tobytes())
            r.set(f"text:{filename}::{i+1}", chunk)

# Function to get filenames only
def find_most_similar_filenames(query, top_k=5):
    query_vec = model.encode(query, convert_to_numpy=True, normalize_embeddings=True)
    results = []
    for key in r.keys("chunk:*"):
        chunk_vec = np.frombuffer(r.get(key), dtype='float32')
        similarity = np.dot(query_vec, chunk_vec)
        filename = key.decode().replace("chunk:", "").split("::")[0]
        results.append((filename, similarity))
    
    # Sort by similarity
    results.sort(key=lambda x: x[1], reverse=True)
    
    # Extract unique filenames
    seen = set()
    filenames = []
    for fname, _ in results:
        if fname not in seen:
            filenames.append(fname)
            seen.add(fname)
        if len(filenames) >= top_k:
            break
    
    return filenames

# ------------------- MAIN -------------------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python semantic.py <query>")
        sys.exit(1)
    
    query = sys.argv[1]
    top_files = find_most_similar_filenames(query, top_k=5)
    
    # Print as JSON array (easy to parse in Node/Express)
    print(json.dumps(top_files))
