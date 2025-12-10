const { google } = require('googleapis');
const Content = require('../models/Content');

/**
 * Sync services from Google Sheet to MongoDB
 * @param {string} spreadsheetId - The Google Sheet ID
 * @param {string} refreshToken - OAuth refresh token
 * @returns {Object} Sync result
 */
async function syncServicesFromSheet(spreadsheetId, refreshToken) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Services!A2:E',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return { success: false, message: 'No data found in sheet' };
    }
    const services = rows
      .filter(row => row[0])
      .map(row => ({
        id: row[0]?.trim() || '',
        name: row[1]?.trim() || '',
        short: row[2]?.trim() || '',
        details: row[3]?.trim() || '',
        active: row[4]?.toLowerCase() === 'true' || row[4] === '1' || row[4]?.toLowerCase() === 'yes'
      }))
      .filter(s => s.id && s.name); 
    const content = await Content.findOneAndUpdate(
      {},
      { 
        services,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    return { 
      success: true, 
      message: `Successfully synced ${services.length} services`,
      services: content.services,
      syncedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Google Sheets sync error:', error);
    return { 
      success: false, 
      message: error.message,
      error: error.toString()
    };
  }
}

/**
 * Get active services from MongoDB
 * Falls back to default services if none found
 * @returns {Array} Active services
 */
async function getActiveServices() {
  try {
    const content = await Content.findOne();
    
    if (content && content.services && content.services.length > 0) {

      const activeServices = content.services.filter(s => s.active !== false);
      return activeServices;
    }
    return getDefaultServices();

  } catch (error) {
    console.error('❌ Error fetching services:', error);
    // Return default services on error
    return getDefaultServices();
  }
}

/**
 * Get all services (including inactive)
 * @returns {Array} All services
 */
async function getAllServices() {
  try {
    const content = await Content.findOne();
    
    if (content && content.services && content.services.length > 0) {

      return content.services;
    }

    return getDefaultServices();

  } catch (error) {
    console.error('Error fetching all services:', error);
    return getDefaultServices();
  }
}

/**
 * Default services as fallback
 * @returns {Array} Default services
 */
function getDefaultServices() {
  return [
    { 
      id: 'sap', 
      name: 'SAP Consulting', 
      short: 'SAP Consulting',
      details: 'ERP & SAP Solutions',
      active: true 
    },
    { 
      id: 'dev', 
      name: 'Custom Development', 
      short: 'Custom Dev',
      details: 'Web/Mobile/Enterprise Apps',
      active: true 
    },
    { 
      id: 'qa', 
      name: 'Quality Assurance', 
      short: 'QA & Testing',
      details: 'Manual + Automation Testing',
      active: true 
    },
    { 
      id: 'training', 
      name: 'IT Training', 
      short: 'IT Training',
      details: 'Certifications & Workshops',
      active: true 
    }
  ];
}

/**
 * Initialize database with default services if empty
 */
async function initializeServices() {
  try {
    const content = await Content.findOne();
    
    if (!content || !content.services || content.services.length === 0) {
      const defaultServices = getDefaultServices();
      
      await Content.findOneAndUpdate(
        {},
        { 
          services: defaultServices,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
    }
  } catch (error) {
    console.error('❌ Error initializing services:', error);
  }
}

module.exports = { 
  syncServicesFromSheet, 
  getActiveServices,
  getAllServices,
  initializeServices
};