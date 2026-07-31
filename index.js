import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';

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
    const usersCollection = db.collection('users');
    const postsCollection = db.collection('posts');
    const requestsCollection = db.collection('requests');

    // Test route
    app.get('/', (req, res) => {
      res.send('Mentora Server Running!');
    });

    // ===== USER রুট =====

    // রেজিস্টারের সময় ইউজার সেভ হবে
    app.post('/users', async (req, res) => {
      const user = req.body; // { name, email, password, role: student/teacher/alumni }
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: 'User already exists', insertedId: null });
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // লগইনের পর email দিয়ে ইউজারের role চেক করার জন্য
    app.get('/users/:email', async (req, res) => {
      const result = await usersCollection.findOne({ email: req.params.email });
      res.send(result);
    });

    // নির্দিষ্ট role এর সব ইউজার (যেমন সব teacher/alumni)
    app.get('/users', async (req, res) => {
      const role = req.query.role;
      const query = role ? { role } : {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // ===== POST রুট (job / internship / research) =====

    // সব পোস্ট (ফিড) — ?type=job/internship/research দিয়ে ফিল্টার করা যাবে
    app.get('/posts', async (req, res) => {
      const type = req.query.type;
      const query = type ? { type } : {};
      const result = await postsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    // নির্দিষ্ট author (teacher/alumni) এর নিজের পোস্টগুলো
    app.get('/posts/author/:email', async (req, res) => {
      const result = await postsCollection.find({ authorEmail: req.params.email }).toArray();
      res.send(result);
    });

    // id wise post
    app.get('/posts/:id', async (req, res) => {
      const result = await postsCollection.findOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // new post create
    app.post('/posts', async (req, res) => {
      const post = req.body; // { title, description, type, authorEmail, authorName, authorRole }
      post.interestCount = 0;
      post.createdAt = new Date();
      const result = await postsCollection.insertOne(post);
      res.send(result);
    });

    // post update
    app.patch('/posts/:id', async (req, res) => {
      const result = await postsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.send(result);
    });

    // post delete
    app.delete('/posts/:id', async (req, res) => {
      const result = await postsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // ===== REQUEST রুট (interest + mentorship) =====

    // স্টুডেন্ট Interest বাটনে ক্লিক করলে বা মেন্টরশিপ রিকোয়েস্ট পাঠালে
    app.post('/requests', async (req, res) => {
      const request = req.body;
      // { postId (optional), studentEmail, studentName, recipientEmail, type: post_interest/mentorship, message }
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

    // স্টুডেন্ট যেসব রিকোয়েস্ট পাঠিয়েছে (My Requests পেজ)
    app.get('/requests/student/:email', async (req, res) => {
      const result = await requestsCollection.find({ studentEmail: req.params.email }).toArray();
      res.send(result);
    });

    // teacher/alumni যেসব রিকোয়েস্ট পেয়েছে
    app.get('/requests/recipient/:email', async (req, res) => {
      const result = await requestsCollection.find({ recipientEmail: req.params.email }).toArray();
      res.send(result);
    });

    // Accept/Reject করার জন্য
    app.patch('/requests/:id', async (req, res) => {
      const result = await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } } // 'accepted' or 'rejected'
      );
      res.send(result);
    });

    // স্টুডেন্ট রিকোয়েস্ট cancel করলে
    app.delete('/requests/:id', async (req, res) => {
      const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Mentora server running on port ${port}`);
});