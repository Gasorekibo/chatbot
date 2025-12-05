require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const connectDB = require('./helpers/config');
const chatRoutes = require('./routes/chat');
const bookMeetingHandler = require('./controllers/bookMeeting');
const Employee = require('./models/Employees');
const { oauth2Client } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static('public'));

// Connect DB
connectDB(); 
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
    const data = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(data.tokens);
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${data.tokens.access_token}`
      }
    });
    
    const userInfo = await userInfoResponse.json();
    const existingEmployee = await Employee.findOne({ email: userInfo.email });
    
    if (existingEmployee) {
      existingEmployee.refreshToken = data.tokens.refresh_token;
      await existingEmployee.save();
    } else {
      const newEmployee = new Employee({
        name: userInfo.name,
        email: userInfo.email,
        refreshToken: data.tokens.refresh_token
      });
      await newEmployee.save();
    }
    
    res.send(`
      <h3>Authorization successful!</h3>
      <p><strong>Name:</strong> ${userInfo.name}</p>
      <p><strong>Email:</strong> ${userInfo.email}</p>
      <p>✅ Employee automatically saved to database!</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('OAuth error: ' + err.message);
  }
});

app.get('/', (req, res)=> {
  res.send('Welcome to the AI Chatbot with Real Calendar! Auth at /auth');
});

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
    const calendarData = await getCalendarData(employee.email, token);
    res.json(calendarData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'calendar error', details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});