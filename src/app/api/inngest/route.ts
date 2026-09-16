import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { 
    processBookingPayment, 
    activateMembershipPayment, 
    awardCreditsPayment 
} from '@/inngest/functions/payments';
import { 
    expireWaitlistOffersCron, 
    eventRemindersCron, 
    processSavedSearchesCron, 
    analyticsSnapshotCron 
} from '@/inngest/functions/crons';

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        processBookingPayment,
        activateMembershipPayment,
        awardCreditsPayment,
        expireWaitlistOffersCron,
        eventRemindersCron,
        processSavedSearchesCron,
        analyticsSnapshotCron,
    ],
});
