// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const Employee = require('../models/Employees');
// const getCalendarData = require('../utils/getCalendarData');
// const ServiceRequest = require('../models/ServiceRequest');
// const dotenv = require('dotenv');
// dotenv.config();

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

// const systemInstruction = `
// You are a warm, professional AI assistant for Moyo Tech Solutions. Your role is to help clients book consultations and gather requirements for services.

// SERVICES WE OFFER:
// • SAP Consulting - Enterprise resource planning implementation
// • Custom Development - Tailored software solutions
// • Software Quality Assurance - Testing and QA services
// • IT Training - Professional development programs

// CONVERSATION FLOW:
// 1. NEVER show services again after the first message. The user has already seen them.

// 2. AFTER SERVICE SELECTION: Immediately start asking smart, contextual questions:
//    - For SAP: "Great choice! Which SAP modules are you interested in? (e.g., FI/CO, MM, SD, HR)" 
//    - For Development: "Excellent! What type of application do you need? (web, mobile, desktop, or enterprise system)"
//    - For QA: "Perfect! What's the scope of your QA needs? Are you looking for manual testing, automation, or both?"
//    - For Training: "Wonderful! What specific IT skills or technologies would you like training on? (e.g., programming, cloud, cybersecurity, data analysis)"
   
//    Then continue with: Name, company (optional), participant count/team size, timeline, budget range (if relevant)

// 3. DO NOT repeat the service selection prompt. Move forward with the conversation.

// 4. COLLECT REMAINING INFO: After understanding their needs, ask for:
//    - Full name
//    - Email address
//    - Phone number (optional)
//    - Company name (optional)

// 5. WHEN READY TO BOOK:
//    - If you have name + email + enough details → ask "Would you like to schedule a consultation call to discuss this further?"
//    - If user confirms → use ===SHOW_SLOTS===
   
// 6. AFTER SLOT SELECTION:
//    - Extract the datetime from user's message
//    - Output BOOKING JSON (see format below)

// BOOKING FORMAT (output ONLY when user selects a specific time):
// ===BOOK===
// {"intent":"book","service":"SERVICE_NAME","title":"SERVICE - Meeting with NAME","start":"ISO_DATETIME","end":"ISO_DATETIME","attendeeEmail":"EMAIL","name":"NAME","phone":"PHONE","company":"COMPANY","details":"SUMMARY"}

// ===SAVE_REQUEST===
// {"service":"SERVICE_NAME","name":"NAME","email":"EMAIL","phone":"PHONE","company":"COMPANY","details":"DETAILED_REQUIREMENTS","timeline":"TIMELINE","budget":"BUDGET"}

// CRITICAL RULES:
// - NEVER show ===SHOW_SERVICES=== after the first interaction
// - NEVER output ===BOOK=== before user selects a specific time slot
// - NEVER put text before ===BOOK=== or ===SAVE_REQUEST===
// - NEVER wrap in markdown code blocks
// - CURRENT YEAR IS 2025 - Use dates in 2025 only (e.g., 2025-12-03, not 2024-12-03)
// - Always use +02:00 timezone (Africa/Kigali)
// - End time = start time + 1 hour
// - Be conversational, not robotic
// - Show empathy and understanding
// - Confirm details before booking

// AVAILABLE TIMES (ALL IN 2025):
// {{AVAILABILITY}}

// Remember: Quality conversation > rushing to book. Build rapport first.
// `;

// const model = genAI.getGenerativeModel({
//   model: "gemini-2.0-flash",
//   generationConfig: { 
//     temperature: 0.8, 
//     maxOutputTokens: 800,
//     topP: 0.95
//   },
// });

// const whatsappSessions = new Map();

// const userStates = new Map();

// const services = [
//   { id: 'sap', name: "SAP Consulting" },
//   { id: 'dev', name: "Custom Development" },
//   { id: 'qa', name: "Software Quality Assurance" },
//   { id: 'training', name: "IT Training" }
// ];

// async function sendWhatsAppMessage(to, body) {
//     console.log('Sending WhatsApp message', 'to=====>:', to, body);
//   const url = process.env.WHATSAPP_URL;
  
//   try {
//     const response = await fetch(url, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         messaging_product: 'whatsapp',
//         to,
//         type: 'text',
//         text: { body }
//       })
//     });

//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error('WhatsApp send error:', error);
//     throw error;
//   }
// }

// // Send interactive list (for services)
// async function sendServiceList(to) {
//   const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
//   try {
//     const response = await fetch(url, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         messaging_product: 'whatsapp',
//         to,
//         type: 'interactive',
//         interactive: {
//           type: 'list',
//           header: {
//             type: 'text',
//             text: '🚀 Moyo Tech Solutions'
//           },
//           body: {
//             text: 'Welcome! Please select the service you need:'
//           },
//           footer: {
//             text: 'We\'re here to help you succeed'
//           },
//           action: {
//             button: 'Select Service',
//             sections: [
//               {
//                 title: 'Our Services',
//                 rows: services.map(svc => ({
//                   id: svc.id,
//                   title: svc.name,
//                   description: svc.id === 'sap' ? 'ERP implementation' : 
//                                svc.id === 'dev' ? 'Custom software solutions' :
//                                svc.id === 'qa' ? 'Testing & QA services' :
//                                'Professional IT training'
//                 }))
//               }
//             ]
//           }
//         }
//       })
//     });

//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error('WhatsApp send list error:', error);
//     throw error;
//   }
// }

// // Send time slots as buttons (WhatsApp limits to 3 buttons, so we'll send text with numbers)
// async function sendTimeSlots(to, slots) {
//   const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
//   // Format slots for display
//   let slotsText = '📅 *Available Time Slots:*\n\n';
//   slots.slice(0, 10).forEach((slot, idx) => {
//     const date = new Date(slot.isoStart);
//     const formatted = date.toLocaleString('en-US', {
//       weekday: 'short',
//       month: 'short',
//       day: 'numeric',
//       hour: 'numeric',
//       minute: '2-digit',
//       timeZone: 'Africa/Kigali'
//     });
//     slotsText += `${idx + 1}. ${formatted}\n`;
//   });
  
//   slotsText += '\n💬 Reply with the number (1-10) to book that slot.';
  
//   try {
//     const response = await fetch(url, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         messaging_product: 'whatsapp',
//         to,
//         type: 'text',
//         text: { body: slotsText }
//       })
//     });

//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error('WhatsApp send slots error:', error);
//     throw error;
//   }
// }

// // Process chatbot message
// async function processChatbotMessage(phoneNumber, userMessage, history = []) {
//   try {
//     // Get fresh calendar data
//     const employee = await Employee.findOne({ email: EMPLOYEE_EMAIL });
//     if (!employee) {
//       throw new Error("Calendar connection issue");
//     }

//     const token = employee.getDecryptedToken();
//     const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);
//     const freeSlots = calendar.freeSlots.map(s => {
//       const startDate = new Date(s.start);
//       if (startDate.getFullYear() < 2025) {
//         startDate.setFullYear(2025);
//       }
      
//       const endDate = new Date(s.end);
//       if (endDate.getFullYear() < 2025) {
//         endDate.setFullYear(2025);
//       }
      
//       return {
//         isoStart: startDate.toISOString(),
//         isoEnd: endDate.toISOString(),
//         display: startDate.toLocaleString('en-US', {
//           weekday: 'long',
//           month: 'long',
//           day: 'numeric',
//           year: 'numeric',
//           hour: 'numeric',
//           minute: '2-digit',
//           timeZone: 'Africa/Kigali'
//         })
//       };
//     });

//     const prompt = systemInstruction.replace(
//       "{{AVAILABILITY}}", 
//       JSON.stringify(freeSlots.map(s => s.display), null, 2)
//     );

//     // Get or create chat session
//     let chat = whatsappSessions.get(phoneNumber);
//     if (!chat || history.length === 0) {
//       chat = model.startChat({
//         history: [],
//         systemInstruction: { parts: [{ text: prompt }] },
//       });
//       whatsappSessions.set(phoneNumber, chat);
//     }

//     // Send message to AI
//     const result = await chat.sendMessage(userMessage);
//     let text = result.response.text();

//     let showSlots = text.includes("===SHOW_SLOTS===");
//     let showServices = text.includes("===SHOW_SERVICES===");
//     let bookData = null;
//     let saveData = null;
//     let finalReply = text;
//     let bookingSuccess = false;

//     // HANDLE SERVICE REQUEST SAVE
//     const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{[\s\S]*?\})/i);
//     if (saveMatch) {
//       try {
//         const jsonStr = saveMatch[1].replace(/```json|```/g, '').trim();
//         saveData = JSON.parse(jsonStr);
        
//         await ServiceRequest.create({
//           service: saveData.service,
//           name: saveData.name,
//           email: saveData.email,
//           phone: saveData.phone || phoneNumber,
//           company: saveData.company || null,
//           details: saveData.details || "",
//           timeline: saveData.timeline || null,
//           budget: saveData.budget || null,
//           status: 'new'
//         });
//       } catch (err) {
//         console.error("Failed to save service request:", err);
//       }
//     }

//     // HANDLE BOOKING
//     const bookMatch = text.match(/===BOOK===\s*(\{[\s\S]*?\})/i);
//     if (bookMatch) {
//       try {
//         const jsonStr = bookMatch[1].replace(/```json|```/g, '').trim();
//         bookData = JSON.parse(jsonStr);
        
//         // Ensure year is 2025
//         const bookStart = new Date(bookData.start);
//         const bookEnd = new Date(bookData.end);
        
//         if (bookStart.getFullYear() !== 2025) {
//           bookStart.setFullYear(2025);
//           bookData.start = bookStart.toISOString();
//         }
        
//         if (bookEnd.getFullYear() !== 2025) {
//           bookEnd.setFullYear(2025);
//           bookData.end = bookEnd.toISOString();
//         }

//         if (!bookData.start || !bookData.attendeeEmail || !bookData.title) {
//           throw new Error("Incomplete booking data");
//         }
//         const bookResponse = await fetch('https://catherin-postsaccular-rosann.ngrok-free.dev/api/chat/book', {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({
//             title: bookData.title,
//             start: bookData.start,
//             end: bookData.end,
//             attendeeEmail: bookData.attendeeEmail,
//             description: `Service: ${bookData.service}\nCompany: ${bookData.company || 'N/A'}\nPhone: ${phoneNumber}\nDetails: ${bookData.details || 'N/A'}`
//           })
//         });

//         const bookResult = await bookResponse.json();

//         if (bookResult.success) {
//           bookingSuccess = true;
//           finalReply = `✅ Perfect! Your consultation is confirmed for ${new Date(bookData.start).toLocaleString('en-US', {
//             weekday: 'long',
//             month: 'long',
//             day: 'numeric',
//             hour: 'numeric',
//             minute: '2-digit',
//             timeZone: 'Africa/Kigali'
//           })}.\n\nYou'll receive a calendar invite at ${bookData.attendeeEmail} with the Google Meet link.\n\nIs there anything else I can help you with?`;
//         } else {
//           finalReply = "I apologize, but that time slot was just taken. Let me show you the updated available times:";
//           showSlots = true;
//         }
//       } catch (parseError) {
//         console.error("Booking error:", parseError);
//         finalReply = "I encountered an issue while booking. Let me show you the available times again:";
//         showSlots = true;
//       }
//     }

//     // Clean up reply
//     finalReply = finalReply
//       .replace(/===SHOW_SLOTS===|===SHOW_SERVICES===|===BOOK===\s*\{[\s\S]*?\}|===SAVE_REQUEST===\s*\{[\s\S]*?\}/gi, '')
//       .replace(/```json|```/g, '')
//       .trim();

//     if (!finalReply) {
//       finalReply = "I'm here to help! What would you like to know about our services?";
//     }

//     return {
//       reply: finalReply,
//       showSlots,
//       freeSlots: showSlots ? freeSlots : [],
//       showServices,
//       bookingConfirmed: bookingSuccess,
//     };

//   } catch (error) {
//     console.error("Chat processing error:", error);
//     throw error;
//   }
// }

// // Webhook verification
// const verifyWebhook = (req, res) => {
//   const mode = req.query['hub.mode'];
//   const challenge = req.query['hub.challenge'];
//   const token = req.query['hub.verify_token'];

//   const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
//   if (mode && token === VERIFY_TOKEN) {
//     res.status(200).send(challenge);
//   } else {
//     console.log('Webhook verification failed');
//     res.sendStatus(403);
//   }
// };

// const handleWebhook = async (req, res) => {
//   console.log('=== INCOMING WEBHOOK ===');
//   console.log(JSON.stringify(req.body, null, 2));
  
//   try {
//     const { entry } = req.body;

//     // Immediately respond to WhatsApp to prevent timeout
//     res.status(200).send('EVENT_RECEIVED');

//     if (!entry || entry.length === 0) {
//       console.log('No entry in webhook');
//       return;
//     }

//     const changes = entry[0].changes;
//     if (!changes || changes.length === 0) {
//       console.log('No changes in webhook');
//       return;
//     }

//     const value = changes[0].value;
//     const messages = value.messages ? value.messages[0] : null;
//     const statuses = value.statuses ? value.statuses[0] : null;

//     // Handle message status updates
//     if (statuses) {
//       console.log(`Message Status: ${statuses.status} for ID: ${statuses.id}`);
//       return;
//     }

//     // Handle incoming messages
//     if (!messages) {
//       console.log('No messages in webhook');
//       return;
//     }

//     const phoneNumber = messages.from;
//     const messageId = messages.id;
    
//     console.log(`Processing message from: ${phoneNumber}`);
    
//     // Get or initialize user state
//     let userState = userStates.get(phoneNumber) || {
//       serviceSelected: false,
//       awaitingSlotSelection: false,
//       freeSlots: [],
//       history: []
//     };

//     // Handle text messages
//     if (messages.type === 'text') {
//       const userMessage = messages.text.body.trim();
//       console.log(`Text message: "${userMessage}"`);
      
//       // Check if user is selecting a time slot by number
//       if (userState.awaitingSlotSelection && /^\d+$/.test(userMessage)) {
//         const slotIndex = parseInt(userMessage) - 1;
        
//         if (slotIndex >= 0 && slotIndex < userState.freeSlots.length) {
//           const selectedSlot = userState.freeSlots[slotIndex];
//           const formatted = new Date(selectedSlot.isoStart).toLocaleString('en-US', {
//             weekday: 'long',
//             month: 'long',
//             day: 'numeric',
//             hour: 'numeric',
//             minute: '2-digit',
//             timeZone: 'Africa/Kigali'
//           });
          
//           // Process booking
//           const convertedMessage = `I'd like to book this time: ${formatted}`;
//           const response = await processChatbotMessage(phoneNumber, convertedMessage, userState.history);
          
//           await sendWhatsAppMessage(phoneNumber, response.reply);
          
//           userState.awaitingSlotSelection = false;
//           userState.freeSlots = [];
//         } else {
//           await sendWhatsAppMessage(phoneNumber, '❌ Invalid selection. Please choose a number from the list above.');
//         }
        
//         userStates.set(phoneNumber, userState);
//         return;
//       }
      
//       // Handle "start" or "hello" to show services
//       const lowerMsg = userMessage.toLowerCase();
//       if (lowerMsg === 'start' || lowerMsg === 'hello' || lowerMsg === 'hi' || lowerMsg === 'hey') {
//         await sendServiceList(phoneNumber);
//         userState.serviceSelected = false;
//         userStates.set(phoneNumber, userState);
//         return;
//       }
      
//       // Process regular message through chatbot
//       const response = await processChatbotMessage(phoneNumber, userMessage, userState.history);
      
//       console.log(`AI Response: ${response.reply}`);
      
//       // Send reply
//       await sendWhatsAppMessage(phoneNumber, response.reply);
      
//       // If showing slots, send them
//       if (response.showSlots && response.freeSlots.length > 0) {
//         await sendTimeSlots(phoneNumber, response.freeSlots);
//         userState.awaitingSlotSelection = true;
//         userState.freeSlots = response.freeSlots;
//       }
      
//       // If showing services, send them
//       if (response.showServices && !userState.serviceSelected) {
//         await sendServiceList(phoneNumber);
//       }
      
//       // Update history
//       userState.history.push({ role: 'user', content: userMessage });
//       userState.history.push({ role: 'assistant', content: response.reply });
//       userStates.set(phoneNumber, userState);
//     }
    
//     // Handle interactive messages (service selection from list)
//     if (messages.type === 'interactive') {
//       console.log('Interactive message received');
//       if (messages.interactive.type === 'list_reply') {
//         const selectedId = messages.interactive.list_reply.id;
//         const selectedService = services.find(s => s.id === selectedId);
        
//         console.log(`Service selected: ${selectedId}`);
        
//         if (selectedService) {
//           const convertedMessage = `I need ${selectedService.name}`;
//           const response = await processChatbotMessage(phoneNumber, convertedMessage, userState.history);
          
//           await sendWhatsAppMessage(phoneNumber, response.reply);
          
//           userState.serviceSelected = true;
//           userState.history.push({ role: 'user', content: convertedMessage });
//           userState.history.push({ role: 'assistant', content: response.reply });
//           userStates.set(phoneNumber, userState);
//         }
//       }
//     }

//   } catch (error) {
//     console.error('=== WEBHOOK ERROR ===');
//     console.error(error);
//     // Already sent 200 response, just log the error
//   }
// };
// setInterval(() => {
//   const now = Date.now();
//   for (const [key, value] of whatsappSessions.entries()) {
//     if (value.lastAccess && now - value.lastAccess > 30 * 60 * 1000) {
//       whatsappSessions.delete(key);
//     }
//   }
  
//   // Also clean user states
//   for (const [key, value] of userStates.entries()) {
//     if (value.lastAccess && now - value.lastAccess > 30 * 60 * 1000) {
//       userStates.delete(key);
//     }
//   }
// }, 5 * 60 * 1000);

// module.exports = {
//   verifyWebhook,
//   handleWebhook
// };


const dotenv = require('dotenv');
dotenv.config();

const userStates = new Map();

const services = [
  { id: 'sap', name: "SAP Consulting" },
  { id: 'dev', name: "Custom Development" },
  { id: 'qa', name: "Software Quality Assurance" },
  { id: 'training', name: "IT Training" }
];

async function sendWhatsAppMessage(to, body) {
  console.log('\n📤 SENDING MESSAGE');
  console.log('To:', to);
  console.log('Body:', body);
  
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  try {
    const response = await fetch(url, {
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

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ WhatsApp API Error Response:', JSON.stringify(data, null, 2));
      throw new Error(`WhatsApp API error: ${response.status} ${response.statusText}`);
    }
    
    console.log('✅ Message sent successfully!');
    console.log('Response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('❌ WhatsApp send error:', error.message);
    throw error;
  }
}

async function sendServiceList(to) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  console.log('\nSENDING SERVICE LIST');
  console.log('To:', to);

  try {
    const response = await fetch(url, {
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
          body: { text: 'Please select a service:' },
          footer: { text: "We're here to help!" },
          action: {
            button: 'View Services',
            sections: [
              {
                title: 'Our Services',
                rows: [
                  { id: 'sap',       title: 'SAP Consulting',        description: 'ERP & SAP Solutions' },
                  { id: 'dev',       title: 'Custom Development',   description: 'Web, Mobile & Apps' },
                  { id: 'qa',        title: 'Quality Assurance',    description: 'Testing & QA Services' },
                  { id: 'training',  title: 'IT Training',          description: 'Professional Courses' }
                ]
              }
            ]
          }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp List API Error:', JSON.stringify(data, null, 2));
      throw new Error(`WhatsApp List API error: ${response.status}`);
    }

    console.log('Service list sent successfully!');
    return data;
  } catch (error) {
    console.error('WhatsApp send list error:', error.message);

    // Fallback: send a simple text menu if list fails
    try {
      await sendWhatsAppMessage(to, `
*Our Services:*

1️⃣ SAP Consulting  
2️⃣ Custom Development  
3️⃣ Quality Assurance  
4️⃣ IT Training  

Reply with the number or type *menu* to see again!
      `.trim());
    } catch (fallbackError) {
      console.error('Even fallback failed:', fallbackError.message);
    }

    throw error;
  }
}

const verifyWebhook = (req, res) => {
  console.log('\n🔍 WEBHOOK VERIFICATION REQUEST');
  console.log('Query params:', req.query);
  
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  
  console.log('Mode:', mode);
  console.log('Token matches:', token === VERIFY_TOKEN);
  
  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
};

const handleWebhook = async (req, res) => {
  console.log('\n' + '='.repeat(50));
  console.log('INCOMING WEBHOOK');
  console.log('Timestamp:', new Date().toISOString());
  console.log('='.repeat(50));

  // ALWAYS respond first — WhatsApp timeouts after 5-10 seconds
  res.status(200).send('EVENT_RECEIVED');
  console.log('Sent 200 response to WhatsApp');

  try {
    const body = req.body;

    if (!body?.entry?.[0]?.changes?.[0]?.value) {
      console.log('Invalid payload structure');
      return;
    }

    const value = body.entry[0].changes[0].value;

    // === 1. Handle Status Updates Safely (MOST COMMON) ===
    if (value.statuses && value.statuses.length > 0) {
      const s = value.statuses[0];
      const statusEmoji = s.status === 'sent' ? 'Sent' : 
                         s.status === 'delivered' ? 'Delivered' : 
                         s.status === 'read' ? 'Read' : 
                         s.status === 'failed' ? 'Failed' : s.status;
      console.log(`Message ${statusEmoji}: ${s.id}`);
      return; // Do nothing else — safe exit
    }

    // === 2. Only Now Check for Real Incoming Messages ===
    if (!value.messages || value.messages.length === 0) {
      console.log('No incoming messages in this webhook');
      return;
    }

    const message = value.messages[0];
    const from = message.from; // This is SAFE now — we know message exists
    const type = message.type;

    console.log(`\nNEW MESSAGE from ${from} | Type: ${type}`);

    // Reinitialize user state
    let userState = userStates.get(from) || { messageCount: 0 };
    userState.lastAccess = Date.now();
    userState.messageCount = (userState.messageCount || 0) + 1;
    userStates.set(from, userState);

    // Handle text
    if (type === 'text') {
      const text = message.text.body.trim().toLowerCase();

      if (['hi', 'hello', 'hey', 'start', 'menu', 'services'].includes(text)) {
        await sendServiceList(from);
        return;
      }

      await sendWhatsAppMessage(from,
        `Message #${userState.messageCount} received!\n\nYou said: "${message.text.body}"\n\nType "menu" to see our services!`
      );
    }

    // Handle list selection
    else if (type === 'interactive' && message.interactive?.type === 'list_reply') {
      const selectedId = message.interactive.list_reply.id;
      const service = services.find(s => s.id === selectedId);

      if (service) {
        await sendWhatsAppMessage(from, `You selected: *${service.name}*\n\nOur team will contact you shortly!`);
        userState.selectedService = selectedId;
        userStates.set(from, userState);
      } else {
        await sendWhatsAppMessage(from, "Invalid selection. Please try again.");
      }
    }

    // Handle media
    else if (['image', 'audio', 'video', 'document'].includes(type) ) {
      await sendWhatsAppMessage(from, `${type.charAt(0).toUpperCase() + type.slice(1)} received! Thank you!`);
    }

  } catch (error) {
    // ONLY log server errors — NEVER send error messages blindly
    console.error('\nSERVER ERROR (not user-facing):');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);

    // OPTIONAL: Only notify admin (not user!)
    // You can send to your own number:
    // await sendWhatsAppMessage("YOUR_ADMIN_NUMBER", `Bot error: ${error.message}`);
  }
};
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes
  
  let statesCleared = 0;
  
  for (const [key, value] of userStates.entries()) {
    if (value.lastAccess && now - value.lastAccess > timeout) {
      userStates.delete(key);
      statesCleared++;
    }
  }
  
  if (statesCleared > 0) {
    console.log(`🧹 Cleaned up ${statesCleared} inactive user states`);
  }
}, 5 * 60 * 1000);

module.exports = {
  verifyWebhook,
  handleWebhook
};