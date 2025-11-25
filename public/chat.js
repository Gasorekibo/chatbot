// public/chat.js
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
let history = [];

const addMessage = (text, sender, slots = [], bookingConfirmed = false) => {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = sender === 'user' ? 'You' : 'A';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = text.replace(/\n/g, '<br>');

  if (slots.length > 0) {
    const slotsDiv = document.createElement('div');
    slotsDiv.className = 'slots';
    slots.forEach(slot => {
      const btn = document.createElement('div');
      btn.className = 'slot-btn';
      btn.textContent = `${slot.day}, ${slot.date} • ${slot.time}`;
      btn.onclick = () => bookSlot(slot);
      slotsDiv.appendChild(btn);
    });
    bubble.appendChild(slotsDiv);
  }

  if (bookingConfirmed) {
    bubble.innerHTML += `<br><br><strong style="color:#10b981">Meeting booked successfully!</strong><br>Check your email for the Google Meet link.`;
  }

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(bubble);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

const showTyping = () => {
  const typingDiv = document.createElement('div');
  typingDiv.id = 'typing';
  typingDiv.className = 'message bot';
  typingDiv.innerHTML = `
    <div class="avatar">A</div>
    <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>
  `;
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

const removeTyping = () => {
  const typing = document.getElementById('typing');
  if (typing) typing.remove();
};

const bookSlot = async (slot) => {
  const userMessage = `Book ${slot.formatted} please`;
  addMessage(userMessage, 'user');
  messageInput.value = '';
  history.push({ role: 'user', content: userMessage });
  await sendMessageInternal(userMessage);
};

const sendMessageInternal = async (message) => {
  showTyping();
  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history })
    });
    const data = await res.json();
    removeTyping();

    if (data.bookingData && data.bookingData.intent === 'book') {
      const bookRes = await fetch('/api/chat/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.bookingData)
      });
      const bookResult = await bookRes.json();
      const finalReply = bookResult.success
        ? `Booked! ${bookResult.event.summary} on ${new Date(bookResult.event.start).toLocaleString()}. Meet link: ${bookResult.event.meetLink || 'Check email'}`
        : `Sorry, that slot was taken. Here are alternatives:`;
      addMessage(finalReply, 'bot', data.freeSlots || [], bookResult.success);
    } else {
      addMessage(data.reply, 'bot', data.freeSlots || []);
    }

    history.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    removeTyping();
    addMessage("Sorry, connection issue. Please try again.", 'bot');
  }
};

const sendMessage = async () => {
  const message = messageInput.value.trim();
  if (!message) return;

  addMessage(message, 'user');
  history.push({ role: 'user', content: message });
  messageInput.value = '';
  await sendMessageInternal(message);
};

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

messageInput.focus();