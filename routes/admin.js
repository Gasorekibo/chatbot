
// const express = require('express');
// const router = express.Router();
// const { initiateWhatsappMessage } = require('../controllers/initiateMessage');
// const UserSession = require('../models/UserSession');
// const ServiceRequest = require('../models/ServiceRequest');
// const Content = require('../models/Content');
// const zohoClient = require('../utils/zohoClient')

// router.post('/template', async (req, res) => {

//   const userSession = await UserSession.find()
//   const to = userSession.map(session => session.phone);
//   const templateName = req.body.templateName
//   if (!to?.length || !templateName) {
//     return res.status(400).json({ error: "Missing 'to' or 'templateName'" });
//   }
//   try {

//    await to.forEach(async (phoneNumber) => {
//     const username = await userSession.filter(session => session.phone === phoneNumber).map(session => session.name || "Customer");
//     const params = username;
//       await initiateWhatsappMessage(phoneNumber, templateName, params);
//     });
//     res.json({ success: true, sent_to: to, template: templateName });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// router.get('/users', async (req, res) => {
//   try {
//     const users = await UserSession.find({});
//     res.json({ users });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// })

// router.get('/appointments', async(req, res)=> {
//   try {
//     const appointments = await ServiceRequest.find({});
//     res.json({ appointments });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// })

// router.get('/services', async(req, res)=> {
//   try {
//     const services = await Content.find({})
//     res.json(services || []);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// })
// module.exports = router;



const express = require('express');
const router = express.Router();
const { initiateWhatsappMessage } = require('../controllers/initiateMessage');
const UserSession = require('../models/UserSession');
const ServiceRequest = require('../models/ServiceRequest');
const Content = require('../models/Content');
const zohoClient = require('../utils/zohoClient');


router.post('/template', async (req, res) => {
  try {
    const { templateName, filters = {} } = req.body;

    if (!templateName) {
      return res.status(400).json({ error: "Missing 'templateName'" });
    }

    console.log(`📤 Fetching contacts from Zoho CRM for template: ${templateName}`);

    // Fetch contacts from Zoho CRM
    let contacts;
    if (Object.keys(filters).length > 0) {
      contacts = await zohoClient.getFilteredContacts(filters);
    } else {
      contacts = await zohoClient.getAllContacts({ activeOnly: true });
    }

    if (contacts.length === 0) {
      return res.json({
        success: true,
        message: 'No contacts found in Zoho CRM',
        sent_to: [],
        count: 0,
        template: templateName,
      });
    }

    console.log(`📋 Found ${contacts.length} contacts from Zoho CRM`);

    const sentTo = [];
    const failed = [];

    // Send messages to each contact
    for (const contact of contacts) {
      if (!contact.phone) {
        console.log(`⚠️ Skipping ${contact.name} - no phone number`);
        failed.push({ name: contact.name, reason: 'No phone number' });
        continue;
      }

      try {
        // Use contact name as parameter for template
        const params = contact.name || "Customer";
        
        await initiateWhatsappMessage(contact.phone, templateName, params);
        
        sentTo.push({
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        });

        // Optional: Update Zoho contact with last message sent timestamp
        await zohoClient.updateContactField(
          contact.id,
          'Last_WhatsApp_Message',
          new Date().toISOString()
        );

        console.log(`✅ Message sent to ${contact.name} (${contact.phone})`);

        // Rate limiting: small delay between messages
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        console.error(`❌ Failed to send to ${contact.name}:`, err.message);
        failed.push({
          name: contact.name,
          phone: contact.phone,
          error: err.message,
        });
      }
    }

    console.log(`✅ Broadcast complete: ${sentTo.length} sent, ${failed.length} failed`);

    res.json({
      success: true,
      sent_to: sentTo,
      count: sentTo.length,
      failed: failed.length > 0 ? failed : undefined,
      template: templateName,
      source: 'zoho_crm',
    });

  } catch (err) {
    console.error('❌ Broadcast error:', err);
    res.status(500).json({ error: err.message });
  }
});
router.get('/users', async (req, res) => {
  try {
    console.log('📥 Fetching users from Zoho CRM...');
    
    const contacts = await zohoClient.getAllContacts({ activeOnly: true });

    // Transform Zoho contacts to match your dashboard format
    const users = contacts.map(contact => ({
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
      state: {
        selectedService: null, // Zoho contacts don't have this by default
        leadStatus: contact.leadStatus,
      },
      history: [], // Zoho contacts don't have chat history
      lastAccess: contact.createdTime,
      source: 'zoho_crm',
    }));

    console.log(`✅ Retrieved ${users.length} users from Zoho CRM`);

    res.json({ users });

  } catch (error) {
    console.error('❌ Failed to fetch Zoho contacts:', error);
    
    // Fallback to UserSession if Zoho fails
    console.log('⚠️ Falling back to UserSession database...');
    try {
      const users = await UserSession.find({});
      res.json({ 
        users,
        source: 'user_session',
        warning: 'Zoho CRM unavailable, showing local sessions',
      });
    } catch (fallbackError) {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/outreach/appointments
 * Fetch all service requests (appointments)
 */
router.get('/appointments', async (req, res) => {
  try {
    const appointments = await ServiceRequest.find({})
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.json({ appointments });
  } catch (error) {
    console.error('❌ Failed to fetch appointments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/outreach/services
 * Fetch all active services
 */
router.get('/services', async (req, res) => {
  try {
    const services = await Content.find({});
    res.json(services || []);
  } catch (error) {
    console.error('❌ Failed to fetch services:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/test-zoho
 * Test Zoho CRM connection and fetch sample contacts
 */
router.post('/test-zoho', async (req, res) => {
  try {
    console.log('🔍 Testing Zoho CRM connection...');
    
    const contacts = await zohoClient.getAllContacts({ activeOnly: true });
    
    res.json({
      success: true,
      message: 'Zoho CRM connection successful',
      sampleContacts: contacts.slice(0, 5), // Return first 5 as sample
      totalContacts: contacts.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Zoho connection test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Check your ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in .env',
    });
  }
});

/**
 * POST /api/outreach/sync-sessions
 * Sync Zoho contacts to UserSession (optional, for backup)
 */
router.post('/sync-sessions', async (req, res) => {
  try {
    console.log('🔄 Syncing Zoho contacts to UserSession...');
    
    const contacts = await zohoClient.getAllContacts({ activeOnly: true });
    let synced = 0;
    let skipped = 0;

    for (const contact of contacts) {
      if (!contact.phone) {
        skipped++;
        continue;
      }

      // Check if session already exists
      const existing = await UserSession.findOne({ phone: contact.phone });
      
      if (!existing) {
        await UserSession.create({
          name: contact.name,
          phone: contact.phone,
          history: [],
          state: { 
            selectedService: null,
            zohoId: contact.id,
            leadStatus: contact.leadStatus,
          },
          lastAccess: new Date(),
        });
        synced++;
      } else {
        skipped++;
      }
    }

    console.log(`✅ Sync complete: ${synced} synced, ${skipped} skipped`);

    res.json({
      success: true,
      synced,
      skipped,
      total: contacts.length,
    });

  } catch (error) {
    console.error('❌ Sync failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;