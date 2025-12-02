const express = require('express');
const router = express.Router();
const { sendMessage } = require('../controllers/chatController');
const collectServiceRequest = require('../controllers/collectServiceRequest');

router.post('/send', sendMessage);
router.post('/collect-service', collectServiceRequest);

module.exports = router;