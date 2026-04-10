require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

// CLOUDINARY IMPORTS
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- STARTUP DEBUG ---
console.log("--- STARTUP DEBUG ---");
console.log("Cloud Name:", process.env.CLOUDINARY_NAME ? "✅ " + process.env.CLOUDINARY_NAME : "❌ MISSING");
console.log("API Key:", process.env.CLOUDINARY_KEY ? "✅ Loaded" : "❌ MISSING");

// Configure Cloudinary (Added .trim() to prevent signature errors)
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_NAME?.trim(), 
  api_key: process.env.CLOUDINARY_KEY?.trim(), 
  api_secret: process.env.CLOUDINARY_SECRET?.trim() 
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'chat_uploads',
    resource_type: 'auto',
  },
});

const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));

const User = require('./models/User');
const Message = require('./models/Message');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// AUTH ROUTES
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET);
    res.json({ token, username: user.username });
  } else res.status(401).send();
});

// UPLOAD ROUTE
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  console.log("🚀 Cloudinary Upload Success! URL:", req.file.path);
  res.json({ 
    fileUrl: req.file.path, 
    fileName: req.file.originalname, 
    fileType: req.file.mimetype 
  });
}, (error, req, res, next) => {
  console.error("❌ CLOUDINARY CRASH:", error.message);
  res.status(500).json({ error: error.message });
});

const online = new Map();

io.on('connection', (socket) => {
  socket.user = null;
  socket.currentRoom = null;

  console.log('🔌 New socket connection established');

  socket.on('auth', async (data) => {
    try {
      const tokenToVerify = typeof data === 'string' ? data : data.token;
      const roomRequested = (typeof data === 'object' && data.room) ? data.room : 'public';

      const decoded = jwt.verify(tokenToVerify, process.env.JWT_SECRET);
      socket.user = decoded.username;
      socket.currentRoom = roomRequested.toLowerCase().trim(); 
      
      socket.join(socket.currentRoom);
      
      if (!online.has(socket.currentRoom)) online.set(socket.currentRoom, new Set());
      online.get(socket.currentRoom).add(socket.user);
      
      console.log(`👤 User Authenticated: ${socket.user} in [${socket.currentRoom}]`);
      
      const history = await Message.find({ room: socket.currentRoom })
        .sort({ createdAt: -1 })
        .limit(500);
      
      socket.emit('history', history.reverse());

      const joinMsg = { 
        room: socket.currentRoom, 
        user: 'System', 
        text: `${socket.user} joined the chat`, 
        type: 'system' 
      };
      
      io.to(socket.currentRoom).emit('message', joinMsg);
      io.to(socket.currentRoom).emit('onlineUsers', Array.from(online.get(socket.currentRoom)));
      
    } catch (e) { 
      console.error("❌ Auth Error:", e.message);
      socket.disconnect(); 
    }
  });

  // --- TYPING FEATURE EVENTS ---
  socket.on('typing', (isTyping) => {
    if (!socket.user || !socket.currentRoom) return;
    // Broadcast to everyone else in the room
    socket.to(socket.currentRoom).emit('userTyping', {
      user: socket.user,
      typing: isTyping
    });
  });

  socket.on('chatMessage', async (text) => {
    if (!socket.user || !socket.currentRoom) return;
    try {
      const msg = new Message({ 
        room: socket.currentRoom, 
        user: socket.user, 
        text, 
        type: 'text', 
        seenBy: [socket.user] 
      });
      const savedMsg = await msg.save();
      io.to(socket.currentRoom).emit('message', savedMsg);
    } catch (err) {
      console.error("❌ Message Save Error:", err.message);
    }
  });

  socket.on('fileMessage', async (data) => {
    if (!socket.user || !socket.currentRoom) return;
    try {
      console.log("📂 File Data Received:", JSON.stringify(data));
      const msg = new Message({ 
        room: socket.currentRoom, 
        user: socket.user, 
        ...data, 
        type: 'file', 
        seenBy: [socket.user] 
      });
      await msg.save();
      io.to(socket.currentRoom).emit('message', msg);
    } catch (err) {
      console.error("❌ File Message DB Error:", err.message);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.user && socket.currentRoom && online.has(socket.currentRoom)) {
      online.get(socket.currentRoom).delete(socket.user);
      
      const leaveMsg = { 
        room: socket.currentRoom, 
        user: 'System', 
        text: `${socket.user} has left the chat`, 
        type: 'system' 
      };

      io.to(socket.currentRoom).emit('message', leaveMsg);
      io.to(socket.currentRoom).emit('onlineUsers', Array.from(online.get(socket.currentRoom)));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));