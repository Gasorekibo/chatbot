
const express = require('express');
const router = express.Router();
const { initiateWhatsappMessage } = require('../controllers/initiateMessage');

router.post('/template', async (req, res) => {
  const { to, templateName} = req.body;

  if (!to?.length || !templateName) {
    return res.status(400).json({ error: "Missing 'to' or 'templateName'" });
  }

  try {
    // to is an array of phone numbers

   await to.forEach(async (phoneNumber) => {
      await initiateWhatsappMessage(phoneNumber, templateName);
    });
    res.json({ success: true, sent_to: to, template: templateName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;