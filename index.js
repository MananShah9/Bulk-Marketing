const express = require('express');
const admin =  require('./src/config/firebase-config');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const helmet = require('helmet');
const { Pool } = require('pg');
const dbConfig = require('./src/config/dbConfig');


// Initialize Express.js
const app = express();
app.use(express.json());
app.use(helmet());

// Firebase Authentication Middleware
const authenticate = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authorizationHeader.split('Bearer ')[1].trim();
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Multer Configuration for File Uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'attachments/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const attachmentPath = `attachments/${uniqueSuffix}${path.extname(file.originalname)}`;
    cb(null, attachmentPath);
  }
});
const upload = multer({ storage });

const pool = new Pool(dbConfig);

// Endpoint: Create a Company
app.post('/companies', authenticate, async (req, res) => {
  try {
    const { name, description, primaryEmail, primaryPhoneNumber } = req.body;
    const company_id = uuidv4();
    const credits = 100;

    // Save the company details to the database
    await pool.query(
      'INSERT INTO Companies (company_id,company_firebase_id, name, description, primary_email, primary_phone_number,credits) VALUES ($1, $2, $3, $4, $5 , $6, $7)',
      [company_id, req.userId, name, description, primaryEmail, primaryPhoneNumber,credits]
    );

    res.status(201).json({ company_id });
  } catch (error) {
    console.error('Error creating a company:', error);
    res.status(500).json({ error: 'Failed to create the company' });
  }
});

// Endpoint: Buy Credits
app.post('/companies/:company_id/buy-credits', authenticate, async (req, res) => {
  try {
    const { company_id } = req.params;
    const { credits } = req.body;

    // Validate input
    if (!Number.isInteger(credits) || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credits value' });
    }

    // Update the credits for the company in the database
    await pool.query(
      'UPDATE Companies SET credits = credits + $1 WHERE company_id = $2',
      [credits, company_id]
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error buying credits:', error);
    res.status(500).json({ error: 'Failed to buy credits' });
  }
});

// Endpoint: Create Message Template
app.post('/companies/:company_id/message-templates', authenticate, async (req, res) => {
  try {
    const { company_id } = req.params;
    const { template_name, message_template } = req.body;

    // Validate input
    if (!template_name || !message_template) {
      return res.status(400).json({ error: 'Missing template name or message template' });
    }

    // Save the message template details to the database
    const template_id = uuidv4();
    await pool.query(
      'INSERT INTO MessageTemplates (template_id, company_id, template_name, message_template) VALUES ($1, $2, $3, $4)',
      [template_id, company_id, template_name, message_template]
    );

    res.status(201).json({ template_id });
  } catch (error) {
    console.error('Error creating a message template:', error);
    res.status(500).json({ error: 'Failed to create the message template' });
  }
});

// Endpoint: Send Message
app.post('/companies/:company_id/send-message', authenticate, upload.array('attachments'), async (req, res) => {
  try {
    const { company_id } = req.params;
    const { recipient_ids, template_id, source_id } = req.body;
    const attachments = req.files;

    // Validate input
    if (!Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ error: 'Invalid recipient IDs' });
    }
    if (!template_id || !source_id) {
      return res.status(400).json({ error: 'Missing template ID or source ID' });
    }

    // Deduct credits from the company for each recipient
    const recipientCount = recipient_ids.length;
    const creditsToDeduct = recipientCount;
    await pool.query(
      'UPDATE Companies SET credits = credits - $1 WHERE company_id = $2',
      [creditsToDeduct, company_id]
    );

    // Save the sent message details to the database
    const sentMessagePromises = recipient_ids.map(async (recipient_id) => {
      const message_id = uuidv4();
      await pool.query(
        'INSERT INTO SentMessages (message_id, recipient_id, template_id, source_id) VALUES ($1, $2, $3, $4)',
        [message_id, recipient_id, template_id, source_id]
      );
    });
    await Promise.all(sentMessagePromises);

    // Handle file attachments
    const attachmentPaths = [];
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const attachmentPath = attachment.path;
        attachmentPaths.push(attachmentPath);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error sending a message:', error);
    res.status(500).json({ error: 'Failed to send the message' });
  }
});

// Start the server
app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
