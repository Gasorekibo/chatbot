// test-zoho.js
// Test script to verify Zoho CRM integration

require('dotenv').config();
const {
  fetchZohoContacts,
  searchZohoContactByPhone,
  getZohoContactById,
  fetchAllZohoContacts
} = require('./utils/zohoApi');

async function testZohoIntegration() {
  console.log('🧪 Testing Zoho CRM Integration...\n');
  
  try {
    // Test 1: Fetch contacts
    console.log('📋 Test 1: Fetching first page of contacts...');
    const contacts = await fetchZohoContacts(1, 10);
    console.log(`✅ Success! Retrieved ${contacts.length} contacts`);
    
    if (contacts.length > 0) {
      console.log('\n📇 Sample contact:');
      const sample = contacts[0];
      console.log(`   Name: ${sample.First_Name} ${sample.Last_Name}`);
      console.log(`   Mobile: ${sample.Mobile || 'N/A'}`);
      console.log(`   Email: ${sample.Email || 'N/A'}`);
      console.log(`   ID: ${sample.id}`);
      
      // Test 2: Search by phone (if contact has a phone)
      if (sample.Mobile || sample.Phone) {
        const phoneToSearch = sample.Mobile || sample.Phone;
        console.log(`\n🔍 Test 2: Searching for contact with phone: ${phoneToSearch}`);
        const searchResults = await searchZohoContactByPhone(phoneToSearch);
        console.log(`✅ Success! Found ${searchResults.length} matching contact(s)`);
      }
      
      // Test 3: Get contact by ID
      console.log(`\n🆔 Test 3: Fetching contact by ID: ${sample.id}`);
      const contactById = await getZohoContactById(sample.id);
      console.log(`✅ Success! Retrieved contact: ${contactById.First_Name} ${contactById.Last_Name}`);
    } else {
      console.log('\n⚠️  No contacts found in Zoho CRM. Please add some contacts first.');
    }
    
    // Test 4: Statistics
    console.log('\n📊 Test 4: Generating contact statistics...');
    const allContacts = await fetchAllZohoContacts(3); // Fetch up to 3 pages
    const stats = {
      total: allContacts.length,
      withMobile: allContacts.filter(c => c.Mobile).length,
      withPhone: allContacts.filter(c => c.Phone).length,
      withEmail: allContacts.filter(c => c.Email).length,
      withoutContact: allContacts.filter(c => !c.Mobile && !c.Phone).length
    };
    
    console.log('✅ Statistics:');
    console.log(`   Total contacts: ${stats.total}`);
    console.log(`   With mobile: ${stats.withMobile}`);
    console.log(`   With phone: ${stats.withPhone}`);
    console.log(`   With email: ${stats.withEmail}`);
    console.log(`   Without contact info: ${stats.withoutContact}`);
    console.log(`   Valid for messaging: ${stats.withMobile + stats.withPhone - stats.withoutContact}`);
    
    console.log('\n✨ All tests passed! Zoho CRM integration is working correctly.');
    console.log('\n📝 Next steps:');
    console.log('   1. Start your server: npm start');
    console.log('   2. Test API endpoint: http://localhost:3000/api/zoho/contacts');
    console.log('   3. Integrate with your messaging service in the broadcast endpoint');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\n🔧 Troubleshooting:');
    
    if (error.message.includes('refresh token')) {
      console.error('   → Visit http://localhost:3000/auth/zoho to authorize');
      console.error('   → Copy the refresh token to your .env file');
    } else if (error.message.includes('credentials')) {
      console.error('   → Check ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env');
    } else {
      console.error('   → Check your internet connection');
      console.error('   → Verify Zoho CRM API is accessible');
      console.error('   → Review error details above');
    }
    
    process.exit(1);
  }
}

// Run tests
console.log('='.repeat(60));
console.log('   ZOHO CRM INTEGRATION TEST');
console.log('='.repeat(60));
console.log();

testZohoIntegration();