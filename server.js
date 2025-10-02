// index.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
require("dotenv").config();

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
    const text = (message.text || "").trim().toLowerCase();

    if (text === "/start" || text === "/help") {
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: chatId,
        text: `🤖 File Bot\n\nCommands:\n/list - Show files\n/get filename - Download file\n/count - Stats\n/search keyword - Search files`,
        parse_mode: "HTML"
      });
    } else if (text === "/list") {
      const files = fs.readdirSync(UPLOADS_DIR);
      if (!files.length) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: "📁 No files available" });
      } else {
        const list = files.map((f,i) => `${i+1}. ${f.split('-').slice(1).join('-')} (${formatSize(fs.statSync(path.join(UPLOADS_DIR,f)).size)})`).join("\n");
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `📁 Files:\n\n${list}`, parse_mode: "HTML" });
      }
    } else if (text === "/count") {
      const files = fs.readdirSync(UPLOADS_DIR);
      const total = files.reduce((sum,f)=>sum+fs.statSync(path.join(UPLOADS_DIR,f)).size,0);
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id: chatId, text: `📊 Files: ${files.length}\n💾 Size: ${formatSize(total)}` });
    } else if (text.startsWith("/search ")) {
      const keyword = text.substring(8).trim();
      const matches = fs.readdirSync(UPLOADS_DIR).filter(f => f.toLowerCase().includes(keyword.toLowerCase()));
      if (!matches.length) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id, text: `🔍 No files found: "${keyword}"` });
      } else {
        const list = matches.map((f,i)=>`${i+1}. ${f.split('-').slice(1).join('-')}`).join("\n");
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id, text: `🔍 Found ${matches.length} files:\n\n${list}` });
      }
    } else if (text.startsWith("/get ")) {
      const filename = text.substring(5).trim();
      const file = getFileInfo(filename);
      if (!file) {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id, text: `❌ File not found: "${filename}"` });
      } else {
        if (file.size > TELEGRAM_FILE_LIMIT) {
          await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id,
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
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, { chat_id, text: `❓ Unknown command: "${text}"` });
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
