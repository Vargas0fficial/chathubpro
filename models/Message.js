const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room: { type: String, default: 'general' },
  user: String,
  text: String,
  type: { type: String, default: 'text' }, // 'text', 'file', or 'system'
  fileUrl: String,
  fileName: String,
  fileType: String,
  seenBy: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);