import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import { sendSupervisionReminder } from './utils/mailer.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// MongoDB connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected!");

    const db = client.db('mentora');

    // ৩টা collection: users, posts, requests
    const usersCollection = db.collection('user');
    const postsCollection = db.collection('posts');
    const requestsCollection = db.collection('requests');

    // Test route
    app.get('/', (req, res) => {
      res.send('Mentora Server Running!');
    });

    // ===== USER রুট =====

    app.post('/users', async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: 'User already exists', insertedId: null });
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users/:email', async (req, res) => {
      const result = await usersCollection.findOne({ email: req.params.email });
      res.send(result || {});
    });

    app.get('/users', async (req, res) => {
      const role = req.query.role;
      const query = role ? { role: new RegExp(`^${role}$`, 'i') } : {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.patch('/users/:email', async (req, res) => {
      const result = await usersCollection.updateOne(
        { email: req.params.email },
        { $set: { ...req.body, email: req.params.email } },
        { upsert: true }
      );
      res.send(result);
    });

    // ===== POST রুট (job / internship / research) =====

    app.get('/posts', async (req, res) => {
      const type = req.query.type;
      const query = type ? { type } : {};
      const result = await postsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.get('/posts/author/:email', async (req, res) => {
      const result = await postsCollection.find({ authorEmail: req.params.email }).toArray();
      res.send(result);
    });

    // id wise post — invalid/missing id safely handle kora hocche
    app.get('/posts/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid post id' });
        }
        const result = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!result) {
          return res.status(404).send({ message: 'Post not found' });
        }
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.post('/posts', async (req, res) => {
      const post = req.body;
      post.interestCount = 0;
      post.createdAt = new Date();
      const result = await postsCollection.insertOne(post);
      res.send(result);
    });

    app.patch('/posts/:id', async (req, res) => {
      const result = await postsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.send(result);
    });

    app.delete('/posts/:id', async (req, res) => {
      const result = await postsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // ===== REQUEST রুট (interest + mentorship) =====

    app.post('/requests', async (req, res) => {
      const request = req.body;
      request.status = 'pending';
      request.createdAt = new Date();
      const result = await requestsCollection.insertOne(request);

      if (request.postId) {
        await postsCollection.updateOne(
          { _id: new ObjectId(request.postId) },
          { $inc: { interestCount: 1 } }
        );
      }
      res.send(result);
    });

    app.get('/requests/student/:email', async (req, res) => {
      const result = await requestsCollection.find({ studentEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.get('/requests/recipient/:email', async (req, res) => {
      const result = await requestsCollection.find({ recipientEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.patch('/requests/:id', async (req, res) => {
      const result = await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } }
      );
      res.send(result);
    });

    app.delete('/requests/:id', async (req, res) => {
      const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // ===== Daily Supervision Reminder =====
    cron.schedule('* * * * *', async () => {
      console.log('Running supervision reminder job...');

      const accepted = await requestsCollection.find({ status: 'accepted' }).toArray();

      const byTeacher = {};
      accepted.forEach((req) => {
        if (!req.recipientEmail || !req.postTitle) return;
        if (!byTeacher[req.recipientEmail]) {
          byTeacher[req.recipientEmail] = { recipientName: req.recipientName, projects: {} };
        }
        const key = req.postId || req.postTitle;
        if (!byTeacher[req.recipientEmail].projects[key]) {
          byTeacher[req.recipientEmail].projects[key] = { postTitle: req.postTitle, students: [] };
        }
        byTeacher[req.recipientEmail].projects[key].students.push(req);
      });

      for (const [teacherEmail, data] of Object.entries(byTeacher)) {
        try {
          await sendSupervisionReminder(
            teacherEmail,
            data.recipientName,
            Object.values(data.projects)
          );
          console.log(`Reminder sent to ${teacherEmail}`);
        } catch (err) {
          console.error(`Failed to send to ${teacherEmail}:`, err.message);
        }
      }
    });

  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Mentora server running on port ${port}`);
});