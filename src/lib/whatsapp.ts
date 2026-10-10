export async function uploadMediaToWhatsApp(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const WHATSAPP_TOKEN = process.env.META_SYSTEM_USER_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('WhatsApp configuration missing in environment variables.');
  }

  const endpoint = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`;

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('messaging_product', 'whatsapp');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      // Note: Do not set Content-Type manually, fetch will automatically set it to multipart/form-data with the correct boundary
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('WhatsApp Media Upload Error:', data);
    throw new Error(`Failed to upload media to WhatsApp: ${JSON.stringify(data)}`);
  }

  return data.id; // Returns the Media ID
}

export type WhatsAppTicketParams = {
  phoneNumber: string; // Including country code, e.g., 919876543210
  pdfBuffer: Buffer;
  userName: string;
  eventName: string;
  date: string;
  time: string;
  venue: string;
  mapLink: string;
  eventLink: string;
  bookingId: string;
  paymentId: string;
};

export async function sendTicketConfirmationWhatsApp(params: WhatsAppTicketParams) {
  const WHATSAPP_TOKEN = process.env.META_SYSTEM_USER_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('WhatsApp configuration missing in environment variables.');
  }

  // 1. Upload the PDF to get a Media ID
  const filename = `${params.eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_ticket.pdf`;
  const mediaId = await uploadMediaToWhatsApp(params.pdfBuffer, filename, 'application/pdf');

  // 2. Send the message using the Media ID
  const endpoint = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: params.phoneNumber,
    type: 'template',
    template: {
      name: 'ticket_confirmation',
      language: {
        code: 'en_US',
      },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: {
                id: mediaId,
                filename: filename,
              },
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.userName },
            { type: 'text', text: params.eventName },
            { type: 'text', text: params.date },
            { type: 'text', text: params.time },
            { type: 'text', text: params.venue },
            { type: 'text', text: params.mapLink || 'N/A' },
            { type: 'text', text: params.eventLink || 'N/A' },
            { type: 'text', text: params.bookingId },
            { type: 'text', text: params.paymentId || 'N/A' },
          ],
        },
      ],
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('WhatsApp API Error:', data);
    throw new Error(`Failed to send WhatsApp message: ${JSON.stringify(data)}`);
  }

  console.log('Successfully sent WhatsApp ticket confirmation!', data);
  return data;
}
