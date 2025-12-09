const mongoose = require('mongoose');

const UserSessionSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  history: [{
    role: { type: String, enum: ['user', 'model'], required: true },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  state: {
    selectedService: String,
    awaitingSlot: Boolean,
    slots: Array,
    name: String,
    email: String,
    company: String
  },
  lastAccess: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserSession', UserSessionSchema);