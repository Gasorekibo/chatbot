const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const ServiceRequest = require('../models/ServiceRequest');
const UserSession = require('../models/UserSession');
const getCalendarData = require('../utils/getCalendarData');
const { getActiveServices } = require('../utils/googleSheets');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

// ==================== CONFIG & STATE ====================
const whatsappSessions = new Map();

const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

SERVICES WE OFFER:
{{SERVICES_LIST}}

RULES:
- NEVER show the service list again — user already saw it
- After service selection, ask smart follow-up questions based on the selected service
- Collect: Name, Email, Company (optional), Timeline, Budget, and service-specific details
- When ready: Ask "Would you like to book a free consultation?"
- If yes → reply with ===SHOW_SLOTS===
- When user picks a time → output ===BOOK=== JSON only
- Always be empathetic, clear, and professional
- Use Africa/Kigali time (+02:00), year 2025 only
- Be conversational and natural

AVAILABLE CONSULTATION SLOTS (2025 only):
{{AVAILABILITY}}

OUTPUT FORMATS (exact, no extra text):

When user wants to see available slots:
===SHOW_SLOTS===

When user confirms a booking:
===BOOK===
{"service":"Service Name","title":"Service Consultation - NAME","start":"2025-12-15T10:00:00+02:00","end":"2025-12-15T11:00:00+02:00","attendeeEmail":"user@example.com","name":"John Doe","phone":"+250...","company":"ABC Ltd","details":"User requirements"}

When saving service request:
===SAVE_REQUEST===
{"service":"Service Name","name":"Jane","email":"jane@company.com","details":"Detailed requirements","timeline":"3 months","budget":"$50k+"}
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
    console.error('❌ Send message failed:', err.message);
  }
}

async function sendServiceList(to) {
  console.log('📤 Fetching services from database for WhatsApp user:', to);
  
  // Fetch active services from MongoDB - THIS IS THE KEY PART
  const services = await getActiveServices();
  
  console.log(`✅ Retrieved ${services.length} active services:`, services.map(s => s.name).join(', '));
  
  if (services.length === 0) {
    await sendWhatsAppMessage(to, "Sorry, no services are currently available. Please contact us directly.");
    return;
  }

  // Build interactive list rows from database services
  const LIST_ROWS = services.map(s => ({
    id: s.id,
    title: s.short || s.name,
    description: s.details || `Professional ${s.name}`
  }));

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
      console.error('❌ Interactive list send failed:', data);
      // Fallback to text message with numbered services
      let fallbackText = "Welcome to Moyo Tech! How can we help you today?\n\n";
      services.forEach((s, i) => {
        fallbackText += `${i + 1}. ${s.short || s.name}\n`;
      });
      fallbackText += "\nReply with a number to select a service!";
      await sendWhatsAppMessage(to, fallbackText);
    } else {
      console.log('✅ Service list sent successfully');
    }
    return data;
  } catch (err) {
    console.error('❌ sendServiceList error:', err);
  }
}

async function sendTimeSlots(to, slots) {
  let text = '📅 Available Consultation Slots (2025):\n\n';
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
  text += '\n✨ Reply with the number to book your slot!';
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

    // Get active services from MongoDB - DYNAMIC SERVICES
    const services = await getActiveServices();
    const servicesList = services.map(s => 
      `• ${s.name}${s.details ? ' - ' + s.details : ''}`
    ).join('\n');

    console.log('🤖 Processing with Gemini, services available:', services.length);

    let prompt = systemInstruction
      .replace('{{SERVICES_LIST}}', servicesList)
      .replace('{{AVAILABILITY}}', JSON.stringify(freeSlots.map(s => s.display), null, 2));

    let chat = whatsappSessions.get(phoneNumber);
    if (!chat) {
      chat = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).startChat({
        systemInstruction: { parts: [{ text: prompt }] },
        history: history.map(h => ({ 
          role: h.role === 'user' ? 'user' : 'model', 
          parts: [{ text: h.content }] 
        }))
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
            description: `Service: ${data.service}\nPhone: ${phoneNumber}\nCompany: ${data.company || 'N/A'}\nDetails: ${data.details || 'N/A'}`
          })
        });

        const result = await res.json();
        if (result.success) {
          reply = `✅ Booking Confirmed!\n\nYour consultation is scheduled for:\n📅 ${start.toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Africa/Kigali'
          })}\n\n📧 Check your email (${data.attendeeEmail}) for the Google Meet link.\n\n🎉 Thank you for choosing Moyo Tech Solutions!`;
        } else {
          reply = "⚠️ That slot was just taken. Let me show you updated available times:";
          return { reply, showSlots: true, freeSlots };
        }
      } catch (e) {
        console.error('❌ Booking failed:', e);
        reply = "❌ Booking failed. Let me show you updated slots:";
        return { reply, showSlots: true, freeSlots };
      }
    }

    // Save service request
    if (saveMatch) {
      try {
        const data = JSON.parse(saveMatch[1]);
        await ServiceRequest.create({
          ...data,
          phone: data.phone || phoneNumber,
          status: 'new'
        });
        console.log('✅ Service request saved:', data.service);
      } catch (e) { 
        console.error("❌ Save request failed:", e); 
      }
    }

    return { reply, showSlots, freeSlots: showSlots ? freeSlots : [] };

  } catch (err) {
    console.error("❌ Gemini error:", err);
    return { 
      reply: "I'm having trouble connecting right now. Please try again in a moment!", 
      showSlots: false, 
      freeSlots: [] 
    };
  }
}

// ==================== WEBHOOK HANDLERS ====================

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
};

const handleWebhook = async (req, res) => {
  console.log('\n📨 INCOMING WEBHOOK', new Date().toISOString());
  res.status(200).send('OK');

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    if (value.statuses) {
      console.log(`📊 Status update: ${value.statuses[0].status}`);
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    console.log(`👤 Message from: ${from}`);
    
    // Load or create user session from MongoDB
    let session = await UserSession.findOne({ phone: from });
    if (!session) {
      console.log('🆕 Creating new user session');
      session = await UserSession.create({
        phone: from,
        history: [],
        state: { awaitingSlot: false, slots: [] },
        lastAccess: new Date()
      });
    }

    // Update last access
    session.lastAccess = new Date();

    if (msg.type === 'text') {
      const text = msg.text.body.trim().toLowerCase();
      console.log(`💬 User message: "${msg.text.body}"`);
      
      // Reset commands - SHOW SERVICES FROM DATABASE
      if (['hi', 'hello', 'hey', 'start', 'menu', 'services'].includes(text)) {
        console.log('🔄 Sending service list from database...');
        await sendServiceList(from);
        session.history = [];
        session.state = { awaitingSlot: false, slots: [] };
        await session.save();
        return;
      }

      // Handle slot selection
      if (session.state.awaitingSlot && /^\d+$/.test(msg.text.body)) {
        const idx = parseInt(msg.text.body) - 1;
        if (idx >= 0 && idx < session.state.slots.length) {
          const slot = session.state.slots[idx];
          const formatted = new Date(slot.isoStart).toLocaleString('en-US', {
            dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Kigali'
          });
          console.log(`📅 User selected slot ${idx + 1}: ${formatted}`);
          const geminiResponse = await processWithGemini(from, `Book this time: ${formatted}`, session.history);
          await sendWhatsAppMessage(from, geminiResponse.reply);
          
          session.state.awaitingSlot = false;
          session.state.slots = [];
          session.history.push({ role: 'user', content: `Selected slot ${idx + 1}`, timestamp: new Date() });
          session.history.push({ role: 'model', content: geminiResponse.reply, timestamp: new Date() });
          await session.save();
          return;
        }
      }

      // Regular chat
      const response = await processWithGemini(from, msg.text.body, session.history);
      await sendWhatsAppMessage(from, response.reply);

      if (response.showSlots && response.freeSlots.length > 0) {
        await sendTimeSlots(from, response.freeSlots);
        session.state.awaitingSlot = true;
        session.state.slots = response.freeSlots;
      }

      session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
      session.history.push({ role: 'model', content: response.reply, timestamp: new Date() });
      await session.save();
    }
    else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
      console.log(`🎯 User selected service: ${msg.interactive.list_reply.id}`);
      
      // Get services from database to match selection
      const services = await getActiveServices();
      const service = services.find(s => s.id === msg.interactive.list_reply.id);
      
      if (service) {
        console.log(`✅ Service found: ${service.name}`);
        const response = await processWithGemini(from, `I need ${service.name}`, session.history);
        await sendWhatsAppMessage(from, response.reply);
        
        session.state.selectedService = service.id;
        session.history.push({ role: 'user', content: `Selected: ${service.name}`, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply, timestamp: new Date() });
        await session.save();
      } else {
        console.log(`⚠️ Service not found: ${msg.interactive.list_reply.id}`);
        await sendWhatsAppMessage(from, "Sorry, that service is no longer available. Let me show you our current services.");
        await sendServiceList(from);
      }
    }

  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
};

// Cleanup old sessions (keep 24 hours)
setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const result = await UserSession.deleteMany({ lastAccess: { $lt: cutoff } });
    
    // Clean in-memory sessions
    whatsappSessions.clear();
    
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old sessions`);
    }
  } catch (err) {
    console.error('❌ Cleanup error:', err);
  }
}, 60 * 60 * 1000); // Every hour

module.exports = { verifyWebhook, handleWebhook };