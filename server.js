require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Your AI Business Chatbot is LIVE!' });
});

app.use('/api/chat', chatRoutes);

app.listen(PORT, () => {
  console.log(`Chatbot running on http://localhost:${PORT}`);
});