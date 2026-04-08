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

mongoose.connect(process.env.MONGO_URI).then(() => console.log(' MongoDB Connected'));

const upload = multer({ storage: multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
})});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed });
  await user.save();
  res.json({ success: true });
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
  res.json({ fileUrl: `/uploads/${req.file.filename}`, fileName: req.file.originalname, fileType: req.file.mimetype });
});

const online = new Map();

io.on('connection', (socket) => {
  let user = null;
  let currentRoom = null;

  socket.on('auth', async (data) => {
    try {
      const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
      user = decoded.username;
      currentRoom = data.room.toLowerCase();
      socket.join(currentRoom);
      
      if (!online.has(currentRoom)) online.set(currentRoom, new Set());
      online.get(currentRoom).add(user);
      
      const joinMsg = new Message({ room: currentRoom, user: 'System', text: `${user} joined`, type: 'system' });
      io.to(currentRoom).emit('message', joinMsg);
      io.to(currentRoom).emit('onlineUsers', Array.from(online.get(currentRoom)));
      
      const history = await Message.find({ room: currentRoom }).sort({ createdAt: 1 }).limit(50);
      socket.emit('history', history);
    } catch (e) { socket.disconnect(); }
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

  socket.on('messageRead', async (data) => {
    if (!user || !currentRoom) return;
    const msg = await Message.findById(data.msgId);
    if (msg && !msg.seenBy.includes(user)) {
      msg.seenBy.push(user);
      await msg.save();
      io.to(currentRoom).emit('readUpdate', { msgId: data.msgId, seenBy: msg.seenBy });
    }
  });

  socket.on('typing', (d) => {
    if (currentRoom) socket.to(currentRoom).emit('displayTyping', { user, isTyping: d.isTyping });
  });

  socket.on('disconnect', () => {
    if (user && currentRoom && online.has(currentRoom)) {
      online.get(currentRoom).delete(user);
      const leaveMsg = new Message({ room: currentRoom, user: 'System', text: `${user} left`, type: 'system' });
      io.to(currentRoom).emit('message', leaveMsg);
      io.to(currentRoom).emit('onlineUsers', Array.from(online.get(currentRoom)));
    }
  });
});

server.listen(3000, () => console.log(' Server on 3000'));