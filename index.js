const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

// Initialize Firebase Admin
admin.initializeApp();

// Gmail OAuth2 Configuration
const createTransporter = async () => {
  const oauth2Client = new OAuth2(
    functions.config().gmail.client_id,
    functions.config().gmail.client_secret,
    "https://us-central1-kary-wagner-agent.firebaseapp.com/oauth2callback"
  );

  oauth2Client.setCredentials({
    refresh_token: functions.config().gmail.refresh_token
  });

  const accessToken = await new Promise((resolve, reject) => {
    oauth2Client.getAccessToken((err, token) => {
      if (err) {
        reject('Failed to create access token');
      }
      resolve(token);
    });
  });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: functions.config().gmail.user,
      clientId: functions.config().gmail.client_id,
      clientSecret: functions.config().gmail.client_secret,
      refreshToken: functions.config().gmail.refresh_token,
      accessToken: accessToken
    }
  });

  return transporter;
};

// Function to make HTTPS request to ChatGPT API
function callChatGPTAPI(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = functions.config().chatgpt.apikey;
    //ad1
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response.choices[0].message.content);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(JSON.stringify({
      model: "deepseek-chat",
      messages: messages,
      "stream": false
    }));

    req.end();
  });
}

// OAuth2 Callback Handler
exports.oauth2callback = functions.https.onRequest(async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('No code provided');
  }
  //ad1

  try {
    const oauth2Client = new OAuth2(
      functions.config().gmail.client_id,
      functions.config().gmail.client_secret,
      req.protocol + '://' + req.get('host') + req.path
    );

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens to Firebase config
    await functions.config().set('gmail', {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token
    });

    res.send('Authentication successful! You can now use Gmail API.');
  } catch (error) {
    console.error('OAuth2 Callback Error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Gmail Webhook for Handling Incoming Emails
exports.gmailWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Verify the incoming webhook (implement proper authentication)
    const { email, subject, body, sender } = req.body;

    // Check if sender is already a client
    //ad1
    const clientSnapshot = await admin.firestore()
      .collection('clients')
      .where('email', '==', sender)
      .get();

    let clientRef;
    if (clientSnapshot.empty) {
      // Create new client if not exists
      clientRef = admin.firestore().collection('clients').doc(sender);
      await clientRef.set({
        email: sender,
        name: extractNameFromEmail(sender),
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Use existing client
      clientRef = clientSnapshot.docs[0].ref;
    }

    // Create conversation thread
    const conversationRef = clientRef.collection('conversations').doc();
    await conversationRef.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'open',
      initialSubject: subject
    });

    // Save incoming message
    await conversationRef.collection('messages').add({
      sender: 'client',
      message: body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'email'
    });

    // Retrieve agent configuration
    const agentConfigDoc = await admin.firestore()
      .collection('agent-config')
      .doc('company-details')
      .get();
    const agentConfig = agentConfigDoc.data();

    // Prepare system prompt for AI
    const systemPrompt = {
      role: 'system',
      content: `
        You are Kary Wagner, a professional sales agent for ${agentConfig.companyName}. 
        Your mission is to convert potential clients by showcasing our digital marketing services.
        
        Personal Attributes:
        - Name: Kary Wagner
        - Role: Senior Sales Consultant
        - Communication Style: Professional, empathetic, solution-oriented

        Services We Offer:
        ${agentConfig.services.join(', ')}

        Product Catalog:
        ${JSON.stringify(agentConfig.productCatalog)}

        Key Objectives:
        1. Understand the client's needs
        2. Demonstrate value of our services
        3. Guide towards a consultation or sale
        4. Maintain a warm, consultative approach
      `
    };

    // Generate AI response
    const apiMessages = [
      systemPrompt,
      { role: 'user', content: body }
    ];

    const responseText = await callChatGPTAPI(apiMessages);

    // Create transporter
    const transporter = await createTransporter();

    // Send email response
    await transporter.sendMail({
      from: functions.config().gmail.user,
      to: sender,
      subject: `Re: ${subject}`,
      text: responseText
    });

    // Save agent's response
    await conversationRef.collection('messages').add({
      sender: 'agent',
      message: responseText,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'email'
    });

    res.status(200).send('Email processed successfully');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Error processing email');
  }
});

// Utility function to extract name from email
function extractNameFromEmail(email) {
  const username = email.split('@')[0];
  return username.split('.').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Initial outreach function
exports.sendInitialOutreachEmail = functions.firestore
  .document('clients/{clientId}')
  .onCreate(async (snapshot, context) => {
    const clientData = snapshot.data();
    //ad1
    
    // Create transporter
    const transporter = await createTransporter();

    // Retrieve agent configuration
    const agentConfigDoc = await admin.firestore()
      .collection('agent-config')
      .doc('company-details')
      .get();
    const agentConfig = agentConfigDoc.data();

    await transporter.sendMail({
      from: functions.config().gmail.user,
      to: clientData.email,
      subject: 'Boost Your Digital Marketing - Exclusive Offer!',
      text: `
        Hi ${clientData.name},

        I hope this email finds you well. I'm Kary Wagner from ${agentConfig.companyName}. 
        We specialize in transforming businesses through cutting-edge digital marketing strategies.

        Would you be interested in a free consultation to explore how we can elevate your online presence?

        Best regards,
        Kary Wagner
        ${agentConfig.companyName}
      `
    });
  });