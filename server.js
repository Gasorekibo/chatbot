require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./helpers/config');
const chatRoutes = require('./routes/chat');
const UserSession = require('./models/UserSession');
const { sendWhatsAppMessage } = require('./controllers/whatsappController');
const bookMeetingHandler = require('./controllers/bookMeeting');
const Employee = require('./models/Employees');
const { oauth2Client } = require('./utils/auth');
const { verifyWebhook, handleWebhook } = require('./controllers/whatsappController');
const { syncServicesFromSheet, initializeServices } = require('./utils/googleSheets');
const adminRoutes= require('./routes/admin');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));

connectDB().then(async () => {
  await initializeServices();
});

app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

// Google OAuth
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ],
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userInfoRes.json();

    await Employee.findOneAndUpdate(
      { email: userInfo.email },
      { 
        name: userInfo.name,
        email: userInfo.email,
        refreshToken: tokens.refresh_token || undefined
      },
      { upsert: true, new: true }
    );

    res.send(`
      <html>
        <head>
          <title>Authentication Success</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            h2 { color: #4CAF50; }
            .info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <h2>✅ Authentication Successful!</h2>
          <div class="info">
            <p><strong>Connected as:</strong> ${userInfo.name}</p>
            <p><strong>Email:</strong> ${userInfo.email}</p>
          </div>
          <p>You can now use the sync services endpoint.</p>
          <p><a href="/">Go to Dashboard</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('Authentication failed');
  }
});
app.use(express.static('public'));
app.use('/api/chat', chatRoutes);
app.post('/api/chat/book', bookMeetingHandler);
app.use('/api/outreach', adminRoutes);

app.get('/employees', async (req, res) => {
  const employees = await Employee.find({}, 'name email');
  res.json(employees);
});
app.post('/webhook/flutterwave', express.json(), async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_SECRET;
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {

    return res.status(401).end();
  }


  try {
    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      const meta = payload.meta_data;
      

      if (!meta?.booking_details) {
        return res.status(200).end();
      }

      const booking = JSON.parse(meta.booking_details);
      let phone = meta.phone || booking.phone;;
      const normalizedPhone = phone.toString().replace(/^\+/, '');
      const session = await UserSession.findOne({ phone: normalizedPhone });
      
      if (!session) {
        try {
          const message = `✅ *Payment Received!*\n\n` +
                        `Your deposit of ${payload.data.amount} ${payload.data.currency} was successful.\n\n` +
                        `We're processing your booking now. You'll receive a confirmation email at ${booking.email} shortly.\n\n` +
                        `Thank you for choosing Moyo Tech Solutions! 🚀`;
          
          await sendWhatsAppMessage(phone, message);
        } catch (msgErr) {
          console.error('❌ Could not send message:', msgErr);
        }
        
        return res.status(200).end();
      }

      const startISO = booking.start;
      const endISO = booking.end;
      // Create calendar booking
      const bookRes = await fetch('http://localhost:3000/api/chat/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: booking.title || `Consultation - ${booking.name}`,
          start: startISO,  
          end: endISO,  
          attendeeEmail: booking.email,
          description: `Service: ${booking.service}\n` +
                      `Phone: ${phone}\n` +
                      `Company: ${booking.company || 'N/A'}\n` +
                      `Details: ${booking.details || 'N/A'}\n` +
                      `Deposit Paid: ${payload.data.amount} ${payload.data.currency}\n` +
                      `Transaction Ref: ${booking.tx_ref}\n` +
                      `Payment Method: ${payload.data.payment_type}`
        })
      });

      const result = await bookRes.json();
      const start = new Date(startISO);
      const displayDate = start.toLocaleString('en-US', { 
        timeZone: 'Africa/Kigali', 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      });

      let message;
      if (result.success) {
        message = `✅ *Booking Confirmed!*\n\n` +
                  `Thank you ${booking.name}! Your deposit of *${payload.data.amount} ${payload.data.currency}* was successful.\n\n` +
                  `📅 *Consultation Details:*\n` +
                  `• Service: ${booking.service}\n` +
                  `• Date & Time: ${displayDate}\n` +
                  `• Duration: 1 hour\n\n` +
                  `📧 Check your email (*${booking.email}*) for:\n` +
                  `✓ Calendar invite\n` +
                  `✓ Google Meet link\n` +
                  `✓ Pre-consultation form\n\n` +
                  `We can't wait to help you grow! 🚀\n\n` +
                  `_Type 'menu' anytime to see our services again._`;
      } else {
        message = `⚠️ Payment Received\n\n` +
                  `Your deposit of ${payload.data.amount} ${payload.data.currency} was successful, but the time slot was just taken.\n\n` +
                  `Don't worry! Our team will:\n` +
                  `✓ Process a full refund within 24 hours\n` +
                  `✓ Contact you at ${booking.email} to reschedule\n\n` +
                  `We apologize for the inconvenience!`;
      }

      await sendWhatsAppMessage(phone, message);

    } else {
      // Payment not successful
      const failedPaymentMessage = `⚠️ *Payment Not Successful*\n\n` +
                                   `We noticed that your recent payment did not go through successfully.\n\n` +
                                   `Please try again or contact support if the issue persists.\n\n` +
                                   `Thank you!`;
      await sendWhatsAppMessage(meta.phone || 'Client', failedPaymentMessage);

    }

    res.status(200).json({ success: true });

  } catch (err) {
    res.status(200).json({ success: false, error: err.message });
  }
});
app.get('/payment-success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Payment Successful</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            text-align: center;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-top: 50px;
          }
          .success-icon {
            font-size: 64px;
            color: #4CAF50;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          p {
            color: #666;
            line-height: 1.6;
          }
          .highlight {
            background: #e8f5e9;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Thank you for your deposit.</p>
          <div class="highlight">
            <p><strong>Your booking is being confirmed...</strong></p>
            <p>You'll receive a WhatsApp message with your booking details and Google Meet link shortly.</p>
          </div>
          <p style="margin-top: 30px; font-size: 14px; color: #999;">
            You can close this page now.
          </p>
        </div>
      </body>
    </html>
  `);
});
app.post('/calendar-data', async (req, res) => {
  const { employeeName } = req.body;
  if (!employeeName) return res.status(400).json({ error: 'no employee name' });

  const employee = await Employee.findOne({ name: employeeName });
  if (!employee) return res.status(404).json({ error: 'employee not found' });

  const token = employee.getDecryptedToken();
  if (!token) return res.status(401).json({ error: 'no token' });

  const getCalendarData = require('./utils/getCalendarData');
  try {
    const data = await getCalendarData(employee.email, token);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync-services', async (req, res) => {
  try {
    const spreadsheetId = req?.body?.spreadsheetId || process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(400).json({ 
        success: false, 
        error: 'spreadsheetId is required (in body or GOOGLE_SHEET_ID env variable)' 
      });
    }

    const employee = await Employee.findOne({ email: process.env.EMPLOYEE_EMAIL });
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        error: 'Employee not found. Please authenticate first at /auth' 
      });
    }

    const token = employee.getDecryptedToken();
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'No refresh token found. Please authenticate at /auth' 
      });
    }

    const result = await syncServicesFromSheet(spreadsheetId, token);
    res.json(result);

  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/webhook/sheets-sync', async (req, res) => {
  try {
    const { spreadsheetId, verifyToken } = req.body;
    if (process.env.SHEETS_WEBHOOK_TOKEN && 
        verifyToken !== process.env.SHEETS_WEBHOOK_TOKEN) {
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid webhook token' 
      });
    }

    const sheetId = spreadsheetId || process.env.GOOGLE_SHEET_ID;
    
    if (!sheetId) {
      return res.status(400).json({ 
        success: false, 
        error: 'spreadsheetId required' 
      });
    }

    const employee = await Employee.findOne({ email: process.env.EMPLOYEE_EMAIL });
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        error: 'Employee not found' 
      });
    }

    const token = employee.getDecryptedToken();
    const result = await syncServicesFromSheet(sheetId, token);

    res.json(result);

  } catch (error) {
    console.error('❌ Webhook sync error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});