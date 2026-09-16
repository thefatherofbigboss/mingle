import { Inngest } from 'inngest';

export type BookingVerifiedData = {
    bookingId: string;
};

export type MembershipVerifiedData = {
    razorpayOrderId?: string | null;
    razorpaySubscriptionId?: string | null;
    razorpayPaymentId?: string | null;
    source?: 'verify' | 'webhook' | 'sync' | 'status';
    forceResendEmail?: boolean;
};

export type CreditsVerifiedData = {
    email: string;
    phone?: string;
    name?: string;
    creditsToAdd: number;
    razorpayOrderId?: string;
};

export const inngest = new Inngest({
    id: 'stranger-mingle',
});
