import { Resend } from 'resend';
import { Booking, Event } from './events';

if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not defined');
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({
    to,
    subject,
    html,
    from = 'team@strangermingle.com',
    cc = [],
    attachments = [],
}: {
    to: string;
    subject: string;
    html: string;
    from?: string;
    cc?: string[];
    attachments?: { filename: string; content: Buffer | Uint8Array }[];
}) {
    try {
        const data = await resend.emails.send({
            from,
            to,
            subject,
            html,
            cc,
            attachments: attachments.map(att => ({
                filename: att.filename,
                content: att.content instanceof Buffer ? att.content : Buffer.from(att.content),
            })),
        });
        return data;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

export function generateBookingConfirmationHtml(booking: Booking & {
    booking_items?: {
        ticket_tier_id: string;
        ticket_tier_name: string;
        quantity: number;
        unit_price: number
    }[]
}, event: Event) {
    const amount = booking.total_amount;
    const itemsList = booking.booking_items ? booking.booking_items.map((item: { ticket_tier_name: string; quantity: number; unit_price: number }) => `
        <div style="background-color: #f9fafb; padding: 12px; border-radius: 12px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
            <div style="font-weight: bold; color: #111827;">${item.ticket_tier_name}</div>
            <div style="color: #6b7280; font-size: 14px;">${item.quantity}x @ ₹${item.unit_price} each</div>
        </div>
    `).join('') : '';

    const eventDate = new Date(event.start_datetime).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        timeZone: 'Asia/Kolkata'
    });
    const eventTime = new Date(event.start_datetime).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata'
    });

    return `
    <!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }

        body {
            font-family: 'DM Sans', sans-serif;
            font-weight: 400;
            line-height: 1.6;
            color: #2d2d2d;
            background-color: #efefef;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 620px;
            margin: 48px auto;
            padding: 20px;
        }

        /* ── CARD ── */
        .card {
            background-color: #ffffff;
            border-radius: 28px;
            box-shadow:
                0 2px 4px rgba(0,0,0,0.04),
                0 12px 40px rgba(0,0,0,0.09);
            overflow: hidden;
        }

        /* ── HEADER ── */
        .header {
            background-color: #ffffff;
            padding: 52px 48px 40px;
            text-align: center;
            position: relative;
            border-bottom: 1px solid #f0f0f0;
        }

        .header::before {
            content: '';
            position: absolute;
            inset: 0;
            background: radial-gradient(ellipse 80% 60% at 50% -10%, #f0eeff 0%, transparent 70%);
            pointer-events: none;
        }

        .logo-wrap {
            display: inline-block;
            margin-bottom: 28px;
        }

        .logo-wrap img {
            width: 110px;
            position: relative;
            z-index: 1;
        }

        .check-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6c5ce7, #a29bfe);
            margin-bottom: 20px;
            position: relative;
            z-index: 1;
            box-shadow: 0 8px 24px rgba(108, 92, 231, 0.28);
        }

        .check-icon svg {
            width: 28px;
            height: 28px;
            stroke: #fff;
            stroke-width: 2.5;
            fill: none;
        }

        .header h1 {
            font-family: 'Cormorant Garamond', serif;
            font-size: 42px;
            font-weight: 700;
            letter-spacing: -0.5px;
            margin: 0 0 8px 0;
            color: #111111;
            position: relative;
            z-index: 1;
        }

        .header p {
            font-size: 15px;
            color: #7a7a7a;
            margin: 0;
            font-weight: 400;
            position: relative;
            z-index: 1;
        }

        /* ── CONTENT ── */
        .content {
            padding: 44px 48px;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background-color: #f3f0ff;
            color: #5b4fcf;
            padding: 5px 14px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 18px;
        }

        .badge::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: #6c5ce7;
        }

        .event-title {
            font-family: 'Cormorant Garamond', serif;
            font-size: 28px;
            font-weight: 600;
            color: #111111;
            margin: 0 0 32px 0;
            line-height: 1.25;
        }

        /* ── DETAIL GRID ── */
        .detail-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            border: 1px solid #ebebeb;
            border-radius: 16px;
            overflow: hidden;
            margin-bottom: 36px;
        }

        .detail-cell {
            padding: 20px 24px;
            background: #fafafa;
        }

        .detail-cell:nth-child(odd) {
            border-right: 1px solid #ebebeb;
        }

        .detail-cell:nth-child(1),
        .detail-cell:nth-child(2) {
            border-bottom: 1px solid #ebebeb;
        }

        .detail-cell--full {
            grid-column: 1 / -1;
            border-right: none !important;
            border-bottom: 1px solid #ebebeb;
        }

        .detail-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #b0b0b0;
            margin-bottom: 6px;
        }

        .detail-value {
            font-size: 15px;
            font-weight: 500;
            color: #111111;
            line-height: 1.3;
        }

        .detail-sub {
            font-size: 13px;
            color: #888888;
            font-weight: 400;
            margin-top: 2px;
        }

        /* ── TICKET SUMMARY ── */
        .ticket-summary {
            background: #fafafa;
            border: 1px solid #ebebeb;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 36px;
        }

        .ticket-summary h3 {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #b0b0b0;
            margin: 0 0 16px 0;
        }

        .items-list {
            /* injected items go here */
        }

        .ticket-divider {
            border: none;
            border-top: 1px dashed #e0e0e0;
            margin: 16px 0;
        }

        .total-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .total-label {
            font-size: 14px;
            font-weight: 600;
            color: #111111;
        }

        .total-amount {
            font-family: 'Cormorant Garamond', serif;
            font-size: 28px;
            font-weight: 700;
            color: #6c5ce7;
            letter-spacing: -0.5px;
        }

        /* ── CTA BUTTON ── */
        .cta-wrap {
            text-align: center;
        }

        .cta-note {
            font-size: 13px;
            color: #aaaaaa;
            margin: 0 0 18px 0;
        }

        .button {
            display: inline-block;
            background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
            color: #ffffff;
            padding: 16px 40px;
            border-radius: 14px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
            box-shadow: 0 8px 24px rgba(108, 92, 231, 0.30);
            transition: box-shadow 0.2s;
        }

        .button:hover {
            box-shadow: 0 12px 32px rgba(108, 92, 231, 0.42);
        }

        /* ── BOOKING REF STRIP ── */
        .ref-strip {
            background: #f7f7f7;
            border-top: 1px solid #efefef;
            padding: 28px 48px;
            text-align: center;
        }

        .ref-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: #b0b0b0;
            margin-bottom: 8px;
        }

        .ref-code {
            font-family: 'DM Sans', monospace;
            font-size: 20px;
            font-weight: 600;
            color: #111111;
            letter-spacing: 0.18em;
        }

        /* ── FOOTER ── */
        .footer {
            padding: 32px 48px;
            text-align: center;
            background: #efefef;
            border-radius: 0 0 28px 28px;
        }

        .footer p {
            font-size: 13px;
            color: #b0b0b0;
            margin: 0 0 8px 0;
        }

        .footer a {
            color: #b0b0b0;
            margin: 0 10px;
            font-size: 12px;
            text-decoration: none;
            border-bottom: 1px solid #d8d8d8;
            padding-bottom: 1px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">

            <!-- HEADER -->
            <div class="header">
                <div class="logo-wrap">
                    <img src="https://strangermingle.com/logo.png" alt="Stranger Mingle Logo">
                </div>
                <h1>You're In!</h1>
                <p>Welcome to the Tribe, ${booking.attendee_name}</p>
            </div>

            <!-- CONTENT -->
            <div class="content">
                <div class="badge">Booking Confirmed</div>
                <h2 class="event-title">${event.title}</h2>

                <!-- DETAILS -->
                <div class="detail-grid">
                    <div class="detail-cell">
                        <div class="detail-label">When</div>
                        <div class="detail-value">${eventDate}</div>
                        <div class="detail-sub">${eventTime} onwards</div>
                    </div>
                    <div class="detail-cell">
                        <div class="detail-label">Attendee</div>
                        <div class="detail-value">${booking.attendee_name}</div>
                    </div>
                    <div class="detail-cell detail-cell--full">
                        <div class="detail-label">Where</div>
                        <div class="detail-value">${event.location?.venue_name || event.event_type}</div>
                    </div>
                    <div class="detail-cell">
                        <div class="detail-label">Status</div>
                        <div class="detail-value" style="color:#22c55e;">✓ Confirmed</div>
                    </div>
                </div>

                <!-- TICKET SUMMARY -->
                <div class="ticket-summary">
                    <h3>Ticket Summary</h3>
                    <div class="items-list">${itemsList}</div>
                    <hr class="ticket-divider">
                    <div class="total-row">
                        <span class="total-label">Total Paid</span>
                        <span class="total-amount">₹${amount}</span>
                    </div>
                </div>

                <!-- CTA -->
                <div class="cta-wrap">
                    <p class="cta-note">Your tickets are attached to this email.</p>
                    <a href="https://www.strangermingle.com/members" class="button">Premium Membership</a>
                </div>
            </div>

            <!-- BOOKING REF -->
            <div class="ref-strip">
                <div class="ref-label">Booking Reference</div>
                <div class="ref-code">${booking.booking_ref}</div>
            </div>

        </div>

        <!-- FOOTER -->
        <div class="footer">
            <p>Don't want to go alone? Share this with a friend!</p>
            <p>&copy; {year} Stranger Mingle &mdash; a brand of Salty Media Production (OPC) Pvt Ltd.</p>
            <div style="margin-top: 14px;">
                <a href="https://www.strangermingle.com/terms">Terms</a>
                <a href="https://www.strangermingle.com/privacy-policy">Privacy Policy</a>
                <a href="https://www.strangermingle.com/refund-policy">Refund Policy</a>
                <a href="https://www.strangermingle.com/safety-guidelines">Safety Guidelines</a>
            </div>
        </div>
    </div>
</body>
</html>
    `;
}
