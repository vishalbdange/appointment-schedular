const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const moment = require('moment-timezone');
const { MongoClient, ServerApiVersion } = require('mongodb');
dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const app = express();
const port = 5000;
const client = new MongoClient(
    `mongodb+srv://autismdrmumbai:${process.env.MONGO_PSWD}@cluster0.d6f4q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("appointmentsDB");
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
        process.exit(1);
    }
}

// ─── CORS (single clean config) ───────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS;

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g. curl, Postman, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight for every route
// ─────────────────────────────────────────────────────────────────────────────

app.use(bodyParser.json());

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD,
    },
});

// Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// ─── POST /book-appointment ───────────────────────────────────────────────────
app.post('/book-appointment', async (req, res) => {
    console.log(req.body);
    const { selectedDate, selectedTime, selectedEmail, selectedName } = req.body;

    try {
        const appointmentsCollection = db.collection("appointments");

        // Normalize the date to ISO string for consistent storage
        const normalizedDate = new Date(selectedDate).toISOString();

        // Check if slot is already booked
        const existingAppointment = await appointmentsCollection.findOne({
            date: normalizedDate,
            time: selectedTime,
        });
        if (existingAppointment) {
            return res.json({ success: false, message: "Slot already booked" });
        }

        const startDateTimeIST = moment.tz(selectedDate, 'Asia/Kolkata')
            .startOf('day')
            .add(moment(selectedTime, ["h:mm A"]).hours(), 'hours')
            .add(moment(selectedTime, ["h:mm A"]).minutes(), 'minutes');

        const endDateTimeIST = moment(startDateTimeIST).add(15, 'minutes');

        console.log(startDateTimeIST.toISOString(), endDateTimeIST.toISOString());

        const event = {
            summary: 'Appointment',
            location: 'Google Meet',
            description: 'Scheduled meeting',
            start: {
                dateTime: startDateTimeIST.toISOString(),
                timeZone: 'Asia/Kolkata',
            },
            end: {
                dateTime: endDateTimeIST.toISOString(),
                timeZone: 'Asia/Kolkata',
            },
            attendees: [
                { email: selectedEmail },
                { email: process.env.EMAIL },
            ],
            conferenceData: {
                createRequest: {
                    requestId: `appt-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            conferenceDataVersion: 1,
        });

        const meetingLink = response.data.hangoutLink;
        console.log("Meet link:", meetingLink);

        const emailContent = `
            <h1>Appointment Confirmation</h1>
            <p>Dear ${selectedName},</p>
            <p>Your appointment has been scheduled for ${normalizedDate.slice(0, 10)} at ${selectedTime}.</p>
            <p>Join the meeting using this <a href="${meetingLink}">Google Meet Link</a>.</p>
            <p>Thank you for booking with us!</p>
        `;

        const mailOptions = {
            from: process.env.EMAIL,
            to: selectedEmail,
            subject: `Aakar Clinic - Appointment`,
            text: "Sending you Appointment Details",
            html: emailContent,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);

        // Store with normalized ISO date
        await appointmentsCollection.insertOne({
            name: selectedName,
            email: selectedEmail,
            date: normalizedDate,
            time: selectedTime,
        });

        res.status(200).json({ message: 'Appointment booked successfully' });

    } catch (error) {
        console.error('Error booking appointment:', error);
        res.status(500).json({
            message: 'An error occurred while booking the appointment.',
            error: error.message,
        });
    }
});

// ─── GET /booked-slots ────────────────────────────────────────────────────────
app.get("/booked-slots", async (req, res) => {
    try {
        const { date } = req.query;
        console.log("Received date query:", date);

        // Normalize to ISO string — same format used when storing
        const normalizedDate = new Date(date).toISOString();
        console.log("Normalized ISO date:", normalizedDate);

        const appointmentsCollection = db.collection("appointments");
        console.log("Fetching booked appointments for date:", normalizedDate);
        const bookedAppointments = await appointmentsCollection
            .find({ date: normalizedDate })
            .toArray();
        console.log("Booked appointments:", bookedAppointments);

        const bookedSlots = bookedAppointments.map(a => a.time);
        res.status(200).json(bookedSlots);

    } catch (error) {
        console.error("Error fetching booked slots:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ─── Start server ─────────────────────────────────────────────────────────────
connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
});