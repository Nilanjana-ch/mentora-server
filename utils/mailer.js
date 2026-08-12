import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

export async function sendSupervisionReminder(teacherEmail, teacherName, projects) {
  const projectListHtml = projects
    .map(
      (p) => `
      <div style="margin-bottom:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <p style="margin:0 0 6px;font-weight:600;">${p.postTitle}</p>
        <ul style="margin:0;padding-left:18px;">
          ${p.students.map((s) => `<li>${s.studentName} (${s.studentEmail})</li>`).join('')}
        </ul>
      </div>`
    )
    .join('');

  await transporter.sendMail({
    from: `"Mentora" <${process.env.EMAIL_USER}>`,
    to: teacherEmail,
    subject: 'Mentora — Your Supervised Students Reminder',
    html: `
      <div style="font-family:sans-serif;max-width:500px;">
        <h2>Hi ${teacherName},</h2>
        <p>Here's a reminder of the students currently working under your supervision:</p>
        ${projectListHtml}
        <p style="color:#666;font-size:13px;">— Mentora</p>
      </div>
    `,
  });
}