const chat = document.getElementById('chatMessages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
let history = [];

// === All functions first ===
const addMessage = (text, sender, slots = [], confirmed = false) => {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;

  let slotsHTML = '';
  if (slots.length > 0) {
    slotsHTML = '<div class="slots">' + slots.map((slot, i) => `
      <div class="slot-btn" data-start="${slot.start}">
        ${new Date(slot.start).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        <br>
        <strong>${new Date(slot.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>
      </div>
    `).join('') + '</div>';
  }

  const confirmedHTML = confirmed
    ? '<br><br><strong style="color:#10b981">Meeting booked successfully!<br>Check your email for the Google Meet link.</strong>'
    : '';

  msg.innerHTML = `
    <div class="avatar">${sender === 'user' ? 'You' : 'A'}</div>
    <div class="bubble">
      ${text.replace(/\n/g, '<br>')}
      ${slotsHTML}
      ${confirmedHTML}
    </div>
  `;

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // Attach click listeners safely (NO inline onclick!)
  msg.querySelectorAll('.slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const isoStart = btn.dataset.start;
      const formatted = new Date(isoStart).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const userMsg = `Please book this time: ${formatted}`;
      addMessage(userMsg, 'user');
      input.value = '';
      history.push({ role: 'user', content: userMsg });
      sendMessage(userMsg);
    });
  });
};

const typing = () => {
  const el = document.createElement('div');
  el.id = 'typing';
  el.className = 'message bot';
  el.innerHTML = `<div class="avatar">A</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
};

const removeTyping = () => document.getElementById('typing')?.remove();

const sendMessage = async (message) => {
  if (!message?.trim()) return;
  typing();
  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), history })
    });
    const data = await res.json();
    removeTyping();
    addMessage(data.reply || "How can I help?", 'bot', data.freeSlots || [], data.bookingConfirmed);
    history.push({ role: 'assistant', content: data.reply || "" });
  } catch (err) {
    removeTyping();
    addMessage("Sorry, connection issue. Try again.", 'bot');
  }
};

// === Input handlers ===
sendBtn.addEventListener('click', () => {
  const msg = input.value.trim();
  if (msg) {
    addMessage(msg, 'user');
    history.push({ role: 'user', content: msg });
    input.value = '';
    sendMessage(msg);
  }
});

input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

addMessage("Hello! I'm your AI assistant at Moyo Tech Solutions. I can help you book a meeting or answer any questions. How can I assist you today?", 'bot');

input.focus();