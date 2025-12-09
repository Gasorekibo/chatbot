const mongoose = require('mongoose');

const ContentSchema = new mongoose.Schema({
  services: [{
    id: String,
    name: String,
    short: String,
    details: String,
    active: Boolean
  }],
  faqs: [{
    question: String,
    answer: String
  }],
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'content', timestamps: false });

module.exports = mongoose.model('Content', ContentSchema);