// controllers/chatController.js  ← FINAL PROFESSIONAL VERSION
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const getCalendarData = require('../utils/getCalendarData');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = 'mugwanezagasore073@gmail.com';

const systemInstruction = `
You are a warm, professional AI scheduling assistant for Moyo Tech Solutions.

Business details:
- We help businesses with SAP Consulting, Custom Development, Software Quality Assurance and IT Training.
- Office hours: Mon–Fri, 9 AM – 6 PM (Africa/Kigali timezone)
- We reply fast and love helping people!

Rules:
- Be friendly, concise, and human-like
- When user asks about availability → reply naturally and include ===SHOW_SLOTS===
- When ready to book (you have name + email + time) → reply with confirmation AND include ===BOOK=== followed by valid JSON
- NEVER show JSON or code to the user in your reply
- After booking → say something like "All set! I've booked your meeting..."

Current free slots (next 7 days):
{{AVAILABILITY}}

Response format:
Natural message only
===SHOW_SLOTS===   (if showing calendar)
OR
===BOOK===
{"intent":"book","title":"Meeting with Name","start":"ISO","end":"ISO+1h","attendeeEmail":"email"}
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
});

let chat = null;

const sendMessage = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message required" });

    // Get fresh calendar
    const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
    if (!employee) return res.status(500).json({ reply: "Calendar not ready yet." });

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);
    const freeSlots = calendar.freeSlots.map(s => ({
      ...s,
      isoStart: s.start,
      isoEnd: s.end,
    }));

    const prompt = systemInstruction.replace("{{AVAILABILITY}}", JSON.stringify(freeSlots, null, 2));

    if (!chat) {
      chat = model.startChat({
        history: history.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        systemInstruction: { parts: [{ text: prompt }] },
      });
    }

    const result = await chat.sendMessage(message);
    let text = result.response.text().trim();

    let showSlots = text.includes("===SHOW_SLOTS===");
    let bookData = null;
    let finalReply = text;

    // Remove markers from visible reply
    if (text.includes("===SHOW_SLOTS===")) {
      finalReply = text.split("===SHOW_SLOTS===")[0].trim();
    }
    if (text.includes("===BOOK===")) {
      const parts = text.split("===BOOK===");
      finalReply = parts[0].trim();
      try {
        bookData = JSON.parse(parts[1].trim());
      } catch (e) {
        console.error("Invalid book JSON:", parts[1]);
      }
    }

    // Auto-book if needed
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
        finalReply = `Perfect! I've booked your meeting for ${new Date(bookData.start).toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })}. A Google Meet link has been sent to your email!`;
      } else {
        finalReply += "\n\nThat slot just got taken. Here are the latest openings:";
        showSlots = true;
      }
    }

    res.json({
      reply: finalReply || "How can I help you?",
      showSlots,
      freeSlots: showSlots ? freeSlots : [],
      bookingConfirmed: bookingSuccess,
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "I'm having a little trouble right now. Please try again!" });
  }
};

module.exports = { sendMessage };