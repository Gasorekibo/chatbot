
const express = require('express');
const router = express.Router();
const { initiateWhatsappMessage } = require('../controllers/initiateMessage');
const UserSession = require('../models/UserSession');
const ServiceRequest = require('../models/ServiceRequest');
const Content = require('../models/Content');

router.post('/template', async (req, res) => {

  const userSession = await UserSession.find()
  const to = userSession.map(session => session.phone);
const templateName = req.body.templateName
  if (!to?.length || !templateName) {
    return res.status(400).json({ error: "Missing 'to' or 'templateName'" });
  }
  try {

   await to.forEach(async (phoneNumber) => {
    const username = await userSession.filter(session => session.phone === phoneNumber).map(session => session.name || "Customer");
    const params = username;
      await initiateWhatsappMessage(phoneNumber, templateName, params);
    });
    res.json({ success: true, sent_to: to, template: templateName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await UserSession.find({});
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/appointments', async(req, res)=> {
  try {
    const appointments = await ServiceRequest.find({});
    res.json({ appointments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/services', async(req, res)=> {
  try {
    const services = await Content.find({})
    res.json(services || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})
module.exports = router;