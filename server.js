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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));

connectDB();
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
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

    const employee = await Employee.findOneAndUpdate(
      { email: userInfo.email },
      { 
        name: userInfo.name,
        email: userInfo.email,
        refreshToken: tokens.refresh_token || undefined
      },
      { upsert: true, new: true }
    );

    res.send(`<h2>Success!</h2><p>Connected as ${userInfo.name} (${userInfo.email})</p>`);
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('Authentication failed');
  }
});
app.use(express.static('public'));

app.use('/api/chat', chatRoutes);
app.post('/api/chat/book', bookMeetingHandler);

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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});