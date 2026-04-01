/**
 * Returns an ISO string representation in Asia/Kolkata (+05:30)
 * Example: 2026-03-29T14:00:00+05:30
 */
export function toISTISOString(dateTime: string): string {
    if (!dateTime) return '';
    try {
        const date = new Date(dateTime);
        if (isNaN(date.getTime())) return dateTime;

        const formatter = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Kolkata'
        });
        
        const parts = formatter.formatToParts(date);
        const p: Record<string, string> = {};
        parts.forEach(part => { p[part.type] = part.value; });
        
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+05:30`;
    } catch (e) {
        console.error('Error formatting IST ISO string:', e);
        return dateTime;
    }
}

export function formatEventDate(startDateTime: string, _endDateTime: string): string {
    const start = new Date(startDateTime);
    const day = start.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    const date = start.toLocaleDateString('en-US', { day: '2-digit', timeZone: 'Asia/Kolkata' });
    const month = start.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    
    return `${day} ${date} ${month}`;
}

export function formatEventTime(startDateTime: string, _endDateTime: string): string {
    const start = new Date(startDateTime);
    return start.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true,
        timeZone: 'Asia/Kolkata'
    }).toUpperCase();
}
