const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const HARDCODED_AVAILABILITY = [
  { date: "2025-12-01", day: "Monday", time: "10:00 AM", available: true },
  { date: "2025-12-01", day: "Monday", time: "2:00 PM", available: true },
  { date: "2025-12-02", day: "Tuesday", time: "11:00 AM", available: true },
  { date: "2025-12-02", day: "Tuesday", time: "3:30 PM", available: true },
  { date: "2025-12-02", day: "Tuesday", time: "5:00 PM", available: true },
  { date: "2025-12-03", day: "Wednesday", time: "9:30 AM", available: false },
  { date: "2025-12-04", day: "Thursday", time: "1:00 PM", available: true },
  { date: "2025-12-05", day: "Friday", time: "10:00 AM", available: true },
  { date: "2025-12-05", day: "Friday", time: "4:00 PM", available: true },
];

const systemInstruction = `
You are a warm, professional, and super helpful customer support assistant for "Moyo tech Solutions".

Business details:
- We help businesses with marketing, web design, and automation.
- Office hours: Mon–Fri, 9 AM – 6 PM
- We reply fast and love helping people!

Your job:
- Answer ANY question naturally and kindly
- Detect when user asks about availability, booking, schedule, free slots, etc.
- NEVER invent availability — ONLY use the real slots below
- If they want to book: ask for name, email/phone, and preferred time
- Format dates nicely (e.g., "Tuesday, December 2nd")

Current REAL availability (next 2 weeks):
${JSON.stringify(HARDCODED_AVAILABILITY, null, 2)}

Rules:
- Be friendly and human (use contractions, emojis occasionally)
- If no slots match, say: "I'm fully booked that day, but here are my next openings..."
- Never output JSON or code — only speak as the assistant
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash", 
  systemInstruction,
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
    if (!chat) {
      chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      });
    }

    const result = await chat.sendMessage(message);
    const response = result.response;
    const reply = response.text();

    res.json({
      reply,
      sender: "bot"
    });

  } catch (error) {
    console.error("Gemini Error:", error);

    if (error.message.includes("API key")) {
      return res.status(500).json({ reply: "Sorry, I'm having authentication issues. Please contact support." });
    }

    res.status(500).json({
        reply: "Oops! I'm having a little trouble right now. Please try again in a minute!"
    });
  }
};

module.exports = { sendMessage };