const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const getCalendarData = require('../utils/getCalendarData');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const STATIC_EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL; 

const systemInstruction = `
You are a warm, professional customer support assistant for "Moyo Tech solutions".

Business details:
- We help businesses with SAP Consulting, Custom Development, Software Quality Assurance and IT Training.
- Office hours: Mon–Fri, 9 AM – 6 PM (Africa/Kigali timezone)
- We reply fast and love helping people!

Your job:
- Answer ANY question naturally and kindly
- Detect availability queries and ONLY use the REAL free slots below (never invent)
- For booking: Guide user to provide name, email, preferred time. When ready, output ONLY this JSON (no other text): {"intent": "book", "title": "Meeting Title", "description": "Brief desc", "start": "ISO start time", "end": "ISO end time (1 hour later)", "attendeeEmail": "user@email.com"}
- If not booking, chat normally
- Format dates nicely (e.g., "Tuesday, December 2nd at 11:00 AM")

Current REAL availability (next 7 days, free 1-hour slots):
{{AVAILABILITY}}

Rules:
- Be friendly and human (use contractions, emojis occasionally)
- If no slots: "I'm booked then, but here are alternatives..."
- For booking JSON: Use exact free slot times from above
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.8,
    maxOutputTokens: 1024,
  },
});

let chat;

const sendMessage = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // 1. Fetch real employee & calendar data
    const employee = await Employee.findOne({ email: STATIC_EMPLOYEE_EMAIL });
    if (!employee) {
      return res.status(500).json({ reply: "Sorry, calendar not set up yet. Contact admin." });
    }
    const refreshToken = employee.getDecryptedToken();
    const calendarData = await getCalendarData(STATIC_EMPLOYEE_EMAIL, refreshToken);
    const freeSlots = calendarData.freeSlots.map(slot => ({
      ...slot,
      // Add day/date for prompt
      fullDate: `${slot.date}, ${slot.day} at ${slot.time}`
    }));
    const availabilityJson = JSON.stringify(freeSlots, null, 2);

    // 2. Build prompt with real data
    const fullSystem = systemInstruction.replace("{{AVAILABILITY}}", availabilityJson);

    // 3. Start/update chat
    if (!chat) {
      chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
        systemInstruction: { parts: [{ text: fullSystem }] },
      });
    }

    const result = await chat.sendMessage(message);
    const response = result.response;
    let reply = response.text();

    // 4. Check for booking JSON (parse if present)
    let bookingData = null;
    try {
      const jsonMatch = reply.match(/\{.*\}/s);
      if (jsonMatch) {
        bookingData = JSON.parse(jsonMatch[0]);
        if (bookingData.intent === 'book') {
          // Auto-book via API
          const bookRes = await fetch('http://localhost:3000/api/chat/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
          });
          const bookResult = await bookRes.json();
          if (bookResult.success) {
            reply = `Great! I've booked your meeting: "${bookingData.title}" on ${bookingData.start}. Join via: ${bookResult.event.meetLink || 'Calendar invite sent!'}`;
          } else {
            reply = `Sorry, couldn't book: ${bookResult.error}. Let's try another time.`;
          }
          bookingData = null;  // Clear after handling
        }
      }
    } catch (parseErr) {
      // Not JSON, normal reply
    }

    res.json({
      reply,
      bookingData,  
      sender: "bot",
      freeSlots 
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      reply: "Oops! Having trouble connecting to the calendar. Try again soon!"
    });
  }
};

module.exports = { sendMessage };