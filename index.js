const express = require('express');
const admin = require('./src/config/firebase-config');
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


app.use(function (req, res, next) {

  //res.setHeader("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type,, Access-Control-Request-Method, Access-Control-Request-Headers");
  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', true);

  // Pass to next layer of middleware
  next();
});


// Firebase Authentication Middleware
const authenticate = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authorizationHeader.split('Bearer ')[1].trim();
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.userEmail = decodedToken.email;
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

// Endpoint: Get Company by Company ID
app.get('/company', authenticate, async (req, res) => {
  try {
    // Retrieve the company from the database
    const query = 'SELECT * FROM Companies WHERE primary_email = $1';
    const result = await pool.query(query, [req.userEmail]);

    // Check if the company exists
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const company = result.rows[0];
    res.status(200).json(company);
  } catch (error) {
    console.error('Error retrieving company:', error);
    res.status(500).json({ error: 'Failed to retrieve the company' });
  }
});

// Endpoint: Get all Companies
app.get('/companies', authenticate, async (req, res) => {
  try {
    const query = 'SELECT * FROM Companies';
    const result = await pool.query(query);

    const companies = result.rows;
    res.status(200).json(companies)
  }
  catch (error) {
    console.error('Error retrieving companies:', error);
    res.status(500).json({ error: 'Failed to retrieve companies' });
  }
});

// Endpoint: Delete a Company
app.delete('/company/:company_id', authenticate, async (req, res) => {
  try {
    console.log(req.params.company_id);
    // delete
    let delete_status = await pool.query(
      'DELETE FROM  Companies WHERE company_id = $1',
      [req.params.company_id]
    );

    res.status(201).json({ 'delete_status': delete_status });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ error: 'Failed to delete the company' });
  }
});

// Endpoint: Get All Templates of a Company
app.get('/company/templates', authenticate, async (req, res) => {
  try {

    // Retrieve the templates of the company from the database
    const query = 'SELECT * FROM MessageTemplates,Companies WHERE MessageTemplates.company_id = Companies.company_id and Companies.primary_email = $1';
    const result = await pool.query(query, [req.userEmail]);

    const templates = result.rows;
    res.status(200).json(templates);
  } catch (error) {
    console.error('Error retrieving templates:', error);
    res.status(500).json({ error: 'Failed to retrieve templates' });
  }
});

// Endpoint: Create a Company
app.post('/companies', authenticate, async (req, res) => {
  try {
    const { name, description, primaryEmail, primaryPhoneNumber } = req.body;
    const company_id = uuidv4();
    const credits = 100;

    // Save the company details to the database
    await pool.query(
      'INSERT INTO Companies (company_id,company_firebase_id, name, description, primary_email, primary_phone_number,credits) VALUES ($1, $2, $3, $4, $5 , $6, $7)',
      [company_id, req.userId, name, description, primaryEmail, primaryPhoneNumber, credits]
    );

    res.status(201).json({ company_id });
  } catch (error) {
    console.error('Error creating a company:', error);
    res.status(500).json({ error: 'Failed to create the company' });
  }
});

// Endpoint: Buy Credits
app.post('/company/buy-credits', authenticate, async (req, res) => {
  try {
    const { credits } = req.body;

    // Validate input
    if (!Number.isInteger(credits) || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credits value' });
    }

    // Update the credits for the company in the database
    let dbResult=await pool.query(
      'UPDATE Companies SET credits = credits + $1 WHERE primary_email = $2',
      [credits, req.userEmail]
    );

    res.status(200).json({ 'rowsUpdated': dbResult.rowCount });
  } catch (error) {
    console.error('Error buying credits:', error);
    res.status(500).json({ error: 'Failed to buy credits' });
  }
});

// Endpoint: Create Message Template
app.post('/companies/message-templates', authenticate, async (req, res) => {
  try {
    const company_id = '';
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
app.post('/companies/send-message', authenticate, upload.array('attachments'), async (req, res) => {
  try {
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
      'UPDATE Companies SET credits = credits - $1 WHERE primary_email = $2',
      [creditsToDeduct, req.userEmail]
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
