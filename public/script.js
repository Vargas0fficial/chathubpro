const socket = io();
let token = localStorage.getItem('token');
let username = '';
let currentRoom = 'Public Room Only';

const messagesDiv = document.getElementById('messages');
const onlineUsersDiv = document.getElementById('onlineUsers');
const typingIndicator = document.getElementById('typingIndicator');
const roomNameEl = document.getElementById('roomName');
const usernameDisplay = document.getElementById('usernameDisplay');
const authModal = document.getElementById('authModal');

// Dark Mode Toggle
function toggleTheme() {
  if (document.documentElement.classList.contains('dark')) {
    document.documentElement.classList.remove('dark');
    localStorage.theme = 'light';
  } else {
    document.documentElement.classList.add('dark');
    localStorage.theme = 'dark';
  }
}

// Auth Modal
function switchTab(tab) {
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 0);
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 1);
}

async function register() {
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  if (!u || !p) return alert("Please fill all fields");

  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (data.success) {
    alert("Account created! Please login.");
    switchTab(0);
  } else {
    alert(data.error || "Registration failed");
  }
}

async function login() {
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  if (!u || !p) return alert("Please fill all fields");

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();

  if (data.token) {
    localStorage.setItem('token', data.token);
    token = data.token;
    username = data.username;
    authModal.classList.add('hidden');
    usernameDisplay.textContent = `👤 ${username}`;
    socket.emit('auth', token);
  } else {
    alert(data.error || "Login failed");
  }
}

function logout() {
  if (confirm("Logout?")) {
    localStorage.removeItem('token');
    location.reload();
  }
}

// Show modal if not logged in
if (!token) {
  authModal.classList.remove('hidden');
} else {
  socket.emit('auth', token);
  usernameDisplay.textContent = `👤 ${username || 'User'}`;
}

// Chat Functions
function joinNewRoom() {
  const room = document.getElementById('roomInput').value.trim();
  if (room) socket.emit('joinRoom', room);
}

function sendMessage() {
  const text = document.getElementById('messageInput').value.trim();
  if (text) {
    socket.emit('chatMessage', text);
    document.getElementById('messageInput').value = '';
  }
}

function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fetch('/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => socket.emit('updateAvatar', data.fileUrl));
}

function uploadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fetch('/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => socket.emit('fileMessage', { fileUrl: data.fileUrl, fileType: data.fileType }));
}

function addMessage(msg) {
  const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatarUrl = msg.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.user)}&background=random`;

  const div = document.createElement('div');
  div.className = `flex gap-3 ${msg.user === username ? 'justify-end' : ''}`;
  div.innerHTML = `
    <div class="${msg.user === username ? 'items-end' : 'items-start'}">
      <div class="flex items-center gap-2 mb-1 text-xs text-gray-500 dark:text-gray-400">
        <img src="${avatarUrl}" class="w-7 h-7 rounded-full">
        <span>${msg.user}</span>
        <span>${time}</span>
      </div>
      ${msg.type === 'text' ? 
        `<div class="bg-white dark:bg-gray-800 px-5 py-3 rounded-3xl">${msg.text}</div>` : 
        msg.fileType && msg.fileType.startsWith('image') ? 
        `<img src="${msg.fileUrl}" class="max-w-xs rounded-3xl">` :
        `<video src="${msg.fileUrl}" controls class="max-w-xs rounded-3xl"></video>`}
    </div>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateOnlineUsers(users) {
  onlineUsersDiv.innerHTML = users.map(u => `
    <div class="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800">
      <div class="w-2 h-2 bg-green-500 rounded-full"></div>
      ${u}
    </div>
  `).join('');
}

// Socket Events
socket.on('history', (msgs) => { messagesDiv.innerHTML = ''; msgs.forEach(addMessage); });
socket.on('message', addMessage);
socket.on('onlineUsers', updateOnlineUsers);
socket.on('system', (text) => {
  const div = document.createElement('div');
  div.className = "text-center text-gray-500 dark:text-gray-400 my-4";
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
});
socket.on('typing', (data) => {
  typingIndicator.textContent = data.isTyping ? `${data.user} is typing...` : '';
});
socket.on('joined', (data) => {
  currentRoom = data.room;
  roomNameEl.textContent = currentRoom;
});
socket.on('authError', () => {
  localStorage.removeItem('token');
  authModal.classList.remove('hidden');
});

// Typing indicator
let typingTimeout;
document.getElementById('messageInput').addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 800);
});

document.getElementById('messageInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});