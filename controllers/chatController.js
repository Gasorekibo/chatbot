// controllers/chat/sendMessage.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const getCalendarData = require('../utils/getCalendarData');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = 'mugwanezagasore073@gmail.com';

const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions.

We offer exactly these four services:
• SAP Consulting
• Custom Development
• Software Quality Assurance
• IT Training

ON THE VERY FIRST MESSAGE (when history is empty), you MUST reply:
"Welcome! I'm here to help you with Moyo Tech Solutions.

Please choose the service you need:"
===SHOW_SERVICES===

After the user selects a service (by button or text), ask 1–2 smart follow-up questions.

Always allow booking: say things like "Want to jump on a quick call?" or "We can book a time anytime!"

Use these markers only when needed:
===SHOW_SLOTS=== → when suggesting or user wants to book
===BOOK=== → when you have name + email + selected time
===COLLECT_SERVICE=== → when you have full service details (optional, for rich leads)

Example BOOK:
===BOOK===
{"intent":"book","title":"Custom Development - Meeting with Sarah","start":"2025-12-10T14:00:00","end":"2025-12-10T15:00:00","attendeeEmail":"sarah@example.com"}

Example COLLECT_SERVICE:
===COLLECT_SERVICE===
{"service":"SAP Consulting","name":"John","email":"john@company.com","company":"ABC Ltd","details":"S/4HANA migration","sapModule":"FI/CO"}

Rules:
- NEVER show JSON or markers to user
- Be friendly, concise, human
- If user says "book", "call", "talk", "meeting" → use ===SHOW_SLOTS===
- After collecting info → use ===COLLECT_SERVICE=== and suggest booking

Current free slots (next 7 days):
{{AVAILABILITY}}

Respond naturally only.
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
});

let chat = null;

const sendMessage = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim() && history.length > 0) return res.status(400).json({ error: "Message required" });

    // Get fresh calendar
    const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
    if (!employee) return res.status(500).json({ reply: "Calendar not connected yet." });

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);
    const freeSlots = calendar.freeSlots.map(s => ({
      isoStart: s.start,
      isoEnd: s.end,
    }));

    const prompt = systemInstruction.replace("{{AVAILABILITY}}", JSON.stringify(freeSlots, null, 2));

    // Start chat on first message
    if (!chat || history.length === 0) {
      chat = model.startChat({
        history: [],
        systemInstruction: { parts: [{ text: prompt }] },
      });
    }

    // If this is the very first message, force service buttons
    const isFirstMessage = history.length === 0 && !message;

    let result;
    if (isFirstMessage) {
      result = { response: { text: () => "Welcome! I'm here to help you with Moyo Tech Solutions.\n\nPlease choose the service you need:\n===SHOW_SERVICES===" } };
    } else {
      result = await chat.sendMessage(message || "Start");
    }

    let text = result.response.text().trim();

    let showSlots = text.includes("===SHOW_SLOTS===");
    let showServices = text.includes("===SHOW_SERVICES===");
    let bookData = null;
    let serviceData = null;
    let finalReply = text;

    // Handle ===COLLECT_SERVICE===
    if (text.includes("===COLLECT_SERVICE===")) {
      const [before, jsonPart] = text.split("===COLLECT_SERVICE===");
      finalReply = before.trim();
      try {
        serviceData = JSON.parse(jsonPart.trim());
        const saveRes = await fetch('http://localhost:3000/api/chat/collect-service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serviceData)
        });
        const saveResult = await saveRes.json();
        if (saveResult.success) {
          finalReply += `\n\nThank you, ${serviceData.name.split(" ")[0]}! I've saved your ${serviceData.service} request — our team will review it today.\n\nWould you like to book a quick call now?`;
          showSlots = true;
        }
      } catch (e) { console.error("Collect service error:", e); }
    }

    // Handle ===BOOK===
    if (text.includes("===BOOK===")) {
      const [before, jsonPart] = text.split("===BOOK===");
      finalReply = before.trim();
      try {
        bookData = JSON.parse(jsonPart.trim());
      } catch (e) { console.error("Invalid BOOK JSON"); }
    }

    // Clean reply (remove all markers)
    finalReply = finalReply
      .replace(/===SHOW_SLOTS===|===SHOW_SERVICES===|===BOOK===|===COLLECT_SERVICE===/g, '')
      .trim();

    // Handle actual booking
    let bookingSuccess = false;
    if (bookData?.intent === "book") {
      const bookRes = await fetch('http://localhost:3000/api/chat/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookData)
      });
      const result = await bookRes.json();
      bookingSuccess = result.success;

      if (bookingSuccess) {
        finalReply = `All set! I've booked your meeting for ${new Date(bookData.start).toLocaleString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
        })}. A Google Meet link has been sent to your email!`;
      } else {
        finalReply += "\n\nThat slot was just taken! Here are the latest times:";
        showSlots = true;
      }
    }

    res.json({
      reply: finalReply || "How can I help you today?",
      showSlots,
      freeSlots: showSlots ? freeSlots : [],
      showServices,  // ← This triggers service buttons
      bookingConfirmed: bookingSuccess,
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "I'm having trouble right now. Please try again!" });
  }
};

module.exports = { sendMessage };