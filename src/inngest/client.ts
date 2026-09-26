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

export type CallInitiatedData = {
    callId: string;
    callRef: string;
    hostId: string;
    userId: string;
    callerName?: string;
    callerEmail?: string;
    callerPhone?: string;
    durationMinutes: number;
    amount: number;
    deviceFingerprint?: string;
    deviceCallCount?: number;
    paymentMethod: 'razorpay' | 'credits';
    creditsEarned: number;
    creditsNeeded: number;
};

export type HostStatsUpdateData = {
    hostId: string;
};

type Events = {
    'host/stats.update': { data: HostStatsUpdateData };
    // other events can be typed here or fallback to generic
};

export const inngest = new Inngest({
    id: 'stranger-mingle',
});
