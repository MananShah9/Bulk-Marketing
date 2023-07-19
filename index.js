const express = require('express');
const admin = require('./src/config/firebase-config');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const { Pool } = require('pg');
const dbConfig = require('./src/config/dbConfig');

const pool = new Pool(dbConfig);

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
    req.phone_number = decodedToken.phone_number || '';
    req.userEmail = decodedToken.email || '';
    // req.userId = decodedToken.uid;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};



let getUserByEmailOrPhone = async (email, phone_number) => {
  const user = await pool.query(
    'SELECT * FROM Users WHERE ((email = $1 AND email != $3 ) OR (phone_number = $2 AND phone_number != $3)) ',
    [email, phone_number, '']
  );

  if (user.rowCount === 0) {
    return null;
  }

  return (user.rows[0]);

}



app.post('/users/signup', authenticate, async (req, res) => {
  const { name } = req.body;

  try {
    // Check if the user already exists in the database based on email or phone number
    const existingUser = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (existingUser != null) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Insert the new user into the database
    const newUser = await pool.query(
      'INSERT INTO Users ( name, email, phone_number) VALUES ($1, $2, $3) RETURNING *',
      [name, req.userEmail, req.phone_number]
    );

    res.status(200).json(newUser.rows[0]);
  } catch (error) {
    console.error('Error signing up user:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});


app.post('/users/signin', authenticate, async (req, res) => {

  try {

    // Check if the user exists in the database based on email or phone number
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).send(user);
  } catch (error) {
    console.error('Error signing in user:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/companies', authenticate, async (req, res) => {
  const { name, description } = req.body;

  try {

    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    const adminId = user.user_id;

    // Create a new company with the provided details and the user as the admin
    const newCompany = await pool.query(
      'INSERT INTO Companies (name, description, admin) VALUES ($1, $2, $3) RETURNING *',
      [name, description, adminId]
    );

    res.status(200).json(newCompany.rows[0]);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/companies/:companyId/users', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const { userId } = req.body;

  try {

    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    const adminId = user.user_id;

    // Check if the user is the admin of the company
    const isAdmin = await pool.query(
      'SELECT * FROM Companies WHERE company_id = $1 AND admin = $2',
      [companyId, adminId]
    );

    if (isAdmin.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Add the user to the specified company
    await pool.query(
      'INSERT INTO CompanyUsers (company_id, user_id) VALUES ($1, $2)',
      [companyId, userId]
    );

    res.sendStatus(200);
  } catch (error) {
    console.error('Error adding user to company:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.get('/users/companies', authenticate, async (req, res) => {

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user.user_id;


    // Retrieve the companies associated with the specified user
    console.log(userId);
    const companies = await pool.query(
      `SELECT * FROM Companies
       JOIN CompanyUsers ON Companies.company_id = CompanyUsers.company_id
       JOIN Users ON Users.user_id = CompanyUsers.user_id
       WHERE Users.user_id = $1`,
      [userId]
    );

    res.status(200).json(companies.rows);
  } catch (error) {
    console.error('Error retrieving user companies:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.get('/users/search', authenticate, async (req, res) => {
  const { prefix } = req.query;

  try {
    // Retrieve users with email or phone number starting with the specified prefix
    const users = await pool.query(
      'SELECT * FROM Users WHERE email LIKE $1 OR phone_number LIKE $1',
      [`${prefix}%`]
    );

    res.status(200).json(users.rows);
  } catch (error) {
    console.error('Error retrieving users:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/companies/:companyId/credits', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const { credits } = req.body;

  try {

    // Update the credits for the specified company
    await pool.query(
      'UPDATE Companies SET credits = credits + $1 WHERE company_id = $2',
      [credits, companyId]
    );

    res.sendStatus(200);
  } catch (error) {
    console.error('Error buying credits:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/companies/:companyId/recipients', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const recipients = req.body; // Array of recipient objects

  try {


    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number)

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user.user_id;

    // Check if the user making the request belongs to the specified company
    const userCompany = await pool.query(
      'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
      [companyId, userId]
    );

    if (userCompany.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const newRecipients = [];

    // Iterate over the recipients array and add each recipient to the company
    for (const recipient of recipients) {
      const { name, contactMedium, contactInformation } = recipient;

      // Add a new recipient to the specified company
      const newRecipient = await pool.query(
        'INSERT INTO Recipients (company_id, name, contact_medium, contact_information) VALUES ($1, $2, $3, $4) RETURNING *',
        [companyId, name, contactMedium, contactInformation]
      );

      newRecipients.push(newRecipient.rows[0]);
    }

    res.status(200).json(newRecipients);
  } catch (error) {
    console.error('Error adding recipients:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});


app.get('/companies/:companyId/recipients', authenticate, async (req, res) => {
  const { companyId } = req.params;

  try {

    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user.user_id;
    // Check if the user making the request belongs to the specified company
    const userCompany = await pool.query(
      'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
      [companyId, userId]
    );

    if (userCompany.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Retrieve recipients for the specified company
    const recipients = await pool.query(
      'SELECT * FROM Recipients WHERE company_id = $1',
      [companyId]
    );

    res.status(200).json(recipients.rows);
  } catch (error) {
    console.error('Error retrieving recipients:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

const multer = require('multer');
const path = require('path');

// Set up the storage for file uploads
const storage = multer.diskStorage({
  destination: './attachments',
  filename: (req, file, cb) => {
    const filename = `${Date.now()}-${file.originalname}`;
    cb(null, filename);
  },
});

// Initialize multer
const upload = multer({ storage });

// Endpoint for creating message templates
app.post(
  '/companies/:companyId/message-templates', authenticate,
  upload.single('attachment'),
  async (req, res) => {
    const { companyId } = req.params;
    const { templateName, messageTemplate } = req.body;
    const attachmentFilename = req.file ? req.file.filename : null;

    try {
      const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

      if (user === null) {
        return res.status(404).json({ error: 'User not found' });
      }
      const userId = user.user_id;
      // Check if the user making the request belongs to the specified company
      const userCompany = await pool.query(
        'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
        [companyId, userId]
      );

      if (userCompany.rowCount === 0) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Create a new message template for the specified company
      const newTemplate = await pool.query(
        'INSERT INTO MessageTemplates (company_id, template_name, message_template, attachment_filename) VALUES ($1, $2, $3, $4) RETURNING *',
        [companyId, templateName, messageTemplate, attachmentFilename]
      );

      res.status(200).json(newTemplate.rows[0]);
    } catch (error) {
      console.error('Error creating message template:', error);
      res.status(500).json({ error: 'An error occurred' });
    }
  }
);


app.get('/companies/:companyId/message-templates', authenticate, async (req, res) => {
  const { companyId } = req.params;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user.user_id;
    // Check if the user making the request belongs to the specified company
    const userCompany = await pool.query(
      'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
      [companyId, userId]
    );

    if (userCompany.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }


    // Retrieve message templates for the specified company
    const templates = await pool.query(
      'SELECT * FROM MessageTemplates WHERE company_id = $1',
      [companyId]
    );

    res.status(200).json(templates.rows);
  } catch (error) {
    console.error('Error retrieving message templates:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/companies/:companyId/message-sources',authenticate, async (req, res) => {
  const { companyId } = req.params;
  const { type, value } = req.body;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);

    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user.user_id;
    // Check if the user making the request belongs to the specified company
    const userCompany = await pool.query(
      'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
      [companyId, userId]
    );

    if (userCompany.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Create a new MessageSource for the specified company
    const newMessageSource = await pool.query(
      'INSERT INTO MessageSources (company_id, type, value) VALUES ($1, $2, $3) RETURNING *',
      [companyId, type, value]
    );

    res.status(200).json(newMessageSource.rows[0]);
  } catch (error) {
    console.error('Error creating MessageSource:', error);
    res.status(500).json({ error: 'An error occurred' });
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
