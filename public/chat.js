const chat = document.getElementById('chatMessages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
let history = [];
let isProcessing = false;
let lastSentMessage = null;
let serviceSelected = false; // Track if service was already selected
const sessionId = 'session_' + Date.now();

const services = [
  { name: "SAP Consulting", icon: "cogs", color: "#dc2626" },
  { name: "Custom Development", icon: "code", color: "#2563eb" },
  { name: "Software Quality Assurance", icon: "check-square", color: "#16a34a" },
  { name: "IT Training", icon: "graduation-cap", color: "#9333ea" }
];

// Format time in a user-friendly way
const formatTime = (isoString) => {
  return new Date(isoString).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Kigali'
  });
};

// Add message with enhanced formatting
const addMessage = (text, sender, slots = [], showServices = false, confirmed = false) => {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;

  let slotsHTML = '';
  if (slots.length > 0) {
    slotsHTML = '<div class="slots-header" style="margin-top:12px;margin-bottom:8px;font-weight:600;color:#374151">Available times:</div>';
    slotsHTML += '<div class="slots">' + slots.map((s, idx) => {
      const date = new Date(s.isoStart);
      const dayMonth = date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      const time = date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      return `
        <div class="slot-btn" data-start="${s.isoStart}" data-end="${s.isoEnd}" style="animation-delay:${idx * 0.05}s">
          <div style="font-size:11px;opacity:0.8;margin-bottom:2px">${dayMonth}</div>
          <div style="font-size:15px;font-weight:700">${time}</div>
        </div>
      `;
    }).join('') + '</div>';
  }

  let servicesHTML = '';
  if (showServices && !serviceSelected) { // Only show if not already selected
    servicesHTML = '<div class="services-grid" style="margin-top:16px">' + 
      services.map((svc, idx) => `
        <button class="service-btn" data-service="${svc.name}" 
          style="border-color:${svc.color};animation-delay:${idx * 0.1}s">
          <i class="fas fa-${svc.icon}" style="color:${svc.color};font-size:24px;margin-bottom:8px"></i>
          <div style="font-weight:600;color:#1f2937;font-size:14px">
            ${svc.name === "Software Quality Assurance" ? "QA & Testing" : svc.name}
          </div>
        </button>
      `).join('') + '</div>';
  }

  const confirmedHTML = confirmed ? `
    <div style="margin-top:16px;padding:12px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:8px">
      <div style="display:flex;align-items:center;gap:8px;color:#059669;font-weight:600">
        <i class="fas fa-check-circle"></i>
        <span>Meeting confirmed!</span>
      </div>
      <div style="font-size:13px;color:#047857;margin-top:4px">
        Check your email for calendar invite and Google Meet link.
      </div>
    </div>
  ` : '';

  msg.innerHTML = `
    <div class="avatar">${sender === 'user' ? 'You' : 'M'}</div>
    <div class="bubble">
      ${text.replace(/\n/g, '<br>')}
      ${servicesHTML}
      ${slotsHTML}
      ${confirmedHTML}
    </div>
  `;

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // Attach event listeners after DOM insertion
  attachSlotListeners(msg);
  attachServiceListeners(msg);
};

// Handle time slot selection
const attachSlotListeners = (msgElement) => {
  msgElement.querySelectorAll('.slot-btn[data-start]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      
      if (isProcessing) return;
      
      // Visual feedback
      btn.style.transform = 'scale(0.95)';
      btn.style.opacity = '0.6';
      
      const time = btn.dataset.start;
      const formatted = formatTime(time);
      const userMsg = `I'd like to book this time: ${formatted}`;

      if (lastSentMessage === userMsg) return;
      lastSentMessage = userMsg;

      // Disable all slot buttons
      msgElement.querySelectorAll('.slot-btn').forEach(b => {
        b.style.pointerEvents = 'none';
        b.style.opacity = '0.5';
      });

      addMessage(userMsg, 'user');
      await sendToBackend(userMsg);
    };
  });
};

// Handle service selection
const attachServiceListeners = (msgElement) => {
  msgElement.querySelectorAll('.service-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      
      if (isProcessing) return;
      
      const service = btn.dataset.service;
      const userMsg = `I need ${service}`;

      if (lastSentMessage === userMsg) return;
      lastSentMessage = userMsg;

      // Mark service as selected
      serviceSelected = true;

      // Disable all service buttons
      msgElement.querySelectorAll('.service-btn').forEach(b => {
        b.style.pointerEvents = 'none';
        b.style.opacity = '0.5';
      });

      addMessage(userMsg, 'user');
      await sendToBackend(userMsg);
    };
  });
};

// Show typing indicator
const typing = () => {
  const el = document.createElement('div');
  el.id = 'typing';
  el.className = 'message bot';
  el.innerHTML = `
    <div class="avatar">M</div>
    <div class="bubble">
      <div class="typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
};

const removeTyping = () => document.getElementById('typing')?.remove();

// Send message to backend
const sendToBackend = async (message) => {
  if (!message?.trim() || isProcessing) return;
  
  isProcessing = true;
  typing();
  
  // Disable input while processing
  input.disabled = true;
  sendBtn.disabled = true;

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: message.trim(), 
        history,
        sessionId 
      })
    });

    if (!res.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await res.json();
    removeTyping();

    if (data.showError) {
      addMessage("⚠️ " + data.reply, 'bot');
    } else {
      addMessage(
        data.reply, 
        'bot', 
        data.freeSlots || [], 
        data.showServices || false, 
        data.bookingConfirmed || false
      );
      
      history.push({ role: 'assistant', content: data.reply });
    }

    lastSentMessage = null;

  } catch (err) {
    console.error('Chat error:', err);
    removeTyping();
    addMessage(
      "I apologize, but I'm having trouble connecting. Please check your internet and try again.", 
      'bot'
    );
  } finally {
    isProcessing = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
};

// Send button handler
sendBtn.onclick = async () => {
  const msg = input.value.trim();
  if (!msg || isProcessing) return;

  const userMsg = msg;
  if (lastSentMessage === userMsg) return;
  lastSentMessage = userMsg;

  addMessage(userMsg, 'user');
  history.push({ role: 'user', content: userMsg });
  input.value = '';
  
  await sendToBackend(userMsg);
};

// Enter key handler
input.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isProcessing) {
      sendBtn.click();
    }
  }
});

// Prevent multiple rapid submissions
input.addEventListener('paste', () => {
  setTimeout(() => lastSentMessage = null, 1000);
});

// Initial greeting
document.addEventListener('DOMContentLoaded', () => {
  addMessage(
    "Welcome! I'm here to help you with Moyo Tech Solutions.\n\nPlease choose the service you need:", 
    'bot', 
    [], 
    true
  );
  input.focus();
  
  // Add connection status indicator
  window.addEventListener('online', () => {
    console.log('Connection restored');
  });
  
  window.addEventListener('offline', () => {
    addMessage("⚠️ You appear to be offline. Please check your connection.", 'bot');
  });
});