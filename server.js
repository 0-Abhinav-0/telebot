const express = require('express');
const multer = require('multer'); //for file upload
const path = require('path'); //Paths are formatted differently on Windows (\) and Linux/macOS (/). path ensures compatibility.
const fs = require('fs'); // read,write and update
const axios = require('axios'); // 3rd party app uses fetch
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

app.use(express.json());                            //JavaScript object accessible via req.body
app.use(express.urlencoded({ extended: true }));                        //Parses URL-encoded form data.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));         //

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {    // 1️⃣ DESTINATION: Where to save uploaded files
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {                 // 2️⃣ FILENAME: How to name the saved file
        const timestamp = Date.now();
        cb(null, `${timestamp}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mp3|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

// Utility functions
const getBaseUrl = () => process.env.BASE_URL || `http://localhost:${PORT}`;

const getFileInfo = (filename) => {
    const files = fs.readdirSync(uploadsDir);
    const matchingFile = files.find(file =>
        file.toLowerCase().includes(filename.toLowerCase()) ||
        file.split('-').slice(1).join('-').toLowerCase() === filename.toLowerCase()
    );
//    .split('-')       // ["169567", "photo", "example.png"]
//   .slice(1)         // ["photo", "example.png"]
//   .join('-')        // "photo-example.png"
//   .toLowerCase();   // "photo-example.png"

    if (matchingFile) {
        const filePath = path.join(uploadsDir, matchingFile);
        const stats = fs.statSync(filePath);
        return {
            filename: matchingFile,
            originalName: matchingFile.split('-').slice(1).join('-'),
            path: filePath,
            url: `${getBaseUrl()}/uploads/${matchingFile}`,
            size: stats.size,
            uploadDate: stats.birthtime
        };
    }
    return null;
};

// Telegram Bot functions
const sendMessage = async (chatId, text, options = {}) => {
    try {
        const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {     // yes, Telegram provides a built-in sendMessage endpoint as part of its Bot API.
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            ...options
        });
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error.response?.data || error.message);
        throw error;
    }
};

const sendDocument = async (chatId, filePath, caption = '') => {
    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', fs.createReadStream(filePath));                //so we are appending the file to formdata giving file location
        if (caption) formData.append('caption', caption);

        const response = await axios.post(`${TELEGRAM_API_URL}/sendDocument`, formData, {
            headers: formData.getHeaders()
        });
        return response.data;
    } catch (error) {
        console.error('Error sending document:', error.response?.data || error.message);
        // Fallback: send file URL if direct upload fails
        await sendMessage(chatId, `📎 <b>File:</b> ${caption}\n\n🔗 <a href="${getBaseUrl()}/uploads/${path.basename(filePath)}">Download Link</a>`);
    }
};

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// API Routes

// Upload file via API
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileInfo = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: `${getBaseUrl()}/uploads/${req.file.filename}`,
        uploadDate: new Date()
    };

    res.json({ success: true, message: 'File uploaded successfully', file: fileInfo });
});

// List all uploaded files
app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir).map(filename => {
            const filePath = path.join(uploadsDir, filename);
            const stats = fs.statSync(filePath);
            return {
                filename,
                originalName: filename.split('-').slice(1).join('-'),
                size: stats.size,
                url: `${getBaseUrl()}/uploads/${filename}`,
                uploadDate: stats.birthtime
            };
        });
        res.json({ success: true, files, count: files.length });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to list files', error: err.message });
    }
});

// Delete a file
app.delete('/api/files/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const files = fs.readdirSync(uploadsDir);
        const matchingFile = files.find(f => f.toLowerCase().includes(filename.toLowerCase()));
        
        if (!matchingFile) {
            return res.status(404).json({ success: false, message: 'File not found' });
        }

        fs.unlinkSync(path.join(uploadsDir, matchingFile));
        res.json({ success: true, message: 'File deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete file', error: err.message });
    }
});

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    console.log("📥 Received Telegram webhook:", JSON.stringify(req.body, null, 2));

    try {
        const { message } = req.body;
        if (!message) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text?.trim().toLowerCase() || '';
        const userName = message.from.first_name || 'User';

        let reply = '';

        if (text === '/start' || text === '/help') {
            reply = `🤖 <b>File Management Bot</b>\n\n` +
                   `👋 Hello ${userName}!\n\n` +
                   `📋 <b>Available Commands:</b>\n` +
                   `• /help - Show this help message\n` +
                   `• /list - Show all available files\n` +
                   `• /get filename - Download a specific file\n` +
                   `• /count - Show total number of files\n\n` +
                   `📤 <b>Upload files via API:</b>\n` +
                   `POST ${getBaseUrl()}/api/upload`;

        } else if (text === '/list' || text === '/files') {
            const files = fs.readdirSync(uploadsDir);
            
            if (files.length === 0) {
                reply = '📁 <b>No files available</b>\n\n' +
                       `Upload files via API: POST ${getBaseUrl()}/api/upload`;
            } else {
                const fileList = files.map((file, i) => {
                    const name = file.split('-').slice(1).join('-');
                    const stats = fs.statSync(path.join(uploadsDir, file));
                    const size = formatFileSize(stats.size);
                    return `${i + 1}. <code>${name}</code> (${size})`;
                }).join('\n');

                reply = `📁 <b>Available Files (${files.length}):</b>\n\n${fileList}\n\n` +
                       `💡 To download: <code>/get filename</code>`;
            }

        } else if (text === '/count') {
            const files = fs.readdirSync(uploadsDir);
            const totalSize = files.reduce((acc, file) => {
                return acc + fs.statSync(path.join(uploadsDir, file)).size;
            }, 0);
            
            reply = `📊 <b>File Statistics:</b>\n\n` +
                   `📁 Total files: ${files.length}\n` +
                   `💾 Total size: ${formatFileSize(totalSize)}`;

        } else if (text.startsWith('/get ')) {
            const requestedFile = text.substring(5).trim();
            const fileInfo = getFileInfo(requestedFile);

            if (fileInfo) {
                await sendMessage(chatId, `📎 <b>Sending file:</b> ${fileInfo.originalName}\n\n` +
                                         `📏 Size: ${formatFileSize(fileInfo.size)}\n` +
                                         `📅 Uploaded: ${new Date(fileInfo.uploadDate).toLocaleDateString()}`);
                
                // Try to send the actual file
                try {
                    await sendDocument(chatId, fileInfo.path, fileInfo.originalName);
                } catch (error) {
                    console.error('Failed to send document:', error);
                    await sendMessage(chatId, `❌ <b>Failed to send file directly</b>\n\n` +
                                             `🔗 <a href="${fileInfo.url}">Download Link</a>`);
                }
                return res.sendStatus(200);
            } else {
                reply = `❌ <b>File not found:</b> "${requestedFile}"\n\n` +
                       `Use /list to see available files.`;
            }

        } else {
            reply = `❓ <b>Unknown command:</b> "${message.text}"\n\n` +
                   `Send /help for available commands.`;
        }

        await sendMessage(chatId, reply);
        res.sendStatus(200);

    } catch (err) {
        console.error('❌ Telegram webhook error:', err);
        res.sendStatus(500);
    }
});

// Set Telegram webhook (call this once to register your webhook)
app.post('/setup-webhook', async (req, res) => {
    try {
        const webhookUrl = `${getBaseUrl()}/webhook/telegram`;
        const response = await axios.post(`${TELEGRAM_API_URL}/setWebhook`, {
            url: webhookUrl
        });
        res.json({ success: true, message: 'Webhook set successfully', data: response.data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to set webhook', error: error.message });
    }
});

// Remove Telegram webhook
app.post('/remove-webhook', async (req, res) => {
    try {
        const response = await axios.post(`${TELEGRAM_API_URL}/deleteWebhook`);
        res.json({ success: true, message: 'Webhook removed successfully', data: response.data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove webhook', error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 Server started at http://localhost:${PORT}
🤖 Telegram Webhook: ${getBaseUrl()}/webhook/telegram
📤 Upload API: POST ${getBaseUrl()}/api/upload
📋 File List: GET ${getBaseUrl()}/api/files
⚙️  Setup webhook: POST ${getBaseUrl()}/setup-webhook

📝 Don't forget to:
1. Set TELEGRAM_BOT_TOKEN in your .env file
2. Call /setup-webhook endpoint to register webhook
3. Set BASE_URL in .env if deploying to production
`);
});

module.exports = app;



// lt --port 3000
// curl -X POST https://mytelegrambot.loca.lt/setup-webhook

//User → Telegram → (Webhook URL) → Your Server → Telegram → User

