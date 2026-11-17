import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import cron from 'node-cron';
import { createAuth } from './middleware/auth.js';
import { sendSupervisionReminder } from './utils/mailer.js';
import {
  ipLimiter, authFailLimiter,
  postCreateLimiter, requestCreateLimiter, writeLimiter,
} from './middleware/rateLimit.js';
import {
  sanitize, validate,
  createPostSchema, updatePostSchema, profileSchema,
  createRequestSchema, requestStatusSchema,
} from './middleware/validate.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

app.use(sanitize);

app.set('trust proxy', 1); // Render-er proxy-r pichone asol IP pete
app.use('/api', ipLimiter, authFailLimiter);

// MongoDB connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// ---------- small helpers ----------
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const sameEmail = (a, b) =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();
const pick = (obj, keys) =>
  Object.fromEntries(
    keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]])
  );

const POST_FIELDS = [
  'title', 'description', 'category', 'organization', 'skills',
  'eligibleDepartments', 'minCGPA', 'deadline', 'workMode',
  'location', 'externalLink', 'coverImage',
];
const PROFILE_FIELDS = [
  'name', 'studentId', 'batch', 'department', 'cgpa', 'resumeLink',
  'skills', 'company', 'designation', 'interestedFields',
];
const ROLES = ['student', 'teacher', 'alumni'];

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected!");

    const db = client.db('mentora');

    // better-auth-er collection নাম "user" (singular)
    const usersCollection = db.collection('user');
    const postsCollection = db.collection('posts');
    const requestsCollection = db.collection('requests');
    const sessionsCollection = db.collection('session');

    const { verifySession, requireRole, fail } = createAuth({
      sessionsCollection,
      usersCollection,
    });

    // Test route
    app.get('/', (req, res) => {
      res.send('Mentora Server Running!');
    });

    // who am I (also used by tests)
    app.get('/api/me', verifySession, (req, res) => res.json(req.user));

    // ===== USER রুট =====

    // own profile only
    app.get('/api/users/:email', verifySession, async (req, res) => {
      if (!sameEmail(req.params.email, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only view your own profile.');
      }
      const result = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
      res.json(result || {});
    });

    // list users by role (Alumni Network) — only safe fields
    app.get('/api/users', verifySession, async (req, res) => {
      const role = String(req.query.role || '').toLowerCase();
      if (!ROLES.includes(role)) {
        return fail(res, 400, 'BAD_REQUEST', 'A valid role is required.');
      }
      const result = await usersCollection
        .find(
          { role: new RegExp(`^${role}$`, 'i') },
          { projection: { name: 1, email: 1, role: 1, image: 1, company: 1, designation: 1, interestedFields: 1 } }
        )
        .toArray();
      res.json(result);
    });

    // update own profile (whitelisted fields only — role can NOT be changed here)
    app.patch('/api/users/:email', verifySession, writeLimiter, validate(profileSchema), async (req, res) => {
      if (!sameEmail(req.params.email, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only edit your own profile.');
      }
      const updates = pick(req.body, PROFILE_FIELDS);
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.user.id) },
        { $set: { ...updates, updatedAt: new Date() } }
      );
      res.json(result);
    });

    // ===== POST রুট =====

    // public feed
    app.get('/api/posts', async (req, res) => {
      const query = req.query.type ? { type: String(req.query.type) } : {};
      const result = await postsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.json(result);
    });

    // my posts
    app.get('/api/posts/author/:email', verifySession, async (req, res) => {
      if (!sameEmail(req.params.email, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only view your own posts.');
      }
      const result = await postsCollection.find({ authorEmail: req.user.email }).toArray();
      res.json(result);
    });

    // public details
    app.get('/api/posts/:id', async (req, res) => {
      const _id = oid(req.params.id);
      if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid post id.');
      const result = await postsCollection.findOne({ _id });
      if (!result) return fail(res, 404, 'NOT_FOUND', 'Post not found.');
      res.json(result);
    });

    // create — author info comes from the session, not the client
    app.post('/api/posts', verifySession, requireRole('teacher', 'alumni'), postCreateLimiter, validate(createPostSchema), async (req, res) => {
      const post = {
        ...pick(req.body, POST_FIELDS),
        authorEmail: req.user.email,
        authorName: req.user.name,
        authorRole: req.user.role,
        interestCount: 0,
        createdAt: new Date(),
      };
      const result = await postsCollection.insertOne(post);
      res.status(201).json(result);
    });

    // update — owner only
    app.patch('/api/posts/:id', verifySession, requireRole('teacher', 'alumni'),writeLimiter, validate(updatePostSchema), async (req, res) => {
      const _id = oid(req.params.id);
      if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid post id.');
      const post = await postsCollection.findOne({ _id });
      if (!post) return fail(res, 404, 'NOT_FOUND', 'Post not found.');
      if (!sameEmail(post.authorEmail, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only edit your own posts.');
      }
      const result = await postsCollection.updateOne(
        { _id },
        { $set: pick(req.body, POST_FIELDS) }
      );
      res.json(result);
    });

    // delete — owner only
    app.delete('/api/posts/:id', verifySession, requireRole('teacher', 'alumni'),writeLimiter, async (req, res) => {
      const _id = oid(req.params.id);
      if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid post id.');
      const post = await postsCollection.findOne({ _id });
      if (!post) return fail(res, 404, 'NOT_FOUND', 'Post not found.');
      if (!sameEmail(post.authorEmail, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only delete your own posts.');
      }
      const result = await postsCollection.deleteOne({ _id });
      res.json(result);
    });

    // ===== REQUEST রুট (interest + mentorship) =====

    // students only. Recipient is decided by the server, never by the client.
    app.post('/api/requests', verifySession, requireRole('student'),requestCreateLimiter, validate(createRequestSchema), async (req, res) => {
      const { postId, recipientEmail, message } = req.body || {};
      let target;

      if (postId) {
        const _id = oid(postId);
        if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid post id.');
        const post = await postsCollection.findOne({ _id });
        if (!post) return fail(res, 404, 'NOT_FOUND', 'Post not found.');
        if (sameEmail(post.authorEmail, req.user.email)) {
          return fail(res, 403, 'FORBIDDEN', 'You cannot show interest in your own post.');
        }
        target = {
          postId: post._id.toString(),
          postTitle: post.title,
          recipientEmail: post.authorEmail,
          recipientName: post.authorName,
          type: 'post_interest',
        };
      } else {
        if (typeof recipientEmail !== 'string') {
          return fail(res, 400, 'BAD_REQUEST', 'recipientEmail is required.');
        }
        const alumnus = await usersCollection.findOne({
          email: recipientEmail.toLowerCase(),
          role: /^alumni$/i,
        });
        if (!alumnus) return fail(res, 404, 'NOT_FOUND', 'Alumnus not found.');
        target = {
          recipientEmail: alumnus.email,
          recipientName: alumnus.name,
          type: 'mentorship',
        };
      }

      const request = {
        ...target,
        studentEmail: req.user.email,
        studentName: req.user.name,
        message: String(message || '').slice(0, 2000),
        status: 'pending',
        createdAt: new Date(),
      };
      const result = await requestsCollection.insertOne(request);

      if (target.postId) {
        await postsCollection.updateOne(
          { _id: new ObjectId(target.postId) },
          { $inc: { interestCount: 1 } }
        );
      }
      res.status(201).json(result);
    });

    // my sent requests
    app.get('/api/requests/student/:email', verifySession, async (req, res) => {
      if (!sameEmail(req.params.email, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only view your own requests.');
      }
      const result = await requestsCollection.find({ studentEmail: req.user.email }).toArray();
      res.json(result);
    });

    // requests addressed to me
    app.get('/api/requests/recipient/:email', verifySession, async (req, res) => {
      if (!sameEmail(req.params.email, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'You can only view requests sent to you.');
      }
      const result = await requestsCollection.find({ recipientEmail: req.user.email }).toArray();
      res.json(result);
    });

    // accept / reject — recipient only
    app.patch('/api/requests/:id', verifySession, requireRole('teacher', 'alumni'),writeLimiter, validate(requestStatusSchema), async (req, res) => {
      const _id = oid(req.params.id);
      if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid request id.');
      const status = req.body && req.body.status;
      if (!['accepted', 'rejected'].includes(status)) {
        return fail(res, 400, 'BAD_REQUEST', 'status must be "accepted" or "rejected".');
      }
      const request = await requestsCollection.findOne({ _id });
      if (!request) return fail(res, 404, 'NOT_FOUND', 'Request not found.');
      if (!sameEmail(request.recipientEmail, req.user.email)) {
        return fail(res, 403, 'FORBIDDEN', 'This request was not sent to you.');
      }
      const result = await requestsCollection.updateOne({ _id }, { $set: { status } });
      res.json(result);
    });

    // withdraw (sender) or clear (recipient) — either party, nobody else
    app.delete('/api/requests/:id', verifySession, writeLimiter, async (req, res) => {
      const _id = oid(req.params.id);
      if (!_id) return fail(res, 400, 'BAD_REQUEST', 'Invalid request id.');
      const request = await requestsCollection.findOne({ _id });
      if (!request) return fail(res, 404, 'NOT_FOUND', 'Request not found.');
      const isParty =
        sameEmail(request.studentEmail, req.user.email) ||
        sameEmail(request.recipientEmail, req.user.email);
      if (!isParty) {
        return fail(res, 403, 'FORBIDDEN', 'You are not part of this request.');
      }
      const result = await requestsCollection.deleteOne({ _id });
      res.json(result);
    });

    // ===== Supervision Reminder (Task 3 e per-user scheduling hobe) =====
    cron.schedule('0 0 1 * *', async () => {
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
        const userExists = await usersCollection.findOne({ email: teacherEmail });
        if (!userExists) {
          console.log(`Skipping ${teacherEmail} — account no longer exists`);
          continue;
        }

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

    // ===== uniform 404 + error responses (must stay LAST) =====
    app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Route not found.'));
    app.use((err, req, res, next) => {
      console.error('Unhandled error:', err.message);
      fail(res, 500, 'SERVER_ERROR', 'Something went wrong.');
    });

  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Mentora server running on port ${port}`);
});