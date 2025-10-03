// index.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");
const util = require("util");
require("dotenv").config();

const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

console.log("TOKEN:", process.env.TELEGRAM_BOT_TOKEN);

// Telegram bot config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN missing in .env");
  process.exit(1);
}
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Upload folder
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer config
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: TELEGRAM_FILE_LIMIT }
});

// Utility: base URL
function getBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${PORT}`;
}

// Utility: human-readable size
function formatSize(bytes) {
  if (!bytes) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${["B","KB","MB","GB"][i]}`;
}

// Utility: escape HTML for Telegram
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Utility: get file info by name
function getFileInfo(filename) {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const match = files.find(f => f.includes(filename));
    if (match) {
      const stats = fs.statSync(path.join(UPLOADS_DIR, match));
      return {
        filename: match,
        url: `${getBaseUrl()}/files/${match}`,
        size: stats.size
      };
    }
  } catch(err) { console.error(err); }
  return null;
}

// Utility: detect Python command
function getPythonCommand() {
  const isWindows = process.platform === 'win32';
  return isWindows ? 'python' : 'python3';
}

// Utility: run semantic search Python script
async function runSemanticSearch(query) {
  try {
    const pythonScript = path.join(__dirname, "semantic.py");
    
    // Check if semantic.py exists
    if (!fs.existsSync(pythonScript)) {
      throw new Error("semantic.py not found");
    }

    // Get appropriate Python command
    const pythonCmd = getPythonCommand();

    // Escape query for shell safety
    const escapedQuery = query.replace(/"/g, '\\"');
    
    // Run Python script with query as argument
    const { stdout, stderr } = await execPromise(`${pythonCmd} "${pythonScript}" "${escapedQuery}"`, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 // 1MB buffer
    });

    if (stderr && !stdout) {
      console.error("Python stderr:", stderr);
      throw new Error(stderr);
    }

    // Parse JSON output
    const results = JSON.parse(stdout.trim());
    
    if (!Array.isArray(results)) {
      throw new Error("Invalid response format from semantic.py - expected array");
    }

    return results;
  } catch (err) {
    console.error("Semantic search error:", err.message);
    throw err;
  }
}

// Serve uploaded files
app.use("/files", express.static(UPLOADS_DIR));
app.use(express.json());

// --- Upload API ---
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: `${getBaseUrl()}/files/${req.file.filename}`
    }
  });
});

// --- Telegram Webhook ---
app.post("/webhook/telegram", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = (message.text || "").trim();
    const textLower = text.toLowerCase();

    if (textLower === "/start" || textLower === "/help") {
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: chatId,
        text: `🤖 File Bot\n\nCommands:\n/list - Show files\n/get filename - Download file\n/count - Stats\n/search keyword - Search files\n/searchh query - Semantic search PDFs`,
        parse_mode: "HTML"
      });
    } else if (textLower === "/list") {
      const files = fs.readdirSync(UPLOADS_DIR);
      if (!files.length) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: "📁 No files available" });
      } else {
        const list = files.map((f,i) => `${i+1}. ${f.split('-').slice(1).join('-')} (${formatSize(fs.statSync(path.join(UPLOADS_DIR,f)).size)})`).join("\n");
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `📁 Files:\n\n${list}`, parse_mode: "HTML" });
      }
    } else if (textLower === "/count") {
      const files = fs.readdirSync(UPLOADS_DIR);
      const total = files.reduce((sum,f)=>sum+fs.statSync(path.join(UPLOADS_DIR,f)).size,0);
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `📊 Files: ${files.length}\n💾 Size: ${formatSize(total)}` });
    } else if (textLower.startsWith("/search ")) {
      const keyword = text.substring(8).trim();
      const matches = fs.readdirSync(UPLOADS_DIR).filter(f => f.toLowerCase().includes(keyword.toLowerCase()));
      if (!matches.length) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `🔍 No files found: "${keyword}"` });
      } else {
        const list = matches.map((f,i)=>`${i+1}. ${f.split('-').slice(1).join('-')}`).join("\n");
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `🔍 Found ${matches.length} files:\n\n${list}` });
      }
    } else if (textLower.startsWith("/searchh ")) {
      const query = text.substring(9).trim();
      
      if (!query) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { 
          chat_id: chatId, 
          text: "❌ Please provide a search query.\nUsage: /searchh <query>" 
        });
        return res.sendStatus(200);
      }

      // Send "searching..." message
      const searchingMessage = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { 
        chat_id: chatId, 
        text: `🔍 Searching for: "${escapeHtml(query)}"...`,
        parse_mode: "HTML"
      });

      try {
        // Run semantic search (non-blocking)
        const results = await runSemanticSearch(query);
        
        if (!results || results.length === 0) {
          // Edit the searching message to show no results
          try {
            await axios.post(`${TELEGRAM_API_URL}/editMessageText`, {
              chat_id: chatId,
              message_id: searchingMessage.data.result.message_id,
              text: `🔍 No files found for query "${escapeHtml(query)}"`,
              parse_mode: "HTML"
            });
          } catch (editErr) {
            // Fallback: send new message
            await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { 
              chat_id: chatId, 
              text: `🔍 No files found for query "${escapeHtml(query)}"`,
              parse_mode: "HTML"
            });
          }
        } else {
          // Format results with file sizes
          const list = results.map((filename, i) => {
            try {
              const filePath = path.join(UPLOADS_DIR, filename);
              const stats = fs.statSync(filePath);
              // Remove timestamp prefix if present
              const displayName = filename.includes('-') 
                ? filename.split('-').slice(1).join('-') 
                : filename;
              return `${i + 1}. ${escapeHtml(displayName)} (${formatSize(stats.size)})`;
            } catch (err) {
              // If file not found, just show filename
              const displayName = filename.includes('-') 
                ? filename.split('-').slice(1).join('-') 
                : filename;
              return `${i + 1}. ${escapeHtml(displayName)}`;
            }
          }).join("\n");
          
          const messageText = `🔍 Found ${results.length} file(s) for "${escapeHtml(query)}":\n\n${list}\n\nUse /get &lt;filename&gt; to download.`;
          
          // Try to edit the "searching..." message
          try {
            await axios.post(`${TELEGRAM_API_URL}/editMessageText`, {
              chat_id: chatId,
              message_id: searchingMessage.data.result.message_id,
              text: messageText,
              parse_mode: "HTML"
            });
          } catch (editErr) {
            console.warn("Failed to edit message:", editErr.message);
            // Fallback: send new message
            await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { 
              chat_id: chatId, 
              text: messageText,
              parse_mode: "HTML"
            });
          }
        }
      } catch (err) {
        console.error("Semantic search failed:", err.message);
        const errorMsg = `❌ Semantic search failed: ${escapeHtml(err.message)}\n\nPlease try again or contact administrator.`;
        
        try {
          await axios.post(`${TELEGRAM_API_URL}/editMessageText`, {
            chat_id: chatId,
            message_id: searchingMessage.data.result.message_id,
            text: errorMsg,
            parse_mode: "HTML"
          });
        } catch (editErr) {
          console.warn("Failed to edit error message:", editErr.message);
          await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { 
            chat_id: chatId, 
            text: errorMsg,
            parse_mode: "HTML"
          });
        }
      }
    } else if (textLower.startsWith("/get ")) {
      const filename = text.substring(5).trim();
      const file = getFileInfo(filename);
      if (!file) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `❌ File not found: "${filename}"` });
      } else {
        if (file.size > TELEGRAM_FILE_LIMIT) {
          await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: `⚠️ File too large\n🔗 Download: ${file.url}`
          });
        } else {
          // sendDocument
          const FormData = require("form-data");
          const form = new FormData();
          form.append("chat_id", chatId);
          form.append("document", fs.createReadStream(path.join(UPLOADS_DIR, file.filename)), { filename: file.filename });
          await axios.post(`${TELEGRAM_API_URL}/sendDocument`, form, { headers: form.getHeaders() });
        }
      }
    } else {
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `❓ Unknown command: "${text}"` });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// --- Start server & set webhook automatically ---
app.listen(PORT, async () => {
  const baseUrl = getBaseUrl();
  const webhookUrl = `${baseUrl}/webhook/telegram`;
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Webhook endpoint: ${webhookUrl}`);
  console.log(`📤 Upload API: POST ${baseUrl}/api/upload`);

  try {
    const resWebhook = await axios.post(`${TELEGRAM_API_URL}/setWebhook`, { url: webhookUrl, drop_pending_updates: true });
    console.log("✅ Webhook set successfully:", resWebhook.data);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err.response?.data || err.message);
  }
});