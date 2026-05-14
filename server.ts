import express from 'express';
import cors from 'cors';
import asyncHandler from 'express-async-handler';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Initialize Firebase Admin
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = JSON.parse(
      readFileSync(path.resolve('./serviceAccountKey.json'), 'utf8')
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://unichat-acfc2-default-rtdb.firebaseio.com"
  });
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

const db = admin.database();
const membersRef = db.ref('members');

// Seed initial data if empty
async function seed() {
  const snapshot = await membersRef.once('value');
  if (!snapshot.exists()) {
    const initialMembers = [
      { id: '1', name: 'Chủ Account (Bạn)', startDate: new Date().toISOString().split('T')[0], initialBalance: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: (i + 2).toString(),
        name: `Thành viên ${i + 1}`,
        startDate: new Date().toISOString().split('T')[0],
        initialBalance: 0
      }))
    ];

    const seedData: Record<string, any> = {};
    initialMembers.forEach(m => {
      seedData[m.id] = {
        name: m.name,
        startDate: m.startDate,
        initialBalance: m.initialBalance
      };
    });

    await membersRef.set(seedData);
    console.log('Firebase Database seeded!');
  }
}

seed().catch(console.error);

// Routes
app.get('/api/members', asyncHandler(async (req: any, res: any) => {
  const snapshot = await membersRef.once('value');
  const data = snapshot.val() || {};
  
  const members = Object.entries(data).map(([id, member]: [string, any]) => {
    let payments: any[] = [];
    if (member.payments) {
      payments = Object.entries(member.payments).map(([pid, p]: [string, any]) => ({
        ...(p as object),
        id: pid
      }));
      payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    
    return {
      ...member,
      id,
      payments
    };
  });

  res.json(members);
}));

app.put('/api/members/:id', asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const { name, initialBalance, startDate } = req.body;

  const memberRef = membersRef.child(id);
  await memberRef.update({
    name,
    initialBalance: Number(initialBalance),
    startDate
  });

  const updated = (await memberRef.once('value')).val();
  res.json({ ...updated, id });
}));

app.post('/api/members/:id/payments', asyncHandler(async (req: any, res: any) => {
  const { id: memberId } = req.params;
  const { amount, date } = req.body;

  const paymentsRef = membersRef.child(memberId).child('payments');
  const newPaymentRef = paymentsRef.push();
  await newPaymentRef.set({
    amount: Number(amount),
    date
  });

  res.json({ id: newPaymentRef.key, amount, date });
}));

app.delete('/api/payments/:id', asyncHandler(async (req: any, res: any) => {
  const { id } = req.query; // We need memberId to delete from member/payments
  const memberId = req.query.memberId as string;
  
  if (!id || !memberId) {
    return res.status(400).send('Missing id or memberId');
  }

  await membersRef.child(memberId).child('payments').child(id as string).remove();
  res.sendStatus(204);
}));

// Keep alive
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Backend server (Firebase Admin) listening at http://localhost:${port}`);
  });
}

export default app;
