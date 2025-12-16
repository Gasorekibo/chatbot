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

IMPORTANT BOOKING RULES:
- The current date is {{CURRENT_DATE}} 
- ONLY use dates from the AVAILABLE_SLOTS list below
- When user requests a specific day/time, find the CLOSEST MATCH in AVAILABLE_SLOTS
- NEVER invent dates - only use what's in AVAILABLE_SLOTS
- When showing slots, present them clearly with day names
- If user picks a time not in the list, suggest the closest available option

CONVERSATION FLOW:
1. After service selection, ask smart follow-up questions based on the selected service
2. Collect: Name, Email, Company (optional), Timeline, Budget, and service-specific details
3. When ready: Ask "Would you like to book a free consultation?"
4. If yes → show available dates naturally in conversation
5. When user picks a time → verify it exists in AVAILABLE_SLOTS, then output ===BOOK=== JSON only

Always be empathetic, clear, and professional. Use Africa/Kigali time (+02:00).

AVAILABLE CONSULTATION SLOTS (THESE ARE THE ONLY VALID SLOTS):
{{AVAILABLE_SLOTS}}

OUTPUT FORMATS (exact, no extra text):

When user wants to see services list (asking what services available, what you offer, etc):
===SHOW_SERVICES===

When user confirms a booking with a specific time that EXISTS in AVAILABLE_SLOTS:
===BOOK===
{"service":"Service Name","title":"Service Consultation - NAME","start":"2025-12-10T10:00:00+02:00","end":"2025-12-10T11:00:00+02:00","attendeeEmail":"user@example.com","name":"John Doe","phone":"+250...","company":"ABC Ltd","details":"User requirements"}

When saving service request:
===SAVE_REQUEST===
{"service":"Service Name","name":"Jane","email":"jane@company.com","details":"Detailed requirements","timeline":"3 months","budget":"$50k+"}
`;

const intentDetectionPrompt = `
You are an intent classifier. Analyze if the user wants to see the services list.

User wants to see services if they're asking about:
- What services/solutions are available
- What the company offers/provides
- Capabilities and offerings
- Service options
- What help is available
- Exploring services

Respond ONLY with:
"SHOW_SERVICES" if user wants to see services
"CONTINUE" if user wants to continue conversation

User message: "{{USER_MESSAGE}}"

Your response:`;

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
  
  const services = await getActiveServices();
  
  
  if (services.length === 0) {
    await sendWhatsAppMessage(to, "Sorry, no services are currently available. Please contact us directly.");
    return;
  }

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

// ==================== AI INTENT DETECTION ====================

async function detectIntentWithAI(message) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = intentDetectionPrompt.replace('{{USER_MESSAGE}}', message);
    
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim().toUpperCase();
    
    return response.includes('SHOW_SERVICES');
  } catch (err) {
    console.error('❌ Intent detection error:', err);
    return false;
  }
}

// ==================== GEMINI CHAT PROCESSOR ====================

async function processWithGemini(phoneNumber, message, history = [], userEmail = null) {
  try {
    const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
    if (!employee) throw new Error("Calendar not connected");

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);

    const now = new Date();
    const kigaliTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Kigali' }));

    const freeSlots = calendar.freeSlots.map(s => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      const slotStart = start > kigaliTime ? start : kigaliTime;
      
      return {
        isoStart: slotStart.toISOString(),
        isoEnd: end.toISOString(),
        display: slotStart.toLocaleString('en-US', { 
          weekday: 'long',
          year: 'numeric',
          month: 'long', 
          day: 'numeric',
          hour: 'numeric', 
          minute: '2-digit',
          timeZone: 'Africa/Kigali' 
        }),
        dayName: slotStart.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Kigali' }),
        date: slotStart.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Kigali' }),
        time: `${slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Kigali' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Kigali' })}`
      };
    });

    const services = await getActiveServices();
    const servicesList = services.map(s => 
      `• ${s.name}${s.details ? ' - ' + s.details : ''}`
    ).join('\n');

    const slotDetails = freeSlots.map((s, i) => 
      `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`
    ).join('\n');

    const currentDate = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Kigali'
    });
    
    let prompt = systemInstruction
      .replace('{{SERVICES_LIST}}', servicesList)
      .replace('{{AVAILABLE_SLOTS}}', slotDetails)
      .replace('{{CURRENT_DATE}}', currentDate); 

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

    const showServicesMatch = text.match(/===SHOW_SERVICES===/);
    const bookMatch = text.match(/===BOOK===\s*(\{.*?\})/s);
    const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{.*?\})/s);

    let reply = text
      .replace(/===SHOW_SERVICES===|===BOOK===\s*\{.*?\}|===SAVE_REQUEST===\s*\{.*?\}|```json|```/gi, '')
      .trim() || "I'm here to help! How can I assist you today?";

    
    if (showServicesMatch) {
      return { reply: null, showServices: true, showSlots: false, freeSlots };
    }

   
    if (bookMatch) {
      try {
        const data = JSON.parse(bookMatch[1]);
        const requestedStart = new Date(data.start);

        const matchingSlot = freeSlots.find(slot => {
          const slotStart = new Date(slot.isoStart);
          return Math.abs(slotStart - requestedStart) < 60000; 
        });

        if (!matchingSlot) {
          reply = "I apologize, but that specific time slot is not available. Let me show you the currently available times:";
          return { reply, showServices: false, showSlots: true, freeSlots };
        }

        const start = new Date(matchingSlot.isoStart);
        const end = new Date(matchingSlot.isoEnd);

        const res = await fetch('http://localhost:3000/api/chat/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: data.title,
            start: start.toISOString(),
            end: end.toISOString(),
            attendeeEmail: userEmail || data.attendeeEmail,
            description: `Service: ${data.service}\nPhone: ${phoneNumber}\nCompany: ${data.company || 'N/A'}\nDetails: ${data.details || 'N/A'}`
          })
        });

        const result = await res.json();
        if (result.success) {
          reply = `✅ *Booking Confirmed!*\n\n📅 *Date & Time:*\n${start.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Africa/Kigali'
          })} (Africa/Kigali time)\n\n📧 *Check your email* (${userEmail || data.attendeeEmail}) for the Google Meet link and calendar invite.\n\n🎉 Thank you for choosing Moyo Tech Solutions! We look forward to speaking with you.`;
        } else {
          reply = "⚠️ That slot was just taken. Let me show you updated available times:";
          return { reply, showServices: false, showSlots: true, freeSlots };
        }
      } catch (e) {
        console.error('❌ Booking failed:', e);
        reply = "❌ Sorry, there was an issue with the booking. Let me show you the available slots again:";
        return { reply, showServices: false, showSlots: true, freeSlots };
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
      } catch (e) { 
        throw e
      }
    }

    return { reply, showServices: false, showSlots: false, freeSlots };

  } catch (err) {
    console.error("❌ Gemini error:", err);
    if (err.status === 429) {
      return { 
        reply: "🔄 We're experiencing high demand right now. Please try again in a moment or type 'menu' to see our services.", 
        showServices: false,
        showSlots: false, 
        freeSlots: [] 
      };
    }
    return { 
      reply: "I'm having trouble connecting right now. Please try again in a moment!", 
      showServices: false,
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
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
};

const handleWebhook = async (req, res) => {
  res.status(200).send('OK');

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    if (value.statuses) {
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    
    let session = await UserSession.findOne({ phone: from });
    const isNewUser = !session;
    if (!session) {
      session = await UserSession.create({
        name: value.contacts?.[0]?.profile?.name || 'Client',
        phone: from,
        history: [],
        state: { selectedService: null },
        lastAccess: new Date()
      });
    }

    
    session.lastAccess = new Date();

    if (msg.type === 'text') {
      const text = msg.text.body.trim().toLowerCase();
      
      if (isNewUser) {
        const welcomeMsg = "👋 Welcome to *Moyo Tech Solutions*!\n\nWe're a leading IT consultancy in Rwanda, ready to help transform your business with cutting-edge technology solutions.\n\nLet me show you what we can do for you:";
        await sendWhatsAppMessage(from, welcomeMsg);
        await sendServiceList(from);
        return;
      }
      
      if (['menu', 'restart'].includes(text)) {
        await sendServiceList(from);
        session.history = [];
        session.state = { selectedService: null };
        whatsappSessions.delete(from); 
        await session.save();
        return;
      }

      const userEmail = session.state.email || null;
      const response = await processWithGemini(from, msg.text.body, session.history, userEmail);
      if (response.showServices) {
        await sendServiceList(from);
        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: 'Service list shown', timestamp: new Date() });
        await session.save();
        return;
      }

      // Send AI response
      if (response.reply) {
        await sendWhatsAppMessage(from, response.reply);

        // Extract email if present
        if (response.reply.includes('@') && !session.state.email) {
          const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch) {
            session.state.email = emailMatch[0];
          }
        }

        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply, timestamp: new Date() });
        await session.save();
      }
    }
    else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
      
      const services = await getActiveServices();
      const service = services.find(s => s.id === msg.interactive.list_reply.id);
      
      if (service) {
        const response = await processWithGemini(from, `I'm interested in ${service.name}. I'd like to learn more about this service.`, session.history);
        
        if (response.reply) {
          await sendWhatsAppMessage(from, response.reply);
        }
        
        session.state.selectedService = service.id;
        session.history.push({ role: 'user', content: `Selected: ${service.name}`, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply || 'Service selected', timestamp: new Date() });
        await session.save();
      } else {
        await sendWhatsAppMessage(from, "Sorry, that service is no longer available. Let me show you our current services.");
        await sendServiceList(from);
      }
    }

  } catch (err) {
    console.error('❌ Webhook error:', err);
    throw err;
  }
};

setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const result = await UserSession.deleteMany({ lastAccess: { $lt: cutoff } });
    whatsappSessions.clear();
  } catch (err) {
    console.error('❌ Cleanup error:', err);
  }
}, 60 * 60 * 1000); 

module.exports = { verifyWebhook, handleWebhook };