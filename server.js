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
const adminRoutes = require('./routes/admin');
const {fetchZohoContacts} = require('./utils/zohoApi');

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

// ============= ZOHO CRM OAUTH =============
// Redirect to Zoho authorization (one-time setup)
app.get('/auth/zoho', (req, res) => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return res.status(500).send('Zoho OAuth credentials not configured in .env');
  }

  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?` +
    `scope=ZohoCRM.modules.contacts.READ,ZohoCRM.modules.contacts.ALL,ZohoCRM.settings.ALL&` +
    `client_id=${clientId}&` +
    `response_type=code&` +
    `access_type=offline&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `prompt=consent`;
  
  res.redirect(authUrl);
});

// Zoho OAuth callback handler
app.get('/zoho/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('No authorization code received');
  }

  try {
    console.log('🔄 Exchanging Zoho code for tokens...');
    
    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zoho Authorization Success</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 900px; 
              margin: 50px auto; 
              padding: 30px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 15px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            }
            h1 { color: #48bb78; margin-bottom: 20px; }
            .token-box {
              background: #f7fafc;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              border-left: 4px solid #667eea;
            }
            .token-label {
              font-weight: bold;
              color: #667eea;
              margin-bottom: 10px;
              font-size: 14px;
              text-transform: uppercase;
            }
            .token-value {
              background: #2d3748;
              color: #48bb78;
              padding: 15px;
              border-radius: 5px;
              font-family: 'Courier New', monospace;
              word-break: break-all;
              font-size: 13px;
              margin-top: 10px;
            }
            .copy-btn {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              cursor: pointer;
              margin-top: 15px;
              font-weight: 600;
              transition: all 0.3s ease;
            }
            .copy-btn:hover {
              background: #5568d3;
              transform: translateY(-2px);
            }
            .success-icon {
              font-size: 48px;
              text-align: center;
              margin-bottom: 20px;
            }
            .env-example {
              background: #2d3748;
              color: #68d391;
              padding: 20px;
              border-radius: 8px;
              font-family: 'Courier New', monospace;
              margin-top: 20px;
              white-space: pre-wrap;
            }
            .instructions {
              background: #fef5e7;
              border-left: 4px solid #f39c12;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
            }
            .instructions h3 {
              color: #f39c12;
              margin-top: 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Zoho CRM Authorization Successful!</h1>
            
            <div class="token-box">
              <div class="token-label">🔑 Your Refresh Token:</div>
              <div class="token-value" id="refreshToken">${data.refresh_token}</div>
              <button class="copy-btn" onclick="copyToken('refreshToken')">
                📋 Copy Refresh Token
              </button>
            </div>

            <div class="instructions">
              <h3>📝 Next Steps:</h3>
              <ol>
                <li>Copy the <strong>Refresh Token</strong> above</li>
                <li>Open your <code>.env</code> file</li>
                <li>Add or update: <code>ZOHO_REFRESH_TOKEN=${data.refresh_token}</code></li>
                <li>Restart your server</li>
                <li>Test with: <code>GET /api/zoho/contacts</code></li>
              </ol>
            </div>

            <h3 style="margin-top: 30px;">Add to your .env file:</h3>
            <div class="env-example" id="envConfig">ZOHO_REFRESH_TOKEN=${data.refresh_token}</div>
            <button class="copy-btn" onclick="copyToken('envConfig')">
              📋 Copy Token
            </button>

            <p style="margin-top: 30px; color: #718096; text-align: center;">
              You can close this window and restart your server.
            </p>
          </div>

          <script>
            function copyToken(elementId) {
              const element = document.getElementById(elementId);
              const text = element.textContent;
              
              navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.style.background = '#48bb78';
                
                setTimeout(() => {
                  btn.textContent = originalText;
                  btn.style.background = '#667eea';
                }, 2000);
              }).catch(err => {
                alert('Failed to copy. Please select and copy manually.');
              });
            }
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Zoho OAuth error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial; padding: 50px; text-align: center;">
          <h1 style="color: #e53e3e;">❌ Authorization Failed</h1>
          <p style="color: #718096;">Error: ${error.message}</p>
          <p style="margin-top: 30px;">
            <a href="/auth/zoho" 
               style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              🔄 Try Again
            </a>
          </p>
        </body>
      </html>
    `);
  }
});

// ============= ZOHO CRM API ENDPOINTS =============

app.get('/api/zoho/contacts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 200;

    const contacts = await fetchZohoContacts(page, perPage);
    
    // Format contacts for your application
    const formattedContacts = contacts.map(contact => ({
      id: contact.id,
      firstName: contact.First_Name,
      lastName: contact.Last_Name,
      fullName: `${contact.First_Name || ''} ${contact.Last_Name || ''}`.trim(),
      phone: contact.Mobile || contact.Phone,
      mobile: contact.Mobile,
      email: contact.Email,
      source: 'zoho_crm'
    }));

    res.json({
      success: true,
      count: formattedContacts.length,
      page: page,
      contacts: formattedContacts
    });
  } catch (error) {
    console.error('❌ Error fetching Zoho contacts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============= EXISTING ROUTES =============
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
  console.log(`🚀 Server Started Successfully`);
});