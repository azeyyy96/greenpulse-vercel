// Sends OTP emails via Resend (https://resend.com) — free tier: 3,000
// emails/month, 100/day, no credit card. Requires RESEND_API_KEY env
// var. To send to arbitrary recipients (not just your own inbox), you
// must verify a sending domain in the Resend dashboard first — see
// README for the DNS steps.

export async function sendOtpEmail(to, otp, purpose) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'GreenPulse <onboarding@resend.dev>';

  const isReset = purpose === 'reset';
  const subject = isReset ? 'Your GreenPulse password reset code' : 'Verify your GreenPulse account';
  const heading = isReset ? 'Reset your password' : 'Verify your email';
  const body = isReset
    ? 'Use this code to reset your GreenPulse password. It expires in 10 minutes.'
    : 'Use this code to finish creating your GreenPulse account. It expires in 10 minutes.';

  const html = `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:28px;">
      <div style="font-size:13px;font-weight:700;color:#1FB8A6;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:14px;">GreenPulse</div>
      <h2 style="color:#0F2438;margin:0 0 10px;font-size:20px;">${heading}</h2>
      <p style="color:#555;font-size:14px;line-height:1.5;margin:0 0 20px;">${body}</p>
      <div style="font-size:30px;font-weight:700;letter-spacing:7px;color:#0F2438;margin:0 0 20px;text-align:center;background:#E4F5F2;padding:18px;border-radius:12px;">${otp}</div>
      <p style="color:#999;font-size:11.5px;line-height:1.5;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Email send failed: ' + errText);
  }
  return true;
}
