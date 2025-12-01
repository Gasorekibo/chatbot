
const mongoose = require('mongoose');
const serviceRequestSchema = new mongoose.Schema({
  service: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  company: String,
  details: String,
  timeline: String,
  budget: String,
  sapModule: String,
  appType: String,
  trainingTopic: String,
  participants: Number,
  status: { type: String, default: 'new' }, 
}, { timestamps: true });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);