const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const moment = require('moment-timezone');
const { MongoClient, ServerApiVersion } = require('mongodb');
dotenv.config();

// Load OAuth2 credentials from your .env file
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const app = express();
const port = 5000;
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("appointmentsDB"); // Change database name as needed
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
        process.exit(1);
    }
}
connectDB();

// Allow requests from the frontend
app.use(cors({
    origin: 'https://aakarclinic-appointment.netlify.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL, // Your Gmail email
        pass: process.env.PASSWORD, // Your Gmail password or App Password
    },
});


// Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

// Google Calendar API client
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Endpoint to handle booking submission
// Endpoint to handle booking submission
app.post('/book-appointment', async (req, res) => {
    console.log(req.body);
    const { selectedDate, selectedTime, selectedEmail, selectedName } = req.body;
    console.log(selectedDate)
    console.log(selectedTime)


    try {

        const appointmentsCollection = db.collection("appointments");

        // Check if the slot is already booked
        const existingAppointment = await appointmentsCollection.findOne({ date: selectedDate, time: selectedTime });
        if (existingAppointment) {
            return res.json({ success: false, message: "Slot already booked" });
        }
        
        const startDateTimeIST = moment.tz(selectedDate, 'Asia/Kolkata')
            .startOf('day') // Start at midnight of the selected date
            .add(moment(selectedTime, ["h:mm A"]).hours(), 'hours') // Add hours from selectedTime
            .add(moment(selectedTime, ["h:mm A"]).minutes(), 'minutes'); // Add minutes from selectedTime

        // Calculate end time based on the meeting duration
        const endDateTimeIST = moment(startDateTimeIST).add(15, 'minutes');
        // Add event to Google Calendar (Sender's and Receiver's Calendar)
        console.log(startDateTimeIST, endDateTimeIST)
        const event = {
            summary: 'Appointment',
            location: 'Google Meet',
            description: 'Scheduled meeting',
            start: {
                dateTime: startDateTimeIST.toISOString(), // Correct datetime format
                timeZone: 'America/Los_Angeles',
            },
            end: {
                dateTime: endDateTimeIST.toISOString(), // Correct datetime format
                timeZone: 'America/Los_Angeles',
            },
            attendees: [
                { email: selectedEmail }, // Receiver
                { email: process.env.EMAIL }, // Sender (for example, your email)
            ],
            conferenceData: {
                createRequest: {
                    requestId: 'sample123',
                    conferenceSolutionKey: {
                        type: 'hangoutsMeet',
                    },
                    status: {
                        statusCode: 'success',
                    },
                },
            },
        };

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        // const response = await calendar.events.insert({
        //     calendarId: 'primary',
        //     resource: event,
        //     conferenceDataVersion: 1,
        // });
        

        // const meetingLink = response.data.hangoutLink; // Extract Google Meet link
        // console.log(meetingLink)
        // Create email content
        // const emailContent = `
        //     <h1>Appointment Confirmation</h1>
        //     <p>Dear ${selectedName},</p>
        //     <p>Your appointment has been scheduled for ${selectedDate.slice(0, 10)} at ${selectedTime}.</p>
        //     <p>Join the meeting using this <a href=${meetingLink}>Google Meet Link</a>.</p>
        //     <p>Thank you for booking with us!</p>
        //     `;

        // const mailOptions = {
        //     from: "autismdrmumbai@gmail.com",
        //     to: selectedEmail,
        //     subject: `Aakar Clinic - Appointment`,
        //     text: "Sending you Appointment Details",
        //     html: emailContent,
        //     headers: { 'x-myheader': 'test header' },
        // };
        // Send email
        // const info = await transporter.sendMail(mailOptions);
        // console.log('Appointment Details sent: ' + info.response);


        // Insert new appointment
        await appointmentsCollection.insertOne({
            name: selectedName,
            email: selectedEmail,
            date: selectedDate,
            time: selectedTime,
        });
        // Respond to the client with success message
        res.status(200).json({ message: 'Appointment booked successfully' });
    } catch (error) {
        console.error('Error in booking appointment:', error);

        // Respond to the client with an error message
        res.status(500).json({ message: 'An error occurred while booking the appointment.', error: error.message });
    }
});

app.get("/booked-slots", async (req, res) => {
    try {
        const { date } = req.query;  // Get the date from the query string (format: YYYY-MM-DD)
        const isoDate = new Date(date).toISOString();     
        const appointmentsCollection = db.collection("appointments");

        // Find appointments for the specific date
        const bookedAppointments = await appointmentsCollection.find({ date:isoDate }).toArray();
        console.log(bookedAppointments)
        // Extract booked time slots for the selected date
        const bookedSlots = bookedAppointments.map(appointment => appointment.time);
        res.status(200).json(bookedSlots);
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
