const { GoogleGenerativeAI } = require('@google/generative-ai');
const Employee = require('../models/Employees');
const getCalendarData = require('../utils/getCalendarData');
const ServiceRequest = require('../models/ServiceRequest');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = 'mugwanezagasore073@gmail.com';

const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions. Your role is to help clients book consultations and gather requirements for services.

SERVICES WE OFFER:
• SAP Consulting - Enterprise resource planning implementation
• Custom Development - Tailored software solutions
• Software Quality Assurance - Testing and QA services
• IT Training - Professional development programs

CONVERSATION FLOW:
1. NEVER show services again after the first message. The user has already seen them.

2. AFTER SERVICE SELECTION: Immediately start asking smart, contextual questions:
   - For SAP: "Great choice! Which SAP modules are you interested in? (e.g., FI/CO, MM, SD, HR)" 
   - For Development: "Excellent! What type of application do you need? (web, mobile, desktop, or enterprise system)"
   - For QA: "Perfect! What's the scope of your QA needs? Are you looking for manual testing, automation, or both?"
   - For Training: "Wonderful! What specific IT skills or technologies would you like training on? (e.g., programming, cloud, cybersecurity, data analysis)"
   
   Then continue with: Name, company (optional), participant count/team size, timeline, budget range (if relevant)

3. DO NOT repeat the service selection prompt. Move forward with the conversation.

4. COLLECT REMAINING INFO: After understanding their needs, ask for:
   - Full name
   - Email address
   - Phone number (optional)
   - Company name (optional)

5. WHEN READY TO BOOK:
   - If you have name + email + enough details → ask "Would you like to schedule a consultation call to discuss this further?"
   - If user confirms → use ===SHOW_SLOTS===
   
6. AFTER SLOT SELECTION:
   - Extract the datetime from user's message
   - Output BOOKING JSON (see format below)

BOOKING FORMAT (output ONLY when user selects a specific time):
===BOOK===
{"intent":"book","service":"SERVICE_NAME","title":"SERVICE - Meeting with NAME","start":"ISO_DATETIME","end":"ISO_DATETIME","attendeeEmail":"EMAIL","name":"NAME","phone":"PHONE","company":"COMPANY","details":"SUMMARY"}

===SAVE_REQUEST===
{"service":"SERVICE_NAME","name":"NAME","email":"EMAIL","phone":"PHONE","company":"COMPANY","details":"DETAILED_REQUIREMENTS","timeline":"TIMELINE","budget":"BUDGET"}

CRITICAL RULES:
- NEVER show ===SHOW_SERVICES=== after the first interaction
- NEVER output ===BOOK=== before user selects a specific time slot
- NEVER put text before ===BOOK=== or ===SAVE_REQUEST===
- NEVER wrap in markdown code blocks
- CURRENT YEAR IS 2025 - Use dates in 2025 only (e.g., 2025-12-03, not 2024-12-03)
- Always use +02:00 timezone (Africa/Kigali)
- End time = start time + 1 hour
- Be conversational, not robotic
- Show empathy and understanding
- Confirm details before booking

AVAILABLE TIMES (ALL IN 2025):
{{AVAILABILITY}}

Remember: Quality conversation > rushing to book. Build rapport first.
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: { 
    temperature: 0.8, 
    maxOutputTokens: 800,
    topP: 0.95
  },
});

// Store chat sessions per user (use a proper session store in production)
const chatSessions = new Map();

const sendMessage = async (req, res) => {
  try {
    const { message, history = [], sessionId = 'default' } = req.body;

    // Get fresh calendar data
    const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
    if (!employee) {
      return res.status(500).json({ 
        reply: "I'm having trouble connecting to the calendar. Please try again in a moment.",
        showError: true
      });
    }

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);
    const freeSlots = calendar.freeSlots.map(s => {
      const startDate = new Date(s.start);
      if (startDate.getFullYear() < 2025) {
        startDate.setFullYear(2025);
      }
      
      const endDate = new Date(s.end);
      if (endDate.getFullYear() < 2025) {
        endDate.setFullYear(2025);
      }
      
      return {
        isoStart: startDate.toISOString(),
        isoEnd: endDate.toISOString(),
        display: startDate.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'Africa/Kigali'
        })
      };
    });

    const prompt = systemInstruction.replace(
      "{{AVAILABILITY}}", 
      JSON.stringify(freeSlots.map(s => s.display), null, 2)
    );

    // Get or create chat session
    let chat = chatSessions.get(sessionId);
    if (!chat || history.length === 0) {
      chat = model.startChat({
        history: [],
        systemInstruction: { parts: [{ text: prompt }] },
      });
      chatSessions.set(sessionId, chat);
    }

    // Initial load - show welcome
    if (history.length === 0 && !message) {
      return res.json({
        reply: "Welcome! I'm here to help you with Moyo Tech Solutions.\n\nPlease choose the service you need:",
        showServices: true,
        showSlots: false,
        freeSlots: [],
        bookingConfirmed: false,
      });
    }

    // Send message to AI
    const result = await chat.sendMessage(message || "Hi");
    let text = result.response.text();

    let showSlots = text.includes("===SHOW_SLOTS===");
    let showServices = text.includes("===SHOW_SERVICES===");
    let bookData = null;
    let saveData = null;
    let finalReply = text;
    let bookingSuccess = false;

    // HANDLE SERVICE REQUEST SAVE
    const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{[\s\S]*?\})/i);
    if (saveMatch) {
      try {
        const jsonStr = saveMatch[1]
          .replace(/```json|```/g, '')
          .trim();
        
        saveData = JSON.parse(jsonStr);
        
        // Save to database
        const savedRequest = await ServiceRequest.create({
          service: saveData.service,
          name: saveData.name,
          email: saveData.email,
          phone: saveData.phone || null,
          company: saveData.company || null,
          details: saveData.details || "",
          timeline: saveData.timeline || null,
          budget: saveData.budget || null,
          status: 'new'
        });

      } catch (err) {
        console.error("Failed to save service request:", err);
      }
    }

    // HANDLE BOOKING
    const bookMatch = text.match(/===BOOK===\s*(\{[\s\S]*?\})/i);
    if (bookMatch) {
      try {
        const jsonStr = bookMatch[1]
          .replace(/```json|```/g, '')
          .trim();

        bookData = JSON.parse(jsonStr);
        
        // CRITICAL FIX: Ensure year is 2025
        const bookStart = new Date(bookData.start);
        const bookEnd = new Date(bookData.end);
        
        if (bookStart.getFullYear() !== 2025) {
          bookStart.setFullYear(2025);
          bookData.start = bookStart.toISOString();
        }
        
        if (bookEnd.getFullYear() !== 2025) {
          bookEnd.setFullYear(2025);
          bookData.end = bookEnd.toISOString();
        }
        

        // Validate booking data
        if (!bookData.start || !bookData.attendeeEmail || !bookData.title) {
          throw new Error("Incomplete booking data");
        }

        // Call booking endpoint
        const bookResponse = await fetch('http://localhost:3000/api/chat/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: bookData.title,
            start: bookData.start,
            end: bookData.end,
            attendeeEmail: bookData.attendeeEmail,
            description: `Service: ${bookData.service}\nCompany: ${bookData.company || 'N/A'}\nDetails: ${bookData.details || 'N/A'}`
          })
        });

        const bookResult = await bookResponse.json();

        if (bookResult.success) {
          bookingSuccess = true;

          const meetLink = bookResult.event?.meetLink || 'Check your email';
          finalReply = `Perfect! Your consultation is confirmed for ${new Date(bookData.start).toLocaleString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Africa/Kigali'
          })}.\n\nYou'll receive a calendar invite at ${bookData.attendeeEmail} with the Google Meet link.\n\nIs there anything else I can help you with?`;
          
        } else {
          finalReply = "I apologize, but that time slot was just taken. Let me show you the updated available times:";
          showSlots = true;
        }

      } catch (parseError) {
        console.error("Booking error:", parseError);
        finalReply = "I encountered an issue while booking. Let me show you the available times again:";
        showSlots = true;
      }
    }

    // Clean up reply
    finalReply = finalReply
      .replace(/===SHOW_SLOTS===|===SHOW_SERVICES===|===BOOK===\s*\{[\s\S]*?\}|===SAVE_REQUEST===\s*\{[\s\S]*?\}/gi, '')
      .replace(/```json|```/g, '')
      .trim();

    // Ensure we have a reply
    if (!finalReply) {
      finalReply = "I'm here to help! What would you like to know about our services?";
    }

    res.json({
      reply: finalReply,
      showSlots,
      freeSlots: showSlots ? freeSlots : [],
      showServices,
      bookingConfirmed: bookingSuccess,
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      reply: "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.",
      showError: true
    });
  }
};
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of chatSessions.entries()) {
    if (value.lastAccess && now - value.lastAccess > 30 * 60 * 1000) {
      chatSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = { sendMessage };