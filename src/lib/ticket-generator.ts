import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

export interface TicketItem {
    ticket_tier_name: string;
    quantity: number;
}

export interface TicketBookingData {
    booking_ref: string;
    attendee_name: string;
    event_title: string;
    event_date: string;
    venue_name: string;
    items: TicketItem[];
}

export async function generateTicketPdf(data: TicketBookingData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Helper to strip emojis and non-WinAnsi characters
    const safeText = (text: string) => {
        if (!text) return '';
        // Remove emojis and keep basic Latin/Latin-1 Supplement characters supported by WinAnsi
        return text.replace(/[^\x00-\xFF]/g, '');
    };
    
    // Load Logo once
    let logoImage;
    try {
        const logoPath = path.join(process.cwd(), 'public/logo.png');
        if (fs.existsSync(logoPath)) {
            const logoBytes = fs.readFileSync(logoPath);
            logoImage = await pdfDoc.embedPng(logoBytes);
        }
    } catch (error) {
        console.error('Error loading logo:', error);
    }

    const totalTickets = data.items.reduce((sum, item) => sum + item.quantity, 0);
    let ticketNumber = 1;

    for (const item of data.items) {
        for (let q = 1; q <= item.quantity; q++) {
            // Horizontal layout: 800 width, 300 height
            const page = pdfDoc.addPage([800, 300]);
            const { width, height } = page.getSize();
            const stubWidth = 220;
            const mainWidth = width - stubWidth;

            // Background Color (Light premium gray)
            page.drawRectangle({
                x: 0,
                y: 0,
                width: width,
                height: height,
                color: rgb(0.98, 0.98, 1.0),
            });

            // Main Background Color
            page.drawRectangle({
                x: 0,
                y: 0,
                width: mainWidth,
                height: height,
                color: rgb(1, 1, 1),
            });

            // Draw Notches (Cutouts)
            const notchRadius = 15;
            const notchX = mainWidth;
            
            // Top Notch
            page.drawCircle({
                x: notchX,
                y: height,
                size: notchRadius,
                color: rgb(0.9, 0.9, 0.9), // Match the underlying background or transparency if possible
            });
            // Bottom Notch
            page.drawCircle({
                x: notchX,
                y: 0,
                size: notchRadius,
                color: rgb(0.9, 0.9, 0.9),
            });

            // Perforation Line
            for (let y = 10; y < height; y += 10) {
                page.drawLine({
                    start: { x: mainWidth, y: y },
                    end: { x: mainWidth, y: y + 5 },
                    thickness: 1,
                    color: rgb(0.8, 0.8, 0.8),
                });
            }

            // --- MAIN TICKET AREA ---
            
            // Event Header Bar
            page.drawRectangle({
                x: 0,
                y: height - 60,
                width: mainWidth,
                height: 60,
                color: rgb(0.05, 0.1, 0.3), // Dark Navy
            });

            page.drawText(safeText('EVENT ADMISSION TICKET'), {
                x: 30,
                y: height - 35,
                size: 10,
                font: fontBold,
                color: rgb(1, 1, 1),
            });

            // Event Title
            page.drawText(safeText(data.event_title.toUpperCase()), {
                x: 30,
                y: height - 100,
                size: 22,
                font: fontBold,
                color: rgb(0, 0, 0),
            });

            // Details
            const drawInfo = (label: string, value: string, x: number, y: number) => {
                page.drawText(safeText(label), { x, y, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) });
                page.drawText(safeText(value), { x, y: y - 18, size: 12, font: fontBold, color: rgb(0, 0, 0) });
            };

            drawInfo('DATE & TIME', data.event_date, 30, height - 140);
            drawInfo('VENUE', data.venue_name, 30, height - 200);
            drawInfo('ATTENDEE', data.attendee_name, 30, height - 260);

            drawInfo('TICKET TYPE', item.ticket_tier_name, 300, height - 140);
            drawInfo('BOOKING REF', data.booking_ref, 300, height - 200);
            drawInfo('TICKET ID', `${data.booking_ref}-${ticketNumber}`, 300, height - 260);

            // --- STUB AREA ---
            
            // Logo in stub
            if (logoImage) {
                const logoDims = logoImage.scale(0.15);
                page.drawImage(logoImage, {
                    x: mainWidth + (stubWidth / 2) - (logoDims.width / 2),
                    y: height - 60,
                    width: logoDims.width,
                    height: logoDims.height,
                });
            }

            // QR Code
            try {
                const qrData = JSON.stringify({
                    ref: data.booking_ref,
                    tid: `${data.booking_ref}-${ticketNumber}`
                });
                const qrCodeDataUrl = await QRCode.toDataURL(qrData);
                const qrCodeBase64 = qrCodeDataUrl.split(',')[1];
                const qrCodeImage = await pdfDoc.embedPng(Buffer.from(qrCodeBase64, 'base64'));

                page.drawImage(qrCodeImage, {
                    x: mainWidth + (stubWidth / 2) - 60,
                    y: 40,
                    width: 120,
                    height: 120,
                });

                page.drawText(safeText(`${ticketNumber} OF ${totalTickets}`), {
                    x: mainWidth + (stubWidth / 2) - 30,
                    y: 25,
                    size: 9,
                    font: fontBold,
                    color: rgb(0.4, 0.4, 0.4),
                });
            } catch (error) {
                console.error('Error QR:', error);
            }

            ticketNumber++;
        }
    }

    return await pdfDoc.save();
}
