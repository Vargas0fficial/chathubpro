const socket = io();
let token = localStorage.getItem('token');
let username = localStorage.getItem('username') || ''; 
let currentRoom = 'public'; // Changed from 'Public Room Only' to match server logic

const messagesDiv = document.getElementById('messages');
const onlineUsersDiv = document.getElementById('onlineUsers');
const typingIndicator = document.getElementById('typingIndicator');
const roomNameEl = document.getElementById('roomName');
const usernameDisplay = document.getElementById('usernameDisplay');
const authModal = document.getElementById('authModal');

// Dark Mode Toggle
function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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
    
    if (res.ok) {
        const data = await res.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        token = data.token;
        username = data.username;
        authModal.classList.add('hidden');
        usernameDisplay.textContent = `👤 ${username}`;
        // Auth with server
        socket.emit('auth', { token, room: currentRoom });
    } else {
        alert("Invalid username or password");
    }
}

function logout() {
    if (confirm("Logout?")) {
        localStorage.clear();
        location.reload();
    }
}

// Show modal if not logged in
if (!token) {
    authModal.classList.remove('hidden');
} else {
    socket.emit('auth', { token, room: currentRoom });
    usernameDisplay.textContent = `👤 ${username || 'User'}`;
}

// Chat Functions
function sendMessage() {
    const text = document.getElementById('messageInput').value.trim();
    if (text && token) {
        socket.emit('chatMessage', text);
        document.getElementById('messageInput').value = '';
    }
}

// Add this function to handle file uploads properly
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/upload', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    socket.emit('fileMessage', data);
}

function addMessage(msg) {
    if (!msg) return;

    // --- SYSTEM MESSAGE LOGIC ---
    if (msg.type === 'system' || msg.user === 'System') {
        const div = document.createElement('div');
        div.className = "flex justify-center my-3 w-full";
        div.innerHTML = `<span class="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-4 py-1 rounded-full text-xs italic border border-gray-200 dark:border-gray-700">
            ${msg.text}
        </span>`;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return;
    }

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.user)}&background=random`;

    const isMe = msg.user === username;
    const div = document.createElement('div');
    div.className = `flex gap-3 mb-4 w-full ${isMe ? 'flex-row-reverse' : ''}`;
    
    div.innerHTML = `
        <img src="${avatarUrl}" class="w-8 h-8 rounded-full self-end mb-1 shadow-sm">
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]">
            <div class="flex items-center gap-2 mb-1 text-[10px] text-gray-500 uppercase tracking-wider">
                <span>${msg.user}</span>
                <span>•</span>
                <span>${time}</span>
            </div>
            <div class="${isMe ? 'bg-blue-600 text-white rounded-l-2xl rounded-tr-2xl' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-r-2xl rounded-tl-2xl shadow-sm'} px-4 py-2 text-sm">
                ${msg.type === 'text' ? msg.text : 
                  msg.fileType && msg.fileType.startsWith('image') ? `<img src="${msg.fileUrl}" class="rounded-lg max-w-full cursor-pointer" onclick="window.open('${msg.fileUrl}')">` :
                  msg.fileType && msg.fileType.startsWith('video') ? `<video src="${msg.fileUrl}" controls class="rounded-lg max-w-full"></video>` :
                  `<a href="${msg.fileUrl}" target="_blank" class="underline text-blue-200">📎 ${msg.fileName}</a>`}
            </div>
        </div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateOnlineUsers(users) {
    onlineUsersDiv.innerHTML = users.map(u => `
        <div class="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">${u}</span>
        </div>
    `).join('');
}

// Socket Events
socket.on('history', (msgs) => { 
    messagesDiv.innerHTML = ''; 
    if (msgs && msgs.length > 0) {
        msgs.forEach(addMessage); 
    }
});
socket.on('message', addMessage);
socket.on('onlineUsers', updateOnlineUsers);

socket.on('displayTyping', (data) => {
    typingIndicator.textContent = data.isTyping ? `${data.user} is typing...` : '';
});

socket.on('authError', () => {
    localStorage.clear();
    authModal.classList.remove('hidden');
});

// Typing indicator
let typingTimeout;
const msgInput = document.getElementById('messageInput');
if(msgInput) {
    msgInput.addEventListener('input', () => {
        socket.emit('typing', { isTyping: true });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => socket.emit('typing', { isTyping: false }), 1500);
    });

    msgInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}