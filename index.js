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


app.put('/users/update-name', authenticate, async (req, res) => {
  const { name } = req.body;
  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);
    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update the user's name in the Users table
    await pool.query('UPDATE Users SET name = $1 WHERE user_id = $2', [name, user.user_id]);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error updating user name:', error);
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

    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create a new company with the provided details and the user as the admin
      const newCompany = await client.query(
        'INSERT INTO Companies (name, description, admin) VALUES ($1, $2, $3) RETURNING *',
        [name, description, adminId]
      );

      // Insert the admin user into the CompanyUsers table
      await client.query(
        'INSERT INTO CompanyUsers (company_id, user_id) VALUES ($1, $2)',
        [newCompany.rows[0].company_id, adminId]
      );

      // Commit the transaction
      await client.query('COMMIT');

      res.status(200).json(newCompany.rows[0]);
    } catch (error) {
      // If any error occurs, rollback the transaction
      await client.query('ROLLBACK');
      console.error('Error creating company:', error);
      res.status(500).json({ error: 'An error occurred' });
    } finally {
      // Release the client back to the pool
      client.release();
    }
  } catch (error) {
    console.error('Error fetching user:', error);
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


app.put('/companies/:companyId/update', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const { name, description } = req.body;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);
    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the user is the admin of the specified company
    const isAdmin = await pool.query(
      'SELECT * FROM Companies WHERE company_id = $1 AND admin = $2',
      [companyId, user.user_id]
    );

    if (isAdmin.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update the company's name and description in the Companies table
    await pool.query(
      'UPDATE Companies SET name = $1, description = $2 WHERE company_id = $3',
      [name, description, companyId]
    );

    res.sendStatus(200);
  } catch (error) {
    console.error('Error updating company name and description:', error);
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
    const companies = await pool.query(
      `SELECT * FROM Companies
       JOIN CompanyUsers ON Companies.company_id = CompanyUsers.company_id
       WHERE CompanyUsers.user_id = $1`,
      [userId]
    );

    res.status(200).json(companies.rows);
  } catch (error) {
    console.error('Error retrieving user companies:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.get('/companies/:companyId/users', authenticate, async (req, res) => {
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


    // Retrieve the companies associated with the specified user
    const companies = await pool.query(
      `SELECT * FROM Users
       JOIN CompanyUsers ON Users.user_id = CompanyUsers.user_id
       WHERE CompanyUsers.company_id = $1`,
      [companyId]
    );

    res.status(200).json(companies.rows);
  } catch (error) {
    console.error('Error retrieving user companies:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.delete('/companies/:companyId/users/:userId', authenticate, async (req, res) => {
  const { companyId, userId } = req.params;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);
    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the user is the admin of the specified company
    const isAdmin = await pool.query(
      'SELECT * FROM Companies WHERE company_id = $1 AND admin = $2',
      [companyId, user.user_id]
    );

    if (isAdmin.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Remove the user from the CompanyUsers table for the specified company
    await pool.query('DELETE FROM CompanyUsers WHERE company_id = $1 AND user_id = $2', [companyId, userId]);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error removing user from company:', error);
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


app.delete('/recipients', authenticate, async (req, res) => {
  const { recipientIds } = req.body;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);
    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch the company IDs associated with the given recipient IDs
    const recipientCompanyIds = await pool.query(
      'SELECT DISTINCT company_id FROM Recipients WHERE recipient_id = ANY($1)',
      [recipientIds]
    );

    if (recipientCompanyIds.rowCount === 0) {
      return res.status(404).json({ error: 'Recipients not found' });
    }

    const userCompanyIds = await pool.query(
      'SELECT company_id FROM CompanyUsers WHERE user_id = $1',
      [user.user_id]
    );

    // Check if the user is part of the company for each recipient
    for (const row of recipientCompanyIds.rows) {
      if (!userCompanyIds.rows.some((userCompany) => userCompany.company_id === row.company_id)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    // Delete the recipients from the Recipients table for the specified recipient IDs
    await pool.query('DELETE FROM Recipients WHERE recipient_id = ANY($1)', [recipientIds]);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error deleting recipients:', error);
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
app.post('/companies/:companyId/message-templates', authenticate,
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


app.delete('/message-templates/:templateId', authenticate, async (req, res) => {
  const { templateId } = req.params;

  try {
    const user = await getUserByEmailOrPhone(req.userEmail, req.phone_number);
    if (user === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the message template with the given ID exists and get its company ID
    const templateInfo = await pool.query(
      'SELECT * FROM MessageTemplates WHERE template_id = $1',
      [templateId]
    );

    if (templateInfo.rowCount === 0) {
      return res.status(404).json({ error: 'Message template not found' });
    }

    const companyId = templateInfo.rows[0].company_id;

    // Check if the user is part of the company associated with the message template
    const userCompany = await pool.query(
      'SELECT * FROM CompanyUsers WHERE company_id = $1 AND user_id = $2',
      [companyId, user.user_id]
    );

    if (userCompany.rowCount === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Delete the message template from the MessageTemplates table
    await pool.query('DELETE FROM MessageTemplates WHERE template_id = $1', [templateId]);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error deleting message template:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});




app.post('/companies/:companyId/message-sources', authenticate, async (req, res) => {
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




const csvtojson = require('csvtojson');
app.post('/process-file', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileFormat = req.file.originalname.split('.').pop().toLowerCase();
  if (fileFormat !== 'csv' && fileFormat !== 'xls' && fileFormat !== 'xlsx') {
    return res.status(400).json({ error: 'Invalid file format. Only CSV or Excel files are accepted.' });
  }

  csvtojson({ checkType: true })
    .fromFile(req.file.path)
    .then((jsonObj) => {
      console.log(jsonObj);
      if (jsonObj.length === 0) {
        return res.status(400).json({ error: 'Empty file' });
      }

      const columnNames = {
        name: null,
        mobileNumber: null,
      };

      // Function to sanitize the mobile number
      const sanitizeMobileNumber = (mobileNumber) => {
        // Remove any non-digit characters
        const sanitized = (mobileNumber + '').replace(/\D/g, '');

        // Check if the number starts with 91 or +91 and remove it
        if (sanitized.startsWith('91') && !sanitized.endsWith('00000')) {
          return sanitized.substring(2);
        } else if (sanitized.startsWith('0')) {
          return sanitized.substring(1);
        }

        return sanitized;
      };

      // Function to validate if the mobile number is valid Indian number
      const isValidMobileNumber = (mobileNumber) => /^[0-9]{10}$/.test(mobileNumber) && !/e/i.test(mobileNumber);

      // Search for headers containing names and mobile numbers
      for (const row of jsonObj) {
        for (const [key, value] of Object.entries(row)) {
          if (columnNames.name === null && typeof value === 'string' && value.trim() !== '' && !isValidMobileNumber(value)) {
            columnNames.name = key;
          } else if (columnNames.mobileNumber === null && isValidMobileNumber(sanitizeMobileNumber(value))) {
            columnNames.mobileNumber = key;
          }
        }

        if (columnNames.name && columnNames.mobileNumber) {
          // If both columns are found, break the loop
          break;
        }
      }

      if (!columnNames.name || !columnNames.mobileNumber) {
        return res
          .status(400)
          .json({ error: 'Could not find the name and/or mobile number columns in the file' });
      }

      // Extract the required data and construct the response
      const result = jsonObj.map((row) => {
        const name = row[columnNames.name]
        const mobileNumber = sanitizeMobileNumber(row[columnNames.mobileNumber])
        if (mobileNumber != null && mobileNumber != "" && mobileNumber.length < 11 && name.length < 20)
          return ({
            "name": name,
            "mobileNumber": mobileNumber,
          })
      }).filter((element) => (element != null));

      return res.status(200).json(result);
    })
    .catch((err) => {
      console.error(err);
      return res.status(500).json({ error: 'Error processing the file' });
    });
});




// Start the server
app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
