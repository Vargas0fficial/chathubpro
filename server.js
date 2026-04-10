require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const User = require('./models/User');
const Message = require('./models/Message');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const upload = multer({ storage: multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
})});

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

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ fileUrl: `/uploads/${req.file.filename}`, fileName: req.file.originalname, fileType: req.file.mimetype });
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
      
      // --- FIX 1: INCREASE LIMIT & SORT BY NEWEST FIRST ---
      const history = await Message.find({ room: socket.currentRoom })
        .sort({ createdAt: -1 }) // Get the 500 newest messages
        .limit(500);
      
      // We reverse them so the oldest appears at the top for the user
      socket.emit('history', history.reverse());

      // --- FIX 2: SYSTEM MESSAGES ARE NOW LIVE-ONLY (NOT SAVED) ---
      const joinMsg = { 
        room: socket.currentRoom, 
        user: 'System', 
        text: `${socket.user} joined the chat`, 
        type: 'system' 
      };
      
      // Removed await joinMsg.save() to stop database clutter
      io.to(socket.currentRoom).emit('message', joinMsg);
      io.to(socket.currentRoom).emit('onlineUsers', Array.from(online.get(socket.currentRoom)));
      
    } catch (e) { 
      console.error("❌ Auth Error:", e.message);
      socket.disconnect(); 
    }
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
      console.error("❌ Failed to save message:", err.message);
    }
  });

  socket.on('fileMessage', async (data) => {
    if (!socket.user || !socket.currentRoom) return;
    try {
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
      console.error("❌ File save error:", err);
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

      // Removed await leaveMsg.save() to keep history clean
      io.to(socket.currentRoom).emit('message', leaveMsg);
      io.to(socket.currentRoom).emit('onlineUsers', Array.from(online.get(socket.currentRoom)));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));