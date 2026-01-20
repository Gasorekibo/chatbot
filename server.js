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
const {  initializeServices } = require('./utils/googleSheets');
const adminRoutes = require('./routes/admin');
const { paymentWebhookHandler } = require('./helpers/paymentWebhookHandler');
const { syncServicesHandler } = require('./helpers/syncServicesHandler');
const { googleSheetsWebhookHandler } = require('./helpers/googleSheetsWebhookHandler');
const { calendarDataHandler } = require('./helpers/calendarDataHandler');
const { zohoAuthenticationRedirect } = require('./helpers/zoho/zohoAuthenticationRedirect');
const { zohoAuthCallbackHandler } = require('./helpers/zoho/zohoAuthCallbackHandler');
const { zohoGetAllContactsHandler } = require('./helpers/zoho/zohoGetAllContactsHandler');
const { successfulPaymentPageHandler } = require('./helpers/successfulPaymentPageHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));


connectDB().then(async () => {
  await initializeServices();
});
app.use(express.static('public'));
app.use('/api/chat', chatRoutes);
app.post('/api/chat/book', bookMeetingHandler);
app.use('/api/outreach', adminRoutes);

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

app.get('/auth/zoho', zohoAuthenticationRedirect);

app.get('/zoho/oauth/callback', zohoAuthCallbackHandler)

app.get('/api/zoho/contacts', zohoGetAllContactsHandler);



app.get('/employees', async (req, res) => {
  const employees = await Employee.find({}, 'name email');
  res.json(employees);
});
app.post('/webhook/flutterwave', express.json(), paymentWebhookHandler);
app.get('/payment-success', successfulPaymentPageHandler);
app.post('/calendar-data', calendarDataHandler);

app.post('/api/sync-services', syncServicesHandler);

app.post('/api/webhook/sheets-sync', googleSheetsWebhookHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server Started Successfully`);
});