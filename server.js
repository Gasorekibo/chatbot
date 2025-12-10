require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./helpers/config');
const chatRoutes = require('./routes/chat');
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