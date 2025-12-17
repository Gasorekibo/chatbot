require('dotenv').config();
const zohoClient = require('./utils/zohoClient');

async function testZoho() {
  try {
    console.log('🔍 Testing Zoho CRM connection...\n');
    
    const contacts = await zohoClient.getAllContacts({ activeOnly: true });
    
    console.log('✅ SUCCESS! Connected to Zoho CRM');
    console.log(`📊 Total Contacts: ${contacts.length}\n`);
    
    if (contacts.length > 0) {
      console.log('📋 First 5 Contacts:');
      contacts.slice(0, 5).forEach((contact, i) => {
        console.log(`\n${i + 1}. ${contact.name}`);
        console.log(`   Phone: ${contact.phone}`);
        console.log(`   Email: ${contact.email || 'N/A'}`);
        console.log(`   Status: ${contact.leadStatus || 'N/A'}`);
      });
    } else {
      console.log('⚠️ No contacts found in your Zoho CRM');
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Check your .env file has all Zoho credentials');
    console.log('2. Verify the credentials are correct');
    console.log('3. Make sure your Zoho account has CRM access');
  }
}

testZoho();