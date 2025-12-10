
const express = require('express');
const router = express.Router();
const { initiateWhatsappMessage } = require('../controllers/initiateMessage');

router.post('/template', async (req, res) => {
  const { to, templateName, params} = req.body;

  if (!to?.length || !templateName) {
    return res.status(400).json({ error: "Missing 'to' or 'templateName'" });
  }

  try {

   await to.forEach(async (phoneNumber) => {
      await initiateWhatsappMessage(phoneNumber, templateName, params);
    });
    res.json({ success: true, sent_to: to, template: templateName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;