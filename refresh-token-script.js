const { google } = require('googleapis');
const readline = require('readline');

// OAuth2 Configuration
const CREDENTIALS = {
  clientId: '457481193145-hai6qb666joea048jav1nakneenvcvt7.apps.googleusercontent.com',
  clientSecret: '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',
  redirectUri: 'http://localhost:8005/oauth2callback'
};

// Create OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  CREDENTIALS.clientId,
  CREDENTIALS.clientSecret,
  CREDENTIALS.redirectUri
);

// Scopes for Gmail API
const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
];

// Generate Authorization URL
function generateAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',  // This is crucial for getting a refresh token
    scope: SCOPES,
    prompt: 'consent'  // Forces showing consent screen each time
  });
}

// Interactive Token Exchange
async function exchangeCodeForTokens() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Step 1: Generate and display authorization URL
  const authUrl = generateAuthUrl();
  console.log('Please follow these steps:');
  console.log('1. Open this URL in your browser:');
  console.log(authUrl);
  console.log('\n2. After authorizing, you will be redirected to a page with a code');
  console.log('3. Copy the code from the redirect URL');

  // Step 2: Prompt for authorization code
  const code = await new Promise((resolve) => {
    rl.question('\nEnter the authorization code: ', (inputCode) => {
      resolve(inputCode.trim());
    });
  });

  try {
    // Step 3: Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('\n--- Token Information ---');
    console.log('Access Token:', tokens.access_token);
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('Expiry Date:', new Date(tokens.expiry_date));

    // Close readline interface
    rl.close();

    return tokens;
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    rl.close();
    process.exit(1);
  }
}

// Main execution
exchangeCodeForTokens()
  .then((tokens) => {
    console.log('\nTo set Firebase config, run:');
    console.log(`firebase functions:config:set \
gmail.client_id="${CREDENTIALS.clientId}" \
gmail.client_secret="${CREDENTIALS.clientSecret}" \
gmail.refresh_token="${tokens.refresh_token}"`);
  })
  .catch(console.error);


firebase functions:config:set gmail.client_id="457481193145-hai6qb666joea048jav1nakneenvcvt7.apps.googleusercontent.com" gmail.client_secret="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" gmail.refresh_token="1//0gfSAHsJUNypnCgYIARAAGBASNwF-L9Ir7kMhA0DEMblJVLF_fbjwlohliG9GiUhWYE3V0M3NnBgEYBuMtNZJ8zwztfkbj99HZjA"