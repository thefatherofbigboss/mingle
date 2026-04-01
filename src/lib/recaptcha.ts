'use server';

/**
 * Utility to verify a reCAPTCHA Enterprise token via Google Assessment API.
 */
export async function verifyRecaptcha(token: string, action: string) {
    const project_id = process.env.RECAPTCHA_PROJECT_ID;
    const site_key = process.env.RECAPTCHA_SITE_KEY;
    const api_key = process.env.RECAPTCHA_API_KEY;

    if (!project_id || !site_key || !api_key) {
        console.error('[reCAPTCHA Backend] Configuration missing:', { project_id, site_key, hasApiKey: !!api_key });
        return { success: false, score: 0, error: 'reCAPTCHA configuration error' };
    }

    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${project_id}/assessments?key=${api_key}`;

    const body = {
        event: {
            token: token,
            expectedAction: action,
            siteKey: site_key,
        },
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            console.error('[reCAPTCHA Backend] Assessment API Error:', {
                status: response.status,
                error: data.error || 'Unknown error'
            });
            return { 
                success: false, 
                score: 0, 
                error: data.error?.message || `API returned ${response.status}`,
                statusCode: response.status 
            };
        }

        // Assessment successful
        const score = data.riskAnalysis?.score || 0;
        const isValid = data.tokenProperties?.valid === true;
        const isActionMatch = data.tokenProperties?.action === action;

        console.log(`[reCAPTCHA Backend] Assessment for ${action}: score=${score}, valid=${isValid}, actionMatch=${isActionMatch}`);

        return {
            success: isValid && isActionMatch,
            score,
            reasons: data.riskAnalysis?.reasons || [],
            tokenProperties: data.tokenProperties
        };
    } catch (error: any) {
        console.error('[reCAPTCHA Backend] Fetch Exception:', error.message);
        return { success: false, score: 0, error: error.message };
    }
}

