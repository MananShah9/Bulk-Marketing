const { Pool } = require('pg');
const dbConfig = require('./src/config/dbConfig');
const { MessageMedia } = require('whatsapp-web.js');

const pool = new Pool(dbConfig);


const { Client, RemoteAuth, NoAuth } = require('whatsapp-web.js');
const { AwsS3Store } = require('wwebjs-aws-s3');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const qrcode = require('qrcode-terminal');

const s3 = new S3Client({
    region: 'eu-north-1',
    credentials: {
        accessKeyId: 'AKIARA5Q6ZGJPC66XF67',
        secretAccessKey: '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'
    }
});

const putObjectCommand = PutObjectCommand;
const headObjectCommand = HeadObjectCommand;
const getObjectCommand = GetObjectCommand;
const deleteObjectCommand = DeleteObjectCommand;

const store = new AwsS3Store({
    bucketName: 'whatsappsessionsbucket',
    remoteDataPath: 'test/',
    s3Client: s3,
    putObjectCommand,
    headObjectCommand,
    getObjectCommand,
    deleteObjectCommand
});


//add code to generate only 3 whatsapp qrs, else fail
//add code to set timeout for trying to coonect wo whatsapp 

// Implement these : 'UPDATE Companies SET credits = credits - $1 WHERE primary_email = $2',
// 'INSERT INTO SentMessages (message_id, recipient_id, template_id, source_id) VALUES ($1, $2, $3, $4)',
// 
const whatsappApiService = async (req, res, source_id) => {
    // let sessionData = await store.extract(source_id);
    // let client;
    // if (sessionData) {
    //     client = new Client({
    //         authStrategy: new RemoteAuth({
    //             clientId: source_id,
    //             dataPath: './.wwebjs_auth',
    //             store: store,
    //             backupSyncIntervalMs: 600000
    //         })
    //     });
    //     console.log("Old session");
    // }

    // else {
    //     client = new Client({
    //         authStrategy: new RemoteAuth({
    //             clientId: source_id,
    //             dataPath: './.wwebjs_auth',
    //             store: store,
    //             backupSyncIntervalMs: 600000
    //         })
    //     });
    //     console.log("New session");

    // }
    const client = new Client({
        qrMaxRetries: 1,
        authStrategy: new NoAuth(),
        // proxyAuthentication: { username: 'username', password: 'password' },
        puppeteer: {
            // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
            headless: 'new'
        }
    });
    let qrSent = false;
    client.on('qr', async (qr) => {
        // Generate and scan this code with your phone
        console.log('QR RECEIVED', qr);
        qrcode.generate(qr, { small: true });
        if (!qrSent) {
            qrSent = true;
            return res.send(qr);

        }
        else {
            console.log("Destroying target in else");
            await client.destroy();
        }

        // await store.save({ session: source_id });

    });





    client.on('ready', async () => {

        console.log('Client is ready!', source_id);
        let moreMessagesPresent = true;
        while (moreMessagesPresent) {
            const to_send = await pool.query(
                'SELECT * FROM SentMessages WHERE source_id = $1 and sendstatus = $2 LIMIT 1',
                [source_id, "Queue"]
            );
            if (to_send.rowCount == 0) {
                moreMessagesPresent = false;
                setTimeout(async function () {
                    console.log("Destroying in 0 rows left");

                    await client.logout();
                    await client.destroy();
                }, 10000);
            }
            else {
                const recipient = await pool.query(
                    'SELECT * FROM Recipients WHERE recipient_id = $1 and contact_medium=$2',
                    [to_send.rows[0].recipient_id, "WhatsApp"]
                );
                const template = await pool.query(
                    'SELECT * FROM MessageTemplates WHERE template_id = $1',
                    [to_send.rows[0].template_id]
                );

                let media;
                if (template.rows[0]['attachment_filename'])
                    media = MessageMedia.fromFilePath('./attachments/' + template.rows[0]['attachment_filename']);
                // console.log("_____________");
                // console.log(template.rows[0]);
                // console.log("_____________");
                // console.log(recipient.rows[0]);

                console.log("Sending message");
                let sendWhatsAppMessageStatus = await client.sendMessage('91' + recipient.rows[0]["contact_information"] + '@c.us', template.rows[0]["message_template"],options={media:media});
                // console.log(sendWhatsAppMessageStatus);
                //  Add query to mark que message as done
                // await pool.query(
                //     'UPDATE Companies SET credits = credits - $1 WHERE company_id = $2',
                //     [1, template.rows[0]["company_id"]]
                // );
                await pool.query('UPDATE SentMessages SET sendstatus = $1 WHERE message_id = $2', ["Sent", to_send.rows[0].message_id]);


            }

        }
        // 

        // client.destroy();

    });


    client.initialize();
}

module.exports = whatsappApiService;