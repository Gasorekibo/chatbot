// public/chat.js — FINAL FIXED VERSION
const chat = document.getElementById('chatMessages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
let history = [];

// Prevent sending the same message twice
let lastSentMessage = null;

const services = [
  { name: "SAP Consulting", icon: "cogs", color: "#dc2626" },
  { name: "Custom Development", icon: "code", color: "#2563eb" },
  { name: "Software Quality Assurance", icon: "check-square", color: "#16a34a" },
  { name: "IT Training", icon: "graduation-cap", color: "#9333ea" }
];

const addMessage = (text, sender, slots = [], showServices = false, confirmed = false) => {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;

  let slotsHTML = '';
  if (slots.length > 0) {
    slotsHTML = '<div class="slots">' + slots.map(s => `
      <div class="slot-btn" data-start="${s.isoStart}">
        ${new Date(s.isoStart).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        <br><strong>${new Date(s.isoStart).toLocaleTimeString().slice(0,5)}</strong>
      </div>
    `).join('') + '</div>';
  }

  let servicesHTML = '';
  if (showServices) {
    servicesHTML = '<div class="slots">' + services.map(svc => `
      <div class="slot-btn service-btn" data-service="${svc.name}" style="border-color:${svc.color};color:${svc.color};font-weight:600">
        <i class="fas fa-${svc.icon}"></i><br>
        <strong>${svc.name === "Software Quality Assurance" ? "QA & Testing" : svc.name}</strong>
      </div>
    `).join('') + '</div>';
  }

  const confirmedHTML = confirmed
    ? '<br><br><strong style="color:#10b981">Meeting booked successfully!<br>Check your email for the Google Meet link.</strong>'
    : '';

  msg.innerHTML = `
    <div class="avatar">${sender === 'user' ? 'You' : 'M'}</div>
    <div class="bubble">
      ${text.replace(/\n/g, '<br>')}
      ${slotsHTML}
      ${servicesHTML}
      ${confirmedHTML}
    </div>
  `;

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // === TIME SLOT BUTTONS ===
  msg.querySelectorAll('.slot-btn[data-start]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const time = btn.dataset.start;
      const formatted = new Date(time).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const userMsg = `Book this time: ${formatted}`;

      if (lastSentMessage === userMsg) return; // prevent double click
      lastSentMessage = userMsg;

      addMessage(userMsg, 'user');
      sendToBackend(userMsg);
    };
  });

  // === SERVICE BUTTONS ===
  msg.querySelectorAll('.service-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const service = btn.dataset.service;
      const userMsg = `I need ${service}`;

      if (lastSentMessage === userMsg) return; // prevent double
      lastSentMessage = userMsg;

      addMessage(userMsg, 'user');
      sendToBackend(userMsg);
    };
  });
};

const typing = () => {
  const el = document.createElement('div');
  el.id = 'typing';
  el.className = 'message bot';
  el.innerHTML = `<div class="avatar">M</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
};

const removeTyping = () => document.getElementById('typing')?.remove();

// Separate function to avoid duplicate sends
const sendToBackend = async (message) => {
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

    addMessage(data.reply, 'bot', data.freeSlots || [], data.showServices || false, data.bookingConfirmed || false);
    history.push({ role: 'assistant', content: data.reply });

    // Reset last sent after successful response
    lastSentMessage = null;

  } catch (err) {
    removeTyping();
    addMessage("Sorry, I'm having connection issues. Please try again.", 'bot');
    lastSentMessage = null;
  }
};

// === INPUT SEND BUTTON & ENTER KEY ===
sendBtn.onclick = () => {
  const msg = input.value.trim();
  if (!msg) return;

  const userMsg = msg;
  if (lastSentMessage === userMsg) return;
  lastSentMessage = userMsg;

  addMessage(userMsg, 'user');
  history.push({ role: 'user', content: userMsg });
  input.value = '';
  sendToBackend(userMsg);
};

input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendBtn.click();
  }
});

// === INITIAL GREETING — ONLY UI, NO MESSAGE SENT TO BACKEND ===
document.addEventListener('DOMContentLoaded', () => {
  addMessage("Welcome! I'm here to help you with Moyo Tech Solutions.\n\nPlease choose the service you need:", 'bot', [], true);
  input.focus();
});