require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 1. Socket.io Configuration with CORS
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// 2. Folder Setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 3. Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// 4. Models (CRITICAL: Ensure these match your actual file names in the 'models' folder)
const User = require('./models/User');
const Message = require('./models/Message');

// 5. MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
  });

// 6. File Upload Config
const upload = multer({ storage: multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
})});

// --- HTTP ROUTES ---

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();
    
    console.log(`👤 New user created: ${username}`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Registration Error:", error.message);
    res.status(500).json({ error: "Server error during registration" });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.json({ token, username: user.username });
    } else {
      res.status(401).json({ error: "Invalid username or password" });
    }
  } catch (error) {
    console.error("❌ Login Error:", error.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  res.json({ 
    fileUrl: `/uploads/${req.file.filename}`, 
    fileName: req.file.originalname, 
    fileType: req.file.mimetype 
  });
});

// --- SOCKET.IO REAL-TIME LOGIC ---

const online = new Map();

io.on('connection', (socket) => {
  let user = null;
  let currentRoom = null;

  socket.on('auth', async (data) => {
    try {
      if (!data.token) return;
      const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
      user = decoded.username;
      currentRoom = data.room ? data.room.toLowerCase() : 'general';
      
      socket.join(currentRoom);
      
      if (!online.has(currentRoom)) online.set(currentRoom, new Set());
      online.get(currentRoom).add(user);
      
      // Notify room
      const joinMsg = new Message({ room: currentRoom, user: 'System', text: `${user} joined`, type: 'system' });
      io.to(currentRoom).emit('message', joinMsg);
      io.to(currentRoom).emit('onlineUsers', Array.from(online.get(currentRoom)));
      
      // Load history
      const history = await Message.find({ room: currentRoom }).sort({ createdAt: 1 }).limit(50);
      socket.emit('history', history);
    } catch (e) { 
      console.error("Auth Error:", e.message);
      socket.disconnect(); 
    }
  });

  socket.on('chatMessage', async (text) => {
    if (!user || !currentRoom) return;
    const msg = new Message({ room: currentRoom, user, text, type: 'text', seenBy: [user] });
    await msg.save();
    io.to(currentRoom).emit('message', msg);
  });

  socket.on('fileMessage', async (data) => {
    if (!user || !currentRoom) return;
    const msg = new Message({ room: currentRoom, user, ...data, type: 'file', seenBy: [user] });
    await msg.save();
    io.to(currentRoom).emit('message', msg);
  });

  socket.on('typing', (d) => {
    if (currentRoom) socket.to(currentRoom).emit('displayTyping', { user, isTyping: d.isTyping });
  });

  socket.on('disconnect', () => {
    if (user && currentRoom && online.has(currentRoom)) {
      online.get(currentRoom).delete(user);
      io.to(currentRoom).emit('onlineUsers', Array.from(online.get(currentRoom)));
    }
  });
});

// 7. Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server is live on port ${PORT}`);
});