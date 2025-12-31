// const dotenv = require('dotenv');
// dotenv.config();


// class ZohoClient {
//   constructor() {
//     this.clientId = process.env.ZOHO_CLIENT_ID;
//     this.clientSecret = process.env.ZOHO_CLIENT_SECRET;
//     this.refreshToken = process.env.ZOHO_REFRESH_TOKEN;
//     this.apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
//     this.accessToken = null;
//     this.tokenExpiry = null;
//   }


//   async getAccessToken() {
//     if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
//       return this.accessToken;
//     }
//     try {
//       const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded',
//         },
//         body: new URLSearchParams({
//           refresh_token: this.refreshToken,
//           client_id: this.clientId,
//           client_secret: this.clientSecret,
//           grant_type: 'refresh_token',
//         }),
//       });

//       if (!response.ok) {
//         const error = await response.text();
//         throw new Error(`Failed to refresh Zoho token: ${error}`);
//       }

//       const data = await response.json();
//       this.accessToken = data.access_token;
//       this.tokenExpiry = Date.now() + 55 * 60 * 1000;

//       console.log('✅ Zoho access token refreshed');
//       return this.accessToken;
//     } catch (error) {
//       console.error('❌ Zoho token refresh failed:', error);
//       throw error;
//     }
//   }

//   /**
//    * Fetch all contacts from Zoho CRM
//    * @param {Object} options - Filter options
//    * @param {boolean} options.activeOnly - Only fetch active contacts
//    * @param {string} options.phoneField - Name of the phone field in Zoho (default: 'Phone')
//    * @returns {Array} Array of contact objects with name and phone
//    */
//   async getAllContacts(options = {}) {
//     const { activeOnly = true, phoneField = 'Phone' } = options;

//     try {
//       const token = await this.getAccessToken();
//       let allContacts = [];
//       let page = 1;
//       let hasMore = true;
//       const perPage = 200; 

//       while (hasMore) {
//         const url = `${this.apiDomain}/crm/v5/Contacts?page=${page}&per_page=${perPage}`;
        
//         const response = await fetch(url, {
//           method: 'GET',
//           headers: {
//             'Authorization': `Zoho-oauthtoken ${token}`,
//             'Content-Type': 'application/json',
//           },
//         });

//         if (!response.ok) {
//           const error = await response.text();
//           throw new Error(`Zoho API error: ${error}`);
//         }

//         const data = await response.json();
        
//         if (data.data && data.data.length > 0) {
//           // Process contacts
//           const contacts = data.data
//             .filter(contact => {
//               // Filter out contacts without phone numbers
//               const phone = this.extractPhone(contact, phoneField);
//               if (!phone) return false;

//               // Filter by active status if requested
//               if (activeOnly && contact.Lead_Status === 'Dead Lead') {
//                 return false;
//               }

//               return true;
//             })
//             .map(contact => ({
//               id: contact.id,
//               name: contact.Full_Name || contact.First_Name || 'Unknown',
//               phone: this.extractPhone(contact, phoneField),
//               email: contact.Email || null,
//               company: contact.Account_Name?.name || null,
//               leadStatus: contact.Lead_Status || null,
//               tags: contact.Tag || [],
//               createdTime: contact.Created_Time,
//             }));

//           allContacts = allContacts.concat(contacts);

//           // Check if there are more pages
//           hasMore = data.info.more_records;
//           page++;
//         } else {
//           hasMore = false;
//         }
//       }

//       console.log(`✅ Retrieved ${allContacts.length} contacts from Zoho CRM`);
//       return allContacts;

//     } catch (error) {
//       console.error('❌ Failed to fetch Zoho contacts:', error);
//       throw error;
//     }
//   }

//   /**
//    * Extract and format phone number from contact
//    */
//   extractPhone(contact, phoneField) {
//     let phone = contact[phoneField] || contact.Mobile || contact.Phone;
    
//     if (!phone) return null;

//     // Clean and format phone number
//     phone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');

//     // Ensure it starts with country code
//     if (!phone.startsWith('+')) {
//       // Assume Rwanda if no country code (+250)
//       if (phone.startsWith('250')) {
//         phone = '+' + phone;
//       } else if (phone.startsWith('0')) {
//         phone = '+250' + phone.substring(1);
//       } else {
//         phone = '+250' + phone;
//       }
//     }

//     return phone;
//   }

//   /**
//    * Get contacts filtered by specific criteria
//    * @param {Object} filters - ZOHO COQL query filters
//    * @returns {Array} Filtered contacts
//    */
//   async getFilteredContacts(filters = {}) {
//     try {
//       const token = await this.getAccessToken();
      
//       // Build COQL query
//       let query = 'SELECT Full_Name, Phone, Mobile, Email, Account_Name, Lead_Status FROM Contacts';
      
//       const conditions = [];
//       if (filters.leadStatus) {
//         conditions.push(`Lead_Status = '${filters.leadStatus}'`);
//       }
//       if (filters.tag) {
//         conditions.push(`Tag = '${filters.tag}'`);
//       }
//       if (filters.createdAfter) {
//         conditions.push(`Created_Time > '${filters.createdAfter}'`);
//       }

//       if (conditions.length > 0) {
//         query += ' WHERE ' + conditions.join(' AND ');
//       }

//       const response = await fetch(`${this.apiDomain}/crm/v5/coql`, {
//         method: 'POST',
//         headers: {
//           'Authorization': `Zoho-oauthtoken ${token}`,
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({ select_query: query }),
//       });

//       if (!response.ok) {
//         const error = await response.text();
//         throw new Error(`Zoho COQL error: ${error}`);
//       }

//       const data = await response.json();
      
//       if (data.data) {
//         return data.data.map(contact => ({
//           id: contact.id,
//           name: contact.Full_Name || contact.First_Name || 'Unknown',
//           phone: this.extractPhone(contact),
//           email: contact.Email || null,
//           company: contact.Account_Name || null,
//           leadStatus: contact.Lead_Status || null,
//         }));
//       }

//       return [];
//     } catch (error) {
//       console.error('❌ Failed to fetch filtered contacts:', error);
//       throw error;
//     }
//   }

//   /**
//    * Update contact's last message sent timestamp
//    */
//   async updateContactField(contactId, fieldName, value) {
//     try {
//       const token = await this.getAccessToken();
      
//       const response = await fetch(`${this.apiDomain}/crm/v5/Contacts/${contactId}`, {
//         method: 'PUT',
//         headers: {
//           'Authorization': `Zoho-oauthtoken ${token}`,
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           data: [{
//             id: contactId,
//             [fieldName]: value,
//           }],
//         }),
//       });

//       if (!response.ok) {
//         const error = await response.text();
//         console.error(`Failed to update contact ${contactId}:`, error);
//         return false;
//       }

//       return true;
//     } catch (error) {
//       console.error('❌ Failed to update contact:', error);
//       return false;
//     }
//   }
// }

// // Export singleton instance
// module.exports = new ZohoClient();