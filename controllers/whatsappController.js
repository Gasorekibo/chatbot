const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const ServiceRequest = require('../models/ServiceRequest');
const getCalendarData = require('../utils/getCalendarData');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

// ==================== CONFIG & STATE ====================
const whatsappSessions = new Map();
const userStates = new Map();

const services = [
  { id: 'sap',       name: 'SAP Consulting',       short: 'SAP Consulting' },
  { id: 'dev',       name: 'Custom Development',   short: 'Custom Dev' },
  { id: 'qa',        name: 'Quality Assurance',    short: 'QA & Testing' },
  { id: 'training',  name: 'IT Training',          short: 'IT Training' }
];


const LIST_ROWS = services.map(s => ({
  id: s.id,
  title: s.short,
  description: s.id === 'sap' ? 'ERP & SAP Solutions' :
              s.id === 'dev' ? 'Web/Mobile/Enterprise Apps' :
              s.id === 'qa' ? 'Manual + Automation Testing' :
              'Certifications & Workshops'
}));


const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

SERVICES:
• SAP Consulting
• Custom Development (Web, Mobile, Enterprise)
• Software Quality Assurance (Manual + Automation)
• IT Training & Certifications

RULES:
- NEVER show the service list again — user already saw it
- After service selection, ask smart follow-up questions per service
- Collect: Name, Email, Company (optional), Timeline, Budget
- When ready: Ask "Would you like to book a free consultation?"
- If yes → reply with ===SHOW_SLOTS===
- When user picks a time → output ===BOOK=== JSON only
- Always be empathetic, clear, and professional
- Use Africa/Kigali time (+02:00), year 2025 only

AVAILABLE SLOTS (2025 only):
{{AVAILABILITY}}

OUTPUT FORMATS (exact, no extra text):
===SHOW_SLOTS===
===BOOK===
{"service":"SAP Consulting","title":"SAP Consultation - NAME","start":"2025-12-15T10:00:00+02:00","end":"2025-12-15T11:00:00+02:00","attendeeEmail":"user@example.com","name":"John Doe","phone":"+250...","company":"ABC Ltd","details":"Needs S/4HANA migration"}

===SAVE_REQUEST===
{"service":"Custom Development","name":"Jane","email":"jane@company.com","details":"Need a mobile banking app","timeline":"3 months","budget":"$50k+"}
`;


async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('Send message failed:', err.message);
  }
}

async function sendServiceList(to) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Moyo Tech Solutions' },
          body: { text: 'Welcome! Please select a service:' },
          footer: { text: "We're here to help you grow" },
          action: {
            button: 'View Services',
            sections: [{ title: 'Our Services', rows: LIST_ROWS }]
          }
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('List send failed:', data);
      await sendWhatsAppMessage(to, "Welcome to Moyo Tech! How can we help you today?\n\n1. SAP Consulting\n2. Custom Development\n3. QA & Testing\n4. IT Training\n\nReply with a number!");
    }
    return data;
  } catch (err) {
    console.error('sendServiceList error:', err);
  }
}

async function sendTimeSlots(to, slots) {
  let text = 'Available Consultation Slots (2025):\n\n';
  slots.slice(0, 10).forEach((slot, i) => {
    const date = new Date(slot.isoStart);
    const formatted = date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Kigali'
    });
    text += `${i + 1}. ${formatted}\n`;
  });
  text += '\nReply with the number to book your slot!';
  await sendWhatsAppMessage(to, text);
}

// ==================== GEMINI CHAT PROCESSOR ====================

async function processWithGemini(phoneNumber, message, history = []) {
  try {
    const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
    if (!employee) throw new Error("Calendar not connected");

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);

    const freeSlots = calendar.freeSlots.map(s => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      if (start.getFullYear() < 2025) start.setFullYear(2025);
      if (end.getFullYear() < 2025) end.setFullYear(2025);
      return {
        isoStart: start.toISOString(),
        isoEnd: end.toISOString(),
        display: start.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Kigali' })
      };
    });

    const prompt = systemInstruction.replace('{{AVAILABILITY}}', JSON.stringify(freeSlots.map(s => s.display), null, 2));

    let chat = whatsappSessions.get(phoneNumber);
    if (!chat) {
      chat = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).startChat({
        systemInstruction: { parts: [{ text: prompt }] },
        history: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }))
      });
      whatsappSessions.set(phoneNumber, chat);
    }

    const result = await chat.sendMessage(message);
    const text = result.response.text();

    const showSlots = text.includes('===SHOW_SLOTS===');
    const bookMatch = text.match(/===BOOK===\s*(\{.*\})/s);
    const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{.*\})/s);

    let reply = text
      .replace(/===SHOW_SLOTS===|===BOOK===\s*\{.*\}|===SAVE_REQUEST===\s*\{.*\}|```json|```/gi, '')
      .trim() || "I'm here to help! How can I assist you today?";

    // Handle booking
    if (bookMatch) {
      try {
        const data = JSON.parse(bookMatch[1]);
        const start = new Date(data.start);
        start.setFullYear(2025);
        const end = new Date(start);
        end.setHours(start.getHours() + 1);

        const res = await fetch('https://catherin-postsaccular-rosann.ngrok-free.dev/api/chat/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: data.title,
            start: start.toISOString(),
            end: end.toISOString(),
            attendeeEmail: data.attendeeEmail,
            description: `Service: ${data.service}\nPhone: ${phoneNumber}\nCompany: ${data.company || 'N/A'}`
          })
        });

        const result = await res.json();
        if (result.success) {
          reply = `Booked! Your consultation is confirmed for:\n\n${start.toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Africa/Kigali'
          })}\n\nCheck your email (${data.attendeeEmail}) for the Google Meet link.\n\nThank you for choosing Moyo Tech!`;
        } else {
          reply = "That slot was just taken. Here are updated times:";
          return { reply, showSlots: true, freeSlots };
        }
      } catch (e) {
        reply = "Booking failed. Let me show updated slots:";
        return { reply, showSlots: true, freeSlots };
      }
    }

    if (saveMatch) {
      try {
        const data = JSON.parse(saveMatch[1]);
        await ServiceRequest.create({
          ...data,
          phone: data.phone || phoneNumber,
          status: 'new'
        });
      } catch (e) { console.error("Save failed:", e); }
    }

    return { reply, showSlots, freeSlots: showSlots ? freeSlots : [] };

  } catch (err) {
    console.error("Gemini error:", err);
    return { reply: "I'm having trouble connecting right now. Please try again in a moment!", showSlots: false, freeSlots: [] };
  }
}

// ==================== WEBHOOK HANDLERS ====================

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
};

const handleWebhook = async (req, res) => {
  console.log('\nINCOMING WEBHOOK', new Date().toISOString());
  res.status(200).send('OK');

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;


    if (value.statuses) {
      console.log(`Status: ${value.statuses[0].status}`);
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    let state = userStates.get(from) || { history: [], awaitingSlot: false, slots: [] };
    state.lastAccess = Date.now();

  
    if (msg.type === 'text') {
      const text = msg.text.body.trim().toLowerCase();
      if (['hi', 'hello', 'hey', 'start', 'menu'].includes(text)) {
        await sendServiceList(from);
        userStates.set(from, state);
        return;
      }

      if (state.awaitingSlot && /^\d+$/.test(msg.text.body)) {
        const idx = parseInt(msg.text.body) - 1;
        if (idx >= 0 && idx < state.slots.length) {
          const slot = state.slots[idx];
          const formatted = new Date(slot.isoStart).toLocaleString('en-US', {
            dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Kigali'
          });
          const geminiResponse = await processWithGemini(from, `Book this time: ${formatted}`, state.history);
          await sendWhatsAppMessage(from, geminiResponse.reply);
          state.awaitingSlot = false;
          state.slots = [];
          userStates.set(from, state);
          return;
        }
      }

      const response = await processWithGemini(from, msg.text.body, state.history);
      await sendWhatsAppMessage(from, response.reply);

      if (response.showSlots && response.freeSlots.length > 0) {
        await sendTimeSlots(from, response.freeSlots);
        state.awaitingSlot = true;
        state.slots = response.freeSlots;
      }

      state.history.push({ role: 'user', content: msg.text.body });
      state.history.push({ role: 'assistant', content: response.reply });
      userStates.set(from, state);
    }
    else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
      const service = services.find(s => s.id === msg.interactive.list_reply.id);
      if (service) {
        const response = await processWithGemini(from, `I need ${service.name}`, state.history);
        await sendWhatsAppMessage(from, response.reply);
        state.history.push({ role: 'user', content: `Selected: ${service.name}` });
        state.history.push({ role: 'assistant', content: response.reply });
        userStates.set(from, state);
      }
    }

  } catch (err) {
    console.error('Webhook error:', err);
  }
};

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of userStates.entries()) {
    if (v.lastAccess < cutoff) userStates.delete(k);
  }
  for (const [k, v] of whatsappSessions.entries()) {
    if (v.lastAccess < cutoff) whatsappSessions.delete(k);
  }
}, 5 * 60 * 1000);

module.exports = { verifyWebhook, handleWebhook };